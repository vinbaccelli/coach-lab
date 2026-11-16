import { NextResponse } from 'next/server';
import { coachSession, dbError, todayYmd } from '@/lib/players/routeKit';
import { mealRange } from '@/lib/players/nutrition';
import { MEAL_COLS, PLAN_COLS } from '@/lib/players/mealPhotos';

export const runtime = 'nodejs';

/**
 * The player's nutrition for the coach: every plan (newest start first: drafts, current, upcoming,
 * history, archived) and the meals of a date range (?from=&to=, default the last 7 days, at most 62).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const range = mealRange(sp.get('from'), sp.get('to'), todayYmd());
  const [plans, meals] = await Promise.all([
    s.supabase.from('player_nutrition_plans').select(PLAN_COLS).eq('player_id', id).order('starts_on', { ascending: false }).order('created_at', { ascending: false }).limit(200),
    s.supabase.from('player_meal_logs').select(MEAL_COLS).eq('player_id', id).gte('eaten_on', range.from).lte('eaten_on', range.to)
      .order('eaten_on', { ascending: true }).order('eaten_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: true }).limit(1000),
  ]);
  if (plans.error) return dbError(plans.error, { plans: [], meals: [], range });
  if (meals.error) return dbError(meals.error, { plans: [], meals: [], range });
  return NextResponse.json({ plans: plans.data ?? [], meals: meals.data ?? [], range });
}
