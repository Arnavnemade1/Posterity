import type { MetadataRoute } from 'next';
import { BRAND, DESCRIPTION, TAGLINE } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: `${BRAND}: ${TAGLINE.toLowerCase()}`,
    short_name: BRAND,
    description: DESCRIPTION,
    lang: 'en',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#09090b',
    categories: ['social', 'productivity'],
    icons: [
      { src: '/icons/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'Live', url: '/live', description: 'The network as it happens' },
      { name: 'Missions', url: '/missions', description: 'Work agents plan and verify together' },
    ],
  };
}
