'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { MoreHorizontal, Pencil, Trash2, Check, Undo2, Plus } from 'lucide-react';
import {
  buildSeries, computeDerived, defaultSeriesKey, describeEntry, formatValue, seriesChange,
  type Tracker, type TrackerEntry, type TrackerDefinition,
} from '@/lib/players/trackers';
import { BIOMETRICS_EXTRA_FIELDS } from '@/lib/players/trackerPresets';
import TrackerChart from '@/components/players/trackers/TrackerChart';
import EntryForm, { type EntryPayload } from '@/components/players/trackers/EntryForm';
import TrackerEditor from '@/components/players/trackers/TrackerEditor';
import { card, chip, ghostBtn, iconBtn, input, muted, primaryBtn, badge, shortDate } from '@/components/players/ui';

/** What a card may do, wired by the section to the coach routes or the share-link routes. */
export interface TrackerActions {
  addEntry: (trackerId: string, p: EntryPayload) => Promise<void>;
  updateEntry?: (entry: TrackerEntry, p: EntryPayload) => Promise<void>;
  deleteEntry?: (entry: TrackerEntry) => Promise<void>;
  reviewEntry?: (entry: TrackerEntry, status: 'approved' | 'needs_revision', note?: string) => Promise<void>;
  updateTracker?: (tracker: Tracker, d: TrackerDefinition) => Promise<void>;
  archiveTracker?: (tracker: Tracker) => Promise<void>;
  deleteTracker?: (tracker: Tracker) => Promise<void>;
}

const HISTORY_PREVIEW = 4;

export default function TrackerCard({ tracker, entries, actions, viewer, handle }: {
  tracker: Tracker;
  entries: TrackerEntry[];
  actions: TrackerActions | null;
  /** 'coach' sees review actions; 'player' sees their own submission status. */
  viewer: 'coach' | 'player';
  handle?: ReactNode;
}) {
  const series = useMemo(() => buildSeries(tracker, entries), [tracker, entries]);
  const withData = series.filter((s) => s.points.length);
  const [seriesKey, setSeriesKey] = useState<string | null>(null);
  const current = series.find((s) => s.key === (seriesKey ?? defaultSeriesKey(tracker, series))) ?? series[0];
  const derived = useMemo(() => computeDerived(tracker, entries), [tracker, entries]);
  const newestFirst = useMemo(() => [...entries].sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : a.created_at < b.created_at ? 1 : -1)), [entries]);
  const lastEntry = newestFirst.find((e) => e.status !== 'needs_revision') ?? null;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editTracker, setEditTracker] = useState(false);
  const [fixFor, setFixFor] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const change = current ? seriesChange(current) : null;
  const currentField = tracker.fields.find((f) => f.id === current?.key);
  const fmt = (v: number) => (current ? formatValue(v, current.kind, current.unit, { computed: currentField?.computed }) : String(v));
  const shown = showAll ? newestFirst : newestFirst.slice(0, HISTORY_PREVIEW);
  const pendingCount = entries.filter((e) => e.status === 'submitted').length;
  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong'); }
  };

  if (editTracker && actions?.updateTracker) {
    return (
      <TrackerEditor
        title={`Edit ${tracker.name}`}
        initial={{ name: tracker.name, description: tracker.description, category: tracker.category, preset: tracker.preset, mode: tracker.mode, fields: tracker.fields }}
        lockedIds={tracker.fields.map((f) => f.id)}
        hasEntries={entries.length > 0}
        suggestions={tracker.category === 'biometrics' ? BIOMETRICS_EXTRA_FIELDS : []}
        onCancel={() => setEditTracker(false)}
        onSave={async (d) => { await actions.updateTracker!(tracker, d); setEditTracker(false); }}
      />
    );
  }

  return (
    <div style={{ ...card, display: 'grid', gap: 10 }} data-testid={`tracker-${tracker.name}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {handle}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em' }}>{tracker.name}</span>
            {viewer === 'coach' && pendingCount ? <span style={badge('pending')}>{pendingCount} to review</span> : null}
          </div>
          {tracker.description ? <div style={{ ...muted, marginTop: 2 }}>{tracker.description}</div> : null}
          {current && current.points.length ? (
            <div style={{ fontSize: 13, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span><span style={{ color: 'var(--cl-text-secondary)' }}>{current.label}:</span> <strong>{fmt(current.points[current.points.length - 1].value)}</strong></span>
              {change ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: change.improved === null ? 'var(--cl-text-secondary)' : change.improved ? '#1d7a36' : '#b3261e' }}>
                  {change.delta > 0 ? '▲' : change.delta < 0 ? '▼' : '='} {current.kind === 'duration' ? fmt(Math.abs(change.delta)) : fmt(Math.abs(change.delta))} since {shortDate(current.points[0].date)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {actions?.updateTracker || actions?.deleteTracker ? (
          <div style={{ position: 'relative' }}>
            <button type="button" aria-label={`${tracker.name} options`} onClick={() => setMenu((m) => !m)} style={iconBtn}><MoreHorizontal size={18} /></button>
            {menu ? (
              <div role="menu" style={{ position: 'absolute', right: 0, top: 28, zIndex: 20, background: 'var(--cl-bg-panel, #fff)', border: '1px solid var(--cl-border)', borderRadius: 12, padding: 6, display: 'grid', minWidth: 170, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                {actions.updateTracker ? <button type="button" role="menuitem" onClick={() => { setMenu(false); setEditTracker(true); }} style={{ ...iconBtn, padding: '8px 10px', color: 'var(--cl-text-primary)', fontSize: 13 }}>Edit tracker</button> : null}
                {actions.archiveTracker ? <button type="button" role="menuitem" onClick={() => { setMenu(false); void run(() => actions.archiveTracker!(tracker)); }} style={{ ...iconBtn, padding: '8px 10px', color: 'var(--cl-text-primary)', fontSize: 13 }}>Archive (hide)</button> : null}
                {actions.deleteTracker ? <button type="button" role="menuitem" onClick={() => {
                  setMenu(false);
                  if (window.confirm(`Delete "${tracker.name}" and its ${entries.length} entries? This cannot be undone. Archive keeps the history instead.`)) void run(() => actions.deleteTracker!(tracker));
                }} style={{ ...iconBtn, padding: '8px 10px', color: '#b3261e', fontSize: 13 }}>Delete</button> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {withData.length > 1 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist" aria-label="Chart">
          {withData.map((s) => (
            <button key={s.key} type="button" role="tab" aria-selected={s.key === current?.key} onClick={() => setSeriesKey(s.key)}
              style={{ ...chip, ...(s.key === current?.key ? { background: 'var(--cl-accent)', color: '#fff', borderColor: 'var(--cl-accent)' } : {}) }}>
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      {current && entries.length ? <TrackerChart series={current} computed={currentField?.computed} /> : null}

      {actions ? (
        adding ? (
          <EntryForm tracker={tracker} last={lastEntry} submitLabel={viewer === 'player' ? 'Send to coach' : 'Save entry'}
            onCancel={() => setAdding(false)}
            onSubmit={async (p) => { await actions.addEntry(tracker.id, p); setAdding(false); }} />
        ) : (
          <div><button type="button" onClick={() => setAdding(true)} style={{ ...primaryBtn, padding: '8px 13px' }}><Plus size={14} /> Add entry</button></div>
        )
      ) : null}

      {entries.length ? (
        <div style={{ display: 'grid', gap: 0 }}>
          <div style={{ ...muted, fontWeight: 700, marginBottom: 4 }}>History ({entries.length})</div>
          {shown.map((e) => (
            <div key={e.id} style={{ borderTop: '1px solid var(--cl-border)', padding: '8px 0', display: 'grid', gap: 4 }}>
              {editingId === e.id && actions?.updateEntry ? (
                <EntryForm tracker={tracker} initial={e} submitLabel="Save changes" onCancel={() => setEditingId(null)}
                  onSubmit={async (p) => { await actions.updateEntry!(e, p); setEditingId(null); }} />
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: 'var(--cl-text-muted)', whiteSpace: 'nowrap' }}>{shortDate(e.entry_date)}</span>
                    {e.author === 'link' ? <span style={badge('info')}>Player</span> : null}
                    {e.status === 'submitted' ? <span style={badge('pending')}>{viewer === 'player' ? 'Sent' : 'To review'}</span> : null}
                    {e.status === 'needs_revision' ? <span style={badge('warn')}>Needs a fix</span> : null}
                    <span style={{ flex: 1 }} />
                    {actions?.updateEntry && (viewer === 'coach' || (e.author === 'link' && e.status !== 'approved')) ? (
                      <button type="button" aria-label="Edit entry" onClick={() => setEditingId(e.id)} style={iconBtn}><Pencil size={14} /></button>
                    ) : null}
                    {actions?.deleteEntry && (viewer === 'coach' || (e.author === 'link' && e.status !== 'approved')) ? (
                      <button type="button" aria-label={viewer === 'coach' ? 'Delete entry' : 'Withdraw entry'} onClick={() => { if (window.confirm(viewer === 'coach' ? 'Delete this entry?' : 'Withdraw this entry?')) void run(() => actions.deleteEntry!(e)); }} style={iconBtn}><Trash2 size={14} /></button>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 13 }}>{describeEntry(tracker, e, derived.get(e.id))}</div>
                  {e.note ? <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)', whiteSpace: 'pre-wrap' }}>{e.note}</div> : null}
                  {e.status === 'needs_revision' && e.review_note ? <div style={{ fontSize: 12, color: '#b3261e' }}>Coach: {e.review_note}</div> : null}
                  {viewer === 'coach' && actions?.reviewEntry && e.status === 'submitted' ? (
                    fixFor === e.id ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <input value={fixNote} onChange={(ev) => setFixNote(ev.target.value)} placeholder="What should the player change?" style={{ ...input, flex: '1 1 200px' }} />
                        <button type="button" disabled={!fixNote.trim()} onClick={() => void run(async () => { await actions.reviewEntry!(e, 'needs_revision', fixNote.trim()); setFixFor(null); setFixNote(''); })} style={primaryBtn}>Send</button>
                        <button type="button" onClick={() => setFixFor(null)} style={ghostBtn}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" onClick={() => void run(() => actions.reviewEntry!(e, 'approved'))} style={{ ...ghostBtn, padding: '5px 10px', fontSize: 12 }}><Check size={13} /> Approve</button>
                        <button type="button" onClick={() => { setFixFor(e.id); setFixNote(''); }} style={{ ...ghostBtn, padding: '5px 10px', fontSize: 12 }}><Undo2 size={13} /> Ask for a fix</button>
                      </div>
                    )
                  ) : null}
                </>
              )}
            </div>
          ))}
          {newestFirst.length > HISTORY_PREVIEW ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} style={{ ...iconBtn, fontSize: 12, color: 'var(--cl-accent)', justifySelf: 'start', paddingLeft: 0 }}>
              {showAll ? 'Show less' : `Show all ${newestFirst.length}`}
            </button>
          ) : null}
        </div>
      ) : (
        <div style={muted}>No entries yet.</div>
      )}
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
    </div>
  );
}
