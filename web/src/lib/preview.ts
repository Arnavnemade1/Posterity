// Previews: agent-built pages served from their own origin.
//
// The app and the previews live on different sites (vercel.app is on the Public Suffix List, so
// posterity-1.vercel.app and posterity-preview.vercel.app share no cookies or storage), and every
// preview response carries a CSP sandbox, so a preview runs with a throwaway origin even when it is
// opened on its own. This module holds the pieces both the proxy and the route handler need.

/** The preview origin (scheme and host), or null when none is configured. */
export function previewOrigin(): string | null {
  const value = process.env.PREVIEW_ORIGIN?.trim();
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** The preview origin's host (with port), for matching the Host header. */
export function previewHost(): string | null {
  const origin = previewOrigin();
  return origin ? new URL(origin).host.toLowerCase() : null;
}

/** Where a preview lives, for iframes and links. */
export function previewUrl(id: string): string | null {
  const origin = previewOrigin();
  return origin ? `${origin}/${id}/` : null;
}

export const PREVIEW_ID = /^[0-9a-f]{20}$/;

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  wasm: 'application/wasm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/** The content type for a file name; anything unknown downloads instead of rendering. */
export function contentTypeFor(path: string): string {
  const ext = path.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
  return TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Headers for every preview response. The sandbox gives the page a unique origin (no cookies, no
 * storage, no access to the app) even when it is opened directly; connect-src keeps it from calling
 * other sites; only the app may frame it.
 */
export function previewHeaders(parent: string | null): Record<string, string> {
  const ancestors = parent ?? (process.env.NODE_ENV === 'development' ? 'http://localhost:*' : "'none'");
  return {
    'Content-Security-Policy': [
      'sandbox allow-scripts allow-forms allow-popups allow-modals',
      "connect-src 'self'",
      "form-action 'self'",
      "object-src 'none'",
      `frame-ancestors ${ancestors}`,
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The note shown over every page of a preview, so nobody mistakes an agent's page for the app's.
 * It is not a security boundary (the page can remove it); the origin and the sandbox are.
 */
export function bannerHtml(info: { workspace: string; commit: string; publisher: string | null; site: string | null }): string {
  const who = info.publisher ? ` · @${escapeHtml(info.publisher)}` : '';
  const link = info.site ? `${escapeHtml(info.site)}/build/${encodeURIComponent(info.workspace)}` : null;
  const name = link
    ? `<a href="${link}" target="_blank" rel="noopener" style="color:#e2a94b;text-decoration:none">${escapeHtml(info.workspace)}</a>`
    : escapeHtml(info.workspace);
  return (
    '<div id="posterity-preview-banner" style="all:initial;position:fixed;z-index:2147483647;left:12px;bottom:12px;' +
    'display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:6px 6px 6px 12px;border-radius:999px;' +
    'background:rgba(9,9,11,.9);color:#e7e9ea;border:1px solid #3a3e43;font:500 12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;' +
    'box-shadow:0 4px 18px rgba(0,0,0,.35)">' +
    `<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Agent-built preview on Posterity · ${name} · ${escapeHtml(info.commit.slice(0, 7))}${who}</span>` +
    '<button type="button" aria-label="Hide this note" onclick="this.parentNode.remove()" ' +
    'style="all:unset;cursor:pointer;width:22px;height:22px;border-radius:50%;text-align:center;line-height:22px;color:#a2a8ae;font-size:14px">×</button>' +
    '</div>'
  );
}

/** The page with the banner just before </body> (or at the end when it has none). */
export function injectBanner(html: string, banner: string): string {
  const index = html.search(/<\/body\s*>/i);
  return index === -1 ? html + banner : html.slice(0, index) + banner + html.slice(index);
}
