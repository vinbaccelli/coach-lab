/**
 * Sentry settings shared by the browser, server and edge inits. Pure (no
 * @sentry import), so the privacy rules can be unit-tested.
 *
 * Rules (docs/SENTRY.md):
 *  - the DSN comes from NEXT_PUBLIC_SENTRY_DSN; empty means Sentry is off;
 *  - EU region only: a DSN that is not a *.de.sentry.io one keeps Sentry off;
 *  - no session replay, no performance tracing (the inits never add them);
 *  - query strings are stripped from every URL; blob:/data: URLs, media and
 *    image file names and email addresses are removed from everything sent;
 *  - cookies, headers, request bodies and the user object are never sent.
 */

const EU_HOST = /(^|\.)de\.sentry\.io$/i;

/** True for a DSN whose ingest host is in Sentry's EU region (…ingest.de.sentry.io). */
export function isEuDsn(dsn: string | null | undefined): boolean {
  if (!dsn) return false;
  try {
    return EU_HOST.test(new URL(dsn).hostname);
  } catch {
    return false;
  }
}

/** Sentry runs only with a non-empty EU DSN. */
export function sentryEnabled(dsn: string | null | undefined): boolean {
  const d = (dsn ?? '').trim();
  return d !== '' && isEuDsn(d);
}

// ── Scrubbing ───────────────────────────────────────────────────────────────

const BLOB_URL = /\bblob:[^\s"'<>)]+/gi;
const DATA_URL = /\bdata:[a-z0-9.+-]+\/[^\s"'<>)]*/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const MEDIA_FILE = /[^\s/\\"'<>()=?#]+\.(?:mp4|m4v|mov|webm|mkv|avi|mp3|wav|m4a|aac|png|jpe?g|heic|gif|webp|pdf)\b/gi;
const URL_WITH_QUERY = /(\bhttps?:\/\/[^\s?#"'<>)]*)[?#][^\s"'<>)]*/gi;

/** Free text: removes blob:/data: URLs, media/image file names, emails and URL query strings. */
export function scrubString(text: string): string {
  return text
    .replace(BLOB_URL, 'blob:[removed]')
    .replace(DATA_URL, 'data:[removed]')
    .replace(EMAIL, '[email]')
    .replace(MEDIA_FILE, '[file]')
    .replace(URL_WITH_QUERY, '$1');
}

/** A field that holds one URL (absolute or a path): no query string, no fragment, no blob:/data:. */
export function scrubUrl(url: string): string {
  if (/^(blob|data):/i.test(url)) return url.replace(/^(blob|data):.*$/i, '$1:[removed]');
  const cut = url.search(/[?#]/);
  return scrubString(cut === -1 ? url : url.slice(0, cut));
}

const URL_KEYS = new Set(['url', 'to', 'from', 'transaction', 'request_url', 'page_url', 'href', 'src']);

function scrubDeep(value: unknown, depth: number, key?: string): unknown {
  if (typeof value === 'string') return key && URL_KEYS.has(key) ? scrubUrl(value) : scrubString(value);
  if (depth <= 0 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth - 1, key));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubDeep(v, depth - 1, k);
  return out;
}

/** Sentry beforeSend: scrubs the whole event, drops user/cookies/headers/body/query string. */
export function scrubEvent<T extends object>(event: T): T {
  const e = scrubDeep(event, 8) as Record<string, any>;
  delete e.user;
  delete e.server_name;
  if (e.request && typeof e.request === 'object') {
    delete e.request.cookies;
    delete e.request.headers;
    delete e.request.data;
    delete e.request.query_string;
    if (typeof e.request.url === 'string') e.request.url = scrubUrl(e.request.url);
  }
  return e as T;
}

/** Sentry beforeBreadcrumb: same rules for navigation/fetch/xhr/console breadcrumbs. */
export function scrubBreadcrumb<T extends object>(crumb: T): T {
  return scrubDeep(crumb, 6) as T;
}

// ── Options ─────────────────────────────────────────────────────────────────

export type SentryEnvInput = { dsn?: string; release?: string; environment?: string };

/** The init options common to the browser, server and edge runtimes. Never adds replay or tracing. */
export function sentryBaseOptions(env: SentryEnvInput) {
  const dsn = (env.dsn ?? '').trim();
  const enabled = sentryEnabled(dsn);
  return {
    dsn: enabled ? dsn : undefined,
    enabled,
    release: env.release || undefined,
    environment: env.environment || 'development',
    sendDefaultPii: false,
    maxBreadcrumbs: 30,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

/** Read from the build-time env (each access is a literal so Next inlines it into the browser bundle). */
export function sentryEnvFromProcess(): SentryEnvInput {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  };
}
