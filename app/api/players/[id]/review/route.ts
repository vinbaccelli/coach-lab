import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { MEAL_COLS } from '@/lib/players/mealPhotos';
import { LOG_COLS } from '@/lib/players/workoutCols';
import { RESP_COLS } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';

/**
 * Everything the player sent through the share link that waits for the coach: tracker entries,
 * meals, workout logs and questionnaire answers with status `submitted`. Newest first, with the tracker each
 * entry belongs to, so the coach can approve or ask for a fix from one place. A module whose table
 * does not exist yet simply has nothing waiting.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const [{ data: entries, error }, meals, workoutLogs, answers] = await Promise.all([
    s.supabase
      .from('player_tracker_entries')
      .select('id,tracker_id,entry_date,measurements,sets,note,author,status,review_note,created_at,updated_at')
      .eq('player_id', id).eq('status', 'submitted').order('created_at', { ascending: false }).limit(200),
    s.supabase.from('player_meal_logs').select(MEAL_COLS).eq('player_id', id).eq('status', 'submitted').order('eaten_on', { ascending: false }).order('created_at', { ascending: false }).limit(300),
    s.supabase.from('player_workout_logs').select(LOG_COLS).eq('player_id', id).eq('status', 'submitted').order('performed_on', { ascending: false }).limit(200),
    s.supabase.from('player_questionnaire_responses').select(RESP_COLS).eq('player_id', id).eq('status', 'submitted').order('answered_on', { ascending: false }).limit(200),
  ]);
  const mealList = meals.error ? [] : meals.data ?? [];
  const logList = workoutLogs.error ? [] : workoutLogs.data ?? [];
  const answerList = answers.error ? [] : answers.data ?? [];
  if (error) return dbError(error, { entries: [], trackers: [], meals: mealList, workoutLogs: logList, answers: answerList });
  const ids = [...new Set((entries ?? []).map((e) => e.tracker_id))];
  if (!ids.length) return NextResponse.json({ entries: [], trackers: [], meals: mealList, workoutLogs: logList, answers: answerList });
  const { data: trackers, error: te } = await s.supabase
    .from('player_trackers').select('id,player_id,name,description,category,preset,mode,fields,position,archived_at,created_at,updated_at').in('id', ids);
  if (te) return dbError(te, { entries: [], trackers: [], meals: mealList, workoutLogs: logList, answers: answerList });
  return NextResponse.json({ entries: entries ?? [], trackers: trackers ?? [], meals: mealList, workoutLogs: logList, answers: answerList });
}
