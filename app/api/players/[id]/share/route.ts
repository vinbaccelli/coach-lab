import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { requireFeature } from '@/lib/entitlements.server';
import { decryptSecret, encryptSecret, secretKeyConfigured } from '@/lib/crypto/secretBox';
import { hashShareToken, newShareToken, validateShareSettings } from '@/lib/players/share';

export const runtime = 'nodejs';

/** The coach's side of the share link: read it, create / change it, replace it, revoke it. RLS = own coach only. */

const COLS = 'id,mode,allowed_email,revoked_at,token_enc,created_at';
type Row = { id: string; mode: 'view' | 'edit'; allowed_email: string | null; revoked_at: string | null; token_enc: string; created_at: string };

function publicShape(row: Row | null, origin: string) {
  if (!row) return { share: null };
  let url: string | null = null;
  if (!row.revoked_at) {
    try { url = `${origin}/share/${decryptSecret(row.token_enc)}`; } catch { url = null; }
  }
  return { share: { mode: row.mode, allowed_email: row.allowed_email, revoked: !!row.revoked_at, url } };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const { data, error } = await session.supabase.from('player_shares').select(COLS).eq('player_id', id).maybeSingle<Row>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(publicShape(data, new URL(req.url).origin));
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

  const { data: existing } = await session.supabase.from('player_shares').select(COLS).eq('player_id', id).maybeSingle<Row>();
  const origin = new URL(req.url).origin;

  if (existing && !existing.revoked_at && !replace) {
    const { data, error } = await session.supabase.from('player_shares')
      .update({ mode: v.mode, allowed_email: v.allowed_email }).eq('id', existing.id).select(COLS).single<Row>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(publicShape(data, origin));
  }

  const token = newShareToken();
  const fields = { mode: v.mode, allowed_email: v.allowed_email, token_hash: hashShareToken(token), token_enc: encryptSecret(token), revoked_at: null };
  const q = existing
    ? session.supabase.from('player_shares').update(fields).eq('id', existing.id)
    : session.supabase.from('player_shares').insert({ coach_id: session.userId, player_id: id, ...fields });
  const { data, error } = await q.select(COLS).single<Row>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(publicShape(data, origin));
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
