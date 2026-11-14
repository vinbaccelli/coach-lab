import { NextResponse } from 'next/server';
import { resolveShare, type Db, type Share } from '@/lib/players/shareAccess';
import { mealRange } from '@/lib/players/nutrition';
import { MEAL_COLS } from '@/lib/players/mealPhotos';
import { isMissingTable } from '@/lib/db/missingTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };
/** What the player may read of a plan (no coach id, no drafts or archived plans). */
const PLAYER_PLAN_COLS = 'id,title,starts_on,ends_on,status,targets,meals,notes,updated_at';

/**
 * The player's nutrition through the share link: the coach's active plans and the meals of a date
 * range (?from=&to=, default the last 7 days). Only when the link may see Nutrition (403 otherwise).
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (!share.perms.see.nutrition) return NextResponse.json({ error: 'This link does not show nutrition.' }, { status: 403, headers: NO_STORE });
  const sp = new URL(req.url).searchParams;
  const range = mealRange(sp.get('from'), sp.get('to'), new Date().toISOString().slice(0, 10));
  const [plans, meals, toFix] = await Promise.all([
    db.from('player_nutrition_plans').select(PLAYER_PLAN_COLS).eq('player_id', share.player_id).eq('status', 'active').order('starts_on', { ascending: false }).limit(100),
    db.from('player_meal_logs').select(MEAL_COLS).eq('player_id', share.player_id).gte('eaten_on', range.from).lte('eaten_on', range.to)
      .order('eaten_on', { ascending: true }).order('eaten_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: true }).limit(1000),
    // The player's meals the coach sent back, whatever their date, so the page can point to them.
    db.from('player_meal_logs').select(MEAL_COLS).eq('player_id', share.player_id).eq('author', 'link').eq('status', 'needs_revision').order('eaten_on', { ascending: false }).limit(50),
  ]);
  const err = plans.error ?? meals.error;
  if (err) {
    if (isMissingTable(err)) return NextResponse.json({ available: false, plans: [], meals: [], toFix: [], range, canLog: false }, { headers: NO_STORE });
    return NextResponse.json({ error: 'Could not load' }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json(
    {
      available: true, plans: plans.data ?? [], meals: meals.data ?? [], toFix: toFix.data ?? [], range,
      canLog: share.mode === 'edit' && share.perms.add.meals,
    },
    { headers: NO_STORE },
  );
}
