'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import PlayerSessionTimeline from '@/components/players/PlayerSessionTimeline';
import { createPlayerDraftSession } from '@/lib/sessions/saveSession';
import type { PlayerSession } from '@/lib/sessions/types';
import { parseTechnicalSheet, defaultTechnicalSheet, type TechnicalSheetRow } from '@/lib/players/technicalSheet';

type Player = {
  id: string;
  display_name: string;
  photo_url?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  playing_hand?: string | null;
  notes?: string | null;
  /** Technical Analysis Google Doc (null until first export). */
  google_doc_id?: string | null;
  /** Match Analysis Google Doc (null until first match report). */
  google_match_doc_id?: string | null;
  /** Drive folder (AngleMotion/Players/<Name>) holding every export for this player. */
  google_folder_id?: string | null;
  /** Editable Technical Sheet rows (jsonb). */
  technical_sheet?: unknown;
};

type Entry = {
  id: string;
  category: 'technique' | 'match';
  folder_label: string;
  body_text: string;
  youtube_url?: string | null;
  created_at: string;
  screenshots?: unknown;
  /** doc_url → the entry's Doc; measurements → structured values for Statistics. */
  metadata?: {
    doc_url?: string;
    measurements?: Array<{ snapshot: string; label: string; value: number; unit: string; timeSec: number }>;
  } | null;
};

export default function PlayerProfileClient({ playerId }: { playerId: string }) {
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sessions, setSessions] = useState<PlayerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sheet, setSheet] = useState<TechnicalSheetRow[] | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [newRowLabel, setNewRowLabel] = useState<string | null>(null);

  // Initialize the sheet once from the loaded player (don't clobber edits on reloads).
  useEffect(() => {
    if (player && sheet === null) {
      setSheet(parseTechnicalSheet(player.technical_sheet) ?? defaultTechnicalSheet());
    }
  }, [player, sheet]);

  /** Structural row changes update the coach's default template for NEW players. */
  const syncTemplate = useCallback((rows: TechnicalSheetRow[]) => {
    void fetch('/api/coach-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ technicalSheetTemplate: rows.map((r) => r.label) }),
    }).catch(() => {});
  }, []);

  const saveSheet = useCallback(async (rows: TechnicalSheetRow[]) => {
    setSheetSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technical_sheet: rows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not save the technical sheet');
      }
    } catch (e: unknown) {
      // Surface the failure instead of reporting a silent false success.
      setErr(e instanceof Error ? e.message : 'Could not save the technical sheet');
    } finally {
      setSheetSaving(false);
    }
  }, [playerId]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/players/${playerId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Not found');
      setPlayer(data.player);
      setEntries(data.entries ?? []);
      const sessRes = await fetch(`/api/players/${playerId}/sessions`);
      const sessData = await sessRes.json();
      if (sessRes.ok) setSessions(sessData.sessions ?? []);
      else setSessions([]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Player database: Technical / Match tabs + text search ────────────────
  const [dbTab, setDbTab] = useState<'all' | 'technique' | 'match'>('all');
  const [dbSearch, setDbSearch] = useState('');

  const timelineEntries = useMemo(() => {
    const q = dbSearch.trim().toLowerCase();
    return [...entries]
      .filter((e) => (dbTab === 'all' ? true : e.category === dbTab))
      .filter((e) => !q || e.folder_label.toLowerCase().includes(q) || (e.body_text ?? '').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [entries, dbTab, dbSearch]);

  // ── Statistics: measurements across all report entries, grouped by metric ─
  const statSeries = useMemo(() => {
    const byLabel = new Map<string, Array<{ date: string; value: number; unit: string; snapshot: string }>>();
    for (const e of entries) {
      for (const m of e.metadata?.measurements ?? []) {
        if (typeof m?.value !== 'number' || !m.label) continue;
        const list = byLabel.get(m.label) ?? [];
        list.push({ date: e.created_at, value: m.value, unit: m.unit ?? '', snapshot: m.snapshot ?? '' });
        byLabel.set(m.label, list);
      }
    }
    for (const list of byLabel.values()) {
      list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }
    return byLabel;
  }, [entries]);
  const [statMetric, setStatMetric] = useState('');
  const statLabels = useMemo(() => [...statSeries.keys()].sort(), [statSeries]);
  const activeStat = statSeries.get(statMetric || statLabels[0] || '') ?? [];

  const panel = {
    background: 'rgba(250, 249, 247, 0.96)',
    border: '1px solid #E5E5E5',
    borderRadius: 16,
    padding: 18,
    color: '#1A1A1A',
  } as const;

  const saveProfile = async () => {
    if (!player) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: player.display_name,
          photo_url: player.photo_url || null,
          date_of_birth: player.date_of_birth || null,
          nationality: player.nationality || null,
          playing_hand: player.playing_hand || 'unknown',
          notes: player.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setPlayer(data.player);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const startNewSession = async () => {
    if (!player) return;
    setCreatingSession(true);
    setErr(null);
    try {
      const title = `${player.display_name} — ${new Date().toLocaleDateString()}`;
      const session = await createPlayerDraftSession(playerId, title);
      router.push(`/analysis?playerId=${playerId}&sessionId=${session.id}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not start session');
    } finally {
      setCreatingSession(false);
    }
  };

  if (loading) {
    return <p style={{ color: '#57534e' }}>Loading profile…</p>;
  }
  // Only a genuinely-absent player is fatal (nothing to render). A failed
  // save / new-session sets `err` while the player is still loaded — that is
  // shown as a recoverable inline banner below, NOT a full-page unmount.
  if (!player) {
    return <p style={{ color: '#b91c1c' }}>{err || 'Player not found'}</p>;
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', paddingBottom: 48 }}>
      <Link
        href="/players"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: '#007AFF',
          fontSize: 13,
          marginBottom: 16,
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={16} /> Players
      </Link>

      {err ? (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.25)',
            color: '#b91c1c',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {err}
        </div>
      ) : null}

      <div style={{ ...panel, marginBottom: 18 }}>
        <h1 style={{ margin: '0 0 14px', fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em' }}>{player.display_name}</h1>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          <label style={lb}>
            Photo URL
            <input
              value={player.photo_url ?? ''}
              onChange={(e) => setPlayer({ ...player, photo_url: e.target.value })}
              style={inp}
              placeholder="https://…"
            />
          </label>
          <label style={lb}>
            Date of birth
            <input
              type="date"
              value={player.date_of_birth?.slice(0, 10) ?? ''}
              onChange={(e) => setPlayer({ ...player, date_of_birth: e.target.value || null })}
              style={inp}
            />
          </label>
          <label style={lb}>
            Nationality
            <input
              value={player.nationality ?? ''}
              onChange={(e) => setPlayer({ ...player, nationality: e.target.value })}
              style={inp}
            />
          </label>
          <label style={lb}>
            Playing hand
            <select
              value={player.playing_hand ?? 'unknown'}
              onChange={(e) => setPlayer({ ...player, playing_hand: e.target.value })}
              style={inp}
            >
              <option value="unknown">Unknown</option>
              <option value="right">Right</option>
              <option value="left">Left</option>
            </select>
          </label>
        </div>
        <label style={{ ...lb, marginTop: 14 }}>
          Coach notes
          <textarea
            value={player.notes ?? ''}
            onChange={(e) => setPlayer({ ...player, notes: e.target.value })}
            rows={3}
            style={{ ...inp, resize: 'vertical' }}
          />
        </label>
        <button
          type="button"
          onClick={saveProfile}
          disabled={saving}
          style={{
            marginTop: 14,
            padding: '10px 20px',
            borderRadius: 10,
            border: 'none',
            background: '#1A1A1A',
            color: '#fff',
            fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>

      {/* ── Technical Sheet ─────────────────────────────────────────────── */}
      <div style={{ ...panel, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Technical Sheet</h2>
          <button
            type="button"
            onClick={() => { if (sheet) void saveSheet(sheet); }}
            disabled={sheetSaving || !sheet}
            style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: '#1A1A1A', color: '#fff', fontWeight: 700, fontSize: 12, cursor: sheetSaving ? 'wait' : 'pointer' }}
          >
            {sheetSaving ? 'Saving…' : 'Save sheet'}
          </button>
        </div>
        <p style={{ margin: '4px 0 14px', fontSize: 12, color: '#78716c' }}>
          Adding or deleting rows also updates your default sheet for new players — existing players keep their rows.
        </p>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {(sheet ?? []).map((row, i) => (
            <div key={`${row.label}-${i}`} style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
              <label style={{ ...lb, flex: 1 }}>
                {row.label}
                <input
                  value={row.value}
                  onChange={(e) => setSheet((prev) => prev ? prev.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)) : prev)}
                  style={inp}
                />
              </label>
              <button
                type="button"
                aria-label={`Delete ${row.label} row`}
                onClick={() => {
                  // Destructive AND global: this also removes the row from the
                  // coach's default sheet for all future players. Confirm first.
                  if (!window.confirm(`Delete the "${row.label}" row?\n\nThis also removes it from your default technical sheet for new players (existing players keep their rows).`)) return;
                  setSheet((prev) => {
                    if (!prev) return prev;
                    const next = prev.filter((_, j) => j !== i);
                    syncTemplate(next);
                    void saveSheet(next);
                    return next;
                  });
                }}
                style={{ width: 30, height: 34, borderRadius: 8, border: '1px solid #E5E5EA', background: '#fff', color: '#8E8E93', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {newRowLabel === null ? (
            <button
              type="button"
              onClick={() => setNewRowLabel('')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px dashed #007AFF', background: 'rgba(0,122,255,0.04)', color: '#007AFF', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              <Plus size={14} /> Add row
            </button>
          ) : (
            <>
              <input
                value={newRowLabel}
                onChange={(e) => setNewRowLabel(e.target.value)}
                placeholder="Row name (e.g. Serve speed)"
                autoFocus
                style={{ ...inp, maxWidth: 260 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newRowLabel.trim()) {
                    setSheet((prev) => {
                      const next = [...(prev ?? []), { label: newRowLabel.trim(), value: '' }];
                      syncTemplate(next);
                      void saveSheet(next);
                      return next;
                    });
                    setNewRowLabel(null);
                  }
                }}
              />
              <button
                type="button"
                disabled={!newRowLabel.trim()}
                onClick={() => {
                  setSheet((prev) => {
                    const next = [...(prev ?? []), { label: newRowLabel.trim(), value: '' }];
                    syncTemplate(next);
                    void saveSheet(next);
                    return next;
                  });
                  setNewRowLabel(null);
                }}
                style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: '#007AFF', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setNewRowLabel(null)}
                style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #D1D1D6', background: '#fff', color: '#1A1A1A', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <section
        style={{
          background: 'rgba(250, 249, 247, 0.96)',
          border: '1px solid #E5E5E5',
          borderRadius: 16,
          padding: 18,
          color: '#1A1A1A',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>
          Analysis Sessions
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#78716c' }}>
          Start from the player, use tools in Video Analysis, then Save Report — newest first.
        </p>
        <button
          type="button"
          onClick={() => { void startNewSession(); }}
          disabled={creatingSession}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
            padding: '10px 16px',
            borderRadius: 10,
            border: 'none',
            background: '#007AFF',
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            cursor: creatingSession ? 'wait' : 'pointer',
          }}
        >
          <Plus size={16} />
          {creatingSession ? 'Starting…' : 'New Analysis Session'}
        </button>
        <PlayerSessionTimeline playerId={playerId} sessions={sessions} />
      </section>

      <section
        style={{
          background: 'rgba(250, 249, 247, 0.96)',
          border: '1px solid #E5E5E5',
          borderRadius: 16,
          padding: 18,
          color: '#1A1A1A',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Reports</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {player.google_doc_id ? (
              <a
                href={`https://docs.google.com/document/d/${player.google_doc_id}/edit`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 10, background: '#007AFF',
                  color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                }}
              >
                Technical Analysis Doc ↗
              </a>
            ) : null}
            {player.google_match_doc_id ? (
              <a
                href={`https://docs.google.com/document/d/${player.google_match_doc_id}/edit`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 10, background: '#34C759',
                  color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                }}
              >
                Match Analysis Doc ↗
              </a>
            ) : null}
            {player.google_folder_id ? (
              <a
                href={`https://drive.google.com/drive/folders/${player.google_folder_id}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 10, background: '#fff',
                  border: '1px solid #007AFF', color: '#007AFF',
                  fontSize: 12, fontWeight: 700, textDecoration: 'none',
                }}
              >
                Open Drive folder ↗
              </a>
            ) : null}
          </div>
        </div>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#78716c' }}>
          Match and technique reports — newest first.
          {player.google_doc_id ? ' Click an entry to open it in the player’s Google Doc.' : ''}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          {([['all', 'All'], ['technique', 'Technical Analysis'], ['match', 'Match Analysis']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setDbTab(key)}
              style={{
                padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                borderWidth: 1, borderStyle: 'solid',
                borderColor: dbTab === key ? '#007AFF' : '#D1D1D6',
                background: dbTab === key ? '#007AFF' : '#fff',
                color: dbTab === key ? '#fff' : '#1A1A1A',
              }}
            >
              {label}
            </button>
          ))}
          <input
            value={dbSearch}
            onChange={(e) => setDbSearch(e.target.value)}
            placeholder="Search reports…"
            aria-label="Search reports"
            style={{ flex: '1 1 180px', minWidth: 160, padding: '8px 12px', borderRadius: 10, border: '1px solid #D1D1D6', fontSize: 12 }}
          />
        </div>
        {timelineEntries.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: '#78716c' }}>No entries yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {timelineEntries.map((e) => (
              <article
                key={e.id}
                onClick={() => {
                  // Prefer the entry's own doc link; fall back to the doc for its category.
                  const fallbackId = e.category === 'match'
                    ? player.google_match_doc_id ?? player.google_doc_id
                    : player.google_doc_id;
                  const url = e.metadata?.doc_url
                    ?? (fallbackId ? `https://docs.google.com/document/d/${fallbackId}/edit` : null);
                  if (url) window.open(url, '_blank', 'noopener');
                }}
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: '#fff',
                  border: '1px solid #E7E5E4',
                  cursor: (e.metadata?.doc_url || player.google_doc_id) ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      padding: '4px 8px',
                      borderRadius: 8,
                      background: e.category === 'match' ? '#ecfccb' : '#e0f2fe',
                      color: e.category === 'match' ? '#365314' : '#0369a1',
                    }}
                  >
                    {e.category === 'match' ? 'Match analysis' : 'Technique analysis'}
                  </span>
                  <span style={{ fontSize: 11, color: '#78716c' }}>{new Date(e.created_at).toLocaleString()}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8 }}>{e.folder_label}</div>
                {e.youtube_url ? (
                  <a
                    href={e.youtube_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    style={{ fontSize: 13, color: '#2563eb', marginTop: 8, display: 'inline-block' }}
                  >
                    YouTube link
                  </a>
                ) : null}
                {e.body_text?.trim() ? (
                  <pre
                    style={{
                      margin: '10px 0 0',
                      fontSize: 12,
                      lineHeight: 1.45,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                      color: '#44403c',
                    }}
                  >
                    {e.body_text.length > 600 ? `${e.body_text.slice(0, 600)}…` : e.body_text}
                  </pre>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── Statistics: measurement progression across report exports ────── */}
      {statLabels.length > 0 && (
        <section style={{ ...panel, marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Statistics</h2>
            <select
              value={statMetric || statLabels[0]}
              onChange={(e) => setStatMetric(e.target.value)}
              aria-label="Metric"
              style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #D1D1D6', fontSize: 12, background: '#fff' }}
            >
              {statLabels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <p style={{ margin: '4px 0 14px', fontSize: 12, color: '#78716c' }}>
            Values from every exported report, oldest to newest — watch the progression.
          </p>
          {activeStat.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: '#78716c' }}>No values yet for this metric.</p>
          ) : (() => {
            const values = activeStat.map((d) => d.value);
            const min = Math.min(...values);
            const max = Math.max(...values);
            const avg = values.reduce((s, v) => s + v, 0) / values.length;
            const span = Math.max(1e-6, Math.abs(max) > Math.abs(min) ? Math.abs(max) : Math.abs(min));
            const unit = activeStat[0]?.unit ?? '';
            return (
              <>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: 12, color: '#44403c' }}>
                  <span><strong>Min</strong> {Math.round(min * 10) / 10}{unit}</span>
                  <span><strong>Avg</strong> {Math.round(avg * 10) / 10}{unit}</span>
                  <span><strong>Max</strong> {Math.round(max * 10) / 10}{unit}</span>
                  <span><strong>Samples</strong> {values.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activeStat.slice(-30).map((d, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 130, fontSize: 11, color: '#78716c', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(d.date).toLocaleDateString()}{d.snapshot ? ` · ${d.snapshot}` : ''}
                      </span>
                      <div style={{ flex: 1, height: 16, background: '#F2F2F7', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.max(2, Math.min(100, (Math.abs(d.value) / span) * 100))}%`,
                          height: '100%',
                          background: '#007AFF',
                          borderRadius: 8,
                        }} />
                      </div>
                      <span style={{ width: 70, fontSize: 12, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(d.value * 10) / 10}{d.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </section>
      )}
    </div>
  );
}

const lb: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
};

const inp: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid #E5E5E5',
  padding: '10px 12px',
  fontSize: 14,
  width: '100%',
  boxSizing: 'border-box',
};
