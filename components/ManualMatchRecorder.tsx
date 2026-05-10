'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyPoint,
  emptyBoard,
  formatFullScore,
  formatGamePoints,
  type Side,
  type TennisBoard,
} from '@/lib/tennis/gameScore';
import type { LoggedPoint, ManualOutcome } from '@/lib/tennis/compileManualReport';
import { compileManualReport } from '@/lib/tennis/compileManualReport';
import SaveReportModal from '@/components/shared/SaveReportModal';
import { formatMatchFolderLabel, localDateTimeForFolder } from '@/lib/players/formatFolderLabel';

type DbPlayer = { id: string; display_name: string };

const STROKES = ['Forehand', 'Backhand', 'Volley', 'Smash', 'Drop Shot'] as const;

type Phase = 'setup' | 'record' | 'summary';

export default function ManualMatchRecorder() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [players, setPlayers] = useState<DbPlayer[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [opponentName, setOpponentName] = useState('');
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [board, setBoard] = useState<TennisBoard>(() => emptyBoard());
  const [points, setPoints] = useState<LoggedPoint[]>([]);

  const [pickWinner, setPickWinner] = useState<Side | null>(null);
  const [branch, setBranch] = useState<null | 'serve' | 'ue' | 'win'>(null);

  const [gameNoteOpen, setGameNoteOpen] = useState(false);
  const [gameNoteDraft, setGameNoteDraft] = useState('');
  const [gameNotes, setGameNotes] = useState<string[]>([]);

  const [saveOpen, setSaveOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => setPlayers(d.players ?? []))
      .catch(() => {});
  }, []);

  const reportText = useMemo(
    () => compileManualReport(playerName.trim() || 'Player', opponentName.trim() || 'Opponent', points, board),
    [playerName, opponentName, points, board],
  );

  const folderLabelDefault = useMemo(() => {
    const d = matchDate.trim().slice(0, 10);
    const a = playerName.trim() || 'Player';
    const b = opponentName.trim() || 'Opponent';
    return `${formatMatchFolderLabel(d, a, b)} — ${localDateTimeForFolder()}`;
  }, [matchDate, playerName, opponentName]);

  const scoreDisplay = useMemo(
    () =>
      formatFullScore(board, {
        player: playerName.trim() || 'You',
        opponent: opponentName.trim() || 'Opponent',
      }),
    [board, playerName, opponentName],
  );

  const resetMenus = useCallback(() => {
    setPickWinner(null);
    setBranch(null);
  }, []);

  const pushPoint = useCallback(
    (winner: Side, outcome: ManualOutcome) => {
      setBoard((prevBoard) => {
        const snapshotBefore = `${prevBoard.sets.map((s) => s.join('-')).join('|')}:${prevBoard.games.join('-')}:${prevBoard.ip}:${prevBoard.io}`;
        const nextBoard = applyPoint(prevBoard, winner);
        const snapshotAfter = `${nextBoard.sets.map((s) => s.join('-')).join('|')}:${nextBoard.games.join('-')}:${nextBoard.ip}:${nextBoard.io}`;
        const gameEnded = snapshotBefore !== snapshotAfter && nextBoard.ip === 0 && nextBoard.io === 0;

        setPoints((p) => [...p, { winner, outcome }]);
        if (gameEnded) setGameNoteOpen(true);
        return nextBoard;
      });
      resetMenus();
    },
    [resetMenus],
  );

  const onPickWinner = useCallback((side: Side) => {
    setPickWinner(side);
    setBranch(null);
  }, []);

  const handleServeAceOrDf = useCallback(
    (detail: 'double_fault' | 'ace') => {
      if (!pickWinner) return;
      pushPoint(pickWinner, { kind: 'serve', detail });
    },
    [pickWinner, pushPoint],
  );

  const handleStroke = useCallback(
    (kind: 'ue' | 'winner', stroke: string) => {
      if (!pickWinner) return;
      pushPoint(pickWinner, { kind: kind, stroke });
    },
    [pickWinner, pushPoint],
  );

  const startRecording = useCallback(() => {
    if (!playerName.trim() || !opponentName.trim()) return;
    setBoard(emptyBoard());
    setPoints([]);
    setGameNotes([]);
    setPhase('record');
    resetMenus();
  }, [opponentName, playerName, resetMenus]);

  const surface: CSSProperties = {
    background: 'rgba(250, 249, 247, 0.96)',
    border: '1px solid #E5E5E5',
    borderRadius: 16,
    padding: 18,
    color: '#1A1A1A',
  };

  const bigBtn: CSSProperties = {
    minHeight: 56,
    borderRadius: 14,
    border: '1px solid #E5E5E5',
    fontSize: 17,
    fontWeight: 700,
    cursor: 'pointer',
    flex: '1 1 140px',
  };

  if (phase === 'setup') {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.55, color: 'rgba(255,255,255,0.82)' }}>
          Log points live with large tap targets. Score updates automatically (games, sets, deuce, advantage).
        </p>
        <div style={surface}>
          <label style={lb}>Your player name</label>
          <input
            list="player-pick"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            style={inp}
            placeholder="Name or pick from list"
          />
          <datalist id="player-pick">
            {players.map((p) => (
              <option key={p.id} value={p.display_name} />
            ))}
          </datalist>

          <label style={lb}>Opponent</label>
          <input
            list="opp-pick"
            value={opponentName}
            onChange={(e) => setOpponentName(e.target.value)}
            style={inp}
            placeholder="Name or pick from list"
          />
          <datalist id="opp-pick">
            {players.map((p) => (
              <option key={p.id} value={p.display_name} />
            ))}
          </datalist>

          <label style={lb}>Match date</label>
          <input type="date" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} style={inp} />

          <button
            type="button"
            onClick={startRecording}
            disabled={!playerName.trim() || !opponentName.trim()}
            style={{ ...bigBtn, width: '100%', marginTop: 18, background: '#1A1A1A', color: '#fff', border: 'none' }}
          >
            Start match
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'summary') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: '0 0 12px' }}>Match summary</h2>
        <div style={{ ...surface, maxHeight: 'min(50vh, 400px)', overflow: 'auto', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {reportText}
        </div>
        {gameNotes.length > 0 ? (
          <div style={{ ...surface, marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>End-of-game notes</div>
            {gameNotes.map((n, i) => (
              <p key={i} style={{ margin: '0 0 6px', fontSize: 13 }}>
                {i + 1}. {n}
              </p>
            ))}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            style={{ ...bigBtn, background: '#1A1A1A', color: '#fff', border: 'none' }}
          >
            Save to player folder
          </button>
          <button
            type="button"
            disabled={exportBusy}
            onClick={async () => {
              setExportBusy(true);
              try {
                const res = await fetch('/api/google/create-document', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title: `Manual match — ${playerName} vs ${opponentName}`,
                    body: gameNotes.length
                      ? `${reportText}\n\nEND OF GAME NOTES\n${gameNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
                      : reportText,
                  }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? 'Export failed');
                if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer');
              } catch {
                alert('Could not create Google Doc — check Drive/Docs scope on login.');
              } finally {
                setExportBusy(false);
              }
            }}
            style={{ ...bigBtn, background: '#fff' }}
          >
            {exportBusy ? 'Creating…' : 'Export to Google Doc'}
          </button>
          <button type="button" onClick={() => setPhase('setup')} style={{ ...bigBtn, background: '#fff' }}>
            New match
          </button>
        </div>

        <SaveReportModal
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          folderLabel={folderLabelDefault}
          bodyText={
            gameNotes.length
              ? `${reportText}\n\nEND OF GAME NOTES\n${gameNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
              : reportText
          }
          primaryPlayerName={playerName.trim()}
          opponentNameHint={opponentName.trim()}
          matchDate={matchDate}
          source="manual_recorder"
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => {
            if (confirm('Leave recording? Point log will be cleared.')) {
              setPhase('setup');
              resetMenus();
            }
          }}
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'transparent',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Exit
        </button>
        <button
          type="button"
          onClick={() => setPhase('summary')}
          style={{
            padding: '8px 14px',
            borderRadius: 10,
            border: 'none',
            background: '#35679A',
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          End match
        </button>
      </div>

      <div style={{ ...surface, marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: '#6e6e73', marginBottom: 6 }}>Score</div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>{scoreDisplay}</div>
        <div style={{ fontSize: 13, marginTop: 6, color: '#6e6e73' }}>
          Game points: {formatGamePoints(board.ip, board.io)} · Points logged: {points.length}
        </div>
      </div>

      {!pickWinner ? (
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" style={{ ...bigBtn, background: '#35679A', color: '#fff', border: 'none' }} onClick={() => onPickWinner('player')}>
            Point → {playerName.trim() || 'Player'}
          </button>
          <button type="button" style={{ ...bigBtn, background: '#57534e', color: '#fff', border: 'none' }} onClick={() => onPickWinner('opponent')}>
            Point → {opponentName.trim() || 'Opponent'}
          </button>
        </div>
      ) : !branch ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Outcome for {pickWinner === 'player' ? playerName : opponentName}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={{ ...bigBtn, background: '#fff' }} onClick={() => setBranch('serve')}>
              1) Serve
            </button>
            <button type="button" style={{ ...bigBtn, background: '#fff' }} onClick={() => setBranch('ue')}>
              2) Unforced Error
            </button>
            <button type="button" style={{ ...bigBtn, background: '#fff' }} onClick={() => setBranch('win')}>
              3) Winner / Induced
            </button>
          </div>
          <button type="button" onClick={resetMenus} style={{ border: 'none', background: 'transparent', color: '#8e8e93', cursor: 'pointer' }}>
            Back
          </button>
        </div>
      ) : branch === 'serve' ? (
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" style={{ ...bigBtn, background: '#fef2f2', borderColor: '#fecaca' }} onClick={() => handleServeAceOrDf('double_fault')}>
            Double fault
          </button>
          <button type="button" style={{ ...bigBtn, background: '#ecfccb', borderColor: '#d9f99d' }} onClick={() => handleServeAceOrDf('ace')}>
            Ace
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {STROKES.map((s) => (
            <button
              key={s}
              type="button"
              style={{ ...bigBtn, minHeight: 48, fontSize: 15, background: '#fff', flex: '1 1 45%' }}
              onClick={() => handleStroke(branch === 'ue' ? 'ue' : 'winner', s)}
            >
              {s}
            </button>
          ))}
          <button type="button" onClick={() => setBranch(null)} style={{ width: '100%', border: 'none', background: 'transparent', color: '#8e8e93' }}>
            Back
          </button>
        </div>
      )}

      {gameNoteOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div style={{ ...surface, maxWidth: 400, width: '100%' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Game break — quick note (optional)</div>
            <textarea
              value={gameNoteDraft}
              onChange={(e) => setGameNoteDraft(e.target.value)}
              rows={3}
              style={{ ...inp, width: '100%', resize: 'vertical' }}
              placeholder="What stood out this game?"
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={{ ...bigBtn, minHeight: 44, flex: 'none', padding: '0 16px' }}
                onClick={() => {
                  setGameNoteDraft('');
                  setGameNoteOpen(false);
                }}
              >
                Skip
              </button>
              <button
                type="button"
                style={{ ...bigBtn, minHeight: 44, flex: 'none', padding: '0 16px', background: '#1A1A1A', color: '#fff', border: 'none' }}
                onClick={() => {
                  const note = gameNoteDraft.trim();
                  if (note) setGameNotes((n) => [...n, note]);
                  setGameNoteDraft('');
                  setGameNoteOpen(false);
                }}
              >
                Save note
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const lb: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, marginTop: 12 };
const inp: CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid #E5E5E5',
  padding: '10px 12px',
  fontSize: 15,
  boxSizing: 'border-box',
};
