import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { apiBase } from '@/lib/api';
import { getGitHubApp } from '@/lib/github';
import { siteUrl } from '@/lib/site';
import { createClient } from '@/lib/supabase/server';

// Where GitHub sends a person after they install (or reconfigure) the Posterity GitHub App. GitHub's
// user authorization code proves who they are on GitHub; the API checks with GitHub which installations
// that GitHub user administers and connects them to this Posterity account. An installation id on its
// own proves nothing (anyone can type one into this URL), so without a code we ask GitHub for one.

const STATE_COOKIE = 'gh_oauth_state';

function back(origin: string, params: Record<string, string>) {
  const url = new URL('/github', origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams, pathname, search } = request.nextUrl;
  const origin = await siteUrl();
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname + search)}`, origin));
  }

  const code = searchParams.get('code');
  const installation = searchParams.get('installation_id');
  const jar = await cookies();

  if (!code) {
    // Reached as the App's setup URL, without user authorization: get it now.
    const app = await getGitHubApp();
    if (!app.client_id) return back(origin, { github_error: 'The GitHub App is not set up on this deployment yet.' });
    const state = randomBytes(16).toString('hex');
    jar.set(STATE_COOKIE, `${state}:${installation ?? ''}`, { httpOnly: true, secure: origin.startsWith('https'), sameSite: 'lax', maxAge: 600, path: '/github' });
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', app.client_id);
    authorize.searchParams.set('redirect_uri', `${origin}/github/installed`);
    authorize.searchParams.set('state', state);
    return NextResponse.redirect(authorize);
  }

  // A state we set means this round trip started here; GitHub's own install redirect carries none.
  const saved = jar.get(STATE_COOKIE)?.value;
  const state = searchParams.get('state');
  let wanted = installation;
  if (state) {
    const [expected, savedInstallation] = (saved ?? '').split(':');
    if (!expected || expected !== state) return back(origin, { github_error: 'That GitHub sign-in did not start here. Connect GitHub again from the GitHub page.' });
    wanted ??= savedInstallation || null;
    jar.delete({ name: STATE_COOKIE, path: '/github' });
  }

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/github/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, installation_id: wanted ? Number(wanted) : null }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return back(origin, { github_error: 'Posterity could not reach GitHub just now. Try again from the GitHub page.' });
  }
  const body = (await res.json().catch(() => null)) as
    | { github_login?: string; installations?: { account?: string; connected?: boolean; error?: string }[]; error?: { message?: string } }
    | null;
  if (!res.ok) return back(origin, { github_error: body?.error?.message ?? `GitHub could not be connected (${res.status}).` });
  const connected = (body?.installations ?? []).filter((i) => i.connected);
  const failed = (body?.installations ?? []).find((i) => !i.connected);
  if (!connected.length) {
    return back(origin, { github_error: failed?.error ?? `@${body?.github_login ?? 'you'} has no Posterity GitHub App installation to connect yet.` });
  }
  return back(origin, { github: connected.map((i) => i.account).filter(Boolean).join(', ') });
}
