/**
 * Shared bits of the YouTube OAuth round-trip.
 *
 * The redirect URI is the reason this file exists rather than each route
 * building its own: Google compares the `redirect_uri` on the token exchange
 * against the one sent on the authorization request BYTE FOR BYTE, and against
 * the list registered in the console. Two routes deriving it independently is a
 * `redirect_uri_mismatch` waiting to happen, and that error says nothing about
 * which of the two was wrong.
 */

/** The single scope this grant asks for. Never combined with Drive scopes — that
 *  combination is what Google refuses, and the whole reason for a second grant. */
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

export const YOUTUBE_STATE_COOKIE = 'yt_oauth_state';
/** Long enough to read a consent screen, short enough that a stray cookie is worthless. */
export const YOUTUBE_STATE_MAX_AGE_S = 600;

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * The origin this request actually arrived on.
 *
 * `request.url` is not reliable behind Vercel's proxy — Next may report the
 * internal origin rather than the one the browser used — so the forwarded
 * headers win when present. Localhost is covered by the same path: a dev request
 * to :3001 carries `host: localhost:3001`, which is why the registered redirect
 * URIs must list each dev port separately.
 */
export function requestOrigin(req: Request): string {
  const h = req.headers;
  const forwardedHost = h.get('x-forwarded-host');
  const host = forwardedHost || h.get('host');
  if (host) {
    const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

/** Must match a URI registered on the YouTube OAuth client, exactly. */
export function youtubeRedirectUri(req: Request): string {
  return `${requestOrigin(req)}/api/youtube/connect/callback`;
}

export function youtubeOAuthCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * The popup's only way to talk to the page that opened it.
 *
 * Rendered for BOTH success and failure — a popup that dies silently leaves the
 * opener spinning forever with no way to tell "still consenting" from "crashed".
 * `targetOrigin` is pinned to our own origin rather than '*' so the message
 * cannot be read by another document that happens to hold a handle on us.
 */
export function popupResultHtml(
  origin: string,
  payload: { ok: true } | { ok: false; error: string },
): string {
  const json = JSON.stringify({ type: 'youtube-connect', ...payload });
  const heading = payload.ok ? 'YouTube connected' : 'Could not connect YouTube';
  const detail = payload.ok
    ? 'You can close this window.'
    : escapeHtml(payload.error);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${heading}</title>
<style>
  body { font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         color: #1A1A1A; background: #FAF9F7; margin: 0;
         display: flex; align-items: center; justify-content: center; height: 100vh; }
  .card { text-align: center; padding: 24px 28px; max-width: 380px; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p { font-size: 13px; color: #6E6E73; margin: 0; line-height: 1.5; }
</style></head>
<body>
  <div class="card"><h1>${heading}</h1><p>${detail}</p></div>
  <script>
    (function () {
      var msg = ${json};
      try { if (window.opener) window.opener.postMessage(msg, ${JSON.stringify(origin)}); } catch (e) {}
      setTimeout(function () { try { window.close(); } catch (e) {} }, ${payload.ok ? 400 : 2500});
    })();
  </script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
