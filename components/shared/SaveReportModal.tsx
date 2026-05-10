'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { namesLikelyMatch } from '@/lib/players/opponent';

export type DbPlayer = {
  id: string;
  display_name: string;
  photo_url?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Initial folder label (coach can edit) */
  folderLabel: string;
  bodyText: string;
  youtubeUrl?: string | null;
  /** Known primary player display name (for opponent extraction hints) */
  primaryPlayerName?: string;
  /** Pre-fill opponent for mirror logic */
  opponentNameHint?: string | null;
  matchDate?: string | null;
  source?: string;
};

type MirrorPrompt =
  | { kind: 'mirror'; target: DbPlayer }
  | { kind: 'create'; name: string }
  | null;

const panelStyle: React.CSSProperties = {
  background: 'rgba(250, 249, 247, 0.98)',
  border: '1px solid #E5E5E5',
  borderRadius: 16,
  padding: 20,
  maxWidth: 440,
  width: 'min(440px, calc(100vw - 32px))',
  boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
  color: '#1A1A1A',
};

export default function SaveReportModal({
  open,
  onClose,
  folderLabel: initialFolder,
  bodyText,
  youtubeUrl,
  primaryPlayerName = '',
  opponentNameHint = '',
  matchDate,
  source = 'app',
}: Props) {
  const [players, setPlayers] = useState<DbPlayer[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [playerId, setPlayerId] = useState('');
  const [category, setCategory] = useState<'technique' | 'match'>('match');
  const [folderLabel, setFolderLabel] = useState(initialFolder);
  const [opponentName, setOpponentName] = useState(opponentNameHint ?? '');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mirrorPrompt, setMirrorPrompt] = useState<MirrorPrompt>(null);
  const [pendingPayload, setPendingPayload] = useState<{
    playerId: string;
    folderLabel: string;
    body: string;
    yt: string | null;
    opp: string | null;
    primaryDisplayName: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setFolderLabel(initialFolder);
    setOpponentName(opponentNameHint ?? '');
    setErr(null);
    setMirrorPrompt(null);
    setPendingPayload(null);
    setCreating(false);
    setNewName('');
  }, [open, initialFolder, opponentNameHint]);

  useEffect(() => {
    if (!open) return;
    setLoadingList(true);
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => {
        const list: DbPlayer[] = d.players ?? [];
        setPlayers(list);
        if (list.length) {
          const guess = primaryPlayerName
            ? list.find((p) => namesLikelyMatch(p.display_name, primaryPlayerName))
            : null;
          setPlayerId((prev) => {
            if (prev && list.some((p) => p.id === prev)) return prev;
            return guess?.id ?? list[0].id;
          });
        }
      })
      .catch(() => setErr('Could not load players'))
      .finally(() => setLoadingList(false));
  }, [open, primaryPlayerName]);

  const selectedPlayer = useMemo(
    () => players.find((p) => p.id === playerId),
    [players, playerId],
  );

  const saveEntry = useCallback(
    async (pid: string, fl: string, skipMirror?: boolean) => {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/players/${pid}/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category,
            folder_label: fl.trim(),
            body_text: bodyText,
            youtube_url: youtubeUrl ?? null,
            opponent_name: opponentName.trim() || null,
            match_date: matchDate ?? null,
            source,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Save failed');

        if (!skipMirror && opponentName.trim() && selectedPlayer) {
          const opp = opponentName.trim();
          const primaryDisplayName = selectedPlayer.display_name;
          const other = players.find(
            (p) => p.id !== pid && namesLikelyMatch(p.display_name, opp),
          );
          if (other) {
            setPendingPayload({
              playerId: pid,
              folderLabel: fl.trim(),
              body: bodyText,
              yt: youtubeUrl ?? null,
              opp,
              primaryDisplayName,
            });
            setMirrorPrompt({ kind: 'mirror', target: other });
            return;
          }
          setPendingPayload({
            playerId: pid,
            folderLabel: fl.trim(),
            body: bodyText,
            yt: youtubeUrl ?? null,
            opp,
            primaryDisplayName,
          });
          setMirrorPrompt({ kind: 'create', name: opp });
          return;
        }

        onClose();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setBusy(false);
      }
    },
    [
      bodyText,
      category,
      matchDate,
      onClose,
      opponentName,
      players,
      selectedPlayer,
      source,
      youtubeUrl,
    ],
  );

  const duplicateForPlayer = useCallback(
    async (pid: string) => {
      if (!pendingPayload) return;
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/players/${pid}/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category,
            folder_label: pendingPayload.folderLabel,
            body_text: pendingPayload.body,
            youtube_url: pendingPayload.yt,
            opponent_name: pendingPayload.primaryDisplayName || null,
            match_date: matchDate ?? null,
            source,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Save failed');
        setMirrorPrompt(null);
        setPendingPayload(null);
        onClose();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setBusy(false);
      }
    },
    [category, matchDate, onClose, pendingPayload, primaryPlayerName, selectedPlayer?.display_name, source],
  );

  const handleCreatePlayerAndSave = useCallback(async () => {
    if (!pendingPayload || !mirrorPrompt || mirrorPrompt.kind !== 'create') return;
    setBusy(true);
    setErr(null);
    try {
      const cr = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: mirrorPrompt.name.trim() }),
      });
      const created = await cr.json();
      if (!cr.ok) throw new Error(created.error ?? 'Create failed');
      const np = created.player;
      await duplicateForPlayer(np.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }, [duplicateForPlayer, mirrorPrompt, pendingPayload]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Save to player folder</h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6e6e73', lineHeight: 1.45 }}>
              Choose player and folder type. The entry appears on their timeline.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: 4,
              color: '#6e6e73',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {mirrorPrompt?.kind === 'mirror' ? (
          <div style={{ marginTop: 18 }}>
            <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.5 }}>
              We noticed <strong>{mirrorPrompt.target.display_name}</strong> is also in your database — save this
              report to their folder too?
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => duplicateForPlayer(mirrorPrompt.target.id)}
                style={btnPrimary}
              >
                Yes, save copy
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMirrorPrompt(null);
                  setPendingPayload(null);
                  onClose();
                }}
                style={btnGhost}
              >
                No thanks
              </button>
            </div>
          </div>
        ) : mirrorPrompt?.kind === 'create' ? (
          <div style={{ marginTop: 18 }}>
            <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.5 }}>
              Add <strong>{mirrorPrompt.name}</strong> as a new player and save this report to their folder?
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button type="button" disabled={busy} onClick={handleCreatePlayerAndSave} style={btnPrimary}>
                Create &amp; save
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMirrorPrompt(null);
                  setPendingPayload(null);
                  onClose();
                }}
                style={btnGhost}
              >
                Skip
              </button>
            </div>
          </div>
        ) : (
          <>
            <label style={labelStyle}>
              Folder type
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as 'technique' | 'match')}
                style={inputStyle}
              >
                <option value="match">Match Analysis</option>
                <option value="technique">Technique Analysis</option>
              </select>
            </label>

            {!creating ? (
              <label style={labelStyle}>
                Player
                <select
                  value={playerId}
                  onChange={(e) => setPlayerId(e.target.value)}
                  disabled={loadingList}
                  style={inputStyle}
                >
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label style={labelStyle}>
                New player name
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Full name"
                  style={inputStyle}
                />
              </label>
            )}

            <button
              type="button"
              onClick={async () => {
                if (!creating) {
                  setCreating(true);
                  return;
                }
                if (!newName.trim()) return;
                setBusy(true);
                try {
                  const res = await fetch('/api/players', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ display_name: newName.trim() }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error ?? 'Failed');
                  setPlayers((prev) => [...prev, data.player].sort((a, b) =>
                    a.display_name.localeCompare(b.display_name),
                  ));
                  setPlayerId(data.player.id);
                  setCreating(false);
                  setNewName('');
                } catch (e: unknown) {
                  setErr(e instanceof Error ? e.message : 'Failed');
                } finally {
                  setBusy(false);
                }
              }}
              style={{
                marginTop: 8,
                border: 'none',
                background: 'transparent',
                color: '#35679A',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {creating ? 'Save new player' : '+ Create new player'}
            </button>

            <label style={labelStyle}>
              Folder title
              <input value={folderLabel} onChange={(e) => setFolderLabel(e.target.value)} style={inputStyle} />
            </label>

            <label style={labelStyle}>
              Opponent name{' '}
              <span style={{ fontWeight: 400, color: '#8e8e93' }}>(optional, for cross-linking)</span>
              <input
                value={opponentName}
                onChange={(e) => setOpponentName(e.target.value)}
                placeholder="e.g. from the report"
                style={inputStyle}
              />
            </label>

            {youtubeUrl ? (
              <p style={{ fontSize: 12, color: '#6e6e73', margin: '12px 0 0', wordBreak: 'break-all' }}>
                YouTube: {youtubeUrl}
              </p>
            ) : null}

            {err ? (
              <p style={{ color: '#FF3B30', fontSize: 13, marginTop: 12 }}>{err}</p>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" onClick={onClose} style={btnGhost} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !playerId || !folderLabel.trim()}
                onClick={() => saveEntry(playerId, folderLabel)}
                style={btnPrimary}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  marginTop: 14,
};

const inputStyle: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid #E5E5E5',
  padding: '10px 12px',
  fontSize: 14,
  background: '#fff',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 10,
  border: 'none',
  background: '#1A1A1A',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 14,
};

const btnGhost: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 10,
  border: '1px solid #E5E5E5',
  background: '#fff',
  color: '#1A1A1A',
  fontWeight: 500,
  cursor: 'pointer',
  fontSize: 14,
};
