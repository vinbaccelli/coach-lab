import { NextResponse } from 'next/server';
import { resolveShare, type Db, type Share } from '@/lib/players/shareAccess';
import { PQ_COLS, RESP_COLS } from '@/lib/players/mentalDb';
import { isMissingTable } from '@/lib/db/missingTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };

/**
 * Questionnaires through the share link (strict access):
 *  - assessments are NEVER sent;
 *  - open questionnaires (to answer) are sent when the link may see Mental or answer questionnaires;
 *  - past answers are sent only when the link may see Mental; otherwise just the dates and review state.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  const canAnswer = share.mode === 'edit' && share.perms.add.questionnaires;
  const canSee = share.perms.see.mental;
  if (!canSee && !canAnswer) return NextResponse.json({ error: 'This link does not show questionnaires.' }, { status: 403, headers: NO_STORE });
  let qq = db.from('player_questionnaires').select(PQ_COLS).eq('player_id', share.player_id).eq('kind', 'questionnaire');
  if (!canSee) qq = qq.eq('status', 'open');
  const qs = await qq.order('created_at', { ascending: false }).limit(100);
  if (qs.error) {
    if (isMissingTable(qs.error)) return NextResponse.json({ available: false, questionnaires: [], responses: [], canAnswer: false, canSee }, { headers: NO_STORE });
    return NextResponse.json({ error: 'Could not load' }, { status: 500, headers: NO_STORE });
  }
  const ids = (qs.data ?? []).map((q) => q.id);
  let responses: Array<Record<string, unknown>> = [];
  if (ids.length) {
    let rq = db.from('player_questionnaire_responses').select(RESP_COLS).eq('player_id', share.player_id).in('questionnaire_id', ids);
    if (!canSee) rq = rq.eq('author', 'link');
    const rs = await rq.order('answered_on', { ascending: false }).limit(500);
    if (rs.error) return NextResponse.json({ error: 'Could not load' }, { status: 500, headers: NO_STORE });
    responses = (rs.data ?? []).map((x) => (canSee ? x : { ...x, answers: x.status === 'needs_revision' ? x.answers : {} }));
  }
  return NextResponse.json({ available: true, questionnaires: qs.data ?? [], responses, canAnswer, canSee }, { headers: NO_STORE });
}
