import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import JsonLd from '@/components/blog/JsonLd';
import Markdown from '@/components/blog/Markdown';
import { TrialCta } from '@/components/blog/BlogChrome';
import PostCard, { formatDate } from '@/components/blog/PostCard';
import { getAuthor } from '@/lib/blog/authors';
import { CATEGORIES } from '@/lib/blog/categories';
import { getPostBySlug, getPublishedPosts } from '@/lib/blog/posts.server';
import { absoluteUrl, DEFAULT_OG_IMAGE, DEFAULT_OG_IMAGE_SIZE, SITE_NAME } from '@/lib/seo/site';

// Only the slugs that exist at build time are valid; anything else is a real 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return getPublishedPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  const url = absoluteUrl(`/blog/${post.slug}`);
  const image = absoluteUrl(post.image ?? DEFAULT_OG_IMAGE);
  const author = getAuthor(post.author);
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url },
    authors: author ? [{ name: author.name, url: absoluteUrl(author.url) }] : [{ name: post.author }],
    openGraph: {
      type: 'article',
      siteName: SITE_NAME,
      url,
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: [post.author],
      images: [{ url: image, ...(post.image ? {} : DEFAULT_OG_IMAGE_SIZE) }],
    },
    twitter: { card: 'summary_large_image', title: post.title, description: post.description, images: [image] },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const url = absoluteUrl(`/blog/${post.slug}`);
  const author = getAuthor(post.author);
  const related = getPublishedPosts().filter((p) => p.category === post.category && p.slug !== post.slug).slice(0, 2);

  return (
    <article>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.title,
          description: post.description,
          datePublished: post.date,
          dateModified: post.updated ?? post.date,
          image: [absoluteUrl(post.image ?? DEFAULT_OG_IMAGE)],
          mainEntityOfPage: { '@type': 'WebPage', '@id': url },
          author: { '@type': 'Person', name: post.author, ...(author ? { url: absoluteUrl(author.url) } : {}) },
          publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: absoluteUrl('/logo-square-new.jpg') } },
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
            { '@type': 'ListItem', position: 2, name: 'Blog', item: absoluteUrl('/blog') },
            { '@type': 'ListItem', position: 3, name: post.title, item: url },
          ],
        }}
      />
      <p className="blog-meta">
        <Link href="/blog">Blog</Link> / <Link href={`/blog/category/${post.category}`}>{CATEGORIES[post.category].label}</Link>
      </p>
      <h1>{post.title}</h1>
      <p className="blog-byline">
        By {author ? <Link href={author.url}>{post.author}</Link> : post.author}
        <span aria-hidden="true"> · </span>
        <time dateTime={post.date}>{formatDate(post.date)}</time>
        {post.updated && <> <span aria-hidden="true">· </span>Updated <time dateTime={post.updated}>{formatDate(post.updated)}</time></>}
        <span aria-hidden="true"> · </span>
        {post.readingMinutes} min read
      </p>
      <Markdown blocks={post.blocks} />
      <TrialCta />
      {author && (
        <section className="blog-author" aria-label="About the author">
          <h2>About {author.name}</h2>
          <p>{author.bio}</p>
          <p><Link href={author.url}>See {author.name}’s coaching profile</Link></p>
        </section>
      )}
      {related.length > 0 && (
        <section aria-label="Related articles">
          <h2>Related articles</h2>
          {related.map((p) => <PostCard key={p.slug} post={p} minutes={p.readingMinutes} />)}
        </section>
      )}
    </article>
  );
}
