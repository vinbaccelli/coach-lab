import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { emailAllowed, hashShareToken, looksLikeShareToken } from '@/lib/players/share';
import { isMissingColumn } from '@/lib/db/missingTable';
import { resolvePermissions, type SharePermissions } from '@/lib/players/sharePermissions';

/** Resolving a share token to its link row (server only, service role). Shared by the share routes. */
const NOT_FOUND = () => NextResponse.json({ error: 'This link is not available.' }, { status: 404 });

export type Db = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;
export type Share = {
  id: string; coach_id: string; player_id: string; mode: 'view' | 'edit'; allowed_email: string | null; revoked_at: string | null;
  /** What this link lets the player see and add (resolved from the stored value and the mode). */
  perms: SharePermissions;
};

const BASE_COLS = 'id,coach_id,player_id,mode,allowed_email,revoked_at';

export async function resolveShare(token: string, email: string | null) {
  if (!looksLikeShareToken(token)) return { fail: NOT_FOUND() };
  const db = createSupabaseServiceClient();
  if (!db) return { fail: NextResponse.json({ error: 'Sharing is not available right now.' }, { status: 503 }) };
  const hash = hashShareToken(token);
  // permissions is a later column: until its SQL is run, read the link without it (mode defaults apply).
  let res = await db.from('player_shares').select(`${BASE_COLS},permissions`).eq('token_hash', hash).maybeSingle<Omit<Share, 'perms'> & { permissions?: unknown }>();
  if (res.error && isMissingColumn(res.error)) {
    res = await db.from('player_shares').select(BASE_COLS).eq('token_hash', hash).maybeSingle<Omit<Share, 'perms'> & { permissions?: unknown }>();
  }
  const data = res.data;
  if (!data || data.revoked_at) return { fail: NOT_FOUND() };
  if (!emailAllowed(data.allowed_email, email)) {
    return { fail: NextResponse.json({ needsEmail: true, error: 'Enter the email this link was shared with.' }, { status: 401 }) };
  }
  const { permissions, ...row } = data;
  return { db, share: { ...row, perms: resolvePermissions(row.mode, permissions) } as Share };
}

/** A 403 for an addition this link does not allow. */
export const notAllowed = (what = 'this') => NextResponse.json({ error: `This link does not allow adding ${what}.` }, { status: 403 });
