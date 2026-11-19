import { isCategory, type CategoryKey } from './categories';

/** Parsed and validated article metadata. */
export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  /** `YYYY-MM-DD` */
  date: string;
  updated?: string;
  category: CategoryKey;
  author: string;
  /** Site-relative image path, or an https URL. */
  image?: string;
  draft: boolean;
}

export interface ParsedFile {
  data: Record<string, string>;
  body: string;
}

/**
 * Splits `---` front matter from the body. Front matter is flat `key: value`
 * lines (optionally quoted); anything richer is rejected on purpose so posts
 * stay easy to write and review.
 */
export function splitFrontMatter(raw: string): ParsedFile | null {
  const m = raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const data: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { data, body: m[2].trim() };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validDate(v: string): boolean {
  return DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** Validates front matter and returns the post's metadata, or throws with the reason and the file. */
export function parseMeta(slug: string, data: Record<string, string>): PostMeta {
  const fail = (why: string): never => {
    throw new Error(`blog post "${slug}": ${why}`);
  };
  if (!SLUG.test(slug)) fail('the file name must be lowercase words joined by hyphens');
  const req = (k: string): string => data[k]?.trim() || fail(`missing "${k}"`);

  const title = req('title');
  const description = req('description');
  const date = req('date');
  const category = req('category');
  if (title.length > 70) fail(`title is ${title.length} characters; keep it at 70 or fewer`);
  if (description.length > 160) fail(`description is ${description.length} characters; keep it at 160 or fewer`);
  if (!validDate(date)) fail('date must be YYYY-MM-DD');
  if (data.updated && !validDate(data.updated)) fail('updated must be YYYY-MM-DD');
  if (!isCategory(category)) fail(`unknown category "${category}"`);
  const image = data.image?.trim();
  if (image && !(image.startsWith('/') && !image.startsWith('//')) && !image.startsWith('https://')) {
    fail('image must be a site path starting with / or an https URL');
  }
  const draft = (data.draft ?? 'false').trim().toLowerCase();
  if (draft !== 'true' && draft !== 'false') fail('draft must be true or false');

  return {
    slug,
    title,
    description,
    date,
    updated: data.updated?.trim() || undefined,
    category: category as CategoryKey,
    author: data.author?.trim() || 'Vin Baccelli',
    image: image || undefined,
    draft: draft === 'true',
  };
}
