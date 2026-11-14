'use client';

import { useState, type CSSProperties } from 'react';
import { validateAnswers, type Answer, type Answers, type Question } from '@/lib/players/mental';
import { card, chip, ghostBtn, h2, input, muted, primaryBtn } from '@/components/players/ui';

const pick = (on: boolean): CSSProperties => ({
  ...chip, minWidth: 34, textAlign: 'center', fontWeight: on ? 800 : 500,
  border: on ? '1px solid var(--cl-accent)' : chip.border, background: on ? 'rgba(0,122,255,0.12)' : chip.background,
});

/** Answer a questionnaire: scales as a row of numbers, choices and yes/no as buttons, text as a box. */
export default function QuestionnaireForm({ title, description, questions, initial, saveLabel, onSave, onCancel }: {
  title: string;
  description?: string;
  questions: Question[];
  initial?: Answers;
  saveLabel: string;
  onSave: (answers: Answers) => Promise<void>;
  onCancel: () => void;
}) {
  const [answers, setAnswers] = useState<Answers>(initial ?? {});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (id: string, v: Answer | undefined) => setAnswers((p) => {
    const next = { ...p };
    if (v === undefined || v === '') delete next[id];
    else next[id] = v;
    return next;
  });
  const save = async () => {
    const v = validateAnswers(questions, answers);
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true);
    setErr(null);
    try {
      await onSave(v.value);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send');
      setBusy(false);
    }
  };
  return (
    <div style={{ ...card, display: 'grid', gap: 12 }} data-testid="questionnaire-form">
      <div>
        <h2 style={h2}>{title}</h2>
        {description ? <p style={{ ...muted, margin: '4px 0 0' }}>{description}</p> : null}
      </div>
      {questions.map((q) => (
        <div key={q.id} style={{ display: 'grid', gap: 6 }} role="group" aria-label={q.label}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{q.label}</div>
          {q.kind === 'scale' ? (
            <>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {Array.from({ length: (q.max ?? 10) - (q.min ?? 1) + 1 }, (_, i) => (q.min ?? 1) + i).map((n) => (
                  <button key={n} type="button" aria-pressed={answers[q.id] === n} aria-label={`${q.label}: ${n}`} onClick={() => set(q.id, answers[q.id] === n ? undefined : n)} style={pick(answers[q.id] === n)}>{n}</button>
                ))}
              </div>
              {q.low || q.high ? <div style={{ ...muted, display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span>{q.low}</span><span>{q.high}</span></div> : null}
            </>
          ) : q.kind === 'choice' ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(q.options ?? []).map((o) => <button key={o} type="button" aria-pressed={answers[q.id] === o} onClick={() => set(q.id, answers[q.id] === o ? undefined : o)} style={pick(answers[q.id] === o)}>{o}</button>)}
            </div>
          ) : q.kind === 'yesno' ? (
            <div style={{ display: 'flex', gap: 6 }}>
              {([['Yes', true], ['No', false]] as const).map(([l, v]) => <button key={l} type="button" aria-pressed={answers[q.id] === v} onClick={() => set(q.id, answers[q.id] === v ? undefined : v)} style={pick(answers[q.id] === v)}>{l}</button>)}
            </div>
          ) : (
            <textarea value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''} onChange={(e) => set(q.id, e.target.value)} rows={2} aria-label={q.label} style={{ ...input, resize: 'vertical' }} />
          )}
        </div>
      ))}
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void save()} style={primaryBtn}>{busy ? 'Sending…' : saveLabel}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}
