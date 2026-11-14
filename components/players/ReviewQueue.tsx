'use client';

import { useState } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { computeDerived, describeEntry, type Tracker, type TrackerEntry } from '@/lib/players/trackers';
import { MEAL_LABELS, type MealLog } from '@/lib/players/nutrition';
import type { WorkoutLog } from '@/components/players/workouts/workoutsClient';
import { apiJson, badge, ghostBtn, h2, input, muted, panel, primaryBtn, shortDate } from '@/components/players/ui';

/**
 * What the player sent through the share link and the coach has not reviewed yet, in one list:
 * approve it (it joins the history and the charts as a normal entry) or ask for a fix with a note
 * (the player sees the note on their page and can correct the entry).
 */
export default function ReviewQueue({ playerId, entries, trackers, meals = [], workoutLogs = [], answers = 0, onChanged, onOpenNutrition, onOpenWorkouts, onOpenMental }: {
  playerId: string;
  entries: TrackerEntry[];
  trackers: Tracker[];
  /** Meals the player logged (waiting): approved here in one tap, or opened in Nutrition. */
  meals?: MealLog[];
  /** Workouts the player logged (waiting): approved here in one tap, or opened in Workouts. */
  workoutLogs?: WorkoutLog[];
  onChanged: () => void;
  onOpenNutrition?: () => void;
  onOpenWorkouts?: () => void;
  /** Questionnaire answers the player sent (read them in Mental). */
  answers?: number;
  onOpenMental?: () => void;
}) {
  const [fixFor, setFixFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!entries.length && !meals.length && !workoutLogs.length && !answers) return null;
  const byId = new Map(trackers.map((t) => [t.id, t]));

  const approveMeals = async () => {
    setBusy('meals');
    setErr(null);
    try {
      await apiJson(`/api/players/${playerId}/meals/approve`, { method: 'POST', json: { ids: meals.map((m) => m.id) } });
      onChanged();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };
  const mealDays = [...new Set(meals.map((m) => m.eaten_on))];
  const approveLogs = async () => {
    setBusy('workouts');
    setErr(null);
    try {
      await apiJson(`/api/players/${playerId}/workout-logs/approve`, { method: 'POST', json: { ids: workoutLogs.map((l) => l.id) } });
      onChanged();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const review = async (e: TrackerEntry, status: 'approved' | 'needs_revision', reviewNote?: string) => {
    setBusy(e.id);
    setErr(null);
    try {
      await apiJson(`/api/players/${playerId}/tracker-entries/${e.id}`, { method: 'PATCH', json: { status, review_note: reviewNote } });
      setFixFor(null);
      setNote('');
      onChanged();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section style={{ ...panel, marginBottom: 18, borderColor: 'rgba(255,159,10,0.45)' }} aria-label="To review" data-testid="review-queue">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={h2}>To review</h2>
        <span style={badge('pending')}>{entries.length + meals.length + workoutLogs.length + answers}</span>
      </div>
      <p style={{ ...muted, margin: '4px 0 10px' }}>Sent by the player through the share link. Approved entries join the history and the charts.</p>
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      <div style={{ display: 'grid' }}>
        {entries.map((e) => {
          const t = byId.get(e.tracker_id);
          if (!t) return null;
          const derived = computeDerived(t, [e]).get(e.id);
          return (
            <div key={e.id} style={{ borderTop: '1px solid var(--cl-border)', padding: '10px 0', display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{t.name}</strong>
                <span style={{ fontSize: 12, color: 'var(--cl-text-muted)' }}>{shortDate(e.entry_date)}</span>
              </div>
              <div style={{ fontSize: 13 }}>{describeEntry(t, e, derived)}</div>
              {e.note ? <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)', whiteSpace: 'pre-wrap' }}>“{e.note}”</div> : null}
              {fixFor === e.id ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <input autoFocus value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="What should the player change?" style={{ ...input, flex: '1 1 220px' }} />
                  <button type="button" disabled={!note.trim() || busy === e.id} onClick={() => void review(e, 'needs_revision', note.trim())} style={primaryBtn}>Send</button>
                  <button type="button" onClick={() => setFixFor(null)} style={ghostBtn}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" disabled={busy === e.id} onClick={() => void review(e, 'approved')} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12 }}><Check size={13} /> Approve</button>
                  <button type="button" disabled={busy === e.id} onClick={() => { setFixFor(e.id); setNote(''); }} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }}><Undo2 size={13} /> Ask for a fix</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {meals.length ? (
        <div data-testid="review-meals" style={{ borderTop: '1px solid var(--cl-border)', padding: '10px 0 0', display: 'grid', gap: 6 }}>
          <strong style={{ fontSize: 13 }}>{meals.length === 1 ? 'One meal' : `${meals.length} meals`} logged by the player</strong>
          <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)' }}>
            {mealDays.slice(0, 3).map((d) => `${shortDate(d)}: ${meals.filter((m) => m.eaten_on === d).map((m) => MEAL_LABELS[m.category] ?? m.category).join(', ')}`).join(' · ')}
            {mealDays.length > 3 ? ` · and ${mealDays.length - 3} more days` : ''}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy === 'meals'} onClick={() => void approveMeals()} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12 }}><Check size={13} /> Approve {meals.length === 1 ? 'it' : `all ${meals.length}`}</button>
            {onOpenNutrition ? <button type="button" onClick={onOpenNutrition} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }}>Review in Nutrition</button> : null}
          </div>
        </div>
      ) : null}
      {answers ? (
        <div data-testid="review-answers" style={{ borderTop: '1px solid var(--cl-border)', padding: '10px 0 0', marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13 }}>{answers === 1 ? 'One questionnaire answer' : `${answers} questionnaire answers`} to read</strong>
          {onOpenMental ? <button type="button" onClick={onOpenMental} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }}>Open Mental</button> : null}
        </div>
      ) : null}
      {workoutLogs.length ? (
        <div data-testid="review-workouts" style={{ borderTop: '1px solid var(--cl-border)', padding: '10px 0 0', marginTop: 10, display: 'grid', gap: 6 }}>
          <strong style={{ fontSize: 13 }}>{workoutLogs.length === 1 ? 'One workout' : `${workoutLogs.length} workouts`} logged by the player</strong>
          <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)' }}>{workoutLogs.slice(0, 4).map((l) => `${shortDate(l.performed_on)}: ${l.title}`).join(' · ')}{workoutLogs.length > 4 ? ' …' : ''}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy === 'workouts'} onClick={() => void approveLogs()} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12 }}><Check size={13} /> Approve {workoutLogs.length === 1 ? 'it' : `all ${workoutLogs.length}`}</button>
            {onOpenWorkouts ? <button type="button" onClick={onOpenWorkouts} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }}>Review in Workouts</button> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
