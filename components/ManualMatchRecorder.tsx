'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Side } from '@/lib/tennis/gameScore';
import type { ManualOutcome } from '@/lib/tennis/compileManualReport';
import { compileManualReport } from '@/lib/tennis/compileManualReport';
import SaveReportModal from '@/components/shared/SaveReportModal';
import { formatMatchFolderLabel, localDateTimeForFolder } from '@/lib/players/formatFolderLabel';
import {
  applyFormattedPoint,
  defaultMatchFormat,
  emptyFormattedBoard,
  formatFormattedScoreLine,
  type FormattedBoard,
  type MatchFormatConfig,
} from '@/lib/tennis/matchFormat';

type Phase = 'setup' | 'record' | 'summary';

const STROKES = ['Forehand', 'Backhand', 'Volley', 'Smash', 'Drop Shot'] as const;

const btnLight: CSSProperties = {
  minHeight: 52,
  borderRadius: 14,
  border: '2px solid #1a1a1a',
  background: '#ffffff',
  color: '#111111',
  fontWeight: 800,
  fontSize: 16,
  cursor: 'pointer',
  flex: '1 1 140px',
};

export default function ManualMatchRecorder() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [players, setPlayers] = useState<Array<{ id: string; display_name: string }>>([]);
  const [playerName, setPlayerName] = useState('');
  const [opponentName, setOpponentName] = useState('');
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [format, setFormat] = useState<MatchFormatConfig>(() => defaultMatchFormat());

  const [board, setBoard] = useState<FormattedBoard>(() => emptyFormattedBoard());
  const [points, setPoints] = useState<Array<{ winner: Side; outcome: ManualOutcome; killer?: boolean }>>([]);

  const [pickWinner, setPickWinner] = useState<Side | null>(null);
  /** serve | ue | win — outcome category */
  const [cat, setCat] = useState<null | 'serve' | 'ue' | 'win'>(null);
  /** After category chosen: for serve — df/ace; for ue/win — stroke string before confirm */
  const [pendingOutcome, setPendingOutcome] = useState<ManualOutcome | null>(null);
  const [killerFlag, setKillerFlag] = useState(false);

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

  const scoreLine = useMemo(
    () =>
      formatFormattedScoreLine(board, format, {
        player: playerName.trim() || 'Player',
        opponent: opponentName.trim() || 'Opponent',
      }),
    [board, format, playerName, opponentName],
  );

  const reportText = useMemo(
    () => compileManualReport(playerName.trim() || 'Player', opponentName.trim() || 'Opponent', points),
    [playerName, opponentName, points],
  );

  const folderLabelDefault = useMemo(() => {
    const d = matchDate.trim().slice(0, 10);
    const a = playerName.trim() || 'Player';
    const b = opponentName.trim() || 'Opponent';
    return `${formatMatchFolderLabel(d, a, b)} — ${localDateTimeForFolder()}`;
  }, [matchDate, playerName, opponentName]);

  const resetMenus = useCallback(() => {
    setPickWinner(null);
    setCat(null);
    setPendingOutcome(null);
    setKillerFlag(false);
  }, []);

  const commitPoint = useCallback(
    (winner: Side, outcome: ManualOutcome) => {
      const snap = { games: [...board.games] as [number, number], phase: board.phase };
      const nb = applyFormattedPoint(board, winner, format);
      const gameEndedRegular =
        snap.phase === 'regular' &&
        nb.phase === 'regular' &&
        (snap.games[0] !== nb.games[0] || snap.games[1] !== nb.games[1]);
      setBoard(nb);
      setPoints((p) => [...p, { winner, outcome, killer: killerFlag }]);
      resetMenus();
      if (gameEndedRegular) {
        setGameNoteDraft('');
        setGameNoteOpen(true);
      }
    },
    [board, format, killerFlag, resetMenus],
  );

  const surface: CSSProperties = {
    background: '#faf9f7',
    border: '2px solid #1a1a1a',
    borderRadius: 16,
    padding: 16,
    color: '#111',
  };

  if (phase === 'setup') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.55, color: 'rgba(255,255,255,0.88)' }}>
          Configure the match, then record points. Tap who won the point, pick the outcome, optionally mark a killer point,
          then confirm with <strong>Add point</strong>.
        </p>
        <div style={surface}>
          <label style={lb}>Your player</label>
          <input list="player-pick" value={playerName} onChange={(e) => setPlayerName(e.target.value)} style={inp} />
          <datalist id="player-pick">
            {players.map((p) => (
              <option key={p.id} value={p.display_name} />
            ))}
          </datalist>
          <label style={lb}>Opponent</label>
          <input list="opp-pick" value={opponentName} onChange={(e) => setOpponentName(e.target.value)} style={inp} />
          <datalist id="opp-pick">
            {players.map((p) => (
              <option key={p.id} value={p.display_name} />
            ))}
          </datalist>
          <label style={lb}>Match date</label>
          <input type="date" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} style={inp} />

          <div style={{ marginTop: 16, fontWeight: 800, fontSize: 13 }}>Match format</div>
          <label style={lb}>Sets</label>
          <select
            value={format.bestOf}
            onChange={(e) => setFormat((f) => ({ ...f, bestOf: Number(e.target.value) as 1 | 3 | 5 }))}
            style={inp}
          >
            <option value={1}>Best of 1</option>
            <option value={3}>Best of 3</option>
            <option value={5}>Best of 5</option>
          </select>
          <label style={lb}>Games per set</label>
          <select
            value={format.gamesPerSet}
            onChange={(e) => setFormat((f) => ({ ...f, gamesPerSet: Number(e.target.value) as 6 | 4 }))}
            style={inp}
          >
            <option value={6}>Standard (6 games)</option>
            <option value={4}>Short set (4 games)</option>
          </select>
          <label style={lb}>Tiebreak at deadlock (6-6 or 4-4)</label>
          <select
            value={format.tiebreakAtDeadlock ? 'yes' : 'no'}
            onChange={(e) => setFormat((f) => ({ ...f, tiebreakAtDeadlock: e.target.value === 'yes' }))}
            style={inp}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
          <label style={lb}>Tiebreak format</label>
          <select
            value={format.tiebreakTarget}
            onChange={(e) => setFormat((f) => ({ ...f, tiebreakTarget: Number(e.target.value) as 7 | 10 }))}
            style={inp}
          >
            <option value={7}>First to 7 (win by 2)</option>
            <option value={10}>Match tiebreak — first to 10 (win by 2)</option>
          </select>
          <label style={lb}>Final set</label>
          <select
            value={format.finalSetRule}
            onChange={(e) =>
              setFormat((f) => ({
                ...f,
                finalSetRule: e.target.value as MatchFormatConfig['finalSetRule'],
              }))
            }
            style={inp}
          >
            <option value="standard">Final set tiebreak (same as above)</option>
            <option value="no_tb">No tiebreak in final set</option>
            <option value="super_tb">Super tiebreak (10 pts) in deciding set</option>
          </select>
          <label style={lb}>Ad scoring</label>
          <select
            value={format.noAd ? 'noad' : 'ad'}
            onChange={(e) => setFormat((f) => ({ ...f, noAd: e.target.value === 'noad' }))}
            style={inp}
          >
            <option value="ad">Ad (deuce / advantage)</option>
            <option value="noad">No-Ad (sudden death at deuce)</option>
          </select>

          <button
            type="button"
            disabled={!playerName.trim() || !opponentName.trim()}
            onClick={() => {
              setBoard(emptyFormattedBoard());
              setPoints([]);
              setGameNotes([]);
              setPhase('record');
              resetMenus();
            }}
            style={{ ...btnLight, width: '100%', marginTop: 18, background: '#111', color: '#fff', borderColor: '#111' }}
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
        <div
          style={{
            ...surface,
            maxHeight: 'min(50vh, 420px)',
            overflow: 'auto',
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            background: '#fff',
          }}
        >
          {reportText}
        </div>
        {gameNotes.length > 0 ? (
          <div style={{ ...surface, marginTop: 12, background: '#fff' }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>End-of-game notes</div>
            {gameNotes.map((n, i) => (
              <p key={i} style={{ margin: '0 0 6px', fontSize: 14 }}>
                {i + 1}. {n}
              </p>
            ))}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            style={{ ...btnLight, background: '#111', color: '#fff', borderColor: '#111' }}
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
                alert('Could not create Google Doc.');
              } finally {
                setExportBusy(false);
              }
            }}
            style={{ ...btnLight, background: '#fff' }}
          >
            {exportBusy ? 'Creating…' : 'Export to Google Doc'}
          </button>
          <button type="button" onClick={() => setPhase('setup')} style={{ ...btnLight, background: '#fff' }}>
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

  const confirmPanel =
    pendingOutcome && pickWinner ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 15, color: '#fff' }}>
          <input type="checkbox" checked={killerFlag} onChange={(e) => setKillerFlag(e.target.checked)} />
          Killer point (decisive moment)
        </label>
        <button
          type="button"
          style={{ ...btnLight, width: '100%', background: '#111', color: '#fff', borderColor: '#111', minHeight: 56 }}
          onClick={() => {
            if (!pickWinner || !pendingOutcome) return;
            commitPoint(pickWinner, pendingOutcome);
          }}
        >
          Add point — confirm
        </button>
        <button
          type="button"
          onClick={() => {
            setPendingOutcome(null);
            setKillerFlag(false);
          }}
          style={{ border: 'none', background: 'transparent', color: '#d6d3d1', cursor: 'pointer', fontWeight: 600 }}
        >
          Back
        </button>
      </div>
    ) : null;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          marginBottom: 12,
          padding: '12px 14px',
          borderRadius: 14,
          background: '#ffffff',
          border: '2px solid #111',
          color: '#111',
          fontWeight: 800,
          fontSize: 14,
          lineHeight: 1.35,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.55, marginBottom: 4 }}>CURRENT SCORE</div>
        {scoreLine}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => {
            if (confirm('Leave recording? Progress will be cleared.')) {
              setPhase('setup');
              resetMenus();
            }
          }}
          style={{ ...btnLight, flex: 'none', minHeight: 44, padding: '0 14px', fontSize: 14 }}
        >
          Exit
        </button>
        <button
          type="button"
          onClick={() => setPhase('summary')}
          style={{
            ...btnLight,
            flex: 'none',
            minHeight: 44,
            padding: '0 14px',
            fontSize: 14,
            background: '#007AFF',
            color: '#fff',
            borderColor: '#007AFF',
          }}
        >
          End match
        </button>
      </div>

      {!pendingOutcome && (
        <>
          {!pickWinner ? (
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" style={{ ...btnLight, background: '#fff' }} onClick={() => setPickWinner('player')}>
                Point → {playerName.trim() || 'Player'}
              </button>
              <button type="button" style={{ ...btnLight, background: '#fff' }} onClick={() => setPickWinner('opponent')}>
                Point → {opponentName.trim() || 'Opponent'}
              </button>
            </div>
          ) : !cat ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>Outcome</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button type="button" style={{ ...btnLight, minHeight: 48 }} onClick={() => setCat('serve')}>
                  1) Serve
                </button>
                <button type="button" style={{ ...btnLight, minHeight: 48 }} onClick={() => setCat('ue')}>
                  2) Unforced Error
                </button>
                <button type="button" style={{ ...btnLight, minHeight: 48 }} onClick={() => setCat('win')}>
                  3) Winner / Induced
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPickWinner(null)}
                style={{ border: 'none', background: 'transparent', color: '#d6d3d1', cursor: 'pointer', fontWeight: 600 }}
              >
                Back
              </button>
            </div>
          ) : cat === 'serve' ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ ...btnLight }}
                onClick={() => setPendingOutcome({ kind: 'serve', detail: 'double_fault' })}
              >
                Double fault
              </button>
              <button
                type="button"
                style={{ ...btnLight }}
                onClick={() => setPendingOutcome({ kind: 'serve', detail: 'ace' })}
              >
                Ace
              </button>
              <button
                type="button"
                onClick={() => setCat(null)}
                style={{ width: '100%', border: 'none', background: 'transparent', color: '#d6d3d1', cursor: 'pointer' }}
              >
                Back
              </button>
            </div>
          ) : cat === 'ue' || cat === 'win' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STROKES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    style={{ ...btnLight, minHeight: 48, flex: '1 1 45%' }}
                    onClick={() =>
                      setPendingOutcome(cat === 'ue' ? { kind: 'ue', stroke: s } : { kind: 'winner', stroke: s })
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setCat(null)}
                style={{ border: 'none', background: 'transparent', color: '#d6d3d1', cursor: 'pointer', fontWeight: 600 }}
              >
                Back
              </button>
            </div>
          ) : null}
        </>
      )}

      {confirmPanel}

      {gameNoteOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div style={{ ...surface, maxWidth: 400, width: '100%', background: '#fff' }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Game break — note (optional)</div>
            <textarea
              value={gameNoteDraft}
              onChange={(e) => setGameNoteDraft(e.target.value)}
              rows={3}
              style={{ ...inp, width: '100%', resize: 'vertical' }}
              placeholder="Quick observation about this game…"
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={{ ...btnLight, flex: 'none', minHeight: 44, padding: '0 16px' }}
                onClick={() => {
                  setGameNoteDraft('');
                  setGameNoteOpen(false);
                }}
              >
                Skip
              </button>
              <button
                type="button"
                style={{
                  ...btnLight,
                  flex: 'none',
                  minHeight: 44,
                  padding: '0 16px',
                  background: '#111',
                  color: '#fff',
                  borderColor: '#111',
                }}
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

const lb: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6, marginTop: 12 };
const inp: CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '2px solid #111',
  padding: '10px 12px',
  fontSize: 15,
  boxSizing: 'border-box',
  background: '#fff',
  color: '#111',
};
