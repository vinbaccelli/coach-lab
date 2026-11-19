import Link from 'next/link';
import { CATEGORIES } from '@/lib/blog/categories';
import type { PostMeta } from '@/lib/blog/frontMatter';

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default function PostCard({ post, minutes }: { post: PostMeta; minutes: number }) {
  return (
    <article className="blog-card">
      <p className="blog-meta">
        <Link href={`/blog/category/${post.category}`}>{CATEGORIES[post.category].label}</Link>
        <span aria-hidden="true"> · </span>
        <time dateTime={post.date}>{formatDate(post.date)}</time>
        <span aria-hidden="true"> · </span>
        {minutes} min read
      </p>
      <h2><Link href={`/blog/${post.slug}`}>{post.title}</Link></h2>
      <p>{post.description}</p>
    </article>
  );
}
