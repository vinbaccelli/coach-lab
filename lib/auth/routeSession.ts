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
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const providerToken = (session as { provider_token?: string | null }).provider_token ?? null;
  const providerRefreshToken =
    (session as { provider_refresh_token?: string | null }).provider_refresh_token ?? null;

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
    userId: session.user.id,
    email: session.user.email,
    supabase,
    /** Google OAuth access token — required for YouTube / Docs APIs when present */
    googleAccessToken,
  };
}
