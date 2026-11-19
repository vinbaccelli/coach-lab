'use client';

/**
 * Technical tab: the eBook's Fundamentals Check for a stroke, step by step, plus one "executing the
 * chosen variant correctly?" check for each variant chosen in the Blueprint tab (lib/players/blueprint.ts).
 */

import { useState } from 'react';
import { STROKE_KEYS, STROKE_LABELS, sheetChecks, stepsFor, setCheck, faults, progress, type PlayerBlueprint, type StrokeKey, type SheetCheck } from '@/lib/players/blueprint';
import { panel, h2, muted, input } from './ui';

const today = () => new Date().toLocaleDateString('en-CA');

export default function BlueprintChecks({ blueprint, onChange, canEdit }: { blueprint: PlayerBlueprint; onChange: (next: PlayerBlueprint) => void; canEdit: boolean }) {
  const [stroke, setStroke] = useState<StrokeKey>('forehand');
  const checks = sheetChecks(stroke, blueprint);
  const marks = blueprint.checks[stroke] ?? {};
  const steps = stepsFor(stroke);
  const groups: { key: string; title: string; items: SheetCheck[] }[] = [
    { key: 'whole', title: 'Whole stroke', items: checks.filter((c) => c.stepId === null) },
    ...steps.map((s, i) => ({ key: s.id, title: `${i + 1}. ${s.label}`, items: checks.filter((c) => c.stepId === s.id) })),
  ].filter((g) => g.items.length > 0);
  const p = progress(stroke, blueprint);
  const bad = faults(stroke, blueprint);
  const hasChoices = checks.some((c) => c.kind === 'execution');

  const mark = (c: SheetCheck, answer: string) => {
    const cur = marks[c.id];
    onChange(setCheck(blueprint, stroke, c.id, cur?.answer === answer ? '' : answer, cur?.note ?? '', today()));
  };

  return (
    <section style={{ ...panel, marginBottom: 18 }} aria-label="Fundamentals check" data-testid="blueprint-checks">
      <h2 style={h2}>Fundamentals check</h2>
      <p style={{ ...muted, margin: '6px 0 12px' }}>
        The book&apos;s checkpoints for each step. Mark what you see on film. {hasChoices ? 'Checks for this player’s chosen variants are included.' : 'Choose this player’s variants in the Blueprint tab to add a check for each choice.'}
      </p>
      <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {STROKE_KEYS.map((s) => {
          const on = s === stroke;
          return (
            <button key={s} type="button" role="tab" aria-selected={on} onClick={() => setStroke(s)}
              style={{ padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on ? 'var(--cl-accent)' : 'var(--cl-border)'}`, background: on ? 'var(--cl-accent)' : 'transparent', color: on ? 'var(--cl-text-on-fill, #fff)' : 'var(--cl-text-primary)' }}>
              {STROKE_LABELS[s]}
            </button>
          );
        })}
      </div>
      <div style={{ ...muted, marginBottom: 10 }} aria-live="polite">
        {p.done} of {p.total} checked{bad.length ? ` · ${bad.length} to work on` : ''}
      </div>

      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, margin: '0 0 6px' }}>{g.title}</div>
          {g.items.map((c) => {
            const r = marks[c.id];
            return (
              <div key={c.id} data-check={c.id} style={{ border: '1px solid var(--cl-border)', borderRadius: 12, padding: '9px 11px', marginBottom: 7 }}>
                <div style={{ fontSize: 14, lineHeight: 1.45 }}>
                  {c.kind === 'execution' ? <strong style={{ color: 'var(--cl-accent)' }}>Chosen variant · </strong> : null}{c.text}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }} role="group" aria-label="Answer">
                  {c.answers.map((a) => {
                    const on = r?.answer === a.label;
                    const color = a.fault ? '#c0392b' : 'var(--cl-accent)';
                    return (
                      <button key={a.label} type="button" disabled={!canEdit} aria-pressed={on} onClick={() => mark(c, a.label)}
                        style={{ padding: '6px 11px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: canEdit ? 'pointer' : 'default', border: `1.5px solid ${on ? color : 'var(--cl-border)'}`, background: on ? color : 'transparent', color: on ? '#fff' : 'var(--cl-text-primary)' }}>
                        {a.label}
                      </button>
                    );
                  })}
                </div>
                {r ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 7, flexWrap: 'wrap' }}>
                    <input key={`${c.id}.${r.note}`} defaultValue={r.note} maxLength={1000} placeholder="Note (optional)" disabled={!canEdit}
                      aria-label={`Note for ${c.id}`} style={{ ...input, flex: '1 1 200px' }}
                      onBlur={(e) => { const v = e.target.value; if (v.trim() !== r.note) onChange(setCheck(blueprint, stroke, c.id, r.answer, v, r.date)); }} />
                    <span style={muted}>{r.date}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
