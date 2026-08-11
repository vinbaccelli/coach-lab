import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Exchange the Google refresh token for a fresh access token.
 *
 * Google access tokens expire after ~1h; Supabase only captures one at
 * sign-in. Both sign-in paths request `access_type=offline&prompt=consent`,
 * so the session carries a provider_refresh_token — refreshing here means
 * Docs/Drive/YouTube exports keep working for the whole coaching session
 * without re-login.
 */
async function refreshGoogleAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string };
    return body.access_token ?? null;
  } catch {
    return null;
  }
}

export async function getRouteSession() {
  const supabase = await createSupabaseServerClient();

  // AUTHENTICATE WITH getUser(), NOT getSession().
  //
  // `getSession()` reads the session straight out of the cookie and does NOT
  // verify it against the auth server — Supabase logs a warning saying exactly
  // that. `getUser()` round-trips to Supabase Auth and validates the JWT, so a
  // tampered or revoked cookie fails HERE rather than relying on RLS to catch it
  // at the data layer. RLS is still the backstop; this makes it the second line
  // instead of the only one.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  // The session is still needed, but only for the GOOGLE PROVIDER TOKENS —
  // `getUser()` does not return them. Identity above comes from the verified
  // call; this read supplies the OAuth tokens for the Docs/Drive/YouTube calls,
  // and those are validated by Google on use.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // `session` is nullable here (getUser can succeed while this read returns
  // nothing), so both lookups are optional — a missing provider token only means
  // the Google exports are unavailable, never that the caller is unauthenticated.
  const providerToken = (session as { provider_token?: string | null } | null)?.provider_token ?? null;
  const providerRefreshToken =
    (session as { provider_refresh_token?: string | null } | null)?.provider_refresh_token ?? null;

  // Prefer a freshly-minted access token (survives the ~1h expiry); fall back
  // to the sign-in token when refresh isn't possible.
  let googleAccessToken: string | null = null;
  if (providerRefreshToken) {
    googleAccessToken = await refreshGoogleAccessToken(providerRefreshToken);
  }
  if (!googleAccessToken && typeof providerToken === 'string') {
    googleAccessToken = providerToken;
  }

  return {
    // From the VERIFIED getUser() call, not the cookie-read session — this is the
    // identity every route authorizes against.
    userId: user.id,
    email: user.email,
    supabase,
    /** Google OAuth access token — required for YouTube / Docs APIs when present */
    googleAccessToken,
  };
}
