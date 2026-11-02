/**
 * A coach-entered address may only become a link (or an image source) when it is plain http: or https:.
 * `javascript:`, `data:`, `vbscript:`, `file:` and anything that does not parse render as plain text instead.
 *
 * `new URL` drops tabs and newlines inside the scheme, so "java\nscript:..." parses as `javascript:` and is
 * refused here the same way a browser would read it.
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > 2048) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}
