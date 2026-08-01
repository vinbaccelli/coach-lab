'use client';

/**
 * Save to Google Docs — two decisions, deliberately separated.
 *
 *   1. WHAT goes in the document  — Side A, Side B, or both.
 *   2. WHOSE document it goes into — one or two players from the coach's database.
 *
 * Keeping them apart is the point. They are genuinely independent: a coach may
 * want the opponent's analysis filed in their own player's doc, or one shared
 * both-sides report filed in two docs. Collapsing them into a single "save for
 * player X" would quietly force scope to follow recipient, which is wrong as
 * often as it's right.
 *
 * Two dropdowns rather than a checkbox list because a match has at most two
 * sides: the second is optional, and leaving it empty saves to one player. Each
 * dropdown can create a new player inline, so an unrecorded opponent never sends
 * the coach out to the Players area and back.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type DocsScope,
  type DocsSectionPayload,
  type SaveOutcome,
  buildDocsSections,
  saveReportToPlayers,
  uploadReportCharts,
} from '@/lib/matchAnalysis/exportToDocs';
import type { SideReport } from '@/lib/matchAnalysis/reportModel';

interface DbPlayer {
  id: string;
  display_name: string;
}

const CREATE = '__create__';

export default function SaveReportToPlayersModal({
  open,
  onClose,
  reports,
  folderLabel,
  summaryText,
}: {
  open: boolean;
  onClose: () => void;
  reports: SideReport[];
  folderLabel: string;
  summaryText: string;
}) {
  const [players, setPlayers] = useState<DbPlayer[]>([]);
  const [scope, setScope] = useState<DocsScope>('both');
  const [slotA, setSlotA] = useState('');
  const [slotB, setSlotB] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<SaveOutcome[] | null>(null);

  const loadPlayers = useCallback(async (): Promise<DbPlayer[]> => {
    const res = await fetch('/api/players');
    const data = (await res.json()) as { players?: DbPlayer[] };
    const list = data.players ?? [];
    setPlayers(list);
    return list;
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setOutcomes(null);
    loadPlayers().catch(() => setError('Could not load your players'));
  }, [open, loadPlayers]);

  /** Create a player inline, then select them in the slot that asked. */
  const createPlayer = useCallback(
    async (slot: 'A' | 'B') => {
      const name = window.prompt('New player name');
      if (!name?.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/players', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: name.trim() }),
        });
        const data = (await res.json()) as { player?: DbPlayer; error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Could not create player');
        const list = await loadPlayers();
        const created = data.player ?? list.find((p) => p.display_name === name.trim());
        if (created) (slot === 'A' ? setSlotA : setSlotB)(created.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create player');
      } finally {
        setBusy(false);
      }
    },
    [loadPlayers],
  );

  const onSlotChange = useCallback(
    (slot: 'A' | 'B', value: string) => {
      if (value === CREATE) {
        void createPlayer(slot);
        return;
      }
      (slot === 'A' ? setSlotA : setSlotB)(value);
    },
    [createPlayer],
  );

  /** One or two recipients; a repeated pick is not two saves to the same doc. */
  const targets = useMemo(() => {
    const ids = Array.from(new Set([slotA, slotB].filter(Boolean)));
    return ids
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is DbPlayer => Boolean(p))
      .map((p) => ({ playerId: p.id, displayName: p.display_name }));
  }, [slotA, slotB, players]);

  const scopeLabel = useMemo(() => {
    if (scope === 'both') return `${reports[0]?.label ?? 'Side A'} + ${reports[1]?.label ?? 'Side B'}`;
    return reports.find((r) => r.sideId === scope)?.label ?? `Side ${scope}`;
  }, [scope, reports]);

  const save = useCallback(async () => {
    if (!targets.length) return;
    setBusy(true);
    setError(null);
    setOutcomes(null);
    try {
      setProgress('Rendering charts…');
      const chartUrls = await uploadReportCharts(
        reports,
        (done, total) => setProgress(`Uploading charts ${done}/${total}…`),
        scope,
      );
      const sections: DocsSectionPayload[] = buildDocsSections(reports, chartUrls, scope);
      const results = await saveReportToPlayers(targets, sections, folderLabel, summaryText, (done, total, name) =>
        setProgress(name ? `Saving to ${name} (${done + 1}/${total})…` : 'Finishing…'),
      );
      setOutcomes(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
      setProgress('');
    }
  }, [targets, reports, scope, folderLabel, summaryText]);

  if (!open) return null;

  const slotSelect = (slot: 'A' | 'B', value: string, label: string, hint: string) => (
    <div style={{ flex: '1 1 190px' }}>
      <div style={slotLabel}>{label}</div>
      <select
        value={value}
        disabled={busy}
        onChange={(e) => onSlotChange(slot, e.target.value)}
        style={selectStyle}
      >
        <option value="">{hint}</option>
        {players.map((p) => (
          <option key={p.id} value={p.id}>{p.display_name}</option>
        ))}
        <option value={CREATE}>+ Create new player…</option>
      </select>
    </div>
  );

  return (
    <div style={backdrop} onClick={busy ? undefined : onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px', letterSpacing: -0.2 }}>
          Save to Google Docs
        </h2>
        <p style={{ fontSize: 12, color: '#6E6E73', lineHeight: 1.55, margin: '0 0 20px' }}>
          The report is added to the top of each player&apos;s <b>Match Analysis</b> doc, newest first.
        </p>

        {error && <p style={{ color: '#b91c1c', fontSize: 12, marginBottom: 12 }}>{error}</p>}

        {!outcomes && (
          <>
            {/* 1 — what goes in */}
            <div style={stepLabel}>1 · Whose stats to include</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              {([
                ['A', reports[0]?.label ?? 'Side A'],
                ['B', reports[1]?.label ?? 'Side B'],
                ['both', 'Both sides'],
              ] as Array<[DocsScope, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() => setScope(value)}
                  style={{
                    ...radioPill,
                    background: scope === value ? '#1A1A1A' : '#fff',
                    color: scope === value ? '#fff' : '#1A1A1A',
                    borderColor: scope === value ? '#1A1A1A' : '#E5E5E5',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 2 — where it goes */}
            <div style={stepLabel}>2 · Save into which player&apos;s doc</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              {slotSelect('A', slotA, 'Player', '— choose a player —')}
              {slotSelect('B', slotB, 'And also (optional)', '— nobody —')}
            </div>
            <p style={{ fontSize: 11, color: '#8E8E93', lineHeight: 1.5, margin: '0 0 20px' }}>
              Leave the second empty to save to one player. Both filled saves the same report into both docs.
            </p>

            {players.length === 0 && (
              <p style={{ fontSize: 12, color: '#8E8E93', marginBottom: 12 }}>
                No players yet — use <b>+ Create new player</b> above.
              </p>
            )}

            <div style={summaryBox}>
              Saving <b>{scopeLabel}</b> to{' '}
              <b>{targets.length ? targets.map((t) => t.displayName).join(' and ') : 'nobody yet'}</b>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button type="button" onClick={onClose} disabled={busy} style={btnGhost}>Cancel</button>
              <button type="button" onClick={() => void save()} disabled={busy || !targets.length} style={btnPrimary}>
                {busy ? progress || 'Saving…' : `Save to ${targets.length || 0} doc${targets.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}

        {outcomes && (
          <>
            {outcomes.map((o) => (
              <div key={o.playerId} style={{ fontSize: 12.5, padding: '8px 0', borderBottom: '1px solid #F5F5F5' }}>
                <b>{o.displayName}</b>{' '}
                {o.ok ? (
                  <span style={{ color: '#2F7D32' }}>saved to their Match Analysis doc</span>
                ) : (
                  <span style={{ color: '#b91c1c' }}>failed — {o.error}</span>
                )}
              </div>
            ))}
            <button type="button" onClick={onClose} style={{ ...btnPrimary, marginTop: 18, width: '100%' }}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
};
const panel: React.CSSProperties = {
  background: '#fff', borderRadius: 16, padding: 26, width: 'min(500px, 100%)',
  color: '#1A1A1A', maxHeight: '90vh', overflowY: 'auto',
};
const stepLabel: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: '#8E8E93',
  textTransform: 'uppercase', marginBottom: 8,
};
const slotLabel: React.CSSProperties = { fontSize: 11, color: '#6E6E73', marginBottom: 5 };
const selectStyle: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '9px 10px', borderRadius: 9,
  border: '1px solid #E5E5E5', background: '#fff', boxSizing: 'border-box',
};
const radioPill: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 999, border: '1px solid #E5E5E5',
  fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
};
const summaryBox: React.CSSProperties = {
  background: '#F7F7F5', border: '1px solid #EAEAE6', borderRadius: 10,
  padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5,
};
const btnPrimary: React.CSSProperties = {
  flex: 1, minHeight: 46, borderRadius: 11, border: 'none',
  background: '#1A1A1A', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  flex: '0 0 100px', minHeight: 46, borderRadius: 11, border: '1px solid #E5E5E5',
  background: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer',
};
