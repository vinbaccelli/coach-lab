'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { QUESTION_KINDS, validateQuestionnaire, type QKind, type QuestionKind, type QuestionnaireInput } from '@/lib/players/mental';
import { card, dashedBtn, ghostBtn, h2, iconBtn, input, primaryBtn } from '@/components/players/ui';

type Row = { id: string; kind: QuestionKind; label: string; min: string; max: string; low: string; high: string; lowerBetter: boolean; options: string; fresh?: boolean };
const KIND_LABELS: Record<QuestionKind, string> = { scale: 'Scale', choice: 'Choice', yesno: 'Yes / no', text: 'Text' };
let seq = 0;
const tmp = () => `r${(seq++).toString(36)}`;

/** Build a questionnaire (the player answers) or an assessment (the coach fills it; never shown to the player). */
export default function QuestionnaireEditor({ initial, onSave, onCancel }: { initial?: QuestionnaireInput; onSave: (q: QuestionnaireInput) => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = useState<QKind>(initial?.kind ?? 'questionnaire');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [rows, setRows] = useState<Row[]>((initial?.questions ?? []).map((q) => ({
    id: q.id, kind: q.kind, label: q.label, min: String(q.min ?? 1), max: String(q.max ?? 10), low: q.low ?? '', high: q.high ?? '', lowerBetter: q.better === 'lower', options: (q.options ?? []).join(', '),
  })));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<Row>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    const v = validateQuestionnaire({
      kind, title, description,
      questions: rows.map((r) => ({
        id: r.fresh ? undefined : r.id, kind: r.kind, label: r.label,
        min: Number(r.min), max: Number(r.max), low: r.low, high: r.high, better: r.lowerBetter ? 'lower' : undefined,
        options: r.options.split(',').map((x) => x.trim()),
      })),
    });
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true);
    setErr(null);
    try { await onSave(v.value); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); setBusy(false); }
  };
  return (
    <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="questionnaire-editor">
      <h2 style={h2}>{initial ? 'Edit questionnaire' : 'New questionnaire'}</h2>
      <div role="radiogroup" aria-label="Who answers" style={{ display: 'flex', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><input type="radio" checked={kind === 'questionnaire'} onChange={() => setKind('questionnaire')} /> The player answers</label>
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><input type="radio" checked={kind === 'assessment'} onChange={() => setKind('assessment')} /> I assess the player (private)</label>
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name" aria-label="Questionnaire name" style={input} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What it is for" aria-label="Description" style={{ ...input, resize: 'vertical' }} />
      {rows.map((r, i) => (
        <div key={r.id} style={{ border: '1px solid var(--cl-border)', borderRadius: 10, padding: 10, display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={r.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Question" aria-label={`Question ${i + 1}`} style={{ ...input, flex: '1 1 auto', width: 0 }} />
            <select value={r.kind} onChange={(e) => set(i, { kind: e.target.value as QuestionKind })} aria-label={`Question ${i + 1} type`} style={{ ...input, width: 104 }}>
              {QUESTION_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
            <button type="button" aria-label={`Remove question ${i + 1}`} onClick={() => setRows((p) => p.filter((_, j) => j !== i))} style={iconBtn}><X size={15} /></button>
          </div>
          {r.kind === 'scale' ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
              from <input value={r.min} onChange={(e) => set(i, { min: e.target.value })} inputMode="numeric" aria-label="From" style={{ ...input, width: 56 }} />
              to <input value={r.max} onChange={(e) => set(i, { max: e.target.value })} inputMode="numeric" aria-label="To" style={{ ...input, width: 56 }} />
              <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={r.lowerBetter} onChange={(e) => set(i, { lowerBetter: e.target.checked })} /> lower is better</label>
            </div>
          ) : null}
          {r.kind === 'choice' ? <input value={r.options} onChange={(e) => set(i, { options: e.target.value })} placeholder="Choices, separated by commas" aria-label={`Question ${i + 1} choices`} style={input} /> : null}
        </div>
      ))}
      <div><button type="button" onClick={() => setRows((p) => [...p, { id: tmp(), kind: 'scale', label: '', min: '1', max: '10', low: '', high: '', lowerBetter: false, options: '', fresh: true }])} style={{ ...dashedBtn, padding: '6px 10px', fontSize: 12 }}><Plus size={13} /> Question</button></div>
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void save()} style={primaryBtn}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}
