'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * Pre-structured Docs sections (headings / lines / notes / one image each).
   *
   * Optional and ADDITIVE: callers that omit it keep the previous behaviour, so
   * the entries route falls back to deriving sections from `screenshots`.
   * Supplying it is what makes a saved report land in Google Docs as a
   * structured report rather than one unstructured block of text.
   */
  sections?: Array<{
    heading?: string;
    imageUrl?: string;
    lines?: string[];
    notes?: string;
    headingLevel?: 'h2' | 'h3';
    imageObjectSizePt?: { width: number; height: number };
  }>;
  /**
   * Structured data to persist ALONGSIDE the Doc/report, independent of what the
   * Doc ends up showing (an image, plain text, whatever). Stored verbatim in
   * `player_entries.metadata` (jsonb) — this is what makes the underlying data
   * queryable later even though the Doc itself is now just a picture.
   */
  metadata?: Record<string, unknown>;
};

type MirrorPrompt =
  | { kind: 'mirror'; target: DbPlayer }
  | { kind: 'create'; name: string }
  | null;

const panelStyle: React.CSSProperties = {
  background: 'rgba(250, 249, 247, 0.98)',
  border: '1px solid var(--cl-border)',
  borderRadius: 16,
  padding: 20,
  maxWidth: 440,
  width: 'min(440px, calc(100vw - 32px))',
  boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
  color: 'var(--cl-text-primary)',
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
  sections,
  metadata,
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
  /**
   * The entry saved, but its Google Doc did not update.
   *
   * NON-BLOCKING BY DESIGN: the save genuinely succeeded, so this is shown as a
   * closing notice rather than an error — but it IS shown, because a report that
   * never reached Google used to look exactly like one that did.
   */
  const docWarningsRef = useRef<string[]>([]);
  const [docWarning, setDocWarning] = useState<string | null>(null);
  /**
   * The entry saved AND its Google Doc updated — the link, so the coach can
   * open it right away instead of hunting for it later. The single combined
   * "Save & Export to Google Doc" action is silent otherwise: the modal would
   * just close, and a coach who wants to actually LOOK at the export has to
   * dig into the player's folder to find it.
   *
   * A REF, not state, for the same reason `docWarningsRef` is: `finishSave`
   * runs synchronously right after `noteDocStatus` sets this, in the same
   * call — reading a `useState` value there would still see last render's
   * value, since a setter's effect is never visible until the next render.
   */
  const docSuccessUrlRef = useRef<string | null>(null);
  const [docSuccessUrl, setDocSuccessUrl] = useState<string | null>(null);
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
    docWarningsRef.current = [];
    docSuccessUrlRef.current = null;
    setDocWarning(null);
    setDocSuccessUrl(null);
  }, [open, initialFolder, opponentNameHint]);

  /** Record the doc outcome reported by the entries route (see EntryDocStatus). */
  const noteDocStatus = useCallback((data: unknown) => {
    const d = (data as { doc?: { ok?: boolean; reason?: string; documentId?: string } } | null)?.doc;
    if (!d) return;
    if (d.ok === false && d.reason) docWarningsRef.current.push(d.reason);
    else if (d.ok === true && d.documentId) {
      docSuccessUrlRef.current = `https://docs.google.com/document/d/${d.documentId}/edit`;
    }
  }, []);

  /**
   * Close, unless there's something the coach should see first: a Docs
   * problem takes priority (it needs acknowledging), otherwise a successful
   * export shows its link before closing.
   */
  const finishSave = useCallback(() => {
    const uniqueWarnings = Array.from(new Set(docWarningsRef.current));
    if (uniqueWarnings.length) {
      setDocWarning(uniqueWarnings.join(' '));
      return;
    }
    if (docSuccessUrlRef.current) {
      setDocSuccessUrl(docSuccessUrlRef.current);
      return;
    }
    onClose();
  }, [onClose]);

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
            ...(sections?.length ? { sections } : {}),
            ...(metadata ? { metadata } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Save failed');
        noteDocStatus(data);

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

        finishSave();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setBusy(false);
      }
    },
    [
      bodyText,
      category,
      finishSave,
      matchDate,
      metadata,
      noteDocStatus,
      opponentName,
      players,
      selectedPlayer,
      sections,
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
            ...(sections?.length ? { sections } : {}),
            ...(metadata ? { metadata } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Save failed');
        noteDocStatus(data);
        setMirrorPrompt(null);
        setPendingPayload(null);
        finishSave();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setBusy(false);
      }
    },
    [category, finishSave, matchDate, metadata, noteDocStatus, pendingPayload, sections, source],
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
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--cl-text-secondary)', lineHeight: 1.45 }}>
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
              color: 'var(--cl-text-secondary)',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {docWarning ? (
          /* The entry SAVED. Only the Google Doc did not update — shown as a
             notice, never as a failure, so the coach knows the report is safe
             but not yet in Docs. */
          <div style={{ marginTop: 18 }}>
            <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.5, fontWeight: 600 }}>
              Saved to the player folder.
            </p>
            <p
              style={{
                margin: '0 0 14px',
                fontSize: 13,
                lineHeight: 1.5,
                color: '#8A6D00',
                background: 'rgba(255,196,0,0.12)',
                border: '1px solid rgba(255,196,0,0.45)',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              The Google Doc wasn&apos;t updated: {docWarning}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={btnPrimary}>
                Done
              </button>
            </div>
          </div>
        ) : docSuccessUrl ? (
          /* Saved AND the Doc updated — the point of the combined action. The
             link is shown rather than the modal just closing, so the coach can
             open the export immediately instead of hunting for it in the
             player's folder afterward. */
          <div style={{ marginTop: 18 }}>
            <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.5, fontWeight: 600 }}>
              Saved, and the report is in the player&apos;s Google Doc.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <a
                href={docSuccessUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}
              >
                Open Google Doc
              </a>
              <button type="button" onClick={onClose} style={btnGhost}>
                Done
              </button>
            </div>
          </div>
        ) : mirrorPrompt?.kind === 'mirror' ? (
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
                  finishSave();
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
                  finishSave();
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
                color: 'var(--cl-accent)',
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
              <span style={{ fontWeight: 400, color: 'var(--cl-text-muted)' }}>(optional, for cross-linking)</span>
              <input
                value={opponentName}
                onChange={(e) => setOpponentName(e.target.value)}
                placeholder="e.g. from the report"
                style={inputStyle}
              />
            </label>

            {youtubeUrl ? (
              <p style={{ fontSize: 12, color: 'var(--cl-text-secondary)', margin: '12px 0 0', wordBreak: 'break-all' }}>
                YouTube: {youtubeUrl}
              </p>
            ) : null}

            {err ? (
              <p style={{ color: 'var(--cl-destructive)', fontSize: 13, marginTop: 12 }}>{err}</p>
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
  border: '1px solid var(--cl-border)',
  padding: '10px 12px',
  fontSize: 14,
  background: 'var(--cl-bg-panel)',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--cl-action-primary)',
  color: 'var(--cl-text-on-fill)',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 14,
};

const btnGhost: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 10,
  border: '1px solid var(--cl-border)',
  background: 'var(--cl-bg-panel)',
  color: 'var(--cl-text-primary)',
  fontWeight: 500,
  cursor: 'pointer',
  fontSize: 14,
};
