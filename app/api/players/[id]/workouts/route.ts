import { NextResponse } from 'next/server';
import { coachSession, dbError, isUuid, todayYmd } from '@/lib/players/routeKit';
import { scheduleDates, validateWorkout } from '@/lib/players/workouts';
import { LOG_COLS, WORKOUT_COLS } from '@/lib/players/workoutCols';
import { workoutRange } from '@/lib/players/workoutRange';

export const runtime = 'nodejs';

/** The player's planned workouts and logs of a date range (?from=&to=, default 4 weeks back and ahead). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const range = workoutRange(sp.get('from'), sp.get('to'), todayYmd());
  const [planned, logs] = await Promise.all([
    s.supabase.from('player_workouts').select(WORKOUT_COLS).eq('player_id', id).gte('scheduled_on', range.from).lte('scheduled_on', range.to)
      .order('scheduled_on', { ascending: true }).order('created_at', { ascending: true }).limit(500),
    s.supabase.from('player_workout_logs').select(LOG_COLS).eq('player_id', id).gte('performed_on', range.from).lte('performed_on', range.to)
      .order('performed_on', { ascending: false }).order('created_at', { ascending: false }).limit(500),
  ]);
  if (planned.error) return dbError(planned.error, { workouts: [], logs: [], range });
  if (logs.error) return dbError(logs.error, { workouts: [], logs: [], range });
  // Logs of planned workouts in the range that were done outside it.
  const have = new Set((logs.data ?? []).map((l) => l.workout_id));
  const missing = (planned.data ?? []).map((w) => w.id).filter((wid) => !have.has(wid));
  let extra: unknown[] = [];
  if (missing.length) {
    const r = await s.supabase.from('player_workout_logs').select(LOG_COLS).in('workout_id', missing);
    if (r.error) return dbError(r.error, { workouts: [], logs: [], range });
    extra = r.data ?? [];
  }
  return NextResponse.json({ workouts: planned.data ?? [], logs: [...(logs.data ?? []), ...extra], range });
}

/**
 * Plan a workout for the player: from a template (`template_id`) or given here (title, notes,
 * items), on one date (`start`) or a series (`weekdays` 0-6 for `weeks` weeks, at most 60 dates).
 * Each date is its own planned workout, with its own copy of the plan.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { data: player, error: pe } = await s.supabase.from('players').select('id').eq('id', id).maybeSingle();
  if (pe) return dbError(pe);
  if (!player) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let source: unknown = body;
  let template_id: string | null = null;
  if (body?.template_id !== undefined && body.template_id !== null) {
    if (!isUuid(body.template_id)) return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
    const { data: t, error: te } = await s.supabase.from('workout_templates').select('id,title,notes,items').eq('id', body.template_id).maybeSingle();
    if (te) return dbError(te);
    if (!t) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    template_id = t.id;
    source = { title: typeof body.title === 'string' && body.title.trim() ? body.title : t.title, notes: t.notes, items: t.items };
  }
  const v = validateWorkout(source);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const weekdays = Array.isArray(body?.weekdays) ? body.weekdays.map(Number) : [];
  const dates = scheduleDates(typeof body?.start === 'string' ? body.start : '', weekdays, Number(body?.weeks ?? 1));
  if (!dates.ok) return NextResponse.json({ error: dates.error }, { status: 400 });
  const batch_id = dates.value.length > 1 ? crypto.randomUUID() : null;
  const rows = dates.value.map((d) => ({ coach_id: s.userId, player_id: id, template_id, batch_id, ...v.value, scheduled_on: d }));
  const { data, error } = await s.supabase.from('player_workouts').insert(rows).select(WORKOUT_COLS);
  if (error) return dbError(error);
  return NextResponse.json({ workouts: data ?? [] });
}
