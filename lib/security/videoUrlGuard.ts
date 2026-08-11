/**
 * SSRF / open-proxy guard for the video routes.
 *
 * ── WHAT WAS WRONG ────────────────────────────────────────────────────────
 * `/api/video/stream` and `/api/video/resolve` accepted ANY url whose string
 * merely began with `http://` or `https://`, with no authentication. That is an
 * open proxy on a public domain: anyone could stream arbitrary bytes through
 * anglemotion.com (bandwidth billed to the account, domain usable as an
 * anonymizer) and probe internal addresses through the server's own network
 * position.
 *
 * ── THE POLICY, AND WHY IT IS LAYERED RATHER THAN A PLAIN ALLOWLIST ──────
 * A pure host allowlist was the obvious fix and would have broken a real
 * feature: pasting a direct video-file URL is supported on purpose (see the
 * "Fast path: direct video URL" branch in app/analysis/page.tsx), and a coach's
 * own .mp4 can legitimately live on any host. So the guard is three independent
 * layers, and a request must pass all of them:
 *
 *   1. AUTH (enforced by the routes, not here) — only a signed-in coach may use
 *      these routes at all. This alone removes the anonymous-abuse vector, which
 *      is the bulk of the risk.
 *   2. NON-PUBLIC ADDRESSES ARE REFUSED, always, whatever the host — loopback,
 *      RFC1918, link-local (incl. the 169.254.169.254 cloud metadata address),
 *      CGNAT, IPv6 loopback/ULA/link-local, and internal-sounding names. This is
 *      the SSRF block and no allowlist entry can bypass it.
 *   3. HOST/SHAPE — the known infrastructure hosts are always allowed; any other
 *      PUBLIC host is allowed only when the URL is a direct video file
 *      (.mp4/.webm/.mov), which is exactly what the client already gates on. So
 *      the proxy will not fetch arbitrary HTML/JSON from arbitrary hosts, which
 *      is what made it useful as an anonymizer and a probe.
 *
 * Set `VIDEO_PROXY_STRICT_HOSTS=1` to drop layer 3's video-file escape hatch and
 * run as a pure allowlist. That disables pasting a self-hosted video URL, so it
 * is opt-in rather than the default.
 *
 * ── KNOWN RESIDUAL RISK ──────────────────────────────────────────────────
 * Hostnames are checked as written; this does not resolve DNS and then pin the
 * connection, so a public name that RESOLVES to a private address (DNS
 * rebinding) is not caught here. Closing that needs resolve-then-connect control
 * that the serverless fetch does not expose. Given layer 1 restricts this to
 * authenticated coaches and layer 3 restricts the response shape, the remaining
 * exposure is small and is recorded here rather than left implicit.
 */

/** Hosts the app genuinely streams from, matched on the host or any subdomain. */
const ALLOWED_HOST_SUFFIXES = [
  // YouTube's CDN — where a resolved (signed) stream URL actually lives. This is
  // the single most common input to /api/video/stream.
  'googlevideo.com',
  'youtube.com',
  'youtu.be',
  'ytimg.com',
  // Supabase storage — coach uploads served from the project's own bucket.
  'supabase.co',
  'supabase.in',
  // The Cloudflare Worker that resolves YouTube URLs (NEXT_PUBLIC_YT_RESOLVER_URL).
  'workers.dev',
];

/** Direct video files the "paste a URL" fast path is built around. */
const VIDEO_FILE_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

export interface UrlGuardFailure {
  ok: false;
  status: number;
  error: string;
}
export interface UrlGuardSuccess {
  ok: true;
  url: URL;
}
export type UrlGuardResult = UrlGuardSuccess | UrlGuardFailure;

const deny = (status: number, error: string): UrlGuardFailure => ({ ok: false, status, error });

/** Strip brackets from an IPv6 literal host, lowercase everything else. */
function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

/**
 * Is this host a non-public address we must never fetch?
 *
 * Deliberately generous: anything that even looks internal is refused. A false
 * refusal costs a coach one unusual URL; a false accept is an SSRF.
 */
export function isBlockedHost(hostnameRaw: string): boolean {
  const host = normalizeHost(hostnameRaw);
  if (!host) return true;

  // Internal-sounding names, including the cloud metadata hostname.
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    host === 'metadata.google.internal'
  ) return true;

  // IPv6 literals: loopback, unspecified, ULA (fc00::/7), link-local (fe80::/10).
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
    // IPv4-mapped IPv6 — re-check the embedded v4.
    //
    // TWO FORMS, and the second is the one that matters: `new URL()` NORMALIZES
    // `[::ffff:10.0.0.1]` to `[::ffff:a00:1]`, so a dotted-quad match alone
    // silently lets every private address through in hex. Caught by the guard
    // test suite, which is exactly why that suite exists.
    const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDotted) return isBlockedHost(mappedDotted[1]);

    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isBlockedHost(v4);
    }
    return false;
  }

  // IPv4 literals.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if ([a, b, Number(m[3]), Number(m[4])].some((n) => Number.isNaN(n) || n > 255)) return true;
    if (a === 0) return true;                       // "this network"
    if (a === 10) return true;                      // RFC1918
    if (a === 127) return true;                     // loopback
    if (a === 169 && b === 254) return true;        // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true;        // RFC1918
    if (a === 192 && b === 0) return true;          // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true;                      // multicast + reserved + broadcast
    return false;
  }

  // A bare name with no dot cannot be a public FQDN (e.g. an intranet hostname).
  if (!host.includes('.')) return true;

  return false;
}

/** Is the host one of the infrastructure hosts we always permit? */
export function isAllowlistedHost(hostnameRaw: string): boolean {
  const host = normalizeHost(hostnameRaw);
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * Validate a caller-supplied video URL. Returns the parsed URL when every layer
 * passes, or a status + message to return verbatim.
 *
 * The error strings are deliberately non-specific about WHY a host was refused —
 * a precise message ("blocked private range") turns this endpoint into an
 * internal-network scanner that reports its findings.
 */
export function guardVideoUrl(raw: string | null | undefined): UrlGuardResult {
  const candidate = (raw ?? '').trim();
  if (!candidate) return deny(400, 'Missing/invalid url');

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return deny(400, 'Missing/invalid url');
  }

  // Scheme: http(s) only. Blocks file:, data:, gopher:, ftp: and friends.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return deny(400, 'Missing/invalid url');
  }

  // Credentials in the URL are never legitimate here and can leak upstream.
  if (url.username || url.password) return deny(400, 'Missing/invalid url');

  // Layer 2 — non-public addresses, refused regardless of anything else.
  if (isBlockedHost(url.hostname)) return deny(403, 'URL host is not allowed');

  // Layer 3 — known infrastructure, or a direct video file on a public host.
  if (isAllowlistedHost(url.hostname)) return { ok: true, url };

  const strict = process.env.VIDEO_PROXY_STRICT_HOSTS === '1';
  if (!strict && VIDEO_FILE_RE.test(url.pathname)) return { ok: true, url };

  return deny(403, 'URL host is not allowed');
}
