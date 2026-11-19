import type { MetadataRoute } from 'next';
import { SITE_URL } from './site';

/**
 * Routes crawlers must not index: the signed-in app, auth, APIs, private
 * tokens and redirect links. Everything else is public (see middleware.ts).
 * tests/seoSite.test.ts checks this list against the middleware's public list.
 */
export const PRIVATE_PATHS = [
  '/academy',
  '/actions',
  '/admin',
  '/affiliate/',
  '/analysis',
  '/api/',
  '/auth/',
  '/billing',
  '/catalog',
  '/dashboard',
  '/decoder',
  '/login',
  '/match-report',
  '/players',
  '/profile',
  '/r/',
  '/share/',
];

export function buildRobots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE_PATHS }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
