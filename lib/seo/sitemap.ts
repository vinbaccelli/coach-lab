import type { MetadataRoute } from 'next';
import { absoluteUrl } from './site';

/** Public marketing and legal pages. Each must be public in middleware.ts. */
export const STATIC_PUBLIC_PATHS = ['/', '/pricing', '/coaches', '/privacy', '/terms', '/blog'];

export interface SitemapInput {
  /** Published posts, with ISO `YYYY-MM-DD` dates. */
  posts: { slug: string; date: string; updated?: string }[];
  categories: string[];
  /** Curated coach profiles are static data; database coaches are not listed. */
  coachSlugs: string[];
}

export function buildSitemap({ posts, categories, coachSlugs }: SitemapInput): MetadataRoute.Sitemap {
  return [
    ...STATIC_PUBLIC_PATHS.map((p) => ({ url: absoluteUrl(p) })),
    ...coachSlugs.map((s) => ({ url: absoluteUrl(`/coach/${s}`) })),
    ...categories.map((c) => ({ url: absoluteUrl(`/blog/category/${c}`) })),
    ...posts.map((p) => ({ url: absoluteUrl(`/blog/${p.slug}`), lastModified: p.updated ?? p.date })),
  ];
}
