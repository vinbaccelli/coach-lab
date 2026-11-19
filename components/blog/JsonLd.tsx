import { jsonLdString } from '@/lib/seo/site';

/**
 * Structured data for search engines. `dangerouslySetInnerHTML` is required for
 * a script element's text; the value is machine-built from our own data and
 * passed through `jsonLdString`, which escapes `<`, `>` and `&` so no value can
 * close the tag. It is not a pattern for rendering any other HTML.
 */
export default function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
