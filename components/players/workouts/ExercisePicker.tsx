'use client';

import { useEffect, useMemo, useState } from 'react';
import { Info, Plus, X } from 'lucide-react';
import {
  CATEGORY_LABELS, DIFFICULTIES, EXERCISE_CATEGORIES, LOG_FIELDS, LOG_FIELD_LABELS, searchExercises, validateExercise,
  type Exercise, type ExerciseCategory, type LogField,
} from '@/lib/players/workouts';
import { card, chip, dashedBtn, ghostBtn, iconBtn, input, muted, primaryBtn } from '@/components/players/ui';
import type { WorkoutsClient } from '@/components/players/workouts/workoutsClient';

/**
 * Pick an exercise from the library (built-in + the coach's own): search by name, muscle,
 * equipment or sport, filter by category, read the instructions, or create a custom exercise.
 */
export default function ExercisePicker({ client, onPick, onClose }: { client: WorkoutsClient; onPick: (e: Exercise) => void; onClose: () => void }) {
  const [all, setAll] = useState<Exercise[] | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    client.library?.().then((x) => { if (alive) setAll(x); }).catch((e) => { if (alive) { setErr(e instanceof Error ? e.message : 'Could not load the library'); setAll([]); } });
    return () => { alive = false; };
  }, [client]);
  const results = useMemo(() => searchExercises(all ?? [], q, cat || null).slice(0, 60), [all, q, cat]);

  return (
    <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="exercise-picker">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 14, flex: 1 }}>Exercise library</strong>
        <button type="button" aria-label="Close the library" onClick={onClose} style={iconBtn}><X size={16} /></button>
      </div>
      {creating ? (
        <NewExercise client={client} onCancel={() => setCreating(false)} onSaved={(e) => { setCreating(false); onPick(e); }} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: squat, band, core, tennis…" aria-label="Search exercises" style={{ ...input, flex: '2 1 160px', width: 0 }} />
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" style={{ ...input, flex: '1 1 120px', width: 0 }}>
              <option value="">All categories</option>
              {EXERCISE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
          {all === null ? <div style={muted}>Loading…</div> : null}
          <div style={{ display: 'grid', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {results.map((e) => (
              <div key={e.id} style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 6 }} data-testid="exercise-option">
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{e.name}{e.coach_id ? <span style={{ ...muted, fontWeight: 500 }}> · yours</span> : null}</div>
                    <div style={{ ...muted, fontSize: 11 }}>{[CATEGORY_LABELS[e.category as ExerciseCategory] ?? e.category, e.muscle_groups.join(', '), e.equipment.join(', ')].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button type="button" aria-label={`About ${e.name}`} aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)} style={iconBtn}><Info size={16} /></button>
                  <button type="button" onClick={() => onPick(e)} style={{ ...chip, fontWeight: 700 }} aria-label={`Add ${e.name}`}>Add</button>
                </div>
                {open === e.id ? (
                  <div style={{ fontSize: 12, display: 'grid', gap: 4, padding: '6px 0' }}>
                    {e.description ? <div>{e.description}</div> : null}
                    {e.instructions ? <div style={{ color: 'var(--cl-text-secondary)', whiteSpace: 'pre-wrap' }}>{e.instructions}</div> : null}
                    <div style={muted}>{e.difficulty}{e.sports.length ? ` · ${e.sports.join(', ')}` : ''} · logs {e.log_fields.map((f) => LOG_FIELD_LABELS[f as LogField] ?? f).join(', ')}</div>
                    {e.video_url ? <a href={e.video_url} target="_blank" rel="noreferrer" style={{ color: 'var(--cl-accent)' }}>Watch the demo</a> : null}
                  </div>
                ) : null}
              </div>
            ))}
            {all && !results.length ? <div style={muted}>No exercise matches. Create your own below.</div> : null}
          </div>
          {client.saveExercise ? (
            <div><button type="button" onClick={() => setCreating(true)} style={{ ...dashedBtn, padding: '6px 10px', fontSize: 12 }}><Plus size={13} /> New exercise</button></div>
          ) : null}
        </>
      )}
    </div>
  );
}

function NewExercise({ client, onSaved, onCancel }: { client: WorkoutsClient; onSaved: (e: Exercise) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ExerciseCategory>('strength');
  const [muscles, setMuscles] = useState('');
  const [equipment, setEquipment] = useState('');
  const [instructions, setInstructions] = useState('');
  const [video, setVideo] = useState('');
  const [difficulty, setDifficulty] = useState<string>('intermediate');
  const [fields, setFields] = useState<LogField[]>(['reps', 'weight']);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = validateExercise({ name, category, muscle_groups: muscles, equipment, instructions, video_url: video, difficulty, log_fields: fields });
    if (!v.ok) { setErr(v.error); return; }
    if (video.trim() && !v.value.video_url) { setErr('The demo link must start with https://'); return; }
    setBusy(true);
    try { onSaved(await client.saveExercise!(v.value)); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); setBusy(false); }
  };
  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="new-exercise">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Exercise name" style={input} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select value={category} onChange={(e) => setCategory(e.target.value as ExerciseCategory)} aria-label="Exercise category" style={{ ...input, flex: '1 1 130px', width: 0 }}>
          {EXERCISE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label="Difficulty" style={{ ...input, flex: '1 1 110px', width: 0 }}>
          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <input value={muscles} onChange={(e) => setMuscles(e.target.value)} placeholder="Muscles (comma separated)" aria-label="Muscle groups" style={input} />
      <input value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder="Equipment (comma separated)" aria-label="Equipment" style={input} />
      <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} placeholder="How to do it" aria-label="Instructions" style={{ ...input, resize: 'vertical' }} />
      <input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="Demo video link (YouTube…)" aria-label="Demo video link" inputMode="url" style={input} />
      <div role="group" aria-label="What a set records" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
        {LOG_FIELDS.map((f) => (
          <label key={f} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <input type="checkbox" checked={fields.includes(f)} onChange={(e) => setFields((p) => (e.target.checked ? [...p, f] : p.filter((x) => x !== f)))} />
            {LOG_FIELD_LABELS[f]}
          </label>
        ))}
      </div>
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void save()} style={primaryBtn}>{busy ? 'Saving…' : 'Save and add'}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}
