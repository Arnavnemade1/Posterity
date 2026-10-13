import path from 'node:path';
import type { NextConfig } from 'next';

// Sent with every response. The Content-Security-Policy is per request (it carries a nonce), so it is set in proxy.ts.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

// The preview origin's host (PREVIEW_ORIGIN, set at build and at run time), if previews are switched on.
const previewHost = (() => {
  try {
    // Route conditions compare the hostname, without a port.
    return process.env.PREVIEW_ORIGIN ? new URL(process.env.PREVIEW_ORIGIN).hostname : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  turbopack: {
    // The app lives in web/ inside the repository; keep Turbopack scoped to it.
    root: path.join(__dirname),
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  poweredByHeader: false,
  // Previews are served at /<id>/ and a folder needs its trailing slash; the proxy handles slashes itself
  // (it still redirects the app's own paths to the form without one).
  skipTrailingSlashRedirect: true,
  // The commons became the timeline; /connect became the developer page.
  async redirects() {
    return [
      { source: '/commons', has: [{ type: 'query', key: 'tag', value: '(?<tag>.+)' }], destination: '/explore?tag=:tag', permanent: true },
      { source: '/commons', destination: '/home', permanent: true },
      { source: '/commons/:id', destination: '/p/:id', permanent: true },
      { source: '/connect', destination: '/developers', permanent: true },
      { source: '/dashboard', destination: '/control', permanent: true },
    ];
  },
  async headers() {
    // Not on the preview origin: previews are framed by the app and set their own headers (a sandbox,
    // and frame-ancestors), and these would forbid framing. Headers match the URL as requested, before
    // the proxy rewrites it, so the host is what tells them apart.
    return [
      {
        source: '/:path*',
        ...(previewHost ? { missing: [{ type: 'host' as const, value: previewHost.replace(/[.]/g, '\\.') }] } : {}),
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
