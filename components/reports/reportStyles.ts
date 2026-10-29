import type { CSSProperties } from 'react';
import type { ReportKind } from '@/lib/reports/deriveBlocks';

/** Chip colours: the tint is the system accent / success at low alpha, the text is darkened to clear 4.5:1 on it. */
export const KIND_CHIP: Record<ReportKind, { label: string; bg: string; fg: string }> = {
  technical: { label: 'Technical analysis', bg: 'var(--cl-accent-soft)', fg: '#0A58C9' },
  match: { label: 'Match analysis', bg: 'rgba(52, 199, 89, 0.16)', fg: '#15803D' },
};

export const wrap: CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  color: 'var(--cl-text-primary)',
  // Long words, URLs and pasted notes must wrap, never push the page sideways.
  overflowWrap: 'anywhere',
  minWidth: 0,
};

export const backLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 44,
  color: 'var(--cl-text-secondary)',
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
};

export const chipStyle = (kind: ReportKind): CSSProperties => ({
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  background: KIND_CHIP[kind].bg,
  color: KIND_CHIP[kind].fg,
  whiteSpace: 'nowrap',
});

/** Keyboard focus for everything inside a reports page (inline styles cannot carry :focus-visible). */
export const FOCUS_CSS = `.rpt a:focus-visible,.rpt button:focus-visible,.rpt input:focus-visible{outline:2px solid var(--cl-accent);outline-offset:2px;border-radius:8px}.rpt ::selection{background:var(--cl-accent-soft)}`;

/** Reading measure for running text: about 66 characters, not the full column. */
export const measure: CSSProperties = { maxWidth: '66ch', textWrap: 'pretty' as never };

export const mutedText: CSSProperties = { color: 'var(--cl-text-secondary)', fontSize: 13, lineHeight: 1.45 };

/** "Oct 27, 2026" from a YYYY-MM-DD key, in the viewer's locale. */
export function formatDateKey(dateKey: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
