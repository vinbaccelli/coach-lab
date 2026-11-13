'use client';

import { formatValue, type Series, type Computed } from '@/lib/players/trackers';
import { shortDate } from '@/components/players/ui';

/**
 * Line chart for one series. Points are placed by date (a long gap looks long), the value axis
 * is labelled in the series' own format (m:ss for times, % for percentages, kg / lb …), and
 * player submissions still waiting for review are drawn hollow.
 */
export default function TrackerChart({ series, computed = null, height = 150 }: { series: Series; computed?: Computed | null; height?: number }) {
  const pts = series.points;
  if (!pts.length) {
    return <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--cl-text-muted)' }}>No values yet</div>;
  }
  const W = 640, H = height, padL = 64, padR = 16, padT = 14, padB = 26;
  const fmt = (n: number) => formatValue(n, series.kind, series.unit, { computed });
  const t = pts.map((p) => Date.parse(p.date));
  const v = pts.map((p) => p.value);
  let v0 = Math.min(...v), v1 = Math.max(...v);
  if (v0 === v1) {
    const pad = Math.abs(v0) * 0.1 || 1;
    v0 -= pad; v1 += pad;
  } else {
    const pad = (v1 - v0) * 0.12;
    v0 -= pad; v1 += pad;
  }
  if (series.kind !== 'number' && v0 < 0 && Math.min(...v) >= 0) v0 = 0;
  if (series.kind === 'percent') v1 = Math.min(100, v1);
  const t0 = Math.min(...t), t1 = Math.max(...t);
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = (i: number) => padL + (t1 === t0 ? iw / 2 : ((t[i] - t0) / (t1 - t0)) * iw);
  const y = (val: number) => padT + (1 - (val - v0) / (v1 - v0)) * ih;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ticks = [v1, (v0 + v1) / 2, v0];
  const last = pts.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${series.label}: ${pts.length} values, latest ${fmt(pts[last].value)}`} style={{ display: 'block', overflow: 'visible' }}>
      {ticks.map((tv, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} stroke="var(--cl-border)" strokeDasharray={i === 2 ? undefined : '3 4'} />
          <text x={padL - 8} y={y(tv) + 4} textAnchor="end" fontSize="11" fill="var(--cl-text-muted)">{fmt(tv)}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--cl-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={p.entryId + i} cx={x(i)} cy={y(p.value)} r={i === last ? 5 : 4}
          fill={p.pending ? 'var(--cl-bg-panel, #fff)' : 'var(--cl-accent)'} stroke="var(--cl-accent)" strokeWidth="2">
          <title>{`${shortDate(p.date)}: ${fmt(p.value)}${p.pending ? ' (waiting for review)' : ''}`}</title>
        </circle>
      ))}
      <text x={Math.min(x(last), W - padR)} y={Math.max(y(pts[last].value) - 10, 10)} textAnchor={x(last) > W - 90 ? 'end' : 'middle'} fontSize="12" fontWeight="700" fill="var(--cl-text-primary)">{fmt(pts[last].value)}</text>
      <text x={padL} y={H - 6} fontSize="11" fill="var(--cl-text-muted)">{shortDate(pts[0].date)}</text>
      {last > 0 ? <text x={W - padR} y={H - 6} textAnchor="end" fontSize="11" fill="var(--cl-text-muted)">{shortDate(pts[last].date)}</text> : null}
    </svg>
  );
}
