'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Side } from '@/lib/tennis/gameScore';
import type { BallType, FinishReason, ManualOutcome } from '@/lib/tennis/compileManualReport';
import {
  BALL_TYPES,
  compileManualReport,
  isErrorOutcome,
  SERVE_OUTCOMES,
  STROKES,
} from '@/lib/tennis/compileManualReport';
import SaveReportModal from '@/components/shared/SaveReportModal';
import MatchReportView from '@/components/decoder/MatchReportView';
import { buildManualReport } from '@/lib/tennis/manualReportModel';
import {
  buildDocsSections,
  uploadReportCharts,
  type DocsSectionPayload,
} from '@/lib/matchAnalysis/exportToDocs';
import { formatMatchFolderLabel, localDateTimeForFolder } from '@/lib/players/formatFolderLabel';
import { ENABLE_GOOGLE_EXPORTS } from '@/lib/featureFlags';
import {
  applyFormattedPoint,
  defaultMatchFormat,
  emptyFormattedBoard,
  formatFormattedScoreLine,
  isMatchOver,
  type FormattedBoard,
  type MatchFormatConfig,
} from '@/lib/tennis/matchFormat';
import {
  currentServer,
  serveOrigin,
  type ServeOrigin,
} from '@/lib/tennis/serving';
import {
  defaultStartingScore,
  describeStartingScore,
  POINT_LABELS,
  seedBoardFromScore,
  type PointLabel,
  type StartingScore,
} from '@/lib/tennis/startingScore';

type Phase = 'setup' | 'record' | 'summary';

/** Outcome categories, data-driven so adding one is a list entry (FEATURES B/C/D). */
const OUTCOME_CATS = [
  { key: 'serve', label: 'Serve / Return' },
  { key: 'ue', label: 'Unforced Error' },
  { key: 'forced', label: 'Induced / Forced Error' },
  { key: 'win', label: 'Winner' },
] as const;
type OutcomeCat = (typeof OUTCOME_CATS)[number]['key'];

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
  const [points, setPoints] = useState<
    Array<{ winner: Side; outcome: ManualOutcome; killer?: boolean; server?: Side }>
  >([]);

  /** FEATURE A — the origin the serve rotation is derived from. */
  const [origin, setOrigin] = useState<ServeOrigin>(() => serveOrigin('player', 0));
  /** FEATURE E — optional score to begin from. */
  const [startingScore, setStartingScore] = useState<StartingScore>(() => defaultStartingScore());
  const [seedError, setSeedError] = useState<string | null>(null);
  /** FEATURE F — how the match ended, which changes the report's wording. */
  const [finishReason, setFinishReason] = useState<FinishReason>('in_progress');

  const [pickWinner, setPickWinner] = useState<Side | null>(null);
  const [cat, setCat] = useState<OutcomeCat | null>(null);
  /** After category chosen: for serve — the detail; for the rest — stroke, before confirm */
  const [pendingOutcome, setPendingOutcome] = useState<ManualOutcome | null>(null);
  /**
   * FEATURE C — the ball-type step is answered (or deliberately skipped).
   * Tracked separately from `ballType` being set so "not sure" can move on
   * without inventing a value.
   */
  const [ballStepDone, setBallStepDone] = useState(false);
  const [killerFlag, setKillerFlag] = useState(false);

  const [gameNoteOpen, setGameNoteOpen] = useState(false);
  const [gameNoteDraft, setGameNoteDraft] = useState('');
  const [gameNotes, setGameNotes] = useState<string[]>([]);

  const [saveOpen, setSaveOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  /** Docs payload built from the charts — see openSaveModal. */
  const [saveSections, setSaveSections] = useState<DocsSectionPayload[] | undefined>(undefined);
  const [preparingSave, setPreparingSave] = useState(false);

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

  /** FEATURE A — who is serving the game in progress, derived from the score. */
  const servingNow = useMemo(() => currentServer(origin, board), [origin, board]);
  /** FEATURE F — did the score itself finish the match? */
  const matchComplete = useMemo(() => isMatchOver(board, format), [board, format]);

  const startingScoreNote = useMemo(
    () =>
      describeStartingScore(startingScore, {
        player: playerName.trim() || 'Player',
        opponent: opponentName.trim() || 'Opponent',
      }),
    [startingScore, playerName, opponentName],
  );

  const reportText = useMemo(
    () =>
      compileManualReport(
        playerName.trim() || 'Player',
        opponentName.trim() || 'Opponent',
        points,
        { board, startingScoreNote, finish: finishReason },
      ),
    [playerName, opponentName, points, board, startingScoreNote, finishReason],
  );

  /**
   * The structured report — the same `SideReport[]` the decoder produces, so it
   * renders through MatchReportView and exports through buildDocsSections
   * without a parallel implementation.
   */
  const reports = useMemo(
    () =>
      buildManualReport({
        playerName: playerName.trim() || 'Player',
        opponentName: opponentName.trim() || 'Opponent',
        points,
        board,
        startingScoreNote,
        finish: finishReason,
        gameNotes,
      }),
    [playerName, opponentName, points, board, startingScoreNote, finishReason, gameNotes],
  );

  const folderLabelDefault = useMemo(() => {
    const d = matchDate.trim().slice(0, 10);
    const a = playerName.trim() || 'Player';
    const b = opponentName.trim() || 'Opponent';
    return `${formatMatchFolderLabel(d, a, b)} — ${localDateTimeForFolder()}`;
  }, [matchDate, playerName, opponentName]);

  /**
   * Rasterise + upload the charts, then open the save modal with a structured
   * Docs payload. Without this the entry saves as one undifferentiated block of
   * text; with it, the manual match lands in Google Docs looking like the
   * decoder's report.
   *
   * A chart-upload failure is NOT fatal: the modal still opens, and the save
   * falls back to the plain-text body.
   */
  const openSaveModal = useCallback(async () => {
    setPreparingSave(true);
    try {
      const chartUrls = await uploadReportCharts(reports);
      setSaveSections(buildDocsSections(reports, chartUrls, 'both'));
    } catch {
      setSaveSections(undefined);
    } finally {
      setPreparingSave(false);
      setSaveOpen(true);
    }
  }, [reports]);

  const resetMenus = useCallback(() => {
    setPickWinner(null);
    setCat(null);
    setPendingOutcome(null);
    setBallStepDone(false);
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
      // FEATURE A — stamp the server derived from the board BEFORE the point was
      // applied, so the point records who actually served it.
      setPoints((p) => [...p, { winner, outcome, killer: killerFlag, server: currentServer(origin, board) }]);
      resetMenus();
      if (gameEndedRegular) {
        setGameNoteDraft('');
        setGameNoteOpen(true);
      }
    },
    [board, format, killerFlag, origin, resetMenus],
  );

  /**
   * FEATURE F — leave the recorder with whatever has been logged.
   *
   * A match that ran out of score is `completed`; one the coach stopped is
   * `stopped_early`, and the report says which so a partial log is never
   * presented as a final result.
   */
  const finishMatch = useCallback(() => {
    setFinishReason(matchComplete ? 'completed' : 'stopped_early');
    setPhase('summary');
    resetMenus();
  }, [matchComplete, resetMenus]);

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

          <div style={{ marginTop: 16, fontWeight: 800, fontSize: 13, marginBottom: 10 }}>Match format</div>

          {/* ── Quick-select preset cards ── */}
          {([
            { label: '1 Set', sub: '6 games · TB to 7', cfg: { bestOf: 1, gamesPerSet: 6, tiebreakAtDeadlock: true, tiebreakTarget: 7, finalSetRule: 'standard', noAd: false } },
            { label: '1 Set No-Ad', sub: '6 games · TB to 7 · no deuce', cfg: { bestOf: 1, gamesPerSet: 6, tiebreakAtDeadlock: true, tiebreakTarget: 7, finalSetRule: 'standard', noAd: true } },
            { label: '2 Sets + Supertiebreak', sub: 'Best of 3 · 3rd set = 10-pt TB', cfg: { bestOf: 3, gamesPerSet: 6, tiebreakAtDeadlock: true, tiebreakTarget: 7, finalSetRule: 'super_tb', noAd: false } },
            { label: 'Best of 3', sub: '6 games · TB to 7', cfg: { bestOf: 3, gamesPerSet: 6, tiebreakAtDeadlock: true, tiebreakTarget: 7, finalSetRule: 'standard', noAd: false } },
            { label: 'Best of 3 No-Ad', sub: '6 games · TB to 7 · no deuce', cfg: { bestOf: 3, gamesPerSet: 6, tiebreakAtDeadlock: true, tiebreakTarget: 7, finalSetRule: 'standard', noAd: true } },
            { label: 'Best of 5', sub: '6 games · TB to 7 · final set advantage', cfg: { bestOf: 5, gamesPerSet: 6, tiebreakAtDeadlock: true, tiebreakTarget: 7, finalSetRule: 'no_tb', noAd: false } },
            { label: 'Pro Set (8 games)', sub: 'First to 8 · TB to 7 at 8-8', cfg: { bestOf: 1, gamesPerSet: 4, tiebreakAtDeadlock: true, tiebreakTarget: 7, finalSetRule: 'standard', noAd: false } },
            { label: 'Short Set (4 games)', sub: '4 games · TB to 7', cfg: { bestOf: 1, gamesPerSet: 4, tiebreakAtDeadlock: true, tiebreakTarget: 7, finalSetRule: 'standard', noAd: false } },
            { label: 'Match Tiebreak Only', sub: 'Single supertiebreak to 10', cfg: { bestOf: 1, gamesPerSet: 6, tiebreakAtDeadlock: true, tiebreakTarget: 10, finalSetRule: 'super_tb', noAd: false } },
          ] as { label: string; sub: string; cfg: MatchFormatConfig }[]).map((preset) => {
            const isActive = JSON.stringify(format) === JSON.stringify(preset.cfg);
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => setFormat(preset.cfg)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  width: '100%', padding: '10px 12px', marginBottom: 6,
                  borderRadius: 10,
                  border: isActive ? '2px solid #007AFF' : '1.5px solid #ccc',
                  background: isActive ? 'rgba(0,122,255,0.08)' : '#fff',
                  color: '#111', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 14, color: isActive ? '#007AFF' : '#111' }}>{preset.label}</span>
                <span style={{ fontSize: 12, color: '#666', marginTop: 1 }}>{preset.sub}</span>
              </button>
            );
          })}

          {/* ── Advanced toggles ── */}
          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 12, color: '#666', cursor: 'pointer', userSelect: 'none', marginBottom: 8 }}>
              Advanced customisation
            </summary>
            <label style={lb}>Sets</label>
            <select value={format.bestOf} onChange={(e) => setFormat((f) => ({ ...f, bestOf: Number(e.target.value) as 1 | 3 | 5 }))} style={inp}>
              <option value={1}>Best of 1</option>
              <option value={3}>Best of 3</option>
              <option value={5}>Best of 5</option>
            </select>
            <label style={lb}>Games per set</label>
            <select value={format.gamesPerSet} onChange={(e) => setFormat((f) => ({ ...f, gamesPerSet: Number(e.target.value) as 6 | 4 }))} style={inp}>
              <option value={6}>Standard (6 games)</option>
              <option value={4}>Short set (4 games)</option>
            </select>
            <label style={lb}>Tiebreak at deadlock</label>
            <select value={format.tiebreakAtDeadlock ? 'yes' : 'no'} onChange={(e) => setFormat((f) => ({ ...f, tiebreakAtDeadlock: e.target.value === 'yes' }))} style={inp}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
            <label style={lb}>Tiebreak target</label>
            <select value={format.tiebreakTarget} onChange={(e) => setFormat((f) => ({ ...f, tiebreakTarget: Number(e.target.value) as 7 | 10 }))} style={inp}>
              <option value={7}>First to 7 (win by 2)</option>
              <option value={10}>Match tiebreak — first to 10 (win by 2)</option>
            </select>
            <label style={lb}>Final set rule</label>
            <select value={format.finalSetRule} onChange={(e) => setFormat((f) => ({ ...f, finalSetRule: e.target.value as MatchFormatConfig['finalSetRule'] }))} style={inp}>
              <option value="standard">Tiebreak (same as above)</option>
              <option value="no_tb">Advantage set (no tiebreak)</option>
              <option value="super_tb">Super tiebreak to 10</option>
            </select>
            <label style={lb}>Ad scoring</label>
            <select value={format.noAd ? 'noad' : 'ad'} onChange={(e) => setFormat((f) => ({ ...f, noAd: e.target.value === 'noad' }))} style={inp}>
              <option value="ad">Ad (deuce / advantage)</option>
              <option value="noad">No-Ad (sudden death at deuce)</option>
            </select>
          </details>

          {/* ── FEATURE A — who serves first (alternates by game from here) ── */}
          <div style={{ marginTop: 18, fontWeight: 800, fontSize: 13, marginBottom: 8 }}>Who serves first?</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['player', 'opponent'] as Side[]).map((s) => {
              const active = startingScore.server === s;
              const label = s === 'player' ? playerName.trim() || 'Player' : opponentName.trim() || 'Opponent';
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStartingScore((v) => ({ ...v, server: s }))}
                  style={{
                    ...btnLight,
                    minHeight: 44,
                    fontSize: 14,
                    border: active ? '2px solid #007AFF' : '2px solid #1a1a1a',
                    background: active ? 'rgba(0,122,255,0.08)' : '#fff',
                    color: active ? '#007AFF' : '#111',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 12, color: '#666', margin: '8px 0 0' }}>
            The serve then alternates every game automatically — you never pick it again.
          </p>

          {/* ── FEATURE E — optionally begin from a score already in progress ── */}
          <details style={{ marginTop: 16 }}>
            <summary style={{ fontSize: 12, color: '#666', cursor: 'pointer', userSelect: 'none', marginBottom: 8 }}>
              Start from an existing score (optional)
            </summary>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 10px' }}>
              Pick up a match already under way. Stats will only cover the points you log from here on.
              Above, choose who is serving the <strong>current</strong> game.
            </p>
            <label style={lb}>Games</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="number"
                min={0}
                max={format.gamesPerSet + 1}
                value={startingScore.gamesPlayer}
                onChange={(e) => setStartingScore((v) => ({ ...v, gamesPlayer: Number(e.target.value) }))}
                style={{ ...inp, textAlign: 'center' }}
                aria-label={`Games for ${playerName.trim() || 'Player'}`}
              />
              <span style={{ fontWeight: 800 }}>–</span>
              <input
                type="number"
                min={0}
                max={format.gamesPerSet + 1}
                value={startingScore.gamesOpponent}
                onChange={(e) => setStartingScore((v) => ({ ...v, gamesOpponent: Number(e.target.value) }))}
                style={{ ...inp, textAlign: 'center' }}
                aria-label={`Games for ${opponentName.trim() || 'Opponent'}`}
              />
            </div>
            <label style={lb}>Points in the current game</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <select
                value={startingScore.pointsPlayer}
                onChange={(e) => setStartingScore((v) => ({ ...v, pointsPlayer: e.target.value as PointLabel }))}
                style={inp}
                aria-label={`Points for ${playerName.trim() || 'Player'}`}
              >
                {POINT_LABELS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <span style={{ fontWeight: 800 }}>–</span>
              <select
                value={startingScore.pointsOpponent}
                onChange={(e) => setStartingScore((v) => ({ ...v, pointsOpponent: e.target.value as PointLabel }))}
                style={inp}
                aria-label={`Points for ${opponentName.trim() || 'Opponent'}`}
              >
                {POINT_LABELS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </details>

          {seedError ? (
            <p style={{ marginTop: 12, marginBottom: 0, color: '#B3261E', fontSize: 13, fontWeight: 700 }}>
              {seedError}
            </p>
          ) : null}

          <button
            type="button"
            disabled={!playerName.trim() || !opponentName.trim()}
            onClick={() => {
              const seeded = seedBoardFromScore(startingScore, format);
              if (!seeded.ok) {
                setSeedError(seeded.error);
                return;
              }
              setSeedError(null);
              setBoard(seeded.board);
              // The chosen server serves the game in progress at the seeded score,
              // so the rotation counts from there rather than from 0 games.
              setOrigin(serveOrigin(startingScore.server, seeded.gamesAtStart));
              setPoints([]);
              setGameNotes([]);
              setFinishReason('in_progress');
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

        {/* The structured report + charts — the same component the decoder uses.
            No `analysis` prop: manual logging has no OCR integrity warnings. */}
        <div style={{ ...surface, background: '#fff', padding: 20, overflowX: 'auto' }}>
          <MatchReportView reports={reports} />
        </div>

        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 12, color: '#d6d3d1', cursor: 'pointer', userSelect: 'none' }}>
            Plain-text version
          </summary>
          <div
            style={{
              ...surface,
              marginTop: 8,
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
        </details>
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
            disabled={preparingSave}
            onClick={openSaveModal}
            style={{ ...btnLight, background: '#111', color: '#fff', borderColor: '#111' }}
          >
            {preparingSave ? 'Preparing charts…' : 'Save to player folder'}
          </button>
          {ENABLE_GOOGLE_EXPORTS && (
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
          )}
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
          sections={saveSections}
        />
      </div>
    );
  }

  /**
   * FEATURE C — an error still needs the ball that caused it. Sits between the
   * stroke and the confirm step, and only for the two error kinds.
   */
  const needsBallStep = !!pendingOutcome && isErrorOutcome(pendingOutcome) && !ballStepDone;

  const setBallType = (bt: BallType | null) => {
    setPendingOutcome((o) => {
      if (!o || !isErrorOutcome(o)) return o;
      return bt ? { ...o, ballType: bt } : { ...o, ballType: undefined };
    });
    setBallStepDone(true);
  };

  const ballTypePanel = needsBallStep ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>What ball caused it?</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {BALL_TYPES.map((bt) => (
          <button
            key={bt}
            type="button"
            style={{ ...btnLight, minHeight: 48, flex: '1 1 45%' }}
            onClick={() => setBallType(bt)}
          >
            {bt}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setBallType(null)}
        style={{ ...btnLight, minHeight: 44, background: '#fff', fontSize: 14 }}
      >
        Not sure — skip
      </button>
      <button
        type="button"
        onClick={() => setPendingOutcome(null)}
        style={{ border: 'none', background: 'transparent', color: '#d6d3d1', cursor: 'pointer', fontWeight: 600 }}
      >
        Back
      </button>
    </div>
  ) : null;

  const confirmPanel =
    pendingOutcome && pickWinner && !needsBallStep ? (
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
            setBallStepDone(false);
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
        {/* FEATURE A — derived server, shown every point so it is never guessed. */}
        <div style={{ marginTop: 6, fontSize: 13, fontWeight: 800, color: '#007AFF' }}>
          Serving: {servingNow === 'player' ? playerName.trim() || 'Player' : opponentName.trim() || 'Opponent'}
        </div>
        {matchComplete ? (
          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: '#1a7f37' }}>
            Match complete on score — finish to save the stats.
          </div>
        ) : null}
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
        {/* FEATURE F — explicit finish, available at any moment. */}
        <button
          type="button"
          onClick={() => {
            if (
              points.length > 0 &&
              !matchComplete &&
              !confirm('Finish the match now and save the stats collected so far?')
            ) {
              return;
            }
            finishMatch();
          }}
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
          Finish match
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
                {OUTCOME_CATS.map((c, i) => (
                  <button
                    key={c.key}
                    type="button"
                    style={{ ...btnLight, minHeight: 48 }}
                    onClick={() => setCat(c.key)}
                  >
                    {i + 1}) {c.label}
                  </button>
                ))}
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
            /* FEATURE B — rendered from SERVE_OUTCOMES, so "Return error" is a
               list entry rather than another hardcoded button. */
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {SERVE_OUTCOMES.map((o) => (
                <button
                  key={o.detail}
                  type="button"
                  style={{ ...btnLight }}
                  onClick={() => setPendingOutcome({ kind: 'serve', detail: o.detail })}
                >
                  {o.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCat(null)}
                style={{ width: '100%', border: 'none', background: 'transparent', color: '#d6d3d1', cursor: 'pointer' }}
              >
                Back
              </button>
            </div>
          ) : (
            /* FEATURE D — the same stroke list serves winners and both error kinds. */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>
                {cat === 'win' ? 'Winner — which stroke?' : 'Which stroke made the error?'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STROKES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    style={{ ...btnLight, minHeight: 48, flex: '1 1 45%' }}
                    onClick={() =>
                      setPendingOutcome(
                        cat === 'ue'
                          ? { kind: 'ue', stroke: s }
                          : cat === 'forced'
                            ? { kind: 'forced', stroke: s }
                            : { kind: 'winner', stroke: s },
                      )
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
          )}
        </>
      )}

      {ballTypePanel}

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
