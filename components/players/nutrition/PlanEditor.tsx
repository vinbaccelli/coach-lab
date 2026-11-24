'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { validatePlan, type NutritionPlanInput } from '@/lib/players/nutrition';
import { card, dashedBtn, ghostBtn, h2, iconBtn, input, muted, primaryBtn } from '@/components/players/ui';

type TargetRow = { id: string; label: string; unit: string; target: string; fresh?: boolean };
type MealRow = { id: string; name: string; time: string; description: string };
const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
let seq = 0;
const tmpId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Create or edit a nutrition plan: name, period, daily targets (+ custom targets such as water or
 * fibre), meal recommendations and notes. The same form makes a new version or a duplicate.
 */
export default function PlanEditor({ heading, initial, hint, onSave, onCancel }: {
  heading: string;
  initial: NutritionPlanInput;
  hint?: string;
  onSave: (input: NutritionPlanInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [startsOn, setStartsOn] = useState(initial.starts_on);
  const [endsOn, setEndsOn] = useState(initial.ends_on ?? '');
  const [draft, setDraft] = useState(initial.status === 'draft');
  const [calories, setCalories] = useState(str(initial.targets.calories));
  const [protein, setProtein] = useState(str(initial.targets.protein_g));
  const [carbs, setCarbs] = useState(str(initial.targets.carbs_g));
  const [fat, setFat] = useState(str(initial.targets.fat_g));
  const [custom, setCustom] = useState<TargetRow[]>(initial.targets.custom.map((c) => ({ id: c.id, label: c.label, unit: c.unit, target: str(c.target) })));
  const [meals, setMeals] = useState<MealRow[]>(initial.meals.map((m) => ({ ...m })));
  const [notes, setNotes] = useState(initial.notes);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const raw = {
      title, starts_on: startsOn, ends_on: endsOn || null, status: draft ? 'draft' : 'active',
      targets: {
        calories, protein_g: protein, carbs_g: carbs, fat_g: fat,
        // A new row gets its id from its label; an existing one keeps its id (meals refer to it).
        custom: custom.map((c) => ({ id: c.fresh ? undefined : c.id, label: c.label, unit: c.unit, target: c.target })),
      },
      meals: meals.map((m) => ({ id: m.id, name: m.name, time: m.time, description: m.description })),
      notes,
    };
    const v = validatePlan(raw);
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true);
    setErr(null);
    try {
      await onSave(v.value);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the plan');
      setBusy(false);
    }
  };

  const num = (value: string, set: (v: string) => void, label: string, unit: string) => (
    <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)', flex: '1 1 110px' }}>
      {label}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder="–" aria-label={`${label} (${unit})`} style={{ ...input, width: 0, flex: '1 1 auto' }} />
        <span style={{ fontSize: 12 }}>{unit}</span>
      </span>
    </label>
  );

  return (
    <div style={{ ...card, display: 'grid', gap: 12 }} data-testid="plan-editor">
      <h2 style={h2}>{heading}</h2>
      {hint ? <p style={{ ...muted, margin: 0 }}>{hint}</p> : null}
      <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)' }}>
        Name
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pre-season, January" style={input} aria-label="Plan name" />
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)', flex: '1 1 140px' }}>
          Starts on
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} style={input} aria-label="Starts on" />
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)', flex: '1 1 140px' }}>
          Ends on (optional)
          <input type="date" value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} style={input} aria-label="Ends on" />
        </label>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        Draft (not shown to the player, not used for the daily totals)
      </label>

      <div style={{ display: 'grid', gap: 6 }}>
        <strong style={{ fontSize: 13 }}>Daily targets</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {num(calories, setCalories, 'Calories', 'kcal')}
          {num(protein, setProtein, 'Protein', 'g')}
          {num(carbs, setCarbs, 'Carbs', 'g')}
          {num(fat, setFat, 'Fat', 'g')}
        </div>
        {custom.map((c, i) => (
          <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={c.label} onChange={(e) => setCustom((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Target (e.g. Water)" aria-label="Custom target name" style={{ ...input, width: 0, flex: '2 1 110px' }} />
            <input inputMode="decimal" value={c.target} onChange={(e) => setCustom((p) => p.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} placeholder="Amount" aria-label="Custom target amount" style={{ ...input, width: 0, flex: '1 1 60px' }} />
            <input value={c.unit} onChange={(e) => setCustom((p) => p.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} placeholder="Unit" aria-label="Custom target unit" style={{ ...input, width: 0, flex: '0 1 56px' }} />
            <button type="button" aria-label={`Remove ${c.label || 'target'}`} onClick={() => setCustom((p) => p.filter((_, j) => j !== i))} style={iconBtn}><X size={16} /></button>
          </div>
        ))}
        <div>
          <button type="button" onClick={() => setCustom((p) => [...p, { id: tmpId(), label: '', unit: '', target: '', fresh: true }])} style={{ ...dashedBtn, padding: '6px 10px', fontSize: 12 }}><Plus size={13} /> Other target (water, fibre…)</button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <strong style={{ fontSize: 13 }}>Meal recommendations</strong>
        {meals.map((m, i) => (
          <div key={m.id} style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 10, border: '1px solid var(--cl-border)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={m.name} onChange={(e) => setMeals((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Meal (e.g. Breakfast)" aria-label="Meal name" style={{ ...input, width: 0, flex: '1 1 auto' }} />
              <input type="time" value={m.time} onChange={(e) => setMeals((p) => p.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} aria-label="Meal time" style={{ ...input, width: 110 }} />
              <button type="button" aria-label={`Remove ${m.name || 'meal'}`} onClick={() => setMeals((p) => p.filter((_, j) => j !== i))} style={iconBtn}><X size={16} /></button>
            </div>
            <textarea value={m.description} onChange={(e) => setMeals((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="What to eat" aria-label="What to eat" rows={2} style={{ ...input, resize: 'vertical' }} />
          </div>
        ))}
        <div>
          <button type="button" onClick={() => setMeals((p) => [...p, { id: tmpId(), name: '', time: '', description: '' }])} style={{ ...dashedBtn, padding: '6px 10px', fontSize: 12 }}><Plus size={13} /> Meal</button>
        </div>
      </div>

      <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)' }}>
        Notes for the player
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Hydration, supplements, what to avoid before matches…" style={{ ...input, resize: 'vertical' }} aria-label="Notes" />
      </label>
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void save()} style={primaryBtn}>{busy ? 'Saving…' : 'Save plan'}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}
