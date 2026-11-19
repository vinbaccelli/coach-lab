import type { Metadata } from 'next';

/**
 * The public site's identity, in one place: metadata, sitemap, robots and
 * structured data all read it, so the canonical host can change in one line.
 *
 * Canonical host is `www`: the app's own links (affiliate links, privacy page)
 * already use it. The apex serves the same pages today; making it redirect to
 * `www` is a Vercel Domains setting, not code (docs/BLOG.md).
 */
export const SITE_URL = 'https://www.anglemotion.com';
export const SITE_NAME = 'AngleMotion';

/** Free one-hour trial entry (lib/plans.ts DEMO.url): sign in, then straight into the app. */
export const TRIAL_PATH = '/login?redirect=/analysis';

/**
 * Default social preview. 980x551 is below the 1200x630 many platforms
 * recommend but works everywhere; a dedicated branded image can replace it by
 * changing this one constant.
 */
export const DEFAULT_OG_IMAGE = '/logo-rect-new.jpg';
export const DEFAULT_OG_IMAGE_SIZE = { width: 980, height: 551 } as const;

/** Every sentence is a fact the app already states (lib/plans.ts, PRODUCT.md). */
export const SITE_DESCRIPTION =
  'Video analysis for tennis coaches: AI skeleton, joint angles and a timeline of every player’s progress. Try every tool free for one hour.';

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Serialises structured data for a <script type="application/ld+json"> tag.
 * `<`, `>` and `&` are escaped so a value can never close the script element.
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

/**
 * Metadata for a public page that is not the home page: its own title and
 * description, a canonical URL on the canonical host, and matching social
 * previews. Next only inherits the root's Open Graph block, so a page that set
 * just `title` would share the HOME page's title and text; use this instead.
 */
export function pageMetadata(o: { title: string; description: string; path: string; noindex?: boolean }): Metadata {
  const url = absoluteUrl(o.path);
  const image = absoluteUrl(DEFAULT_OG_IMAGE);
  return {
    title: o.title,
    description: o.description,
    alternates: { canonical: url },
    ...(o.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: 'website', siteName: SITE_NAME, url, title: o.title, description: o.description, images: [{ url: image, ...DEFAULT_OG_IMAGE_SIZE }] },
    twitter: { card: 'summary_large_image', title: o.title, description: o.description, images: [image] },
  };
}
