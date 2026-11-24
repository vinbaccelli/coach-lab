'use client';

/**
 * Blueprint tab: the player's chosen variants for each stroke, from the eBook's "Your Personal Variants
 * Blueprint" pages (lib/players/blueprint.ts). Each choice adds a check to the Technical tab: "is he
 * executing the variant he chose correctly?".
 */

import { useState } from 'react';
import { SCOPES, STROKE_LABELS, variantsFor, choiceOf, setChoice, type BlueprintScope, type PlayerBlueprint } from '@/lib/players/blueprint';
import { panel, h2, muted, input } from './ui';

export default function BlueprintTab({ blueprint, onChange, canEdit }: { blueprint: PlayerBlueprint; onChange: (next: PlayerBlueprint) => void; canEdit: boolean }) {
  const [scope, setScope] = useState<BlueprintScope>('forehand');
  const groups = variantsFor(scope);
  const chosenCount = (s: BlueprintScope) => variantsFor(s).filter((g) => choiceOf(blueprint, s, g.id)).length;

  return (
    <section style={{ ...panel, marginBottom: 18 }} aria-label="Blueprint" data-testid="blueprint-tab">
      <h2 style={h2}>Blueprint</h2>
      <p style={{ ...muted, margin: '6px 0 12px' }}>
        The variants this player has chosen for each stroke, from the book&apos;s Variants Blueprint. Every choice adds a check to the
        Technical tab: is he executing it correctly?
      </p>
      <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {SCOPES.map((s) => {
          const on = s === scope;
          const n = chosenCount(s);
          return (
            <button key={s} type="button" role="tab" aria-selected={on} onClick={() => setScope(s)}
              style={{ padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on ? 'var(--cl-accent)' : 'var(--cl-border)'}`, background: on ? 'var(--cl-accent)' : 'transparent', color: on ? 'var(--cl-text-on-fill, #fff)' : 'var(--cl-text-primary)' }}>
              {STROKE_LABELS[s]}{n ? ` · ${n}/${variantsFor(s).length}` : ''}
            </button>
          );
        })}
      </div>

      {groups.map((g) => {
        const c = choiceOf(blueprint, scope, g.id);
        const otherText = c && 'other' in c ? c.other : '';
        return (
          <fieldset key={g.id} disabled={!canEdit} style={{ border: '1px solid var(--cl-border)', borderRadius: 12, padding: '10px 12px', margin: '0 0 10px', minWidth: 0 }}>
            <legend style={{ fontSize: 13, fontWeight: 700, padding: '0 6px' }}>
              {g.label}{g.chapter ? <span style={{ ...muted, marginLeft: 6 }}>{g.chapter}</span> : null}
            </legend>
            {g.options.map((o) => {
              const on = !!c && 'option' in c && c.option === o.id;
              return (
                <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', fontSize: 14, cursor: canEdit ? 'pointer' : 'default' }}>
                  <input type="radio" name={`${scope}.${g.id}`} checked={on} onChange={() => onChange(setChoice(blueprint, scope, g.id, { option: o.id }))} style={{ marginTop: 3 }} />
                  <span>{o.label}</span>
                </label>
              );
            })}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14 }}>Other:</span>
              <input key={`${scope}.${g.id}.${otherText}`} defaultValue={otherText} maxLength={200} placeholder="in the coach's words"
                aria-label={`${g.label}: other`} style={{ ...input, flex: '1 1 180px' }}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== otherText) onChange(setChoice(blueprint, scope, g.id, v ? { other: v } : null)); }} />
              {c ? <button type="button" onClick={() => onChange(setChoice(blueprint, scope, g.id, null))} style={{ background: 'none', border: 'none', color: 'var(--cl-text-secondary)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>Clear</button> : null}
            </div>
          </fieldset>
        );
      })}
    </section>
  );
}
