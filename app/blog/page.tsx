import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLd from '@/components/blog/JsonLd';
import PostCard from '@/components/blog/PostCard';
import { CATEGORIES, type CategoryKey } from '@/lib/blog/categories';
import { getPublishedPosts, getUsedCategories } from '@/lib/blog/posts.server';
import { absoluteUrl, DEFAULT_OG_IMAGE, DEFAULT_OG_IMAGE_SIZE, SITE_NAME } from '@/lib/seo/site';

const TITLE = 'AngleMotion Academy: tennis video analysis';
const DESCRIPTION =
  'Guides to analyzing tennis strokes on video: how to film, how to measure angles, and how to use the AngleMotion tools.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/blog') },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: absoluteUrl('/blog'),
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: absoluteUrl(DEFAULT_OG_IMAGE), ...DEFAULT_OG_IMAGE_SIZE }],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function BlogIndex() {
  const posts = getPublishedPosts();
  const categories = getUsedCategories() as CategoryKey[];
  return (
    <>
      <JsonLd
        data={{ '@context': 'https://schema.org', '@type': 'Blog', name: 'AngleMotion Academy', url: absoluteUrl('/blog'), description: DESCRIPTION }}
      />
      <h1>AngleMotion Academy</h1>
      <p className="blog-lede">{DESCRIPTION}</p>
      {categories.length > 0 && (
        <nav className="blog-chips" aria-label="Categories">
          {categories.map((c) => (
            <Link key={c} href={`/blog/category/${c}`}>{CATEGORIES[c].label}</Link>
          ))}
        </nav>
      )}
      {posts.length === 0 ? (
        <p>The first articles are on the way.</p>
      ) : (
        posts.map((p) => <PostCard key={p.slug} post={p} minutes={p.readingMinutes} />)
      )}
    </>
  );
}
