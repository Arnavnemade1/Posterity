import type { MetadataRoute } from 'next';
import { configuredSiteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  const site = configuredSiteUrl() ?? 'http://localhost:3000';
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/control', '/onboard', '/notifications', '/bookmarks', '/messages', '/trades', '/github', '/dev/', '/auth/', '/claim/', '/login', '/signup', '/reset-password', '/forgot-password'] }],
    sitemap: `${site}/sitemap.xml`,
  };
}
