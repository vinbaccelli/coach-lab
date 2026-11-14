'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { formatDuration } from '@/lib/players/trackers';
import { validateWorkout, type Exercise, type LogField, type PlannedItem, type WorkoutInput } from '@/lib/players/workouts';
import { card, dashedBtn, ghostBtn, h2, iconBtn, input, muted, primaryBtn } from '@/components/players/ui';
import ExercisePicker from '@/components/players/workouts/ExercisePicker';
import type { WorkoutsClient } from '@/components/players/workouts/workoutsClient';

type Row = { id: string; exercise_id: string | null; name: string; log_fields: LogField[]; sets: string; reps: string; weight_kg: string; duration_s: string; distance_m: string; rest_s: string; notes: string };
const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const dur = (n: number | null | undefined) => (n === null || n === undefined ? '' : formatDuration(n));
let seq = 0;
const tmpId = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;
const toRow = (p: PlannedItem): Row => ({
  id: p.id, exercise_id: p.exercise_id, name: p.name, log_fields: p.log_fields,
  sets: str(p.sets), reps: str(p.reps), weight_kg: str(p.weight_kg), duration_s: dur(p.duration_s), distance_m: str(p.distance_m), rest_s: dur(p.rest_s), notes: p.notes,
});

/**
 * A workout: name, notes and its exercises with the plan for each (sets, reps, weight, time,
 * distance, rest). Exercises come from the library or are typed in. Used for templates and for a
 * player's planned workouts.
 */
export default function WorkoutEditor({ heading, initial, client, saveLabel = 'Save', onSave, onCancel }: {
  heading: string;
  initial: WorkoutInput;
  client: WorkoutsClient;
  saveLabel?: string;
  onSave: (w: WorkoutInput) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.notes);
  const [rows, setRows] = useState<Row[]>(initial.items.map(toRow));
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = (e: Pick<Exercise, 'name' | 'log_fields'> & { id?: string | null }) => {
    setRows((p) => [...p, {
      id: tmpId(), exercise_id: e.id ?? null, name: e.name, log_fields: e.log_fields as LogField[],
      sets: '3', reps: e.log_fields.includes('reps') ? '10' : '', weight_kg: '', duration_s: e.log_fields.includes('duration') && !e.log_fields.includes('reps') ? '0:30' : '', distance_m: '', rest_s: '1:00', notes: '',
    }]);
  };
  const set = (i: number, k: keyof Row, v: string) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i: number, d: -1 | 1) => setRows((p) => {
    const j = i + d;
    if (j < 0 || j >= p.length) return p;
    const out = p.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  });

  const save = async () => {
    const v = validateWorkout({ title, notes, items: rows.map((r) => ({ ...r })) });
    if (!v.ok) { setErr(v.error); return; }
    if (!v.value.items.length) { setErr('Add at least one exercise'); return; }
    setBusy(true);
    setErr(null);
    try {
      await onSave(v.value);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const field = (i: number, k: keyof Row, label: string, placeholder: string) => (
    <label style={{ display: 'grid', gap: 2, fontSize: 11, color: 'var(--cl-text-secondary)', minWidth: 0 }}>
      {label}
      <input value={rows[i][k] as string} onChange={(e) => set(i, k, e.target.value)} placeholder={placeholder} inputMode={k === 'duration_s' || k === 'rest_s' ? 'text' : 'decimal'} aria-label={`${rows[i].name} ${label}`} style={{ ...input, width: '100%', padding: '7px 8px' }} />
    </label>
  );

  return (
    <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="workout-editor">
      <h2 style={h2}>{heading}</h2>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Workout name (e.g. Leg strength A)" aria-label="Workout name" style={input} />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (warm-up, focus…)" aria-label="Workout notes" style={{ ...input, resize: 'vertical' }} />
      {rows.map((r, i) => (
        <div key={r.id} style={{ border: '1px solid var(--cl-border)', borderRadius: 10, padding: 10, display: 'grid', gap: 8 }} data-testid="workout-item">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <strong style={{ fontSize: 13, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{r.name}</strong>
            <button type="button" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => move(i, -1)} style={iconBtn}><ArrowUp size={15} /></button>
            <button type="button" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} style={iconBtn}><ArrowDown size={15} /></button>
            <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setRows((p) => p.filter((_, j) => j !== i))} style={iconBtn}><X size={15} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 6 }}>
            {field(i, 'sets', 'Sets', '3')}
            {r.log_fields.includes('reps') ? field(i, 'reps', 'Reps', '10') : null}
            {r.log_fields.includes('weight') ? field(i, 'weight_kg', 'kg', '–') : null}
            {r.log_fields.includes('duration') ? field(i, 'duration_s', 'Time', '0:30') : null}
            {r.log_fields.includes('distance') ? field(i, 'distance_m', 'Metres', '–') : null}
            {field(i, 'rest_s', 'Rest', '1:00')}
          </div>
          <input value={r.notes} onChange={(e) => set(i, 'notes', e.target.value)} placeholder="Notes for this exercise" aria-label={`${r.name} notes`} style={input} />
        </div>
      ))}
      {picking ? (
        <ExercisePicker client={client} onClose={() => setPicking(false)} onPick={(e) => { add(e); setPicking(false); }} />
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {client.library ? <button type="button" onClick={() => setPicking(true)} style={{ ...dashedBtn, padding: '6px 10px', fontSize: 12 }}><Plus size={13} /> From the library</button> : null}
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="…or type an exercise" aria-label="Exercise to add" style={{ ...input, flex: '1 1 150px', width: 0 }} />
          <button type="button" disabled={!typed.trim()} onClick={() => { add({ name: typed.trim(), log_fields: ['reps', 'weight'] }); setTyped(''); }} style={{ ...ghostBtn, padding: '6px 10px', fontSize: 12 }}>Add</button>
        </div>
      )}
      {rows.length === 0 ? <div style={muted}>No exercise yet.</div> : null}
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void save()} style={primaryBtn}>{busy ? 'Saving…' : saveLabel}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}
