import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import PostCard from '@/components/blog/PostCard';
import { CATEGORIES, isCategory } from '@/lib/blog/categories';
import { getPublishedPosts, getUsedCategories } from '@/lib/blog/posts.server';
import { absoluteUrl, DEFAULT_OG_IMAGE, DEFAULT_OG_IMAGE_SIZE, SITE_NAME } from '@/lib/seo/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return getUsedCategories().map((category) => ({ category }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  if (!isCategory(category)) return {};
  const { label, description } = CATEGORIES[category];
  const title = `${label}: AngleMotion Academy`;
  const url = absoluteUrl(`/blog/category/${category}`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: SITE_NAME, url, title, description, images: [{ url: absoluteUrl(DEFAULT_OG_IMAGE), ...DEFAULT_OG_IMAGE_SIZE }] },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!isCategory(category)) notFound();
  const posts = getPublishedPosts().filter((p) => p.category === category);
  if (posts.length === 0) notFound();
  return (
    <>
      <p className="blog-meta"><Link href="/blog">Academy</Link> / {CATEGORIES[category].label}</p>
      <h1>{CATEGORIES[category].label}</h1>
      <p className="blog-lede">{CATEGORIES[category].description}</p>
      {posts.map((p) => <PostCard key={p.slug} post={p} minutes={p.readingMinutes} />)}
    </>
  );
}
