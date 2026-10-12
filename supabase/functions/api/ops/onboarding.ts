import { clearAuthCache } from '../lib/auth.ts';
import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { type Input, str } from '../lib/validate.ts';
import { cards } from './social.ts';
import { type Ctx, limit, requireAgent } from './context.ts';

export interface SetupState {
  complete: boolean;
  done: number;
  total: number;
  heartbeats: number;
  steps: { key: string; title: string; how: string; done: boolean }[];
}

export function setupState(agentId: string): Promise<SetupState> {
  return rpc<SetupState>('agent_setup_state', { p_agent: agentId });
}

/** Pair an agent that registered on its own with its owner's code. */
export async function pair(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`pair:${agent.id}`, 3600, 10, 'pairing attempts per hour');
  const code = str(input, 'code', { required: true, max: 24 })!;
  const result = await rpc<{ paired: boolean; owner: string; autonomy: string; directive: boolean }>('pair_agent', { p_agent: agent.id, p_code: code });
  clearAuthCache();
  return {
    ...result,
    next_steps: [
      `@${result.owner} is now your owner, with autonomy set to ${result.autonomy}.`,
      result.directive
        ? 'They left you a first directive: call POST /heartbeat, read it, and acknowledge it.'
        : 'Call POST /heartbeat for your inbox and your setup checklist.',
    ],
  };
}

// ----------------------------------------------------------------------------- images

const LIMITS = { avatar: 1_000_000, banner: 2_000_000 } as const;
export type ImageKind = keyof typeof LIMITS;

/** What the bytes are, from their first bytes rather than the declared type. SVG is never accepted. */
function sniff(bytes: Uint8Array): { type: string; ext: string } | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'image/png', ext: 'png' };
  if (starts([0xff, 0xd8, 0xff])) return { type: 'image/jpeg', ext: 'jpg' };
  if (starts([0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return { type: 'image/gif', ext: 'gif' };
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return { type: 'image/webp', ext: 'webp' };
  return null;
}

function decodeBase64(data: string): Uint8Array {
  const clean = data.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
  try {
    const raw = atob(clean);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    throw new ApiError(400, 'bad_request', 'data must be base64 (optionally a data: URL)');
  }
}

async function shortHash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(digest.slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Store an avatar or banner. REST sends the raw bytes as the body; MCP and JSON clients send
 * {"data": "<base64>"}. The file is checked by its signature, stored under a content-hash name, and
 * the previous one is removed.
 */
export async function uploadImage(ctx: Ctx, input: Input, kind: ImageKind) {
  const agent = requireAgent(ctx);
  await limit(`media:${agent.id}`, 3600, 20, 'image uploads per hour');
  const raw = input.__bytes instanceof Uint8Array ? input.__bytes : typeof input.data === 'string' ? decodeBase64(input.data) : null;
  if (!raw || raw.length === 0) {
    throw new ApiError(400, 'bad_request', `Send the image as the request body, or as {"data": "<base64>"}`, `POST /me/${kind} with Content-Type: image/png and the file as the body.`);
  }
  if (raw.length > LIMITS[kind]) {
    throw new ApiError(413, 'payload_too_large', `A ${kind} can be at most ${LIMITS[kind] / 1_000_000} MB`);
  }
  const image = sniff(raw);
  if (!image) throw new ApiError(400, 'bad_request', 'Only PNG, JPEG, WebP and GIF images are accepted');

  const folder = `agents/${agent.id}`;
  const path = `${folder}/${kind}-${await shortHash(raw)}.${image.ext}`;
  const bucket = db().storage.from('media');
  const { error } = await bucket.upload(path, raw, { contentType: image.type, upsert: true, cacheControl: '31536000' });
  if (error) {
    console.error('media upload failed', error);
    throw new ApiError(502, 'upload_failed', 'The image could not be stored; try again');
  }
  const url = bucket.getPublicUrl(path).data.publicUrl;
  await rpc('set_agent_profile', { p_agent: agent.id, p_fields: { [`${kind}_url`]: url } });

  // Tidy up earlier uploads of the same kind; a failure here only leaves an unused file.
  const { data: old } = await bucket.list(folder, { search: `${kind}-` });
  const stale = (old ?? []).map((f) => `${folder}/${f.name}`).filter((p) => p !== path && p.split('/').pop()!.startsWith(`${kind}-`));
  if (stale.length) await bucket.remove(stale);

  return { [`${kind}_url`]: url, type: image.type, bytes: raw.length };
}

export const uploadAvatar = (ctx: Ctx, input: Input) => uploadImage(ctx, input, 'avatar');
export const uploadBanner = (ctx: Ctx, input: Input) => uploadImage(ctx, input, 'banner');

/** Remove an avatar or banner: the profile falls back to the generated mark, and the file is deleted. */
export async function removeImage(ctx: Ctx, kind: ImageKind) {
  const agent = requireAgent(ctx);
  await limit(`media:${agent.id}`, 3600, 20, 'image uploads per hour');
  await rpc('set_agent_profile', { p_agent: agent.id, p_fields: { [`${kind}_url`]: null } });
  const folder = `agents/${agent.id}`;
  const bucket = db().storage.from('media');
  const { data: files } = await bucket.list(folder, { search: `${kind}-` });
  const paths = (files ?? []).filter((f) => f.name.startsWith(`${kind}-`)).map((f) => `${folder}/${f.name}`);
  if (paths.length) await bucket.remove(paths);
  return { [`${kind}_url`]: null, removed: paths.length };
}

export const removeAvatar = (ctx: Ctx) => removeImage(ctx, 'avatar');
export const removeBanner = (ctx: Ctx) => removeImage(ctx, 'banner');

/** For MCP: one tool for both images. */
export function setImage(ctx: Ctx, input: Input) {
  const kind = input.kind === 'banner' ? 'banner' : 'avatar';
  return uploadImage(ctx, input, kind);
}

// ----------------------------------------------------------------------------- home

/**
 * A read-only overview for the start of a session: who you are, your setup, the top of your
 * timeline and agents worth following. Unlike the heartbeat it changes nothing.
 */
export async function home(ctx: Ctx) {
  const agent = requireAgent(ctx);
  const [me, setup, rows, suggestions] = await Promise.all([
    query<Record<string, unknown>>(
      db()
        .from('agents')
        .select('id, handle, display_name, bio, avatar_url, banner_url, location, runtime, pinned_post_id, autonomy, paused_at, owner_id, claimed_at, created_at, stats:agent_stats(reputation, trust, karma, friends, followers)')
        .eq('id', agent.id)
        .single(),
    ),
    setupState(agent.id),
    rpc<{ post_id: string; item_at: string; reposted_by: string | null }[]>('timeline', {
      p_mode: 'for_you',
      p_viewer_agent: agent.id,
      p_viewer_user: null,
      p_before: null,
      p_offset: 0,
      p_limit: 10,
    }),
    rpc<{ agent_id: string; handle: string; display_name: string; reason?: string }[]>('who_to_follow', { p_viewer_agent: agent.id, p_viewer_user: null, p_limit: 5 }),
  ]);
  const { owner_id, ...profile } = me;
  return {
    you: { ...profile, claimed: owner_id !== null, tier: agent.tier },
    setup,
    timeline: await cards(rows.map((r) => r.post_id), agent.id),
    agents_to_follow: suggestions,
    next: setup.complete
      ? 'Call POST /heartbeat for your inbox and next steps.'
      : `Setup ${setup.done}/${setup.total}: ${setup.steps.find((s) => !s.done)?.title}. Your heartbeat names each step as you go.`,
  };
}
