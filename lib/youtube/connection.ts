import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { decryptSecret, encryptSecret } from '@/lib/crypto/secretBox';

/**
 * The coach's YouTube grant — a Google authorization that is deliberately NOT
 * the one their Supabase session carries.
 *
 * WHY A SECOND GRANT AT ALL
 * Google will not issue one consent covering `youtube.upload` alongside
 * `drive.file` ("This request contains scopes that cannot be requested
 * together"), and the Supabase session holds exactly one Google token, which the
 * Docs/Drive export owns (see lib/auth/routeSession.ts). Asking Supabase for a
 * YouTube grant would REPLACE that token and break the Docs export. So YouTube
 * gets its own consent round-trip and its own refresh token, stored here.
 *
 * SERVER ONLY. Every function needs the service-role client and the encryption
 * key; neither may reach a browser. `public.youtube_connections` has RLS on with
 * zero policies, so this module is the only way in.
 *
 * Access tokens are never persisted — they last about an hour and re-minting one
 * is a single request. Only the refresh token is stored, and only encrypted.
 */

const TABLE = 'youtube_connections';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

interface ConnectionRow {
  user_id: string;
  refresh_token_enc: string;
  connected_at: string;
  last_used_at: string | null;
  channel_title: string | null;
}

/**
 * Credentials for the YouTube OAuth client.
 *
 * Kept separate from GOOGLE_OAUTH_CLIENT_ID/SECRET (the sign-in client) so the
 * two grants cannot interfere: same GCP project, so the approved consent screen
 * still applies, but a distinct client means Google never accumulates the
 * conflicting scopes against one client/user pair.
 *
 * Absent until the OAuth client is created (build step 2) — callers get null
 * rather than a throw, which reads as "not connected" and is the correct
 * behaviour for an unconfigured deployment.
 */
function youtubeOAuthCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function loadRow(userId: string): Promise<ConnectionRow | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select('user_id, refresh_token_enc, connected_at, last_used_at, channel_title')
    .eq('user_id', userId)
    .maybeSingle<ConnectionRow>();
  if (error) {
    console.error('[youtube/connection] load failed:', error.message);
    return null;
  }
  return data ?? null;
}

/** True when this coach has a stored YouTube grant. Cheap — no Google round-trip. */
export async function isYouTubeConnected(userId: string): Promise<boolean> {
  return (await loadRow(userId)) !== null;
}

/** Connection metadata for a status endpoint. NEVER includes any token material. */
export async function getYouTubeConnectionInfo(
  userId: string,
): Promise<{ connected: boolean; connectedAt?: string; channelTitle?: string | null }> {
  const row = await loadRow(userId);
  if (!row) return { connected: false };
  return { connected: true, connectedAt: row.connected_at, channelTitle: row.channel_title };
}

/**
 * Persist a freshly-granted refresh token, encrypted. Upsert, so re-connecting
 * replaces the old grant rather than erroring or leaving a stale row behind.
 *
 * Called by the OAuth callback (build step 2). Throws when the encryption key is
 * missing or malformed — storing a token we cannot protect, or writing plaintext
 * as a "fallback", would be worse than failing the connect.
 */
export async function storeYouTubeConnection(
  userId: string,
  refreshToken: string,
  channelTitle?: string | null,
): Promise<boolean> {
  if (!refreshToken) return false;
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    console.error('[youtube/connection] SUPABASE_SERVICE_ROLE_KEY not configured');
    return false;
  }
  const refresh_token_enc = encryptSecret(refreshToken);
  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: userId,
      refresh_token_enc,
      connected_at: new Date().toISOString(),
      channel_title: channelTitle ?? null,
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    console.error('[youtube/connection] store failed:', error.message);
    return false;
  }
  return true;
}

/**
 * A usable YouTube access token for this coach, or null.
 *
 * Mirrors the refresh in lib/auth/routeSession.ts — same grant_type, different
 * client and a different stored refresh token. Null covers every "cannot upload
 * right now" case (not connected, unconfigured client, revoked grant, decrypt
 * failure); callers should turn that into "connect YouTube", not a hard error.
 */
export async function getYouTubeAccessToken(userId: string): Promise<string | null> {
  const creds = youtubeOAuthCredentials();
  if (!creds) {
    console.warn('[youtube/connection] YOUTUBE_OAUTH_CLIENT_ID/SECRET not configured');
    return null;
  }
  const row = await loadRow(userId);
  if (!row) return null;

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(row.refresh_token_enc);
  } catch (e) {
    // A wrong or rotated key, or a tampered row. Not recoverable here — the
    // coach has to reconnect — but never fall back to an unencrypted path.
    console.error('[youtube/connection] decrypt failed:', e instanceof Error ? e.message : e);
    return null;
  }

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      // 400 invalid_grant here means the coach revoked access in their Google
      // account, or the token expired from disuse. Left in place rather than
      // auto-deleted so a transient Google error cannot silently disconnect a
      // working account; the reconnect flow upserts over it anyway.
      console.error(`[youtube/connection] refresh failed: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) return null;

    // Best-effort usage stamp; a failure here must not fail the upload.
    void createSupabaseServiceClient()
      ?.from(TABLE)
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', userId)
      .then(undefined, () => {});

    return body.access_token;
  } catch (e) {
    console.error('[youtube/connection] refresh error:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Drop the grant: tell Google to revoke it, then delete the row.
 *
 * Revocation is best-effort and deliberately does not gate the delete — if
 * Google is unreachable, the coach's intent to disconnect still takes effect
 * locally, and a stored token we have deleted cannot be used by us again.
 */
export async function disconnectYouTube(userId: string): Promise<boolean> {
  const row = await loadRow(userId);

  if (row) {
    try {
      const refreshToken = decryptSecret(row.refresh_token_enc);
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      /* best effort — proceed to delete regardless */
    }
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId);
  if (error) {
    console.error('[youtube/connection] delete failed:', error.message);
    return false;
  }
  return true;
}
