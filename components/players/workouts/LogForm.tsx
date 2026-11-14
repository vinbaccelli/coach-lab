'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { formatDuration } from '@/lib/players/trackers';
import { validateLog, type DoneItem, type LogField } from '@/lib/players/workouts';
import { card, dashedBtn, ghostBtn, h2, iconBtn, input, muted, primaryBtn, todayLocal } from '@/components/players/ui';

type SetRow = { reps: string; weight_kg: string; duration_s: string; distance_m: string };
type ItemRow = { id: string; exercise_id: string | null; planned_id: string | null; name: string; fields: LogField[]; sets: SetRow[]; notes: string };
export interface LogStart { performed_on: string; title: string; items: DoneItem[]; duration_min: number | null; rpe: number | null; notes: string }

const s = (n: number | undefined) => (n === undefined ? '' : String(n));
let seq = 0;
const tmpId = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;
const emptySet = (): SetRow => ({ reps: '', weight_kg: '', duration_s: '', distance_m: '' });
/** The values a set records: from the plan, else what the saved sets contain, else reps and weight. */
function fieldsOf(item: DoneItem, planned?: Record<string, LogField[]>): LogField[] {
  const fromPlan = item.planned_id ? planned?.[item.planned_id] : undefined;
  if (fromPlan?.length) return fromPlan;
  const seen = new Set<LogField>();
  for (const st of item.sets) {
    if (st.reps !== undefined) seen.add('reps');
    if (st.weight_kg !== undefined) seen.add('weight');
    if (st.duration_s !== undefined) seen.add('duration');
    if (st.distance_m !== undefined) seen.add('distance');
  }
  return seen.size ? [...seen] : ['reps', 'weight'];
}

/**
 * What was done: the date, each exercise with the sets actually performed (prefilled from the plan,
 * so a planned workout done as planned is one tap), the duration, the effort (RPE) and notes.
 */
export default function LogForm({ heading, start, plannedFields, saveLabel, onSave, onCancel }: {
  heading: string;
  start: LogStart;
  plannedFields?: Record<string, LogField[]>;
  saveLabel: string;
  onSave: (draft: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(start.performed_on);
  const [title, setTitle] = useState(start.title);
  const [items, setItems] = useState<ItemRow[]>(start.items.map((it) => ({
    id: it.id, exercise_id: it.exercise_id, planned_id: it.planned_id, name: it.name, notes: it.notes, fields: fieldsOf(it, plannedFields),
    sets: it.sets.length ? it.sets.map((st) => ({ reps: s(st.reps), weight_kg: s(st.weight_kg), duration_s: st.duration_s === undefined ? '' : formatDuration(st.duration_s), distance_m: s(st.distance_m) })) : [emptySet()],
  })));
  const [duration, setDuration] = useState(start.duration_min === null ? '' : String(start.duration_min));
  const [rpe, setRpe] = useState(start.rpe === null ? '' : String(start.rpe));
  const [notes, setNotes] = useState(start.notes);
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setItem = (i: number, f: (r: ItemRow) => ItemRow) => setItems((p) => p.map((r, j) => (j === i ? f(r) : r)));
  const setVal = (i: number, k: number, key: keyof SetRow, v: string) => setItem(i, (r) => ({ ...r, sets: r.sets.map((st, j) => (j === k ? { ...st, [key]: v } : st)) }));

  const save = async () => {
    const draft = {
      performed_on: date, title, duration_min: duration, rpe, notes,
      items: items.map((r) => ({ id: r.id, exercise_id: r.exercise_id, planned_id: r.planned_id, name: r.name, notes: r.notes, sets: r.sets })),
    };
    const v = validateLog(draft, todayLocal());
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true);
    setErr(null);
    try {
      await onSave(draft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  };

  const cell = (i: number, k: number, key: keyof SetRow, label: string, ph: string) => (
    <input value={items[i].sets[k][key]} onChange={(e) => setVal(i, k, key, e.target.value)} placeholder={ph} aria-label={`${items[i].name} set ${k + 1} ${label}`}
      inputMode={key === 'duration_s' ? 'text' : 'decimal'} style={{ ...input, width: 0, flex: '1 1 0', padding: '7px 8px' }} />
  );

  return (
    <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="log-form">
      <h2 style={h2}>{heading}</h2>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} aria-label="Date done" style={{ ...input, flex: '1 1 140px', width: 0 }} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Workout name" placeholder="Workout" style={{ ...input, flex: '2 1 160px', width: 0 }} />
      </div>
      {items.map((r, i) => (
        <div key={r.id} style={{ border: '1px solid var(--cl-border)', borderRadius: 10, padding: 10, display: 'grid', gap: 6 }} data-testid="log-item">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <strong style={{ fontSize: 13, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{r.name}</strong>
            <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setItems((p) => p.filter((_, j) => j !== i))} style={iconBtn}><X size={15} /></button>
          </div>
          <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--cl-text-secondary)', paddingRight: 28 }}>
            <span style={{ width: 22 }} />
            {r.fields.includes('reps') ? <span style={{ flex: '1 1 0' }}>Reps</span> : null}
            {r.fields.includes('weight') ? <span style={{ flex: '1 1 0' }}>kg</span> : null}
            {r.fields.includes('duration') ? <span style={{ flex: '1 1 0' }}>Time</span> : null}
            {r.fields.includes('distance') ? <span style={{ flex: '1 1 0' }}>Metres</span> : null}
          </div>
          {r.sets.map((_, k) => (
            <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 22, fontSize: 12, color: 'var(--cl-text-muted)' }}>{k + 1}</span>
              {r.fields.includes('reps') ? cell(i, k, 'reps', 'reps', '–') : null}
              {r.fields.includes('weight') ? cell(i, k, 'weight_kg', 'kg', '–') : null}
              {r.fields.includes('duration') ? cell(i, k, 'duration_s', 'time', '0:30') : null}
              {r.fields.includes('distance') ? cell(i, k, 'distance_m', 'metres', '–') : null}
              <button type="button" aria-label={`Remove set ${k + 1} of ${r.name}`} onClick={() => setItem(i, (x) => ({ ...x, sets: x.sets.filter((__, j) => j !== k) }))} style={{ ...iconBtn, width: 22 }}><X size={13} /></button>
            </div>
          ))}
          <div>
            <button type="button" onClick={() => setItem(i, (x) => ({ ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] ?? emptySet()) }] }))} style={{ ...ghostBtn, padding: '5px 10px', fontSize: 12 }}><Plus size={12} /> Set</button>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Add an exercise you did" aria-label="Exercise done" style={{ ...input, flex: '1 1 160px', width: 0 }} />
        <button type="button" disabled={!typed.trim()} onClick={() => { setItems((p) => [...p, { id: tmpId(), exercise_id: null, planned_id: null, name: typed.trim(), fields: ['reps', 'weight'], sets: [emptySet()], notes: '' }]); setTyped(''); }} style={{ ...dashedBtn, padding: '6px 10px', fontSize: 12 }}><Plus size={13} /> Add</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 2, fontSize: 12, color: 'var(--cl-text-secondary)', flex: '1 1 110px' }}>
          Duration (min)
          <input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="decimal" aria-label="Duration in minutes" style={{ ...input, width: '100%' }} />
        </label>
        <label style={{ display: 'grid', gap: 2, fontSize: 12, color: 'var(--cl-text-secondary)', flex: '1 1 110px' }}>
          Effort (1–10)
          <select value={rpe} onChange={(e) => setRpe(e.target.value)} aria-label="Effort from 1 to 10" style={{ ...input, width: '100%' }}>
            <option value="">–</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}{n === 1 ? ' very easy' : n === 10 ? ' maximal' : ''}</option>)}
          </select>
        </label>
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="How did it feel?" aria-label="Notes" style={{ ...input, resize: 'vertical' }} />
      {items.length === 0 ? <div style={muted}>No exercise: a note or a duration is enough for a rest-day walk.</div> : null}
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void save()} style={primaryBtn}>{busy ? 'Saving…' : saveLabel}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}
