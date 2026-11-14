import { NextResponse } from 'next/server';
import { resolveShare, notAllowed, type Db, type Share } from '@/lib/players/shareAccess';
import { linkUnderHourlyLimit } from '@/lib/players/shareBrake';
import { validateAnswers, type Question, type Recurrence } from '@/lib/players/mental';
import { RESP_COLS, createNextOccurrence } from '@/lib/players/mentalDb';
import { isMissingTable } from '@/lib/db/missingTable';
import { isUuid } from '@/lib/players/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/**
 * The player answers one of their open questionnaires (never an assessment). A "can add" link with
 * the Questionnaires permission, valid answers, the hourly brake, `client_ref` against retries. The
 * answers wait for the coach; an open to-do task for this questionnaire is marked done.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE });
  if (!share.perms.add.questionnaires) return notAllowed('questionnaire answers');
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isUuid(body?.questionnaire_id)) return NextResponse.json({ error: 'Choose a questionnaire' }, { status: 400, headers: NO_STORE });
  const { data: q, error: qe } = await db.from('player_questionnaires').select('id,kind,status,questions')
    .eq('id', body.questionnaire_id).eq('player_id', share.player_id).eq('kind', 'questionnaire').maybeSingle();
  if (qe) return isMissingTable(qe) ? NextResponse.json({ error: 'Not available yet.' }, { status: 503, headers: NO_STORE }) : NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  if (q.status !== 'open') return NextResponse.json({ error: 'This questionnaire is closed.' }, { status: 409, headers: NO_STORE });
  const v = validateAnswers(q.questions as Question[], body.answers);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: NO_STORE });
  const client_ref = isUuid(body.client_ref) ? body.client_ref : null;
  const existing = async () => (client_ref
    ? (await db.from('player_questionnaire_responses').select(RESP_COLS).eq('player_id', share.player_id).eq('client_ref', client_ref).maybeSingle()).data
    : null);
  const before = await existing();
  if (before) return NextResponse.json({ response: before, duplicate: true }, { headers: NO_STORE });
  if (!(await linkUnderHourlyLimit(db, share))) {
    return NextResponse.json({ error: 'Too many additions in the last hour. Try again later.' }, { status: 429, headers: NO_STORE });
  }
  const { data, error } = await db.from('player_questionnaire_responses').insert({
    coach_id: share.coach_id, player_id: share.player_id, questionnaire_id: q.id, answered_on: new Date().toISOString().slice(0, 10),
    answers: v.value, author: 'link', status: 'submitted', client_ref,
  }).select(RESP_COLS).single();
  if (error) {
    const dup = error.code === '23505' ? await existing() : null;
    if (dup) return NextResponse.json({ response: dup, duplicate: true }, { headers: NO_STORE });
    return NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  }
  // The to-do task for this questionnaire is done (a repeating one gets its next occurrence).
  const { data: tasks } = await db.from('player_assignments').select('id,player_id,title,description,due_on,recurrence,questionnaire_id,series_id')
    .eq('player_id', share.player_id).eq('questionnaire_id', q.id).eq('status', 'open');
  for (const t of tasks ?? []) {
    const now = new Date().toISOString();
    const upd = await db.from('player_assignments').update({ status: 'done', done_at: now, done_by: 'link', updated_at: now }).eq('id', t.id).eq('status', 'open').select('id');
    if (upd.data?.length) await createNextOccurrence(db as never, { ...t, coach_id: share.coach_id, recurrence: t.recurrence as Recurrence });
  }
  return NextResponse.json({ response: data }, { headers: NO_STORE });
}
