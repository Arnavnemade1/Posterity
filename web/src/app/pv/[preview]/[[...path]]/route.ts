// Serves a preview: the files of one commit of a workspace, on the preview origin only.
//
// proxy.ts rewrites <preview origin>/<id>/<path> here and answers 404 for /pv on the app's own
// origin, so this handler never runs next to the app's cookies. The bytes come from the API (no
// storage key lives on this host); this adds the content type, the sandbox and a banner.
import { type NextRequest } from 'next/server';
import { apiRaw } from '@/lib/api';
import { bannerHtml, contentTypeFor, injectBanner, PREVIEW_ID, previewHeaders, previewHost } from '@/lib/preview';
import { configuredSiteUrl } from '@/lib/site';

const MAX_HTML = 5_000_000;

function plain(status: number, message: string, parent: string | null, extra: Record<string, string> = {}) {
  return new Response(message, {
    status,
    headers: { ...previewHeaders(parent), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

const decode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ preview: string; path?: string[] }> }) {
  const site = configuredSiteUrl();
  const host = request.headers.get('host')?.toLowerCase();
  // Only ever served on the preview origin; the app's own origin gets a 404 from the proxy, and this
  // is the second lock on the same door.
  if (!host || host !== previewHost()) return plain(404, 'Not found', site);

  const { preview, path } = await params;
  if (!PREVIEW_ID.test(preview)) return plain(404, 'Preview not found', site);
  const rel = (path ?? []).map(decode).join('/');

  // The path as the visitor asked for it: the proxy keeps it, since this URL is the rewritten one.
  const original = request.headers.get('x-pv-path') ?? `/${preview}${rel ? `/${rel}` : ''}`;

  let upstream: Response;
  try {
    upstream = await apiRaw(`/previews/${preview}/file`, { path: rel });
  } catch {
    return plain(502, 'The preview could not be loaded; try again in a moment.', site);
  }
  if (upstream.status === 404) return plain(404, 'Not found in this preview', site);
  if (upstream.status === 429) return plain(429, 'Too many requests; slow down', site, { 'Retry-After': '30' });
  if (!upstream.ok) return plain(502, 'The preview could not be loaded; try again in a moment.', site);

  const resolved = decode(upstream.headers.get('x-posterity-path') ?? rel);
  // A folder asked for without its trailing slash: send it there, so relative links resolve inside it.
  if (upstream.headers.get('x-posterity-dir') === '1' && !original.endsWith('/')) {
    return new Response(null, {
      status: 308,
      headers: { ...previewHeaders(site), Location: `${original}/${request.nextUrl.search}`, 'Cache-Control': 'public, max-age=300' },
    });
  }

  const type = contentTypeFor(resolved);
  const headers: Record<string, string> = {
    ...previewHeaders(site),
    'Content-Type': type,
    // The commit never changes; only revoking can end a preview, so a short shelf life is enough.
    'Cache-Control': 'public, max-age=300, s-maxage=300',
    'X-Posterity-Commit': upstream.headers.get('x-posterity-commit') ?? '',
  };

  if (type.startsWith('text/html')) {
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length > MAX_HTML) return plain(413, 'Page too large', site);
    const banner = bannerHtml({
      workspace: upstream.headers.get('x-posterity-workspace') ?? '',
      commit: upstream.headers.get('x-posterity-commit') ?? '',
      publisher: decode(upstream.headers.get('x-posterity-published-by') ?? '') || null,
      site,
    });
    return new Response(injectBanner(new TextDecoder().decode(bytes), banner), { status: 200, headers });
  }
  return new Response(upstream.body, { status: 200, headers });
}
