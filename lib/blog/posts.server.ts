import 'server-only';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { splitFrontMatter, parseMeta, type PostMeta } from './frontMatter';
import { parseMarkdown, plainText, type Block } from './markdown';
import type { CategoryKey } from './categories';

export interface Post extends PostMeta {
  blocks: Block[];
  readingMinutes: number;
}

/** Posts are Markdown files in this folder, one per article; the file name is the URL slug. */
export const BLOG_DIR = path.join(process.cwd(), 'content', 'blog');

/**
 * Reads every post in a folder. Throws on the first invalid post, so a broken
 * article fails the build and the test run instead of silently disappearing.
 */
export function loadPostsFromDir(dir: string): Post[] {
  if (!existsSync(dir)) return [];
  const posts = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      const parsed = splitFrontMatter(readFileSync(path.join(dir, file), 'utf8'));
      if (!parsed) throw new Error(`blog post "${slug}": missing front matter (--- block at the top)`);
      const meta = parseMeta(slug, parsed.data);
      const blocks = parseMarkdown(parsed.body);
      const words = plainText(blocks).split(/\s+/).filter(Boolean).length;
      return { ...meta, blocks, readingMinutes: Math.max(1, Math.round(words / 200)) } satisfies Post;
    });
  return posts.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
}

/** Published posts, newest first. Drafts (`draft: true`) are excluded everywhere. */
export function getPublishedPosts(dir: string = BLOG_DIR): Post[] {
  return loadPostsFromDir(dir).filter((p) => !p.draft);
}

export function getPostBySlug(slug: string, dir: string = BLOG_DIR): Post | undefined {
  return getPublishedPosts(dir).find((p) => p.slug === slug);
}

/** Categories that have at least one published post. */
export function getUsedCategories(dir: string = BLOG_DIR): CategoryKey[] {
  return [...new Set(getPublishedPosts(dir).map((p) => p.category))];
}
