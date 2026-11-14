'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CalendarPlus, Check, ClipboardList, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { shiftDay } from '@/lib/players/nutrition';
import {
  comparePlanned, describeDone, describePlanned, logFromPlan, scheduleDates, workoutState,
  type LogField, type WorkoutInput, type WorkoutState,
} from '@/lib/players/workouts';
import { badge, card, chip, dashedBtn, ghostBtn, h2, input, muted, panel, primaryBtn, shortDate, todayLocal } from '@/components/players/ui';
import SetupNotice from '@/components/players/SetupNotice';
import WorkoutEditor from '@/components/players/workouts/WorkoutEditor';
import LogForm, { type LogStart } from '@/components/players/workouts/LogForm';
import type { PlannedWorkout, WorkoutLog, WorkoutTemplate, WorkoutsClient } from '@/components/players/workouts/workoutsClient';

type Mode =
  | { kind: 'none' }
  | { kind: 'assign' }
  | { kind: 'templates' }
  | { kind: 'template'; t?: WorkoutTemplate }
  | { kind: 'plan'; w: PlannedWorkout }
  | { kind: 'log'; workout?: PlannedWorkout; log?: WorkoutLog };

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (ymd: string) => DAY_SHORT[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const when = (ymd: string) => `${weekday(ymd)} ${shortDate(ymd)}`;
const STATE: Record<WorkoutState, { label: string; tone: 'pending' | 'warn' | 'info' | 'ok' }> = {
  done: { label: 'Done', tone: 'ok' }, today: { label: 'Today', tone: 'pending' }, upcoming: { label: 'Planned', tone: 'info' },
  missed: { label: 'Not done', tone: 'warn' }, skipped: { label: 'Skipped', tone: 'info' },
};
const STATUS_COLOR = { done: '#1d7a36', partial: '#a05a00', missed: '#b3261e' } as const;
const small: CSSProperties = { ...chip, display: 'inline-flex', alignItems: 'center', gap: 4 };

/**
 * Workouts of one player: what is planned (from templates or made for the player, on dates or as a
 * weekly series) and what was done, side by side. The coach plans, reviews and manages templates
 * and the exercise library; the player sees the plan and logs what they did (it waits for review).
 */
export default function WorkoutsSection({ client }: { client: WorkoutsClient }) {
  const today = todayLocal();
  const coach = client.viewer === 'coach';
  const [workouts, setWorkouts] = useState<PlannedWorkout[] | null>(null);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [toFix, setToFix] = useState<WorkoutLog[]>([]);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [canLog, setCanLog] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<{ id: string; date: string } | null>(null);
  const [fixFor, setFixFor] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState('');
  const [showPast, setShowPast] = useState(8);

  const load = useCallback(async () => {
    try {
      const d = await client.load(shiftDay(today, -56), shiftDay(today, 56));
      setWorkouts(d.workouts);
      setLogs(d.logs);
      setToFix(d.toFix);
      setSetupNeeded(d.setupNeeded);
      setCanLog(d.canLog);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
      setWorkouts((w) => w ?? []);
    }
  }, [client, today]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const logOf = useMemo(() => new Map(logs.filter((l) => l.workout_id).map((l) => [l.workout_id as string, l])), [logs]);
  const list = workouts ?? [];
  const upcoming = list.filter((w) => w.scheduled_on >= today && !logOf.has(w.id) && w.status !== 'skipped');
  const planIds = new Set(list.map((w) => w.id));
  const past = [
    ...list.filter((w) => !upcoming.includes(w)).map((w) => ({ date: logOf.get(w.id)?.performed_on ?? w.scheduled_on, w, log: logOf.get(w.id) ?? null })),
    ...logs.filter((l) => !l.workout_id || !planIds.has(l.workout_id)).map((l) => ({ date: l.performed_on, w: null as PlannedWorkout | null, log: l })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const startFor = (m: Extract<Mode, { kind: 'log' }>): { start: LogStart; fields?: Record<string, LogField[]> } => {
    if (m.log) return { start: { performed_on: m.log.performed_on, title: m.log.title, items: m.log.items, duration_min: m.log.duration_min, rpe: m.log.rpe, notes: m.log.notes }, fields: m.workout ? Object.fromEntries(m.workout.items.map((p) => [p.id, p.log_fields])) : undefined };
    if (m.workout) {
      const w = m.workout;
      return { start: { performed_on: w.scheduled_on <= today ? w.scheduled_on : today, title: w.title, items: logFromPlan(w.items), duration_min: null, rpe: null, notes: '' }, fields: Object.fromEntries(w.items.map((p) => [p.id, p.log_fields])) };
    }
    return { start: { performed_on: today, title: 'Workout', items: [], duration_min: null, rpe: null, notes: '' } };
  };

  const logBlock = (log: WorkoutLog, w: PlannedWorkout | null) => {
    const rows = w ? comparePlanned(w.items, log.items) : null;
    const mine = !coach && log.author === 'link' && log.status !== 'approved';
    return (
      <div style={{ display: 'grid', gap: 6 }} data-testid="workout-log">
        {rows ? (
          <div role="table" aria-label="Planned and done" style={{ display: 'grid', gap: 2, fontSize: 12 }}>
            <div role="row" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 6, color: 'var(--cl-text-muted)' }}>
              <span role="columnheader">Exercise</span><span role="columnheader">Planned</span><span role="columnheader">Done</span>
            </div>
            {rows.map((r, i) => (
              <div role="row" key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 6, borderTop: '1px solid var(--cl-border)', paddingTop: 3 }}>
                <span role="cell" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.name}{r.extra ? ' (extra)' : ''}</span>
                <span role="cell" style={{ color: 'var(--cl-text-secondary)' }}>{r.planned}</span>
                <span role="cell" style={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>{r.status === 'missed' ? 'Not done' : r.done}{r.status === 'partial' ? ' (part)' : ''}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 2, fontSize: 13 }}>
            {log.items.map((it) => <div key={it.id}><strong>{it.name}</strong> <span style={{ color: 'var(--cl-text-secondary)' }}>{describeDone(it.sets)}</span></div>)}
          </div>
        )}
        <div style={{ ...muted, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {log.duration_min !== null ? <span>{log.duration_min} min</span> : null}
          {log.rpe !== null ? <span>· effort {log.rpe}/10</span> : null}
          {log.author === 'link' ? <span style={badge('info')}>{coach ? 'Logged by the player' : 'You'}</span> : null}
          {log.author === 'link' && log.status === 'submitted' ? <span style={badge('pending')}>{coach ? 'To review' : 'Waiting for review'}</span> : null}
          {log.status === 'needs_revision' ? <span style={badge('warn')}>Needs a fix</span> : null}
        </div>
        {log.notes ? <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)', whiteSpace: 'pre-wrap' }}>“{log.notes}”</div> : null}
        {log.status === 'needs_revision' && log.review_note ? <div style={{ fontSize: 12, color: '#b3261e' }}>{coach ? 'You asked: ' : 'Coach: '}{log.review_note}</div> : null}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {coach && client.reviewLog && log.author === 'link' && log.status === 'submitted' ? (
            fixFor === log.id ? (
              <>
                <input autoFocus value={fixNote} onChange={(e) => setFixNote(e.target.value)} placeholder="What should the player change?" aria-label="What should the player change?" style={{ ...input, flex: '1 1 200px', width: 0 }} />
                <button type="button" disabled={!fixNote.trim() || busy} onClick={() => void act(async () => { await client.reviewLog!(log, 'needs_revision', fixNote.trim()); setFixFor(null); setFixNote(''); })} style={primaryBtn}>Send</button>
                <button type="button" onClick={() => setFixFor(null)} style={ghostBtn}>Cancel</button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => void act(() => client.reviewLog!(log, 'approved'))} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12 }}><Check size={13} /> Approve</button>
                <button type="button" disabled={busy} onClick={() => { setFixFor(log.id); setFixNote(''); }} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }}><Undo2 size={13} /> Ask for a fix</button>
              </>
            )
          ) : null}
          {(coach && client.saveLog) || mine ? (
            <>
              <button type="button" onClick={() => setMode({ kind: 'log', log, workout: w ?? undefined })} style={small} aria-label="Edit log"><Pencil size={12} /> Edit log</button>
              <button type="button" disabled={busy} onClick={() => { if (window.confirm('Delete this log? The planned workout stays.')) void act(() => client.deleteLog!(log)); }} style={{ ...small, color: '#b3261e' }} aria-label="Delete log"><Trash2 size={12} /> Delete log</button>
            </>
          ) : null}
        </div>
      </div>
    );
  };

  const workoutCard = (w: PlannedWorkout, log: WorkoutLog | null) => {
    const state = workoutState(w, Boolean(log), today);
    const st = STATE[state];
    return (
      <div key={w.id} style={{ ...card, display: 'grid', gap: 8, padding: 12 }} data-testid="planned-workout" data-state={state}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--cl-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{when(w.scheduled_on)}</span>
          <strong style={{ fontSize: 14 }}>{w.title}</strong>
          <span style={badge(st.tone)}>{st.label}</span>
          {w.batch_id ? <span style={{ ...muted, fontSize: 11 }}>series</span> : null}
        </div>
        {!log ? (
          <div style={{ display: 'grid', gap: 2, fontSize: 13 }}>
            {w.items.map((it) => <div key={it.id}><strong>{it.name}</strong> <span style={{ color: 'var(--cl-text-secondary)' }}>{describePlanned(it)}</span>{it.notes ? <span style={muted}> · {it.notes}</span> : null}</div>)}
          </div>
        ) : null}
        {w.notes ? <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)', whiteSpace: 'pre-wrap' }}>{w.notes}</div> : null}
        {log ? logBlock(log, w) : null}
        {!log ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {client.saveLog && (coach || canLog) && w.status !== 'skipped' ? (
              <button type="button" onClick={() => setMode({ kind: 'log', workout: w })} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12 }}><ClipboardList size={13} /> {coach ? 'Log it' : 'I did it'}</button>
            ) : null}
            {coach && client.updateWorkout ? (
              <>
                <button type="button" disabled={busy} onClick={() => void act(() => client.updateWorkout!(w, { status: w.status === 'skipped' ? 'planned' : 'skipped' }))} style={small}>{w.status === 'skipped' ? 'Plan it again' : 'Skip'}</button>
                {moving?.id === w.id ? (
                  <>
                    <input type="date" value={moving.date} onChange={(e) => setMoving({ id: w.id, date: e.target.value })} aria-label="New date" style={{ ...input, padding: '5px 8px' }} />
                    <button type="button" disabled={busy || !moving.date} onClick={() => void act(async () => { await client.updateWorkout!(w, { scheduled_on: moving.date }); setMoving(null); })} style={small}>Move</button>
                  </>
                ) : <button type="button" onClick={() => setMoving({ id: w.id, date: w.scheduled_on })} style={small}>Move</button>}
                <button type="button" onClick={() => setMode({ kind: 'plan', w })} style={small}><Pencil size={12} /> Edit</button>
                <button type="button" disabled={busy} onClick={() => { if (window.confirm('Delete this planned workout?')) void act(() => client.deleteWorkout!(w, false)); }} style={{ ...small, color: '#b3261e' }}><Trash2 size={12} /> Delete</button>
                {w.batch_id ? <button type="button" disabled={busy} onClick={() => { if (window.confirm('Delete this workout and the later ones of the series that are not done?')) void act(() => client.deleteWorkout!(w, true)); }} style={{ ...small, color: '#b3261e' }}>Delete this and later</button> : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const form = (() => {
    if (mode.kind === 'assign' && coach) return <AssignForm client={client} onDone={() => { setMode({ kind: 'none' }); void load(); }} onCancel={() => setMode({ kind: 'none' })} />;
    if (mode.kind === 'templates' && coach) return <Templates client={client} onClose={() => setMode({ kind: 'none' })} />;
    if (mode.kind === 'plan' && coach) {
      const w = mode.w;
      return <WorkoutEditor heading={`Edit the plan for ${when(w.scheduled_on)}`} initial={{ title: w.title, notes: w.notes, items: w.items }} client={client} onCancel={() => setMode({ kind: 'none' })} onSave={async (input) => { await client.updateWorkout!(w, { ...input, expected_updated_at: w.updated_at }); setMode({ kind: 'none' }); await load(); }} />;
    }
    if (mode.kind === 'log' && client.saveLog) {
      const { start, fields } = startFor(mode);
      return (
        <LogForm
          heading={mode.log ? 'Edit the log' : mode.workout ? `Log: ${mode.workout.title}` : 'Log a workout'}
          start={start} plannedFields={fields}
          saveLabel={coach ? 'Save' : mode.log ? 'Send the correction' : 'Send to coach'}
          onCancel={() => setMode({ kind: 'none' })}
          onSave={async (draft) => { await client.saveLog!(draft, { log: mode.log, workout: mode.workout }); setMode({ kind: 'none' }); await load(); }}
        />
      );
    }
    return null;
  })();

  return (
    <section style={{ ...panel, marginBottom: 18, display: 'grid', gap: 14 }} aria-label="Workouts" data-testid="workouts-section">
      <div>
        <h2 style={h2}>Workouts</h2>
        <p style={{ ...muted, margin: '4px 0 0' }}>
          {coach
            ? 'Plan workouts from templates or the exercise library, on a date or every week; what was done is logged separately and compared with the plan.'
            : 'The workouts your coach planned for you. Tap “I did it” and adjust what you actually did: it goes to your coach.'}
        </p>
      </div>
      {setupNeeded ? <SetupNotice what="Workouts" /> : null}
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      {workouts === null ? <div style={muted}>Loading…</div> : null}

      {!setupNeeded && workouts !== null ? (
        <>
          {!coach && toFix.length ? (
            <div role="status" style={{ ...card, borderColor: 'rgba(255,59,48,0.35)', background: 'rgba(255,59,48,0.05)' }}>
              <strong style={{ fontSize: 13 }}>Your coach asked you to fix {toFix.length === 1 ? 'one workout log' : `${toFix.length} workout logs`}.</strong>
              <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)', marginTop: 4 }}>Look for “Needs a fix” below, tap “Edit log”, correct it and send it again.</div>
            </div>
          ) : null}
          {form ?? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {coach && client.assign ? <button type="button" onClick={() => setMode({ kind: 'assign' })} style={primaryBtn}><CalendarPlus size={14} /> Plan a workout</button> : null}
              {client.saveLog && (coach || canLog) ? <button type="button" onClick={() => setMode({ kind: 'log' })} style={ghostBtn}><Plus size={14} /> Log a workout</button> : null}
              {coach && client.templates ? <button type="button" onClick={() => setMode({ kind: 'templates' })} style={ghostBtn}>Templates</button> : null}
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }} data-testid="upcoming-workouts">
            <strong style={{ fontSize: 13 }}>Coming up</strong>
            {upcoming.length ? upcoming.map((w) => workoutCard(w, null)) : <div style={muted}>{coach ? 'Nothing planned.' : 'Nothing planned yet.'}</div>}
          </div>
          <div style={{ display: 'grid', gap: 8 }} data-testid="past-workouts">
            <strong style={{ fontSize: 13 }}>Done and past</strong>
            {past.length === 0 ? <div style={muted}>Nothing yet.</div> : null}
            {past.slice(0, showPast).map((p) => (p.w ? workoutCard(p.w, p.log) : (
              <div key={p.log!.id} style={{ ...card, display: 'grid', gap: 8, padding: 12 }} data-testid="adhoc-log">
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--cl-text-secondary)' }}>{when(p.log!.performed_on)}</span>
                  <strong style={{ fontSize: 14 }}>{p.log!.title}</strong>
                  <span style={badge('ok')}>Done</span>
                </div>
                {logBlock(p.log!, null)}
              </div>
            )))}
            {past.length > showPast ? <div><button type="button" onClick={() => setShowPast((n) => n + 8)} style={chip}>Show more</button></div> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Choose a template (or build a workout), then a date or a weekly series. */
function AssignForm({ client, onDone, onCancel }: { client: WorkoutsClient; onDone: () => void; onCancel: () => void }) {
  const today = todayLocal();
  const [templates, setTemplates] = useState<WorkoutTemplate[] | null>(null);
  const [source, setSource] = useState<string>('');
  const [draft, setDraft] = useState<WorkoutInput | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [start, setStart] = useState(today);
  const [days, setDays] = useState<number[]>([]);
  const [weeks, setWeeks] = useState('4');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.templates?.().then(setTemplates).catch(() => setTemplates([])); }, [client]);

  const dates = scheduleDates(start, days, Number(weeks) || 0);
  const ready = (source && source !== 'new') || draft;
  const submit = async () => {
    if (!dates.ok) { setErr(dates.error); return; }
    setBusy(true);
    setErr(null);
    try {
      if (draft && saveAsTemplate) await client.saveTemplate!(draft);
      const body = source && source !== 'new' ? { template_id: source, start, weekdays: days, weeks: Number(weeks) || 1 } : { ...draft!, start, weekdays: days, weeks: Number(weeks) || 1 };
      await client.assign!(body);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not plan the workout');
      setBusy(false);
    }
  };

  if (source === 'new' && !draft) {
    return <WorkoutEditor heading="New workout" initial={{ title: '', notes: '', items: [] }} client={client} saveLabel="Next: choose the dates" onCancel={() => setSource('')} onSave={(w) => setDraft(w)} />;
  }
  return (
    <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="assign-form">
      <h2 style={h2}>Plan a workout</h2>
      {draft ? (
        <div style={{ fontSize: 13 }}><strong>{draft.title}</strong> <span style={muted}>· {draft.items.length} exercises</span> <button type="button" onClick={() => setDraft(null)} style={{ ...chip, marginLeft: 6 }}>Change</button></div>
      ) : (
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Workout to plan" style={input}>
          <option value="">Choose a template…</option>
          {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.title} ({t.items.length} exercises)</option>)}
          <option value="new">+ Build a new workout</option>
        </select>
      )}
      {draft ? (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} /> Also save it as a template
        </label>
      ) : null}
      <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)' }}>
        First date
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="First date" style={input} />
      </label>
      <div role="group" aria-label="Repeat on" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ ...muted, marginRight: 4 }}>Repeat on</span>
        {WEEK.map((d) => {
          const on = days.includes(d);
          return <button key={d} type="button" aria-pressed={on} onClick={() => setDays((p) => (on ? p.filter((x) => x !== d) : [...p, d]))} style={{ ...chip, minWidth: 40, fontWeight: on ? 700 : 500, border: on ? '1px solid var(--cl-accent)' : chip.border, background: on ? 'rgba(0,122,255,0.10)' : chip.background }}>{DAY_SHORT[d]}</button>;
        })}
      </div>
      {days.length ? (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          for <input value={weeks} onChange={(e) => setWeeks(e.target.value)} inputMode="numeric" aria-label="Number of weeks" style={{ ...input, width: 64 }} /> weeks
        </label>
      ) : null}
      <div style={muted} data-testid="assign-preview">
        {dates.ok ? `${dates.value.length === 1 ? 'One workout' : `${dates.value.length} workouts`}: ${dates.value.slice(0, 6).map(when).join(', ')}${dates.value.length > 6 ? '…' : ''}` : dates.error}
      </div>
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy || !ready || !dates.ok} onClick={() => void submit()} style={primaryBtn}>{busy ? 'Saving…' : dates.ok && dates.value.length > 1 ? `Plan ${dates.value.length} workouts` : 'Plan it'}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}

/** The coach's templates: create, edit, delete. Planned workouts keep their own copy. */
function Templates({ client, onClose }: { client: WorkoutsClient; onClose: () => void }) {
  const [list, setList] = useState<WorkoutTemplate[] | null>(null);
  const [editing, setEditing] = useState<{ t?: WorkoutTemplate } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { client.templates?.().then(setList).catch((e) => { setErr(e instanceof Error ? e.message : 'Could not load'); setList([]); }); }, [client]);
  useEffect(() => { load(); }, [load]);
  if (editing) {
    const t = editing.t;
    return <WorkoutEditor heading={t ? 'Edit template' : 'New template'} initial={t ? { title: t.title, notes: t.notes, items: t.items } : { title: '', notes: '', items: [] }} client={client} onCancel={() => setEditing(null)} onSave={async (input) => { await client.saveTemplate!(input, t); setEditing(null); load(); }} />;
  }
  return (
    <div style={{ ...card, display: 'grid', gap: 8 }} data-testid="templates">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h2 style={{ ...h2, flex: 1 }}>Templates</h2>
        <button type="button" onClick={onClose} style={chip}>Done</button>
      </div>
      <p style={{ ...muted, margin: 0 }}>Reusable workouts for all your players. Changing a template never changes workouts already planned.</p>
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      {list === null ? <div style={muted}>Loading…</div> : list.length === 0 ? <div style={muted}>No template yet.</div> : null}
      {(list ?? []).map((t) => (
        <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--cl-border)', paddingTop: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t.title}</div>
            <div style={{ ...muted, fontSize: 11 }}>{t.items.map((i) => i.name).join(', ')}</div>
          </div>
          <button type="button" onClick={() => setEditing({ t })} style={small} aria-label={`Edit ${t.title}`}><Pencil size={12} /> Edit</button>
          <button type="button" onClick={() => { if (window.confirm(`Delete the template “${t.title}”?`)) void client.deleteTemplate!(t).then(load).catch((e) => setErr(e instanceof Error ? e.message : 'Could not delete')); }} style={{ ...small, color: '#b3261e' }} aria-label={`Delete ${t.title}`}><Trash2 size={12} /></button>
        </div>
      ))}
      <div><button type="button" onClick={() => setEditing({})} style={{ ...dashedBtn, padding: '6px 10px', fontSize: 12 }}><Plus size={13} /> New template</button></div>
    </div>
  );
}
