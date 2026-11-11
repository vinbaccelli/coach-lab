'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { chartPoints, groupMetrics, type MetricRow } from '@/lib/players/metrics';

const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 14, minWidth: 0 };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 12, cursor: 'pointer' };

const today = () => new Date().toISOString().slice(0, 10);

export function MetricChart({ points }: { points: MetricRow[] }) {
  const W = 320, H = 90;
  const pts = chartPoints(points, W, H, 10);
  if (pts.length === 0) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 420, height: 'auto', display: 'block' }} role="img" aria-label="Progress chart">
      {pts.length > 1 ? (
        <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--cl-accent)" strokeWidth={2} strokeLinejoin="round" />
      ) : null}
      {pts.map((p, i) => <circle key={points[i].id} cx={p.x} cy={p.y} r={3.5} fill="var(--cl-accent)" />)}
    </svg>
  );
}

/** Values that change over time (weight, fat %, UTR ...): add a value, see the graph. */
export default function PlayerMetrics({ playerId, canEdit }: { playerId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<{ name: string; unit: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [firstValue, setFirstValue] = useState('');
  const [dates, setDates] = useState<Record<string, string>>({});
  const [firstDate, setFirstDate] = useState(today());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/players/${playerId}/metrics`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load');
      setRows(data.metrics ?? []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
    }
  }, [playerId]);
  useEffect(() => { void load(); }, [load]);

  const series = useMemo(() => groupMetrics(rows), [rows]);

  const post = async (name: string, unit: string, value: string, date: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/players/${playerId}/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, unit, value, recorded_on: date || today() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not save');
      await load();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    if (!window.confirm('Delete this value?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/players/${playerId}/metrics?pointId=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: 'rgba(250, 249, 247, 0.96)', border: '1px solid var(--cl-border)', borderRadius: 16, padding: 18, color: 'var(--cl-text-primary)', marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Progress tracking</h2>
      <p style={{ margin: '4px 0 12px', fontSize: 12, color: 'var(--cl-text-secondary)' }}>
        Track anything that changes over time (weight, fat %, UTR, 5 km time…). Each new value is kept and graphed.
      </p>
      {err ? <p style={{ color: 'var(--cl-destructive-text)', fontSize: 12 }}>{err}</p> : null}

      {series.map((s) => (
        <div key={s.key} style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 12, marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{s.name}</strong>
            <span style={{ fontSize: 13 }}>
              {s.latest.value}{s.unit ? ` ${s.unit}` : ''}
              {s.change !== null ? (
                <span style={{ color: 'var(--cl-text-secondary)' }}> ({s.change > 0 ? '+' : ''}{Math.round(s.change * 100) / 100} since first)</span>
              ) : null}
            </span>
          </div>
          <MetricChart points={s.points} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
            {s.points.slice().reverse().slice(0, 6).map((p) => (
              <span key={p.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: '1px solid var(--cl-border)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {p.recorded_on}: {p.value}
                {canEdit ? (
                  <button type="button" aria-label="Delete value" onClick={() => void del(p.id)} disabled={busy} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--cl-text-muted)', display: 'inline-flex' }}>
                    <X size={12} />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
          {canEdit ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                inputMode="decimal"
                placeholder={`New ${s.name.toLowerCase()}${s.unit ? ` (${s.unit})` : ''}`}
                value={draft[s.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                style={{ ...inp, flex: 1 }}
              />
              <input
                type="date"
                aria-label="Date"
                value={dates[s.key] ?? today()}
                max={today()}
                onChange={(e) => setDates((d) => ({ ...d, [s.key]: e.target.value }))}
                style={{ ...inp, width: 150 }}
              />
              <button
                type="button"
                style={btn}
                disabled={busy || !(draft[s.key] ?? '').trim()}
                onClick={async () => { if (await post(s.name, s.unit, draft[s.key] ?? '', dates[s.key] ?? today())) setDraft((d) => ({ ...d, [s.key]: '' })); }}
              >
                Add value
              </button>
            </div>
          ) : null}
        </div>
      ))}

      {series.length === 0 && !err ? <p style={{ fontSize: 12, color: 'var(--cl-text-muted)' }}>Nothing tracked yet.</p> : null}

      {canEdit ? (
        <div style={{ marginTop: 14 }}>
          {adding === null ? (
            <button type="button" onClick={() => { setAdding({ name: '', unit: '' }); setFirstValue(''); setFirstDate(today()); }} style={{ ...btn, background: 'rgba(0,122,255,0.04)', color: 'var(--cl-accent)', border: '1px dashed var(--cl-accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> Track something new
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input autoFocus placeholder="What (e.g. Weight)" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} style={{ ...inp, flex: '1 1 140px' }} />
              <input placeholder="Unit (kg, %)" value={adding.unit} onChange={(e) => setAdding({ ...adding, unit: e.target.value })} style={{ ...inp, width: 90 }} />
              <input inputMode="decimal" placeholder="First value" value={firstValue} onChange={(e) => setFirstValue(e.target.value)} style={{ ...inp, width: 110 }} />
              <input type="date" aria-label="Date" value={firstDate} max={today()} onChange={(e) => setFirstDate(e.target.value)} style={{ ...inp, width: 150 }} />
              <button type="button" style={btn} disabled={busy || !adding.name.trim() || !firstValue.trim()} onClick={async () => { if (await post(adding.name, adding.unit, firstValue, firstDate)) setAdding(null); }}>Start tracking</button>
              <button type="button" onClick={() => setAdding(null)} style={{ ...btn, background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', border: '1px solid var(--cl-border)' }}>Cancel</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
