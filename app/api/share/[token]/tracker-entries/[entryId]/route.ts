import { NextResponse } from 'next/server';
import { resolveShare, notAllowed, type Db, type Share } from '@/lib/players/shareAccess';
import { addKindForCategory } from '@/lib/players/sharePermissions';
import { validateEntry, type TrackerField, type TrackerMode } from '@/lib/players/trackers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTRY_COLS = 'id,tracker_id,entry_date,measurements,sets,note,author,status,review_note,created_at,updated_at';
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/**
 * The player's own entries (author = link) can be corrected or withdrawn only while they wait for
 * review (submitted) or were sent back (needs_revision). An approved entry, or any coach entry, is
 * the coach's history and cannot be changed through the link.
 */
async function ownPendingEntry(db: Db, share: Share, entryId: string) {
  const { data: e } = await db.from('player_tracker_entries').select('id,tracker_id,author,status,player_id').eq('id', entryId).eq('player_id', share.player_id).maybeSingle();
  if (!e) return { fail: NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) };
  if (e.author !== 'link' || e.status === 'approved') return { fail: NextResponse.json({ error: 'Only your entries waiting for review can be changed.' }, { status: 403, headers: NO_STORE }) };
  const { data: t } = await db.from('player_trackers').select('id,category,mode,fields,archived_at').eq('id', e.tracker_id).eq('player_id', share.player_id).maybeSingle();
  if (!t) return { fail: NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) };
  const kind = addKindForCategory(t.category as string);
  if (!kind || !share.perms.add[kind]) return { fail: notAllowed('entries here') };
  return { entry: e, tracker: t };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ token: string; entryId: string }> }) {
  const { token, entryId } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE });
  const own = await ownPendingEntry(db, share, entryId);
  if ('fail' in own) return own.fail;
  const v = validateEntry({ mode: own.tracker.mode as TrackerMode, fields: own.tracker.fields as TrackerField[] }, await req.json().catch(() => null), new Date().toISOString().slice(0, 10));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: NO_STORE });
  // A corrected entry goes back to the coach for review.
  const { data, error } = await db.from('player_tracker_entries')
    .update({ ...v.value, status: 'submitted', review_note: null, updated_at: new Date().toISOString() })
    .eq('id', entryId).eq('player_id', share.player_id).eq('author', 'link').neq('status', 'approved')
    .select(ENTRY_COLS);
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  if (!data?.length) return NextResponse.json({ error: 'This entry was reviewed in the meantime. Reload the page.' }, { status: 409, headers: NO_STORE });
  return NextResponse.json({ entry: data[0] }, { headers: NO_STORE });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ token: string; entryId: string }> }) {
  const { token, entryId } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE });
  const own = await ownPendingEntry(db, share, entryId);
  if ('fail' in own) return own.fail;
  const { data, error } = await db.from('player_tracker_entries').delete()
    .eq('id', entryId).eq('player_id', share.player_id).eq('author', 'link').neq('status', 'approved').select('id');
  if (error) return NextResponse.json({ error: 'Could not delete' }, { status: 500, headers: NO_STORE });
  if (!data?.length) return NextResponse.json({ error: 'This entry was reviewed in the meantime. Reload the page.' }, { status: 409, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
