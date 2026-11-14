'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import PlayerSessionTimeline from '@/components/players/PlayerSessionTimeline';
import PlayerNav from '@/components/reports/PlayerNav';
import PlayerTimeline from '@/components/players/PlayerTimeline';
import PlayerShareCard from '@/components/players/PlayerShareCard';
import TrackerSection from '@/components/players/trackers/TrackerSection';
import ProfileTabs, { isProfileTab, type ProfileTab } from '@/components/players/ProfileTabs';
import PlayerAvatar from '@/components/players/PlayerAvatar';
import EditableLabel from '@/components/players/EditableLabel';
import ReviewQueue from '@/components/players/ReviewQueue';
import type { Tracker, TrackerEntry } from '@/lib/players/trackers';
import type { MealLog } from '@/lib/players/nutrition';
import NutritionSection from '@/components/players/nutrition/NutritionSection';
import { coachNutritionClient } from '@/components/players/nutrition/nutritionClient';
import WorkoutsSection from '@/components/players/workouts/WorkoutsSection';
import { coachWorkoutsClient, type WorkoutLog } from '@/components/players/workouts/workoutsClient';
import MentalSection from '@/components/players/mental/MentalSection';
import TodoCard from '@/components/players/mental/TodoCard';
import { coachMentalClient, coachTodoClient, type QResponse } from '@/components/players/mental/mentalClient';
import DeletePlayerSection from '@/components/players/DeletePlayerSection';
import { createPlayerDraftSession } from '@/lib/sessions/saveSession';
import type { PlayerSession } from '@/lib/sessions/types';
import { useEntitlement } from '@/lib/useEntitlement';
import PlanLockedNotice from '@/components/PlanLockedNotice';
import { REPORTS_IN_APP } from '@/lib/featureFlags';
import { parseTechnicalSheet, defaultTechnicalSheet, migrateOldDefault, resetToStandard, needsReset, labelTaken, makeRow, addTrackEntry, removeTrackEntry, entriesNewestFirst, type TechnicalSheetRow } from '@/lib/players/technicalSheet';
import ReorderList from '@/components/players/ReorderList';
import { parseOrder } from '@/lib/players/reorder';

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
  /** Extra profile rows (name/value) — null until the coach adds one. */
  profile_fields?: unknown;
  /** Manual timeline order (list of item keys) — null = newest first. */
  timeline_order?: unknown;
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
  // Which section is open; kept in the URL (?tab=) so a reload or a shared link opens the same one.
  const [tab, setTabState] = useState<ProfileTab>('overview');
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (isProfileTab(t)) setTabState(t);
  }, []);
  // Player submissions waiting for the coach (share link): shown on Overview, counted on its tab.
  const [review, setReview] = useState<{ entries: TrackerEntry[]; trackers: Tracker[]; meals: MealLog[]; workoutLogs: WorkoutLog[]; answers: QResponse[] }>({ entries: [], trackers: [], meals: [], workoutLogs: [], answers: [] });
  const loadReview = useCallback(async () => {
    try {
      const res = await fetch(`/api/players/${playerId}/review`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setReview({ entries: data.entries ?? [], trackers: data.trackers ?? [], meals: data.meals ?? [], workoutLogs: data.workoutLogs ?? [], answers: data.answers ?? [] });
    } catch { /* the queue is optional */ }
  }, [playerId]);
  useEffect(() => { void loadReview(); }, [loadReview]);
  const setTab = useCallback((t: ProfileTab) => {
    setTabState(t);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('tab', t);
      window.history.replaceState(window.history.state, '', u.toString());
    } catch { /* ignore */ }
  }, []);
  const [err, setErr] = useState<string | null>(null);
  // Without an active plan the profile stays readable; edits are server-gated (403 plan_required).
  const canEdit = useEntitlement().can('players');
  const nutritionClient = useMemo(() => coachNutritionClient(playerId, canEdit), [playerId, canEdit]);
  const workoutsClient = useMemo(() => coachWorkoutsClient(playerId, canEdit), [playerId, canEdit]);
  const mentalClient = useMemo(() => coachMentalClient(playerId, canEdit), [playerId, canEdit]);
  const todoClient = useMemo(() => coachTodoClient(playerId, canEdit), [playerId, canEdit]);
  const [saving, setSaving] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sheet, setSheet] = useState<TechnicalSheetRow[] | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  // Extra profile rows (Nationality, …). Seeded once from the old Nationality / Playing hand columns.
  const [profileRows, setProfileRows] = useState<TechnicalSheetRow[] | null>(null);
  const [profileDirty, setProfileDirty] = useState(false);
  const [newProfileLabel, setNewProfileLabel] = useState<string | null>(null);
  const [newRowLabel, setNewRowLabel] = useState<string | null>(null);
  const [newRowKind, setNewRowKind] = useState<'text' | 'track'>('text');
  // Draft of the next dated comment, per tracking row (keyed by row label).
  const [trackDraft, setTrackDraft] = useState<Record<string, { date: string; text: string }>>({});

  // Initialize the sheet once from the loaded player (don't clobber edits on reloads).
  useEffect(() => {
    if (player && profileRows === null) {
      const saved = parseTechnicalSheet(player.profile_fields);
      if (saved) setProfileRows(saved);
      else {
        const seeded: TechnicalSheetRow[] = [];
        if (player.nationality?.trim()) seeded.push({ label: 'Nationality', value: player.nationality });
        if (player.playing_hand && player.playing_hand !== 'unknown') seeded.push({ label: 'Playing hand', value: player.playing_hand });
        setProfileRows(seeded);
      }
    }
  }, [player, profileRows]);

  useEffect(() => {
    if (player && sheet === null) {
      const parsed = parseTechnicalSheet(player.technical_sheet);
      const rows = parsed ? migrateOldDefault(parsed) : defaultTechnicalSheet();
      setSheet(rows);
      // An untouched old default sheet was replaced by the standard rows: save that once.
      if (parsed && rows !== parsed && canEdit) void saveSheet(rows);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, sheet]);

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
        throw new Error(data.message ?? data.error ?? 'Could not save the technical sheet');
      }
    } catch (e: unknown) {
      // Surface the failure instead of reporting a silent false success.
      setErr(e instanceof Error ? e.message : 'Could not save the technical sheet');
    } finally {
      setSheetSaving(false);
    }
  }, [playerId]);

  const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const renameSheetRow = (i: number, next: string): string | null => {
    if (!sheet) return null;
    if (sheet.some((r, j) => j !== i && sameLabel(r.label, next))) return 'There is already a row with that name';
    const rows = sheet.map((r, j) => (j === i ? { ...r, label: next } : r));
    setSheet(rows);
    void saveSheet(rows);
    return null;
  };
  const renameProfileRow = (i: number, next: string): string | null => {
    const rows = profileRows ?? [];
    if (rows.some((r, j) => j !== i && sameLabel(r.label, next))) return 'There is already a row with that name';
    setProfileRows(rows.map((r, j) => (j === i ? { ...r, label: next } : r)));
    setProfileDirty(true);
    return null;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // no-store: the entries list must be the database's, not a cached copy (a report saved
      // a moment ago has to be there).
      const res = await fetch(`/api/players/${playerId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || (REPORTS_IN_APP && (data.error || !data.player))) throw new Error(data.error === 'Offline' ? 'You appear to be offline.' : data.error ?? 'Not found');
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
    border: '1px solid var(--cl-border)',
    borderRadius: 16,
    padding: 18,
    color: 'var(--cl-text-primary)',
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
          display_name: player.display_name.trim() || 'Player',
          photo_url: player.photo_url || null,
          date_of_birth: player.date_of_birth || null,
          // Keep the Players list's nationality line in step with the "Nationality" row (if any).
          nationality: profileRows?.find((r) => r.label.trim().toLowerCase() === 'nationality')?.value.trim() || player.nationality || null,
          playing_hand: player.playing_hand || 'unknown',
          notes: player.notes || null,
          // Only sent once the coach changed the rows (so an unapplied migration cannot break a plain save).
          ...(profileDirty && profileRows ? { profile_fields: profileRows } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Save failed');
      setPlayer(data.player);
      setProfileDirty(false);
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
    return REPORTS_IN_APP ? (
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <PlayerNav playerId={playerId} current="profile" maxWidth={880} />
        <p style={{ color: 'var(--cl-text-secondary)' }}>Loading profile…</p>
      </div>
    ) : (
      <p style={{ color: 'var(--cl-text-secondary)' }}>Loading profile…</p>
    );
  }
  // Only a genuinely-absent player is fatal (nothing to render). A failed
  // save / new-session sets `err` while the player is still loaded — that is
  // shown as a recoverable inline banner below, NOT a full-page unmount.
  if (!player) {
    return REPORTS_IN_APP ? (
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <PlayerNav playerId={playerId} current="profile" maxWidth={880} />
        <p style={{ color: 'var(--cl-destructive-text)' }}>{REPORTS_IN_APP && (!err || err === 'Not found') ? 'Player not found' : err || 'Player not found'}</p>
      </div>
    ) : (
      <p style={{ color: 'var(--cl-destructive-text)' }}>{REPORTS_IN_APP && (!err || err === 'Not found') ? 'Player not found' : err || 'Player not found'}</p>
    );
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', paddingBottom: 48 }}>
      {/* REPORTS_IN_APP: one pinned bar (Players / name) that stays in view on this long page.
          Off: the original plain link, unchanged. */}
      {REPORTS_IN_APP ? (
        <PlayerNav playerId={playerId} playerName={player.display_name} current="profile" maxWidth={880} />
      ) : (
      <Link
        href="/players"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--cl-accent)',
          fontSize: 13,
          marginBottom: 16,
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={16} /> Players
      </Link>
      )}

      {!canEdit ? (
        <PlanLockedNotice feature="players">
          Editing a player needs an active plan. This profile stays readable.
        </PlanLockedNotice>
      ) : null}

      {err ? (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.25)',
            color: 'var(--cl-destructive-text)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {err}
        </div>
      ) : null}

      <ProfileTabs value={tab} onChange={(t) => { setTab(t); void loadReview(); }} badges={{ overview: review.entries.length + review.meals.length + review.workoutLogs.length + review.answers.length }} />

      {tab === 'overview' ? <ReviewQueue playerId={playerId} entries={review.entries} trackers={review.trackers} meals={review.meals} workoutLogs={review.workoutLogs} answers={review.answers.length} onChanged={() => void loadReview()} onOpenNutrition={() => setTab('nutrition')} onOpenWorkouts={() => setTab('workouts')} onOpenMental={() => setTab('mental')} /> : null}
      {tab === 'overview' ? <TodoCard client={todoClient} /> : null}

      {tab === 'overview' ? (
      <div style={{ ...panel, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <PlayerAvatar
            playerId={playerId}
            name={player.display_name}
            photoUrl={player.photo_url}
            canEdit={canEdit}
            onChange={(url) => setPlayer((prev) => (prev ? { ...prev, photo_url: url } : prev))}
          />
          <h1 data-tour-id="player-profile" style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em' }}>{player.display_name}</h1>
        </div>
        <label style={{ ...lb, marginBottom: 12 }}>
          Name
          <input
            value={player.display_name}
            onChange={(e) => setPlayer({ ...player, display_name: e.target.value })}
            style={inp}
            maxLength={120}
          />
        </label>
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
        </div>
        <ReorderList
          items={profileRows ?? []}
          getKey={(r) => r.label}
          disabled={!canEdit}
          onReorder={(next) => { setProfileRows(next); setProfileDirty(true); }}
          containerStyle={{ display: 'grid', gap: 10, marginTop: 12 }}
          renderItem={(row, i, handle) => (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
              {handle}
              <label style={{ ...lb, flex: 1 }}>
                <EditableLabel label={row.label} canEdit={canEdit} onRename={(n) => renameProfileRow(i, n)} />
                <input
                  value={row.value}
                  onChange={(e) => { setProfileRows((prev) => prev ? prev.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)) : prev); setProfileDirty(true); }}
                  style={inp}
                />
              </label>
              <button
                type="button"
                aria-label={`Delete ${row.label} row`}
                onClick={() => {
                  if (!window.confirm(`Delete the "${row.label}" row?`)) return;
                  setProfileRows((prev) => (prev ? prev.filter((_, j) => j !== i) : prev));
                  setProfileDirty(true);
                }}
                style={{ width: 30, height: 34, borderRadius: 8, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={14} />
              </button>
            </div>
          )}
        />
        {canEdit ? (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {newProfileLabel === null ? (
              <>
                <button
                  type="button"
                  onClick={() => setNewProfileLabel('')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px dashed var(--cl-accent)', background: 'rgba(0,122,255,0.04)', color: 'var(--cl-accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  <Plus size={14} /> Add row
                </button>
                {!(profileRows ?? []).some((r) => r.label.trim().toLowerCase() === 'nationality') ? (
                  <button
                    type="button"
                    onClick={() => { setProfileRows((prev) => [...(prev ?? []), { label: 'Nationality', value: '' }]); setProfileDirty(true); }}
                    style={{ padding: '5px 10px', borderRadius: 999, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 12, cursor: 'pointer' }}
                  >
                    + Nationality
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <input
                  value={newProfileLabel}
                  onChange={(e) => setNewProfileLabel(e.target.value)}
                  placeholder="Row name"
                  autoFocus
                  style={{ ...inp, maxWidth: 260 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProfileLabel.trim()) {
                      setProfileRows((prev) => [...(prev ?? []), { label: newProfileLabel.trim(), value: '' }]);
                      setProfileDirty(true);
                      setNewProfileLabel(null);
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!newProfileLabel.trim()}
                  onClick={() => {
                    setProfileRows((prev) => [...(prev ?? []), { label: newProfileLabel.trim(), value: '' }]);
                    setProfileDirty(true);
                    setNewProfileLabel(null);
                  }}
                  style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setNewProfileLabel(null)}
                  style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 12, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        ) : null}
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
            background: 'var(--cl-action-primary)',
            color: 'var(--cl-text-on-fill)',
            fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
      ) : null}

      {/* ── Technical Sheet ─────────────────────────────────────────────── */}
      {tab === 'technical' ? (
      <div style={{ ...panel, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Technical Sheet</h2>
          <button
            type="button"
            onClick={() => { if (sheet) void saveSheet(sheet); }}
            disabled={sheetSaving || !sheet}
            style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'var(--cl-action-primary)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 12, cursor: sheetSaving ? 'wait' : 'pointer' }}
          >
            {sheetSaving ? 'Saving…' : 'Save sheet'}
          </button>
          {canEdit && sheet && needsReset(sheet) ? (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm('Reset to the standard rows (Forehand, Backhand, Serve, Volley, Footwork)?\n\nRows that have something typed in are kept; empty rows are removed.')) return;
                const next = resetToStandard(sheet, new Date().toISOString().slice(0, 10), () => crypto.randomUUID());
                setSheet(next);
                void saveSheet(next);
              }}
              style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
            >
              Reset to standard rows
            </button>
          ) : null}
        </div>
        <p style={{ margin: '4px 0 14px', fontSize: 12, color: 'var(--cl-text-secondary)' }}>
          Rows you add or delete here only change this player.
        </p>
        <ReorderList
          items={sheet ?? []}
          getKey={(r) => r.label}
          disabled={!canEdit}
          onReorder={(next) => { setSheet(next); void saveSheet(next); }}
          containerStyle={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
          itemStyle={(r) => (r.kind === 'track' ? { gridColumn: '1 / -1' } : undefined)}
          renderItem={(row, i, handle) => (
            <div style={{ display: 'flex', alignItems: row.kind === 'track' ? 'flex-start' : 'flex-end', gap: 4 }}>
              {handle}
              {row.kind === 'track' ? (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, margin: '6px 0 6px' }}><EditableLabel label={row.label} canEdit={canEdit} onRename={(n) => renameSheetRow(i, n)} suffix={<span style={{ fontWeight: 500, color: 'var(--cl-text-muted)', fontSize: 11 }}>· progress tracking</span>} /></div>
                  {entriesNewestFirst(row).map((en) => (
                    <div key={en.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderTop: '1px solid var(--cl-border)' }}>
                      <span style={{ fontSize: 12, color: 'var(--cl-text-muted)', whiteSpace: 'nowrap', paddingTop: 1 }}>{en.date}</span>
                      <span style={{ fontSize: 13, whiteSpace: 'pre-wrap', flex: 1, minWidth: 0 }}>{en.text}</span>
                      {canEdit ? (
                        <button
                          type="button"
                          aria-label="Delete this entry"
                          onClick={() => {
                            if (!window.confirm('Delete this entry?')) return;
                            setSheet((prev) => {
                              if (!prev) return prev;
                              const next = prev.map((r, j) => (j === i ? removeTrackEntry(r, en.id) : r));
                              void saveSheet(next);
                              return next;
                            });
                          }}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--cl-text-muted)', display: 'inline-flex' }}
                        >
                          <X size={14} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {canEdit ? (() => {
                    const draft = trackDraft[row.label] ?? { date: new Date().toISOString().slice(0, 10), text: '' };
                    return (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'flex-start' }}>
                        <input type="date" value={draft.date} onChange={(e) => setTrackDraft((d) => ({ ...d, [row.label]: { ...draft, date: e.target.value } }))} style={{ ...inp, width: 150 }} />
                        <textarea
                          rows={2}
                          value={draft.text}
                          placeholder={`What changed in the ${row.label.toLowerCase()}?`}
                          onChange={(e) => setTrackDraft((d) => ({ ...d, [row.label]: { ...draft, text: e.target.value } }))}
                          style={{ ...inp, flex: '1 1 200px', resize: 'vertical' }}
                        />
                        <button
                          type="button"
                          disabled={!draft.text.trim()}
                          onClick={() => {
                            setSheet((prev) => {
                              if (!prev) return prev;
                              const next = prev.map((r, j) => (j === i ? addTrackEntry(r, draft.date, draft.text, crypto.randomUUID()) : r));
                              void saveSheet(next);
                              return next;
                            });
                            setTrackDraft((d) => ({ ...d, [row.label]: { date: draft.date, text: '' } }));
                          }}
                          style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                        >
                          Add entry
                        </button>
                      </div>
                    );
                  })() : null}
                </div>
              ) : (
              <label style={{ ...lb, flex: 1 }}>
                <EditableLabel label={row.label} canEdit={canEdit} onRename={(n) => renameSheetRow(i, n)} />
                <input
                  value={row.value}
                  onChange={(e) => setSheet((prev) => prev ? prev.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)) : prev)}
                  style={inp}
                />
              </label>
              )}
              <button
                type="button"
                aria-label={`Delete ${row.label} row`}
                onClick={() => {
                  if (!window.confirm(`Delete the "${row.label}" row${row.kind === 'track' && (row.entries?.length ?? 0) > 0 ? ' and its entries' : ''}?`)) return;
                  setSheet((prev) => {
                    if (!prev) return prev;
                    const next = prev.filter((_, j) => j !== i);
                    void saveSheet(next);
                    return next;
                  });
                }}
                style={{ width: 30, height: 34, borderRadius: 8, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={14} />
              </button>
            </div>
          )}
        />
        {canEdit ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--cl-text-muted)' }}>Track more:</span>
            <button type="button" onClick={() => setTab('biometrics')} style={{ padding: '5px 10px', borderRadius: 999, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 12, cursor: 'pointer' }}>+ Biometrics</button>
            <button type="button" onClick={() => setTab('fitness')} style={{ padding: '5px 10px', borderRadius: 999, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 12, cursor: 'pointer' }}>+ Fitness tracker</button>
            <button type="button" onClick={() => setTab('progress')} style={{ padding: '5px 10px', borderRadius: 999, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 12, cursor: 'pointer' }}>+ Custom tracker</button>
          </div>
        ) : null}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {newRowLabel === null ? (
            <>
              <button
                type="button"
                onClick={() => { setNewRowKind('text'); setNewRowLabel(''); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px dashed var(--cl-accent)', background: 'rgba(0,122,255,0.04)', color: 'var(--cl-accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                <Plus size={14} /> Add row
              </button>
              <button
                type="button"
                onClick={() => { setNewRowKind('track'); setNewRowLabel(''); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px dashed var(--cl-accent)', background: 'rgba(0,122,255,0.04)', color: 'var(--cl-accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                <Plus size={14} /> Add progress tracking row
              </button>
            </>
          ) : (
            <>
              <input
                value={newRowLabel}
                onChange={(e) => setNewRowLabel(e.target.value)}
                placeholder={newRowKind === 'track' ? 'Tracking row name (e.g. Return of serve)' : 'Row name (e.g. Serve speed)'}
                autoFocus
                style={{ ...inp, maxWidth: 260 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newRowLabel.trim()) {
                    if (labelTaken(sheet ?? [], newRowLabel)) { window.alert('There is already a row with that name.'); return; }
                    setSheet((prev) => {
                      const next = [...(prev ?? []), makeRow(newRowLabel.trim(), newRowKind)];
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
                  if (labelTaken(sheet ?? [], newRowLabel)) { window.alert('There is already a row with that name.'); return; }
                  setSheet((prev) => {
                    const next = [...(prev ?? []), makeRow(newRowLabel.trim(), newRowKind)];
                    void saveSheet(next);
                    return next;
                  });
                  setNewRowLabel(null);
                }}
                style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setNewRowLabel(null)}
                style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      ) : null}

      {tab === 'progress' ? <TrackerSection playerId={playerId} category="progress" canEdit={canEdit} /> : null}
      {tab === 'biometrics' ? <TrackerSection playerId={playerId} category="biometrics" canEdit={canEdit} /> : null}
      {tab === 'fitness' ? <TrackerSection playerId={playerId} category="fitness" canEdit={canEdit} /> : null}
      {tab === 'nutrition' ? <NutritionSection client={nutritionClient} /> : null}
      {tab === 'workouts' ? <WorkoutsSection client={workoutsClient} /> : null}
      {tab === 'mental' ? <MentalSection client={mentalClient} /> : null}

      {tab === 'timeline' ? (
      <PlayerTimeline
        playerId={playerId}
        playerName={player.display_name}
        canEdit={canEdit}
        order={parseOrder(player.timeline_order)}
        onOrderChange={async (order) => {
          const res = await fetch(`/api/players/${playerId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timeline_order: order }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not save the order (has the database update been run?)');
          setPlayer((prev) => (prev ? { ...prev, timeline_order: order } : prev));
        }}
      />
      ) : null}
      {tab === 'overview' ? <PlayerShareCard playerId={playerId} canEdit={canEdit} /> : null}

      {tab === 'technical' ? (<>
      {/* V2: the "Analysis Sessions" block is hidden while REPORTS_IN_APP is on — reports are
          the player's record now, and a coach saves to any player from the analysis app
          without a session. The code (and player_sessions, its routes and pages) is kept:
          REPORTS_IN_APP = false brings it back unchanged. */}
      {!REPORTS_IN_APP ? (
      <section
        style={{
          background: 'rgba(250, 249, 247, 0.96)',
          border: '1px solid var(--cl-border)',
          borderRadius: 16,
          padding: 18,
          color: 'var(--cl-text-primary)',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>
          Analysis Sessions
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--cl-text-secondary)' }}>
          Start from the player, use tools in Video Analysis, then Save Report — newest first.
        </p>
        <button
          type="button"
          data-tour-id="player-new-session"
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
            background: 'var(--cl-accent)',
            color: 'var(--cl-text-on-fill)',
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
      ) : null}

      <section
        style={{
          background: 'rgba(250, 249, 247, 0.96)',
          border: '1px solid var(--cl-border)',
          borderRadius: 16,
          padding: 18,
          color: 'var(--cl-text-primary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Reports</h2>
          <div data-tour-id="player-doc-links" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {REPORTS_IN_APP ? (
              <Link
                href={`/players/${playerId}/reports`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36,
                  padding: '8px 14px', borderRadius: 10, background: 'var(--cl-accent)',
                  color: 'var(--cl-text-on-fill)', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                }}
              >
                Open reports →
              </Link>
            ) : null}
            {!REPORTS_IN_APP && player.google_doc_id ? (
              <a
                href={`https://docs.google.com/document/d/${player.google_doc_id}/edit`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 10, background: 'var(--cl-accent)',
                  color: 'var(--cl-text-on-fill)', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                }}
              >
                Technical Analysis Doc ↗
              </a>
            ) : null}
            {!REPORTS_IN_APP && player.google_match_doc_id ? (
              <a
                href={`https://docs.google.com/document/d/${player.google_match_doc_id}/edit`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 10, background: 'var(--cl-success)',
                  color: 'var(--cl-text-on-fill)', fontSize: 12, fontWeight: 700, textDecoration: 'none',
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
                  padding: '8px 14px', borderRadius: 10, background: 'var(--cl-bg-panel)',
                  border: '1px solid var(--cl-accent)', color: 'var(--cl-accent)',
                  fontSize: 12, fontWeight: 700, textDecoration: 'none',
                }}
              >
                Open Drive folder ↗
              </a>
            ) : null}
            {/* Every link above is conditional on a doc id that stays null until
                the first export, while the "Reports" heading and the caption
                below render unconditionally — so a player who simply has no
                reports yet looked identical to a broken page (heading present,
                zero links). Say so explicitly instead.

                Names the DOC specifically, not "reports" generally: this row is
                only about google_doc_id / google_match_doc_id / entry doc_urls,
                and a player can have entries (screenshots) with none of those —
                seen live on Azaliya, 5 saved entries but no Doc ever exported.
                "No reports yet" read as "nothing saved" and looked like data
                loss even though her entries were sitting right below it. */}
            {!REPORTS_IN_APP && !player.google_doc_id && !player.google_match_doc_id && !player.google_folder_id
              && !entries.some((e) => e.metadata?.doc_url) ? (
              <span style={{ fontSize: 12, color: 'var(--cl-text-secondary)', fontWeight: 600 }}>
                No Google Doc yet — use Save Report to create one.
              </span>
            ) : null}
          </div>
        </div>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--cl-text-secondary)' }}>
          Match and technique reports — newest first.
          {REPORTS_IN_APP
            ? ' Tap an entry to open its report.'
            : player.google_doc_id ? ' Click an entry to open it in the player’s Google Doc.' : ''}
        </p>
        <div data-tour-id="player-report-tabs" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          {([['all', 'All'], ['technique', 'Technical Analysis'], ['match', 'Match Analysis']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setDbTab(key)}
              style={{
                padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                borderWidth: 1, borderStyle: 'solid',
                borderColor: dbTab === key ? 'var(--cl-accent)' : 'var(--cl-border)',
                background: dbTab === key ? 'var(--cl-accent)' : 'var(--cl-bg-panel)',
                color: dbTab === key ? 'var(--cl-text-on-fill)' : 'var(--cl-text-primary)',
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
            style={{ flex: '1 1 180px', minWidth: 160, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--cl-border)', fontSize: 12 }}
          />
        </div>
        {timelineEntries.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--cl-text-secondary)' }}>No entries yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {timelineEntries.map((e) => (
              <article
                key={e.id}
                {...(REPORTS_IN_APP
                  ? {
                      role: 'link',
                      tabIndex: 0,
                      onKeyDown: (ev: React.KeyboardEvent) => {
                        if (ev.key === 'Enter') router.push(`/players/${playerId}/reports/${e.id}`);
                      },
                    }
                  : {})}
                onClick={() => {
                  if (REPORTS_IN_APP) {
                    router.push(`/players/${playerId}/reports/${e.id}`);
                    return;
                  }
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
                  background: 'var(--cl-bg-panel)',
                  border: '1px solid #E7E5E4',
                  cursor: (REPORTS_IN_APP || e.metadata?.doc_url || player.google_doc_id) ? 'pointer' : 'default',
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
                  <span style={{ fontSize: 11, color: 'var(--cl-text-secondary)' }}>{new Date(e.created_at).toLocaleString()}</span>
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
                      color: 'var(--cl-text-primary)',
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
              style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--cl-border)', fontSize: 12, background: 'var(--cl-bg-panel)' }}
            >
              {statLabels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <p style={{ margin: '4px 0 14px', fontSize: 12, color: 'var(--cl-text-secondary)' }}>
            Values from every exported report, oldest to newest — watch the progression.
          </p>
          {activeStat.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--cl-text-secondary)' }}>No values yet for this metric.</p>
          ) : (() => {
            const values = activeStat.map((d) => d.value);
            const min = Math.min(...values);
            const max = Math.max(...values);
            const avg = values.reduce((s, v) => s + v, 0) / values.length;
            const span = Math.max(1e-6, Math.abs(max) > Math.abs(min) ? Math.abs(max) : Math.abs(min));
            const unit = activeStat[0]?.unit ?? '';
            return (
              <>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: 12, color: 'var(--cl-text-primary)' }}>
                  <span><strong>Min</strong> {Math.round(min * 10) / 10}{unit}</span>
                  <span><strong>Avg</strong> {Math.round(avg * 10) / 10}{unit}</span>
                  <span><strong>Max</strong> {Math.round(max * 10) / 10}{unit}</span>
                  <span><strong>Samples</strong> {values.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activeStat.slice(-30).map((d, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 130, fontSize: 11, color: 'var(--cl-text-secondary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(d.date).toLocaleDateString()}{d.snapshot ? ` · ${d.snapshot}` : ''}
                      </span>
                      <div style={{ flex: 1, height: 16, background: 'var(--cl-bg-secondary)', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.max(2, Math.min(100, (Math.abs(d.value) / span) * 100))}%`,
                          height: '100%',
                          background: 'var(--cl-accent)',
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
      {/* Danger zone: REPORTS_IN_APP only, deliberately not plan-gated, last on the page. */}
      </>) : null}

      {tab === 'overview' && REPORTS_IN_APP ? <DeletePlayerSection playerId={playerId} playerName={player.display_name} /> : null}
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
  border: '1px solid var(--cl-border)',
  padding: '10px 12px',
  fontSize: 16, // 16px+ stops iPhones zooming the page when a field is tapped
  width: '100%',
  boxSizing: 'border-box',
};
