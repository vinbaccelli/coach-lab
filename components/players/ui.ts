import type { CSSProperties } from 'react';

/** Shared look for the player-database screens (coach profile and the player's share page). */
export const panel: CSSProperties = {
  background: 'rgba(250, 249, 247, 0.96)',
  border: '1px solid var(--cl-border)',
  borderRadius: 16,
  padding: 18,
  color: 'var(--cl-text-primary)',
};

export const card: CSSProperties = {
  background: 'var(--cl-bg-panel, #fff)',
  border: '1px solid var(--cl-border)',
  borderRadius: 14,
  padding: 14,
};

export const h2: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' };
export const muted: CSSProperties = { fontSize: 12, color: 'var(--cl-text-secondary)' };

/** 16px+ text in inputs stops iPhones zooming the page when a field is tapped. */
export const input: CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--cl-border)',
  padding: '9px 11px',
  fontSize: 16,
  minWidth: 0,
  boxSizing: 'border-box',
  background: 'var(--cl-bg-panel, #fff)',
  color: 'var(--cl-text-primary)',
};

export const primaryBtn: CSSProperties = {
  padding: '9px 14px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--cl-accent)',
  color: 'var(--cl-text-on-fill, #fff)',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

export const ghostBtn: CSSProperties = {
  ...primaryBtn,
  background: 'var(--cl-bg-panel, #fff)',
  color: 'var(--cl-text-primary)',
  border: '1px solid var(--cl-border)',
};

export const dashedBtn: CSSProperties = {
  ...primaryBtn,
  background: 'rgba(0,122,255,0.04)',
  color: 'var(--cl-accent)',
  border: '1px dashed var(--cl-accent)',
};

export const chip: CSSProperties = {
  padding: '5px 10px',
  borderRadius: 999,
  border: '1px solid var(--cl-border)',
  background: 'var(--cl-bg-panel, #fff)',
  color: 'var(--cl-text-primary)',
  fontSize: 12,
  cursor: 'pointer',
};

export const iconBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  padding: 4,
  color: 'var(--cl-text-muted)',
  display: 'inline-flex',
  alignItems: 'center',
};

export function badge(tone: 'pending' | 'warn' | 'info' | 'ok'): CSSProperties {
  const colors = {
    pending: ['rgba(255,159,10,0.14)', '#a05a00'],
    warn: ['rgba(255,59,48,0.12)', '#b3261e'],
    info: ['rgba(0,122,255,0.10)', '#0058b9'],
    ok: ['rgba(52,199,89,0.14)', '#1d7a36'],
  }[tone];
  return { fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: colors[0], color: colors[1], whiteSpace: 'nowrap' };
}

/** A JSON request that throws the API's error message. */
export async function apiJson<T = Record<string, unknown>>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    cache: 'no-store',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers as Record<string, string> | undefined) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.message ?? data.error ?? `Request failed (${res.status})`));
  return data as T;
}

export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const newRef = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** "12 Mar 2026" in the reader's locale, from YYYY-MM-DD, without timezone shifts. */
export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
