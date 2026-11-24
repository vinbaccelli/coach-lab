import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { requireFeature } from '@/lib/entitlements.server';
import { decryptSecret, encryptSecret, secretKeyConfigured } from '@/lib/crypto/secretBox';
import { hashShareToken, newShareToken, validateShareSettings } from '@/lib/players/share';
import { cleanPermissionsInput, resolvePermissions } from '@/lib/players/sharePermissions';
import { isMissingColumn } from '@/lib/db/missingTable';

export const runtime = 'nodejs';

/** The coach's side of the share link: read it, create / change it, replace it, revoke it. RLS = own coach only. */

const BASE_COLS = 'id,mode,allowed_email,revoked_at,token_enc,created_at';
const COLS = `${BASE_COLS},permissions`;
type Row = { id: string; mode: 'view' | 'edit'; allowed_email: string | null; revoked_at: string | null; token_enc: string; created_at: string; permissions?: unknown };

function publicShape(row: Row | null, origin: string) {
  if (!row) return { share: null };
  let url: string | null = null;
  if (!row.revoked_at) {
    try { url = `${origin}/share/${decryptSecret(row.token_enc)}`; } catch { url = null; }
  }
  return { share: { mode: row.mode, allowed_email: row.allowed_email, revoked: !!row.revoked_at, url, permissions: resolvePermissions(row.mode, row.permissions) } };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  let res = await session.supabase.from('player_shares').select(COLS).eq('player_id', id).maybeSingle<Row>();
  // The permissions column is a later addition: read without it until its SQL is run.
  if (res.error && isMissingColumn(res.error)) res = await session.supabase.from('player_shares').select(BASE_COLS).eq('player_id', id).maybeSingle<Row>();
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  return NextResponse.json({ ...publicShape(res.data, new URL(req.url).origin), permissionsAvailable: !res.error && (res.data ? 'permissions' in res.data : true) });
}

/** Body: { mode, allowed_email?, replace? }. Creates the link, updates its settings, or (replace) issues a new link. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeature(session.supabase, { id: session.userId, email: session.email }, 'players');
  if (denied) return denied;
  if (!secretKeyConfigured()) return NextResponse.json({ error: 'Sharing is not configured on the server yet (missing key).' }, { status: 503 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const v = validateShareSettings(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const replace = (body as { replace?: unknown } | null)?.replace === true;
  // Optional per-section permissions ({ see: {...}, add: {...} }); stored as given, resolved on read.
  const perms = cleanPermissionsInput((body as { permissions?: unknown } | null)?.permissions);

  let existingRes = await session.supabase.from('player_shares').select(COLS).eq('player_id', id).maybeSingle<Row>();
  const hasPermissionsColumn = !(existingRes.error && isMissingColumn(existingRes.error));
  if (!hasPermissionsColumn) existingRes = await session.supabase.from('player_shares').select(BASE_COLS).eq('player_id', id).maybeSingle<Row>();
  const existing = existingRes.data;
  const cols = hasPermissionsColumn ? COLS : BASE_COLS;
  const permsPatch = perms && hasPermissionsColumn ? { permissions: perms } : {};
  const origin = new URL(req.url).origin;

  if (existing && !existing.revoked_at && !replace) {
    const { data, error } = await session.supabase.from('player_shares')
      .update({ mode: v.mode, allowed_email: v.allowed_email, ...permsPatch }).eq('id', existing.id).select(cols).single<Row>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ...publicShape(data, origin), permissionsAvailable: hasPermissionsColumn });
  }

  const token = newShareToken();
  const fields = { mode: v.mode, allowed_email: v.allowed_email, token_hash: hashShareToken(token), token_enc: encryptSecret(token), revoked_at: null, ...permsPatch };
  const q = existing
    ? session.supabase.from('player_shares').update(fields).eq('id', existing.id)
    : session.supabase.from('player_shares').insert({ coach_id: session.userId, player_id: id, ...fields });
  const { data, error } = await q.select(cols).single<Row>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...publicShape(data, origin), permissionsAvailable: hasPermissionsColumn });
}

/** Revoke: the old link stops working immediately. Not plan-gated, so a lapsed coach can always switch sharing off. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const { error } = await session.supabase.from('player_shares').update({ revoked_at: new Date().toISOString() }).eq('player_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
