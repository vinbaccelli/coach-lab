'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { FIELD_KINDS, KIND_LABELS, KIND_UNITS, fieldIdFor, type FieldKind, type TrackerDefinition, type TrackerField } from '@/lib/players/trackers';
import { input, primaryBtn, ghostBtn, chip, iconBtn, muted } from '@/components/players/ui';

/**
 * Create or edit a tracker: its name, whether an entry is one value per measurement or a list
 * of sets, and the measurements themselves. A measurement that already has history keeps its
 * type and can be archived (hidden from new entries) but not removed.
 */
export default function TrackerEditor({ initial, lockedIds = [], hasEntries = false, suggestions = [], onSave, onCancel, title }: {
  initial: TrackerDefinition;
  /** Field ids already stored on the tracker (may be archived, not removed or retyped). */
  lockedIds?: string[];
  hasEntries?: boolean;
  suggestions?: TrackerField[];
  onSave: (d: TrackerDefinition) => Promise<void>;
  onCancel: () => void;
  title: string;
}) {
  const [def, setDef] = useState<TrackerDefinition>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const locked = new Set(lockedIds);

  const setField = (i: number, patch: Partial<TrackerField>) =>
    setDef((d) => ({ ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const addField = (f?: TrackerField) => setDef((d) => {
    const taken = d.fields.map((x) => x.id);
    const base = f ?? { id: '', label: '', kind: 'number' as FieldKind, unit: '', better: null };
    return { ...d, fields: [...d.fields, { ...base, id: fieldIdFor(base.label || 'value', taken) }] };
  });

  const save = async () => {
    setErr(null);
    // New measurements get an id from their name (stable from then on); existing ones keep theirs.
    const taken = new Set(def.fields.filter((f) => locked.has(f.id)).map((f) => f.id));
    const fields = def.fields.map((f) => {
      if (locked.has(f.id)) return f;
      const id = fieldIdFor(f.label || 'value', taken);
      taken.add(id);
      return { ...f, id };
    });
    setBusy(true);
    try {
      await onSave({ ...def, name: def.name.trim(), fields });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const unused = suggestions.filter((s) => !def.fields.some((f) => f.id === s.id || f.label.toLowerCase() === s.label.toLowerCase()));

  return (
    <div style={{ display: 'grid', gap: 12, padding: 14, border: '1px solid var(--cl-border)', borderRadius: 14, background: 'var(--cl-bg-panel, #fff)' }}>
      <div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 600 }}>
        Name
        <input value={def.name} maxLength={80} onChange={(e) => setDef({ ...def, name: e.target.value })} placeholder="e.g. Serve speed, Squat, Weight" style={input} />
      </label>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 600 }}>
        Description <span style={{ fontWeight: 400, ...muted }}>(optional)</span>
        <input value={def.description} maxLength={1000} onChange={(e) => setDef({ ...def, description: e.target.value })} style={input} />
      </label>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }} disabled={hasEntries}>
        <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Each entry records</legend>
        {(['single', 'sets'] as const).map((m) => (
          <label key={m} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="radio" name="mode" checked={def.mode === m} onChange={() => setDef({ ...def, mode: m, fields: m === 'sets' ? def.fields.filter((f) => !f.computed) : def.fields })} />
            {m === 'single' ? 'One value per measurement (weight, time, distance…)' : 'Sets (e.g. 3 sets × 12 reps × 40 kg)'}
          </label>
        ))}
        {hasEntries ? <span style={muted}>Fixed once the tracker has entries.</span> : null}
      </fieldset>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Measurements</div>
        {def.fields.map((f, i) => {
          const isLocked = locked.has(f.id);
          const units = KIND_UNITS[f.kind];
          return (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', opacity: f.archived ? 0.55 : 1 }}>
              <input aria-label="Measurement name" value={f.label} maxLength={40} placeholder="Name" onChange={(e) => setField(i, { label: e.target.value })} style={{ ...input, flex: '1 1 140px' }} />
              {f.computed ? (
                <span style={{ ...muted, padding: '0 6px' }}>calculated</span>
              ) : (
                <>
                  <select aria-label="Type" value={f.kind} disabled={isLocked && hasEntries} onChange={(e) => { const kind = e.target.value as FieldKind; setField(i, { kind, unit: KIND_UNITS[kind][0] }); }} style={{ ...input, flex: '0 1 150px' }}>
                    {FIELD_KINDS.filter((k) => k !== 'score' || def.category === 'mental' || f.kind === 'score').map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                  </select>
                  {f.kind === 'number' || f.kind === 'count' ? (
                    <input aria-label="Unit" value={f.unit} maxLength={12} placeholder="unit" onChange={(e) => setField(i, { unit: e.target.value })} style={{ ...input, width: 80 }} />
                  ) : units.length > 1 ? (
                    <select aria-label="Unit" value={f.unit} onChange={(e) => setField(i, { unit: e.target.value })} style={{ ...input, width: 86 }}>
                      {units.map((u) => <option key={u} value={u}>{f.kind === 'duration' ? (u === 'min' ? 'min (m:ss)' : u) : u}</option>)}
                    </select>
                  ) : null}
                  <select aria-label="Better when" value={f.better ?? ''} onChange={(e) => setField(i, { better: (e.target.value || null) as TrackerField['better'] })} style={{ ...input, width: 128 }}>
                    <option value="">No direction</option>
                    <option value="higher">Higher is better</option>
                    <option value="lower">Lower is better</option>
                  </select>
                </>
              )}
              {isLocked ? (
                <button type="button" onClick={() => setField(i, { archived: !f.archived })} style={{ ...ghostBtn, padding: '6px 10px', fontSize: 12 }}>{f.archived ? 'Restore' : 'Archive'}</button>
              ) : (
                <button type="button" aria-label={`Remove ${f.label || 'measurement'}`} onClick={() => setDef((d) => ({ ...d, fields: d.fields.filter((_, j) => j !== i) }))} style={iconBtn}><X size={15} /></button>
              )}
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={() => addField()} style={{ ...ghostBtn, padding: '7px 12px', fontSize: 12 }}><Plus size={13} /> Add measurement</button>
          {unused.map((s) => <button key={s.id} type="button" onClick={() => addField(s)} style={chip}>+ {s.label}</button>)}
        </div>
      </div>
      {err ? <div role="alert" style={{ fontSize: 12, color: 'var(--cl-destructive-text, #b3261e)' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy || !def.name.trim()} onClick={() => void save()} style={{ ...primaryBtn, opacity: busy || !def.name.trim() ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}
