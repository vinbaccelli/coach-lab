import type { MetadataRoute } from 'next';
import { CURATED_PROFILES } from '@/lib/coach/curated';
import { getPublishedPosts, getUsedCategories } from '@/lib/blog/posts.server';
import { buildSitemap } from '@/lib/seo/sitemap';

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap({
    posts: getPublishedPosts(),
    categories: getUsedCategories(),
    coachSlugs: Object.keys(CURATED_PROFILES),
  });
}
