'use client';

import type { CSSProperties } from 'react';

/**
 * Small charts of the Nutrition section, plain HTML (no chart library):
 *  - MeterList: one row per target (name, bar, figure). The bar is the share of the target; the
 *    track is a light step of the fill's hue. Over the target the bar turns amber and the figure
 *    says how much over (being over is information, not an error, so it is not red).
 *  - WeekStrip: calories per day for 7 days as columns on one baseline, with the target as a
 *    dashed line. Each column is a button (choose the day) with its value as text below it, so
 *    nothing is read from the colour or the height alone.
 */
export interface MeterRow { key: string; label: string; unit: string; value: number; target: number | null; pct: number | null }

const ACCENT = 'var(--cl-accent, #007aff)';
const ACCENT_TRACK = 'rgba(0,122,255,0.14)';
const OVER = '#c77700';
const OVER_TRACK = 'rgba(255,159,10,0.20)';
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

export function MeterList({ rows }: { rows: MeterRow[] }) {
  const shown = rows.filter((r) => r.target !== null || r.value > 0);
  if (!shown.length) return null;
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="nutrition-meters">
      {shown.map((r) => {
        const over = r.target !== null && r.value > r.target;
        const share = r.target ? Math.min(1, r.value / r.target) : 0;
        const figure = r.target !== null
          ? `${fmt(r.value)} / ${fmt(r.target)} ${r.unit}`
          : `${fmt(r.value)} ${r.unit}`;
        const label = r.target !== null
          ? `${r.label}: ${fmt(r.value)} of ${fmt(r.target)} ${r.unit}${over ? `, ${fmt(r.value - r.target)} over` : ''}`
          : `${r.label}: ${fmt(r.value)} ${r.unit}, no target`;
        return (
          <div key={r.key} style={{ display: 'grid', gap: 4 }} role="group" aria-label={label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{r.label}</span>
              <span style={{ color: 'var(--cl-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                {figure}
                {over ? <span style={{ marginLeft: 6, color: OVER, fontWeight: 700 }}>+{fmt(r.value - (r.target ?? 0))}</span> : null}
                {r.pct !== null && !over ? <span style={{ marginLeft: 6, color: 'var(--cl-text-muted)' }}>{r.pct}%</span> : null}
              </span>
            </div>
            {r.target !== null ? (
              <div aria-hidden style={{ height: 8, borderRadius: 999, background: over ? OVER_TRACK : ACCENT_TRACK, overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(share > 0 ? 2 : 0, share * 100)}%`, height: '100%', borderRadius: 999, background: over ? OVER : ACCENT }} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export interface DayBar { day: string; label: string; value: number; target: number | null; meals: number }

export function WeekStrip({ days, selected, onSelect }: { days: DayBar[]; selected: string; onSelect: (day: string) => void }) {
  const H = 72;
  const top = Math.max(1, ...days.map((d) => Math.max(d.value, d.target ?? 0))) * 1.1;
  const targets = days.map((d) => d.target).filter((t): t is number => t !== null);
  const oneTarget = targets.length && targets.every((t) => t === targets[0]) ? targets[0] : null;
  const col: CSSProperties = { flex: '1 1 0', minWidth: 32, border: 'none', background: 'none', padding: '0 1px', cursor: 'pointer', display: 'grid', gap: 3, justifyItems: 'center', color: 'var(--cl-text-primary)' };
  return (
    <div data-testid="nutrition-week">
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--cl-text-secondary)', marginBottom: 6 }}>
        <span>Calories, last 7 days</span>
        {oneTarget !== null ? <span>- - target {fmt(oneTarget)} kcal</span> : null}
      </div>
      <div style={{ position: 'relative', display: 'flex', gap: 2 }}>
        {days.map((d) => {
          const h = d.value > 0 ? Math.max(3, (d.value / top) * H) : 0;
          const t = d.target !== null ? (d.target / top) * H : null;
          const over = d.target !== null && d.value > d.target;
          const isSel = d.day === selected;
          const text = `${d.label}: ${d.meals ? `${fmt(d.value)} kcal` : 'nothing logged'}${d.target !== null ? ` (target ${fmt(d.target)})` : ''}`;
          return (
            <button key={d.day} type="button" onClick={() => onSelect(d.day)} title={text} aria-label={text} aria-pressed={isSel} style={col}>
              <div style={{ position: 'relative', height: H, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', borderBottom: '1px solid var(--cl-border)' }}>
                {t !== null ? <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: t, borderTop: '1px dashed var(--cl-text-muted)' }} /> : null}
                <div aria-hidden style={{ width: '62%', maxWidth: 26, height: h, borderRadius: '4px 4px 0 0', background: over ? OVER : ACCENT, opacity: isSel ? 1 : 0.45 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: isSel ? 800 : 500, color: isSel ? 'var(--cl-text-primary)' : 'var(--cl-text-secondary)' }}>{d.label}</span>
              <span style={{ fontSize: 10, color: 'var(--cl-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{d.meals ? fmt(d.value) : '–'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
