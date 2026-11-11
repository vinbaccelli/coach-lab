import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { emailAllowed, hashShareToken, looksLikeShareToken, withinLinkLimit } from '@/lib/players/share';
import { validateNewItem } from '@/lib/players/timeline';
import { validateMetricInput } from '@/lib/players/metrics';
import { parseTechnicalSheet } from '@/lib/players/technicalSheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The public side of the share link. No login: the token in the URL is the key.
 * Runs on the server with the service role, and EVERY query below is scoped to the one
 * player the token belongs to. Only an allow-listed set of fields leaves this route:
 * name, the profile sheet, progress values, and timeline items. Never: coach notes,
 * reports, Google ids, the coach id, other players.
 * Every failure for a bad / revoked / unknown link is the same 404 (no way to probe).
 */

const BUCKET = 'player-assets';
const MAX_PICTURE_BYTES = 3 * 1024 * 1024;
const NOT_FOUND = () => NextResponse.json({ error: 'This link is not available.' }, { status: 404 });

type Db = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;
type Share = { id: string; coach_id: string; player_id: string; mode: 'view' | 'edit'; allowed_email: string | null; revoked_at: string | null };

async function resolve(token: string, email: string | null) {
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

const headerEmail = (req: Request) => req.headers.get('x-share-email');

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolve(token, headerEmail(req));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };

  const [player, items, metrics] = await Promise.all([
    db.from('players').select('display_name,technical_sheet').eq('id', share.player_id).maybeSingle<{ display_name: string; technical_sheet: unknown }>(),
    db.from('player_timeline_items').select('id,kind,body,media_url,youtube_id,created_at,author').eq('player_id', share.player_id).order('created_at', { ascending: false }).limit(300),
    db.from('player_metrics').select('id,name,unit,value,recorded_on').eq('player_id', share.player_id).order('recorded_on', { ascending: true }).limit(3000),
  ]);
  if (!player.data) return NOT_FOUND();
  const sheet = (parseTechnicalSheet(player.data.technical_sheet) ?? []).filter((r) => r.value.trim() !== '');
  return NextResponse.json(
    { name: player.data.display_name, sheet, items: items.data ?? [], metrics: metrics.data ?? [], canAdd: share.mode === 'edit' },
    { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' } },
  );
}

/** Add something through the link (only when the coach chose "can add"). Add-only: no edit, no delete, no profile fields. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolve(token, headerEmail(req));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return NextResponse.json({ error: 'This link is view-only.' }, { status: 403 });

  // Abuse brake: at most N additions per hour through this player's link.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const [a, b] = await Promise.all([
    db.from('player_timeline_items').select('id', { count: 'exact', head: true }).eq('player_id', share.player_id).eq('author', 'link').gte('created_at', since),
    db.from('player_metrics').select('id', { count: 'exact', head: true }).eq('player_id', share.player_id).eq('author', 'link').gte('created_at', since),
  ]);
  if (!withinLinkLimit((a.count ?? 0) + (b.count ?? 0))) {
    return NextResponse.json({ error: 'Too many additions in the last hour. Try again later.' }, { status: 429 });
  }
  const base = { coach_id: share.coach_id, player_id: share.player_id, author: 'link' as const };

  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File) || !['image/jpeg', 'image/png'].includes(file.type)) return NextResponse.json({ error: 'Choose a JPEG or PNG picture' }, { status: 400 });
    if (file.size > MAX_PICTURE_BYTES) return NextResponse.json({ error: 'Picture is too large' }, { status: 413 });
    const path = `${share.coach_id}/${share.player_id}/timeline/${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
    const up = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) return NextResponse.json({ error: 'Could not upload the picture' }, { status: 500 });
    const caption = typeof form?.get('body') === 'string' ? String(form?.get('body')).trim().slice(0, 1000) : '';
    const { error } = await db.from('player_timeline_items').insert({ ...base, kind: 'picture', body: caption, media_url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
    if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const body = (await req.json().catch(() => null)) as { kind?: string } | null;
  if (body?.kind === 'metric') {
    const v = validateMetricInput(body, new Date().toISOString().slice(0, 10));
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const { error } = await db.from('player_metrics').insert({ ...base, ...v.input });
    if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const v = validateNewItem(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const { error } = await db.from('player_timeline_items').insert({ ...base, ...v.item });
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
