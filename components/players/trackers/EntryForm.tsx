'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { inputFields, inputValue, parseFieldInput, type Tracker, type TrackerEntry, type TrackerField } from '@/lib/players/trackers';
import { input, primaryBtn, ghostBtn, iconBtn, todayLocal } from '@/components/players/ui';

export interface EntryPayload {
  entry_date: string;
  measurements?: Record<string, number>;
  sets?: Array<Record<string, number>>;
  note: string;
}

const unitText = (f: TrackerField) => (f.kind === 'duration' ? 'm:ss' : f.kind === 'percent' ? '%' : f.unit);
const placeholderFor = (f: TrackerField) => (f.kind === 'duration' ? (f.unit === 's' ? 'e.g. 0:45' : 'e.g. 24:30') : '');

/**
 * Record one entry fast: today's date, one input per measurement (or one row per set), an
 * optional note, and "Same as last time" to start from the previous entry. Used by the coach
 * and, through the share link, by the player.
 */
export default function EntryForm({ tracker, initial, last, onSubmit, onCancel, submitLabel = 'Save entry' }: {
  tracker: Pick<Tracker, 'mode' | 'fields' | 'name'>;
  initial?: TrackerEntry | null;
  last?: TrackerEntry | null;
  onSubmit: (p: EntryPayload) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const fields = inputFields(tracker.fields);
  const toStrings = (rec: Record<string, number> | undefined) =>
    Object.fromEntries(fields.map((f) => [f.id, inputValue(rec?.[f.id], f)]));
  const [date, setDate] = useState(initial?.entry_date ?? todayLocal());
  const [vals, setVals] = useState<Record<string, string>>(() => toStrings(initial?.measurements));
  const [sets, setSets] = useState<Array<Record<string, string>>>(() =>
    initial?.sets?.length ? initial.sets.map((s) => toStrings(s)) : [toStrings(undefined)]);
  const [note, setNote] = useState(initial?.note ?? '');
  const [showNote, setShowNote] = useState(Boolean(initial?.note));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fillFromLast = () => {
    if (!last) return;
    if (tracker.mode === 'sets') setSets((last.sets ?? []).map((s) => toStrings(s)));
    else setVals(toStrings(last.measurements));
  };

  const parseRecord = (rec: Record<string, string>): Record<string, number> | string => {
    const out: Record<string, number> = {};
    for (const f of fields) {
      const p = parseFieldInput(f, rec[f.id]);
      if (p === 'invalid') return `${f.label}: ${f.kind === 'duration' ? 'use m:ss, like 24:30' : 'type a number'}`;
      if (p !== null) out[f.id] = p;
    }
    return out;
  };

  const submit = async () => {
    setErr(null);
    let payload: EntryPayload;
    if (tracker.mode === 'sets') {
      const parsed: Array<Record<string, number>> = [];
      for (const s of sets) {
        const r = parseRecord(s);
        if (typeof r === 'string') { setErr(r); return; }
        if (Object.keys(r).length) parsed.push(r);
      }
      if (!parsed.length) { setErr('Fill in at least one set'); return; }
      payload = { entry_date: date, sets: parsed, note };
    } else {
      const r = parseRecord(vals);
      if (typeof r === 'string') { setErr(r); return; }
      if (!Object.keys(r).length) { setErr('Fill in at least one measurement'); return; }
      payload = { entry_date: date, measurements: r, note };
    }
    setBusy(true);
    try {
      await onSubmit(payload);
      if (!initial) {
        setVals(toStrings(undefined));
        setSets([toStrings(undefined)]);
        setNote('');
        setShowNote(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const fieldInput = (f: TrackerField, value: string, onChange: (v: string) => void, compact = false) => (
    <label key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, flex: compact ? '1 1 90px' : '1 1 130px', minWidth: 0 }}>
      {!compact ? f.label : null}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          aria-label={f.label}
          value={value}
          inputMode={f.kind === 'duration' ? 'text' : 'decimal'}
          placeholder={placeholderFor(f) || (compact ? f.label : '')}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          style={{ ...input, width: '100%' }}
        />
        {unitText(f) ? <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--cl-text-muted)', whiteSpace: 'nowrap' }}>{unitText(f)}</span> : null}
      </span>
    </label>
  );

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
          Date
          <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} style={{ ...input, width: 160 }} />
        </label>
        {last && !initial ? <button type="button" onClick={fillFromLast} style={{ ...ghostBtn, padding: '8px 12px', fontSize: 12 }}>Same as last time</button> : null}
      </div>

      {tracker.mode === 'sets' ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {sets.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, width: 44, flexShrink: 0, color: 'var(--cl-text-secondary)' }}>Set {i + 1}</span>
              <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                {fields.map((f) => fieldInput(f, s[f.id] ?? '', (v) => setSets((prev) => prev.map((x, j) => (j === i ? { ...x, [f.id]: v } : x))), true))}
              </div>
              {sets.length > 1 ? (
                <button type="button" aria-label={`Remove set ${i + 1}`} onClick={() => setSets((prev) => prev.filter((_, j) => j !== i))} style={iconBtn}><X size={14} /></button>
              ) : <span style={{ width: 22 }} />}
            </div>
          ))}
          <div>
            <button type="button" onClick={() => setSets((prev) => [...prev, { ...(prev[prev.length - 1] ?? toStrings(undefined)) }])} style={{ ...ghostBtn, padding: '7px 12px', fontSize: 12 }}>
              <Plus size={13} /> Add set
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {fields.map((f) => fieldInput(f, vals[f.id] ?? '', (v) => setVals((prev) => ({ ...prev, [f.id]: v }))))}
        </div>
      )}

      {showNote ? (
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ ...input, width: '100%', resize: 'vertical' }} />
      ) : (
        <button type="button" onClick={() => setShowNote(true)} style={{ ...iconBtn, fontSize: 12, padding: 0, justifySelf: 'start', color: 'var(--cl-accent)' }}>+ Add a note</button>
      )}
      {err ? <div role="alert" style={{ fontSize: 12, color: 'var(--cl-destructive-text, #b3261e)' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void submit()} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel ? <button type="button" onClick={onCancel} style={ghostBtn}>Cancel</button> : null}
      </div>
    </div>
  );
}
