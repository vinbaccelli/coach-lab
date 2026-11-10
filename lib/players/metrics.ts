/** Pure logic for player tracked metrics (grouping, validation, chart geometry). */

export interface MetricRow {
  id: string;
  name: string;
  unit: string;
  value: number;
  recorded_on: string; // YYYY-MM-DD
  note?: string | null;
}

export interface MetricSeries {
  key: string;
  name: string;
  unit: string;
  points: MetricRow[]; // oldest -> newest
  latest: MetricRow;
  /** latest - first, or null with a single point. */
  change: number | null;
}

const seriesKey = (name: string, unit: string) => `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;

/** Group rows into series (one per name+unit), points sorted by date then insertion order. */
export function groupMetrics(rows: readonly MetricRow[]): MetricSeries[] {
  const map = new Map<string, MetricRow[]>();
  rows.forEach((r) => {
    const k = seriesKey(r.name, r.unit);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  });
  const out: MetricSeries[] = [];
  map.forEach((arr, key) => {
    const points = arr
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (a.p.recorded_on < b.p.recorded_on ? -1 : a.p.recorded_on > b.p.recorded_on ? 1 : a.i - b.i))
      .map((x) => x.p);
    const first = points[0];
    const latest = points[points.length - 1];
    out.push({
      key,
      name: first.name.trim(),
      unit: first.unit.trim(),
      points,
      latest,
      change: points.length > 1 ? latest.value - first.value : null,
    });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type MetricInput = { name: string; unit: string; value: number; recorded_on: string; note: string | null };

/** Validate an API body. Returns the cleaned input or an error message. */
export function validateMetricInput(body: unknown, today: string): { ok: true; input: MetricInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 60) return { ok: false, error: 'name is required (max 60 characters)' };
  const unit = typeof b.unit === 'string' ? b.unit.trim() : '';
  if (unit.length > 16) return { ok: false, error: 'unit is too long (max 16 characters)' };
  const value = typeof b.value === 'number' ? b.value : typeof b.value === 'string' && b.value.trim() !== '' ? Number(b.value) : NaN;
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) return { ok: false, error: 'value must be a number' };
  const recorded_on = typeof b.recorded_on === 'string' && b.recorded_on ? b.recorded_on : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recorded_on) || Number.isNaN(Date.parse(recorded_on))) {
    return { ok: false, error: 'recorded_on must be YYYY-MM-DD' };
  }
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  return { ok: true, input: { name, unit, value, recorded_on, note } };
}

/**
 * Line-chart geometry in a width x height box with padding. Points are spaced by date
 * (not evenly), so a long gap looks like a long gap. One point -> centred.
 */
export function chartPoints(points: readonly MetricRow[], width: number, height: number, pad = 8): Array<{ x: number; y: number }> {
  if (points.length === 0) return [];
  const t = points.map((p) => Date.parse(p.recorded_on));
  const v = points.map((p) => p.value);
  const t0 = Math.min(...t), t1 = Math.max(...t);
  const v0 = Math.min(...v), v1 = Math.max(...v);
  const w = width - pad * 2, h = height - pad * 2;
  return points.map((_, i) => ({
    x: pad + (t1 === t0 ? w / 2 : ((t[i] - t0) / (t1 - t0)) * w),
    y: pad + (v1 === v0 ? h / 2 : h - ((v[i] - v0) / (v1 - v0)) * h),
  }));
}
