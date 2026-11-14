import { NextResponse } from 'next/server';
import { resolveShare, notAllowed, type Db, type Share } from '@/lib/players/shareAccess';
import { validateAnswers, type Question } from '@/lib/players/mental';
import { RESP_COLS } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const reviewed = () => NextResponse.json({ error: 'These answers were read by your coach in the meantime. Reload the page.' }, { status: 409, headers: NO_STORE });

/** The player's own answers can be corrected or withdrawn only until the coach has read them. */
async function ownPending(req: Request, token: string, rid: string) {
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return { fail: r.fail };
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return { fail: NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE }) };
  if (!share.perms.add.questionnaires) return { fail: notAllowed('questionnaire answers') };
  const { data: resp } = await db.from('player_questionnaire_responses').select('id,author,status,questionnaire_id').eq('id', rid).eq('player_id', share.player_id).maybeSingle();
  if (!resp) return { fail: NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) };
  if (resp.author !== 'link' || resp.status === 'approved') return { fail: NextResponse.json({ error: 'Only your answers waiting for your coach can be changed.' }, { status: 403, headers: NO_STORE }) };
  return { db, share, resp };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ token: string; rid: string }> }) {
  const { token, rid } = await ctx.params;
  const own = await ownPending(req, token, rid);
  if ('fail' in own) return own.fail;
  const { db, share, resp } = own;
  const { data: q } = await db.from('player_questionnaires').select('questions,kind').eq('id', resp.questionnaire_id).eq('player_id', share.player_id).maybeSingle();
  if (!q || q.kind !== 'questionnaire') return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const v = validateAnswers(q.questions as Question[], body?.answers);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: NO_STORE });
  const { data, error } = await db.from('player_questionnaire_responses')
    .update({ answers: v.value, status: 'submitted', review_note: null, updated_at: new Date().toISOString() })
    .eq('id', rid).eq('player_id', share.player_id).eq('author', 'link').neq('status', 'approved').select(RESP_COLS);
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  if (!data?.length) return reviewed();
  return NextResponse.json({ response: data[0] }, { headers: NO_STORE });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ token: string; rid: string }> }) {
  const { token, rid } = await ctx.params;
  const own = await ownPending(req, token, rid);
  if ('fail' in own) return own.fail;
  const { db, share } = own;
  const { data, error } = await db.from('player_questionnaire_responses').delete()
    .eq('id', rid).eq('player_id', share.player_id).eq('author', 'link').neq('status', 'approved').select('id');
  if (error) return NextResponse.json({ error: 'Could not delete' }, { status: 500, headers: NO_STORE });
  if (!data?.length) return reviewed();
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
