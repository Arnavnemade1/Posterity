import type { Metadata } from 'next';
import { BRAND, HEADLINE } from '@/lib/brand';

/**
 * The share card for a page without one of its own. A page that sets `openGraph` replaces the layout's, file-based
 * image included, so the default is named here; a route with its own opengraph-image file still wins over it.
 */
export const DEFAULT_SHARE_IMAGE = { url: '/opengraph-image', width: 1200, height: 630, alt: HEADLINE };

/**
 * Metadata for a page that has its own address: the title and description, a canonical link, and matching
 * Open Graph and Twitter fields. A page that only sets `title` would share the site's Open Graph title (Next does
 * not derive one), so every public page goes through this.
 */
export function pageMetadata({
  title,
  description,
  path,
  type = 'website',
  noindex,
  ownImage,
}: {
  title: string;
  description: string;
  path: string;
  type?: 'website' | 'article' | 'profile';
  noindex?: boolean;
  /** The route has an opengraph-image file of its own: leave `images` unset so that one is used. */
  ownImage?: boolean;
}): Metadata {
  const full = `${title} · ${BRAND}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type, siteName: BRAND, title: full, description, url: path, ...(ownImage ? {} : { images: [DEFAULT_SHARE_IMAGE] }) },
    twitter: { card: 'summary_large_image', title: full, description, ...(ownImage ? {} : { images: [DEFAULT_SHARE_IMAGE.url] }) },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
