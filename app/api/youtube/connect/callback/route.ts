import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getRouteSession } from '@/lib/auth/routeSession';
import { storeYouTubeConnection } from '@/lib/youtube/connection';
import {
  YOUTUBE_STATE_COOKIE,
  popupResultHtml,
  requestOrigin,
  youtubeOAuthCredentials,
  youtubeRedirectUri,
} from '@/lib/youtube/oauth';

export const runtime = 'nodejs';

/**
 * Where Google returns the coach after the YouTube consent.
 *
 * ALWAYS renders HTML, never JSON and never a redirect — this route is only ever
 * loaded inside the connect popup, and the popup's only way to report back is the
 * postMessage in that HTML. A bare 4xx here would leave the opener waiting on a
 * window that shows an error page and never closes.
 */
function done(req: Request, payload: { ok: true } | { ok: false; error: string }) {
  const res = new NextResponse(popupResultHtml(requestOrigin(req), payload), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
  // The nonce is single-use whatever the outcome.
  res.cookies.set(YOUTUBE_STATE_COOKIE, '', { path: '/api/youtube', maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  // The coach pressed Cancel on the consent screen, or Google refused.
  if (oauthError) {
    return done(req, {
      ok: false,
      error: oauthError === 'access_denied' ? 'Authorization was cancelled.' : oauthError,
    });
  }

  // ── CSRF: the nonce must come back exactly as it went out ────────────────
  const cookieState = req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${YOUTUBE_STATE_COOKIE}=`))
    ?.slice(YOUTUBE_STATE_COOKIE.length + 1);

  if (!state || !cookieState || state !== cookieState) {
    return done(req, { ok: false, error: 'Security check failed — please try connecting again.' });
  }

  // ── The grant belongs to the SIGNED-IN coach, not to whoever Google says ──
  // Verified after the CSRF check and independently of it: an attacker who
  // somehow replayed a code still cannot attach a channel to another account,
  // because the row is keyed by this session's user id.
  const session = await getRouteSession();
  if (!session) {
    return done(req, { ok: false, error: 'Your session expired — sign in again, then reconnect.' });
  }

  if (!code) return done(req, { ok: false, error: 'Google did not return an authorization code.' });

  const creds = youtubeOAuthCredentials();
  if (!creds) return done(req, { ok: false, error: 'YouTube OAuth client not configured.' });

  try {
    const oauth2 = new google.auth.OAuth2(
      creds.clientId,
      creds.clientSecret,
      youtubeRedirectUri(req), // byte-identical to the authorize request
    );
    const { tokens } = await oauth2.getToken(code);

    // HARD FAIL without a refresh token. An access token alone works for about an
    // hour and would leave a "connected" row that quietly stops uploading — worse
    // than not connecting, because the failure arrives later and looks like a bug.
    if (!tokens.refresh_token) {
      return done(req, {
        ok: false,
        error:
          'Google did not issue a refresh token. Remove AngleMotion from your Google account permissions, then connect again.',
      });
    }

    // Channel title is for display only ("Connected as …") and must never block
    // the connection — a coach with no channel yet can still be authorized.
    let channelTitle: string | null = null;
    try {
      oauth2.setCredentials({ access_token: tokens.access_token ?? undefined });
      const yt = google.youtube({ version: 'v3', auth: oauth2 });
      const me = await yt.channels.list({ part: ['snippet'], mine: true });
      channelTitle = me.data.items?.[0]?.snippet?.title ?? null;
    } catch {
      /* display nicety only */
    }

    const stored = await storeYouTubeConnection(session.userId, tokens.refresh_token, channelTitle);
    if (!stored) {
      return done(req, { ok: false, error: 'Could not save the connection. Please try again.' });
    }

    return done(req, { ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Token exchange failed';
    console.error('[youtube/connect/callback] failed:', msg);
    return done(req, { ok: false, error: msg });
  }
}
