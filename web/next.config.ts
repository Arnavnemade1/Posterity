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
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
