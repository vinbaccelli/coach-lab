/** Columns and shared server steps for the mental / to-do routes. */
import { nextDue, type Recurrence } from '@/lib/players/mental';

export const QT_COLS = 'id,coach_id,slug,kind,title,description,questions,archived_at,created_at,updated_at';
export const PQ_COLS = 'id,player_id,template_id,kind,title,description,questions,due_on,status,created_at,updated_at';
export const RESP_COLS = 'id,player_id,questionnaire_id,answered_on,answers,author,status,review_note,created_at,updated_at';
export const ASSIGN_COLS = 'id,player_id,title,description,due_on,recurrence,questionnaire_id,series_id,status,done_at,done_by,created_at,updated_at';

type Row = { id: string; coach_id?: string; player_id: string; title: string; description: string; due_on: string | null; recurrence: Recurrence; questionnaire_id: string | null; series_id: string | null };
// Minimal client surface (user-scoped or service role).
type Db = { from: (t: string) => { insert: (v: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }> } };

/** After a repeating task is done, its next occurrence (same series) is created. */
export async function createNextOccurrence(db: Db, row: Row & { coach_id: string }): Promise<string | null> {
  const due = row.due_on ? nextDue(row.due_on, row.recurrence) : null;
  if (!due) return null;
  const { error } = await db.from('player_assignments').insert({
    coach_id: row.coach_id, player_id: row.player_id, title: row.title, description: row.description, due_on: due,
    recurrence: row.recurrence, questionnaire_id: row.questionnaire_id, series_id: row.series_id ?? row.id, status: 'open',
  });
  return error ? null : due;
}
