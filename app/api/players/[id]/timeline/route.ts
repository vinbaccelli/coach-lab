import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { requireFeature } from '@/lib/entitlements.server';
import { validateNewItem } from '@/lib/players/timeline';

export const runtime = 'nodejs';

const COLS = 'id,kind,body,media_url,youtube_id,created_at';
const MAX_PICTURE_BYTES = 3 * 1024 * 1024; // the page shrinks pictures first; this is the server-side cap
const BUCKET = 'player-assets';

/** Comments, pictures and unlisted-YouTube videos on a player's timeline. RLS (own coach) is the access rule. */

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const { data, error } = await session.supabase
    .from('player_timeline_items').select(COLS).eq('player_id', id)
    .order('created_at', { ascending: false }).limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeature(session.supabase, { id: session.userId, email: session.email }, 'players');
  if (denied) return denied;
  const { id } = await ctx.params;

  let row: Record<string, unknown>;
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File) || !file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Choose an image' }, { status: 400 });
    }
    if (file.size > MAX_PICTURE_BYTES) return NextResponse.json({ error: 'Picture is too large' }, { status: 413 });
    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    const path = `${session.userId}/${id}/timeline/${crypto.randomUUID()}.${ext}`;
    const up = await session.supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    const { data: pub } = session.supabase.storage.from(BUCKET).getPublicUrl(path);
    const caption = typeof form?.get('body') === 'string' ? String(form?.get('body')).trim().slice(0, 4000) : '';
    row = { kind: 'picture', body: caption, media_url: pub.publicUrl };
  } else {
    const v = validateNewItem(await req.json().catch(() => null));
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    row = v.item;
  }

  const { data, error } = await session.supabase
    .from('player_timeline_items')
    .insert({ coach_id: session.userId, player_id: id, ...row })
    .select(COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const itemId = new URL(req.url).searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
  // A picture also frees its stored file (storage counts toward the free-tier allowance).
  const { data: existing } = await session.supabase
    .from('player_timeline_items').select('media_url').eq('id', itemId).eq('player_id', id).maybeSingle<{ media_url: string | null }>();
  const marker = `/${BUCKET}/`;
  const at = existing?.media_url ? existing.media_url.indexOf(marker) : -1;
  const { error } = await session.supabase.from('player_timeline_items').delete().eq('id', itemId).eq('player_id', id);
  if (!error && existing?.media_url && at >= 0) {
    await session.supabase.storage.from(BUCKET).remove([existing.media_url.slice(at + marker.length).split('?')[0]]).catch(() => {});
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
