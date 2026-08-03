import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getRouteSession } from '@/lib/auth/routeSession';
import {
  GOOGLE_AUTH_URL,
  YOUTUBE_SCOPE,
  YOUTUBE_STATE_COOKIE,
  YOUTUBE_STATE_MAX_AGE_S,
  youtubeOAuthCredentials,
  youtubeRedirectUri,
} from '@/lib/youtube/oauth';

export const runtime = 'nodejs';

/**
 * Start the SEPARATE YouTube authorization.
 *
 * Opened in a popup by the client, never navigated to in the main window: the
 * analysis session lives entirely in memory (ADR-012 — no cloud persistence in
 * V1), so redirecting the tab to Google would destroy the coach's Motion Layer
 * draft and annotations on the way out.
 *
 * Requests `youtube.upload` ALONE. Google rejects a consent that mixes it with
 * `drive.file`, which is exactly why this grant is separate from the sign-in one
 * — see lib/featureFlags.ts.
 */
export async function GET(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const creds = youtubeOAuthCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: 'YouTube OAuth client not configured on the server.' },
      { status: 500 },
    );
  }

  // CSRF: a nonce echoed through Google and compared on return. Held in an
  // httpOnly cookie so page scripts cannot read or forge it.
  const state = randomBytes(32).toString('base64url');

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: youtubeRedirectUri(req),
    response_type: 'code',
    scope: YOUTUBE_SCOPE,
    // offline + consent together are what make Google return a REFRESH token.
    // Without `prompt=consent` a returning user gets an access token only, and
    // the connection would silently stop working within the hour.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });

  const res = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  res.cookies.set(YOUTUBE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // must survive the top-level redirect back from Google
    path: '/api/youtube',
    maxAge: YOUTUBE_STATE_MAX_AGE_S,
  });
  return res;
}
