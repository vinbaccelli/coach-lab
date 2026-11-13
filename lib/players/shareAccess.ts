import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { emailAllowed, hashShareToken, looksLikeShareToken } from '@/lib/players/share';

/** Resolving a share token to its link row (server only, service role). Shared by the share routes. */
const NOT_FOUND = () => NextResponse.json({ error: 'This link is not available.' }, { status: 404 });

export type Db = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;
export type Share = { id: string; coach_id: string; player_id: string; mode: 'view' | 'edit'; allowed_email: string | null; revoked_at: string | null };

export async function resolveShare(token: string, email: string | null) {
  if (!looksLikeShareToken(token)) return { fail: NOT_FOUND() };
  const db = createSupabaseServiceClient();
  if (!db) return { fail: NextResponse.json({ error: 'Sharing is not available right now.' }, { status: 503 }) };
  const { data } = await db.from('player_shares')
    .select('id,coach_id,player_id,mode,allowed_email,revoked_at').eq('token_hash', hashShareToken(token)).maybeSingle<Share>();
  if (!data || data.revoked_at) return { fail: NOT_FOUND() };
  if (!emailAllowed(data.allowed_email, email)) {
    return { fail: NextResponse.json({ needsEmail: true, error: 'Enter the email this link was shared with.' }, { status: 401 }) };
  }
  return { db, share: data };
}

