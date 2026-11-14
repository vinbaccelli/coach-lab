'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { caloriesFromMacros, categoryForHour, MEAL_CATEGORIES, MEAL_LABELS, type CustomTarget, type MealCategory, type MealLog } from '@/lib/players/nutrition';
import { card, ghostBtn, iconBtn, input, muted, primaryBtn, todayLocal } from '@/components/players/ui';
import { shrinkImage } from '@/components/players/shrinkImage';

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
/** Two numbers per row on a phone, four on a wide screen. */
const numGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(116px, 1fr))', gap: 6 } as const;

/**
 * Log or correct a meal: date, time, category (guessed from the time), what was eaten, calories and
 * macros (calories are calculated from the macros when left empty), the plan's custom values, an
 * optional photo (shrunk on the phone before upload) and a note.
 */
export default function MealForm({ meal, date, customTargets, onSave, onCancel }: {
  meal: MealLog | null;
  date: string;
  customTargets: CustomTarget[];
  onSave: (draft: Record<string, unknown>, photo: Blob | null, removePhoto: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const isToday = date === todayLocal();
  const [eatenOn, setEatenOn] = useState(meal?.eaten_on ?? date);
  const [eatenAt, setEatenAt] = useState(meal ? (meal.eaten_at ?? '').slice(0, 5) : isToday ? nowTime() : '');
  const [category, setCategory] = useState<MealCategory>(meal?.category ?? (isToday ? categoryForHour(new Date().getHours()) : 'other'));
  const [description, setDescription] = useState(meal?.description ?? '');
  const [calories, setCalories] = useState(str(meal?.calories));
  const [protein, setProtein] = useState(str(meal?.protein_g));
  const [carbs, setCarbs] = useState(str(meal?.carbs_g));
  const [fat, setFat] = useState(str(meal?.fat_g));
  const [extras, setExtras] = useState<Record<string, string>>(() => Object.fromEntries(customTargets.map((c) => [c.id, str(meal?.extras?.[c.id])])));
  const [note, setNote] = useState(meal?.note ?? '');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const computed = calories.trim() === '' ? caloriesFromMacros(toNum(protein), toNum(carbs), toNum(fat)) : null;
  const existingPhoto = meal?.photo_url && !removePhoto && !photo ? meal.photo_url : null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    try {
      const small = await shrinkImage(file, 1280, 0.8);
      setPhoto(small);
      setPreview(URL.createObjectURL(small));
      setRemovePhoto(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read that picture');
    }
  };

  const save = async () => {
    if (!description.trim() && calories.trim() === '' && computed === null && !photo && !existingPhoto) {
      setErr('Describe the meal, add its calories or a photo');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave({
        eaten_on: eatenOn, eaten_at: eatenAt || null, category, description,
        calories, protein_g: protein, carbs_g: carbs, fat_g: fat,
        extras: Object.fromEntries(Object.entries(extras).filter(([, v]) => v.trim() !== '')),
        note,
      }, photo, removePhoto && !photo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the meal');
      setBusy(false);
    }
  };

  const numField = (label: string, unit: string, value: string, set: (v: string) => void, placeholder = '–') => (
    <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)', minWidth: 0 }}>
      {label}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} aria-label={`${label} (${unit})`} style={{ ...input, width: 0, flex: '1 1 auto' }} />
        <span style={{ fontSize: 11 }}>{unit}</span>
      </span>
    </label>
  );

  return (
    <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="meal-form">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)', flex: '1 1 140px' }}>
          Date
          <input type="date" value={eatenOn} max={todayLocal()} onChange={(e) => setEatenOn(e.target.value)} style={input} aria-label="Date" />
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)', flex: '1 1 100px' }}>
          Time
          <input type="time" value={eatenAt} onChange={(e) => {
            setEatenAt(e.target.value);
            const h = Number(e.target.value.slice(0, 2));
            if (!meal && Number.isFinite(h) && e.target.value) setCategory(categoryForHour(h));
          }} style={input} aria-label="Time" />
        </label>
      </div>
      <div role="radiogroup" aria-label="Meal" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {MEAL_CATEGORIES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)}
            style={{ padding: '6px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', border: category === c ? '1px solid var(--cl-accent)' : '1px solid var(--cl-border)', background: category === c ? 'rgba(0,122,255,0.10)' : 'var(--cl-bg-panel, #fff)', color: 'var(--cl-text-primary)', fontWeight: category === c ? 700 : 500 }}>
            {MEAL_LABELS[c]}
          </button>
        ))}
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What was eaten (e.g. chicken, rice, salad)" aria-label="What was eaten" style={{ ...input, resize: 'vertical' }} />
      <div style={numGrid}>
        {numField('Calories', 'kcal', calories, setCalories, computed !== null ? String(computed) : '–')}
        {numField('Protein', 'g', protein, setProtein)}
        {numField('Carbs', 'g', carbs, setCarbs)}
        {numField('Fat', 'g', fat, setFat)}
      </div>
      {computed !== null ? <div style={{ ...muted, marginTop: -4 }}>Calories will be calculated from the macros: {computed} kcal.</div> : null}
      {customTargets.length ? (
        <div style={numGrid}>
          {customTargets.map((c) => (
            <span key={c.id} style={{ display: 'contents' }}>
              {numField(c.label, c.unit, extras[c.id] ?? '', (v) => setExtras((p) => ({ ...p, [c.id]: v })))}
            </span>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" onClick={() => fileRef.current?.click()} style={{ ...ghostBtn, padding: '6px 10px', fontSize: 12 }}><Camera size={14} /> {preview || existingPhoto ? 'Change photo' : 'Photo'}</button>
        {preview || existingPhoto ? (
          <span style={{ position: 'relative', display: 'inline-block' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview ?? existingPhoto ?? ''} alt="Meal photo" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
            <button type="button" aria-label="Remove photo" onClick={() => { setPhoto(null); setPreview(null); setRemovePhoto(true); }} style={{ ...iconBtn, position: 'absolute', top: -8, right: -8, background: 'var(--cl-bg-panel, #fff)', borderRadius: 999, border: '1px solid var(--cl-border)', padding: 2 }}><X size={12} /></button>
          </span>
        ) : null}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" style={input} />
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void save()} style={primaryBtn}>{busy ? 'Saving…' : meal ? 'Save meal' : 'Add meal'}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}
