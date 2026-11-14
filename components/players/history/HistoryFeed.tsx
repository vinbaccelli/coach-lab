'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  HISTORY_SECTIONS, HISTORY_TYPES, SECTION_LABELS, TYPE_LABELS,
  type HistoryItem, type HistorySection, type HistoryType,
} from '@/lib/players/history';
import { youtubeEmbedUrl } from '@/lib/players/timeline';
import { applyManualOrder } from '@/lib/players/reorder';
import ReorderList from '@/components/players/ReorderList';
import { badge, chip, input, muted, shortDate } from '@/components/players/ui';

export type HistoryPage = { items: HistoryItem[]; next: string | null };
type Filter = { types: HistoryType[]; sections: HistorySection[]; author: '' | 'coach' | 'link'; from: string; to: string };
const EMPTY: Filter = { types: [], sections: [], author: '', from: '', to: '' };
const PAGE = 30;

/** Which kinds of item can exist in the sections a viewer sees. */
const TYPE_SECTIONS: Record<HistoryType, HistorySection[]> = {
  comment: ['timeline'], picture: ['timeline'], video: ['timeline'], report: ['technical'], technical: ['technical'],
  measurement: ['progress', 'biometrics', 'fitness'], meal: ['nutrition'], plan: ['nutrition'],
};

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const pressed = (on: boolean): CSSProperties => ({
  ...chip, fontWeight: on ? 700 : 500,
  border: on ? '1px solid var(--cl-accent)' : chip.border, background: on ? 'rgba(0,122,255,0.10)' : chip.background,
});

/**
 * The universal timeline of a player: every module (comments, pictures, videos, reports, technical
 * notes, measurements, meals, nutrition plans) newest first, a page at a time, with filters
 * (section, kind, who added it, dates). With a saved manual order and no filter, everything is
 * loaded and shown in that order (the coach can drag); new items stay on top.
 */
export default function HistoryFeed({ fetchPage, viewer, sections = [...HISTORY_SECTIONS], reloadKey = 0, order = null, onOrderChange, onDelete }: {
  fetchPage: (params: URLSearchParams) => Promise<HistoryPage>;
  viewer: 'coach' | 'player';
  /** The sections this viewer can see (the filter offers only these). */
  sections?: HistorySection[];
  /** Change it to reload from the newest item (after adding something). */
  reloadKey?: number;
  order?: string[] | null;
  onOrderChange?: (keys: string[]) => Promise<void>;
  onDelete?: (item: HistoryItem) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>(EMPTY);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(order);
  const orderSig = JSON.stringify(order ?? null);
  useEffect(() => { setLocalOrder(order); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderSig]);
  const seq = useRef(0);

  const active = Boolean(filter.types.length || filter.sections.length || filter.author || filter.from || filter.to);
  const manual = !active && Boolean(localOrder?.length);
  const params = useCallback((before: string | null, limit: number) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (before) p.set('before', before);
    if (filter.types.length) p.set('types', filter.types.join(','));
    if (filter.sections.length) p.set('sections', filter.sections.join(','));
    if (filter.author) p.set('author', filter.author);
    if (filter.from) p.set('from', filter.from);
    if (filter.to) p.set('to', filter.to);
    return p;
  }, [filter]);

  /** Every page from `before` on (for the manual order, which needs the whole list). */
  const fetchRest = useCallback(async (before: string | null): Promise<HistoryItem[]> => {
    const out: HistoryItem[] = [];
    let cursor = before;
    for (let i = 0; i < 40; i++) {
      const page = await fetchPage(params(cursor, 100));
      out.push(...page.items);
      cursor = page.next;
      if (!cursor) break;
    }
    return out;
  }, [fetchPage, params]);

  useEffect(() => {
    const id = ++seq.current;
    setBusy(true);
    setErr(null);
    (async () => {
      try {
        if (manual) {
          const all = await fetchRest(null);
          if (id === seq.current) { setItems(all); setNext(null); }
        } else {
          const page = await fetchPage(params(null, PAGE));
          if (id === seq.current) { setItems(page.items); setNext(page.next); }
        }
      } catch (e) {
        if (id === seq.current) { setErr(e instanceof Error ? e.message : 'Could not load the timeline'); setItems((x) => x ?? []); }
      } finally {
        if (id === seq.current) setBusy(false);
      }
    })();
  }, [fetchPage, params, fetchRest, manual, reloadKey]);

  const more = async () => {
    if (!next) return;
    const id = seq.current;
    setBusy(true);
    try {
      const page = await fetchPage(params(next, PAGE));
      if (id !== seq.current) return;
      setItems((prev) => {
        const have = new Set((prev ?? []).map((x) => x.key));
        return [...(prev ?? []), ...page.items.filter((x) => !have.has(x.key))];
      });
      setNext(page.next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load more');
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => (manual ? applyManualOrder(items ?? [], localOrder) : items ?? []), [manual, items, localOrder]);
  const canDrag = viewer === 'coach' && Boolean(onOrderChange) && !active;

  const reorder = async (moved: HistoryItem[]) => {
    try {
      // The order covers the whole timeline: load what is not on screen yet (older items keep their place, below).
      const rest = next ? await fetchRest(next) : [];
      const keys = [...moved.map((x) => x.key), ...rest.map((x) => x.key).filter((k) => !moved.some((m) => m.key === k))];
      setItems([...moved, ...rest.filter((r) => !moved.some((m) => m.key === r.key))]);
      setNext(null);
      setLocalOrder(keys);
      await onOrderChange?.(keys);
    } catch (e) {
      setLocalOrder(order);
      setErr(e instanceof Error ? e.message : 'Could not save the order');
    }
  };

  const offeredTypes = HISTORY_TYPES.filter((t) => (viewer === 'coach' || t !== 'report') && TYPE_SECTIONS[t].some((s) => sections.includes(s)));
  const nActive = filter.types.length + filter.sections.length + (filter.author ? 1 : 0) + (filter.from || filter.to ? 1 : 0);

  const row = (t: HistoryItem, handle: React.ReactNode) => (
    <div style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 10 }} data-testid="history-item" data-key={t.key}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
          {handle}
          <span style={{ fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>{t.title}</span>
          <span style={{ ...muted, fontSize: 11 }}>{SECTION_LABELS[t.section]}</span>
          {t.author === 'link' ? <span style={badge('info')}>{viewer === 'coach' ? 'Player' : 'You'}</span> : null}
          {t.status === 'submitted' ? <span style={badge('pending')}>{viewer === 'coach' ? 'To review' : 'Waiting for review'}</span> : null}
          {t.status === 'needs_revision' ? <span style={badge('warn')}>Needs a fix</span> : null}
        </div>
        <span style={{ fontSize: 11, color: 'var(--cl-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          {shortDate(t.date)}
          {onDelete && t.deletableId ? (
            <button type="button" aria-label="Delete" disabled={busy} onClick={() => { if (window.confirm('Delete this item?')) void onDelete(t).then(() => setItems((p) => (p ?? []).filter((x) => x.key !== t.key))).catch((e) => setErr(e instanceof Error ? e.message : 'Could not delete')); }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--cl-text-muted)', display: 'inline-flex' }}><X size={14} /></button>
          ) : null}
        </span>
      </div>
      {t.body ? <p style={{ margin: '4px 0 0', fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t.body}</p> : null}
      {t.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.imageUrl} alt="" loading="lazy" style={{ marginTop: 6, maxWidth: '100%', maxHeight: t.type === 'meal' ? 200 : 360, borderRadius: 10, display: 'block' }} />
      ) : null}
      {t.youtubeId ? (
        <div style={{ marginTop: 6, position: 'relative', paddingTop: '56.25%', maxWidth: 560 }}>
          <iframe src={youtubeEmbedUrl(t.youtubeId)} title="Video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 10 }} />
        </div>
      ) : null}
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="history-feed">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ ...pressed(nActive > 0), display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <SlidersHorizontal size={13} /> Filter{nActive ? ` (${nActive})` : ''}
        </button>
        {active ? <button type="button" onClick={() => setFilter(EMPTY)} style={chip}>Clear filters</button> : null}
        {manual && canDrag ? <span style={{ ...muted, fontSize: 11 }}>Drag the grip to move an item.</span> : null}
      </div>
      {open ? (
        <div style={{ display: 'grid', gap: 10, padding: 10, border: '1px solid var(--cl-border)', borderRadius: 12 }} data-testid="history-filters">
          <div role="group" aria-label="Section" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...muted, width: 64 }}>Section</span>
            {HISTORY_SECTIONS.filter((s) => sections.includes(s)).map((s) => (
              <button key={s} type="button" aria-pressed={filter.sections.includes(s)} onClick={() => setFilter((f) => ({ ...f, sections: toggle(f.sections, s) }))} style={pressed(filter.sections.includes(s))}>{SECTION_LABELS[s]}</button>
            ))}
          </div>
          <div role="group" aria-label="Kind" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...muted, width: 64 }}>Kind</span>
            {offeredTypes.map((t) => (
              <button key={t} type="button" aria-pressed={filter.types.includes(t)} onClick={() => setFilter((f) => ({ ...f, types: toggle(f.types, t) }))} style={pressed(filter.types.includes(t))}>{TYPE_LABELS[t]}</button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Added by" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...muted, width: 64 }}>Added by</span>
            {([['', 'Everyone'], ['coach', 'Coach'], ['link', viewer === 'coach' ? 'Player' : 'Me']] as const).map(([v, label]) => (
              <button key={label} type="button" role="radio" aria-checked={filter.author === v} onClick={() => setFilter((f) => ({ ...f, author: v }))} style={pressed(filter.author === v)}>{label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)', flex: '1 1 130px' }}>
              From
              <input type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} style={input} aria-label="From" />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)', flex: '1 1 130px' }}>
              To
              <input type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} style={input} aria-label="To" />
            </label>
          </div>
        </div>
      ) : null}
      {err ? <div role="alert" style={{ fontSize: 12, color: 'var(--cl-destructive-text, #b3261e)' }}>{err}</div> : null}
      {items === null ? <div style={muted}>Loading…</div> : null}
      {items && shown.length === 0 && !busy ? <div style={muted}>{active ? 'Nothing matches these filters.' : 'Nothing here yet.'}</div> : null}
      {canDrag && shown.length > 1 ? (
        <ReorderList items={shown} getKey={(t) => t.key} onReorder={(moved) => void reorder(moved)} containerStyle={{ display: 'grid', gap: 10 }} renderItem={(t, _i, handle) => row(t, handle)} />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>{shown.map((t) => <div key={t.key}>{row(t, null)}</div>)}</div>
      )}
      {next && !manual ? (
        <div><button type="button" disabled={busy} onClick={() => void more()} style={chip}>{busy ? 'Loading…' : 'Load older'}</button></div>
      ) : null}
    </div>
  );
}
