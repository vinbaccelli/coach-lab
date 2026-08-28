'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Side } from '@/lib/tennis/gameScore';
import type { BallType, FinishReason, ManualOutcome, RallyLength } from '@/lib/tennis/compileManualReport';
import {
  aggregateManualStats,
  BALL_TYPES,
  compileManualReport,
  isErrorOutcome,
  RALLY_LENGTH_OPTIONS,
  rallyLengthLabel,
  serveOutcomesFor,
  STROKES,
} from '@/lib/tennis/compileManualReport';
import { derivePointSignificance, significanceLabel, type PointSignificance } from '@/lib/tennis/pointSignificance';
import SaveReportModal from '@/components/shared/SaveReportModal';
import MatchReportView from '@/components/decoder/MatchReportView';
import { buildManualReport } from '@/lib/tennis/manualReportModel';
import type { DocsSectionPayload } from '@/lib/matchAnalysis/exportToDocs';
import {
  captureNodeAsPng,
  reportImageObjectSize,
  sliceCaptureIntoPages,
} from '@/lib/matchAnalysis/captureReportImage';
import { formatMatchFolderLabel, localDateTimeForFolder } from '@/lib/players/formatFolderLabel';
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

/**
 * Outcome categories, data-driven so adding one is a list entry (FEATURES B/C/D).
 * `hint` is the plain-language sub-line shown under each button — the pair
 * coaches most disagree on is Unforced vs Induced, so those two get the most
 * direct wording.
 */
const OUTCOME_CATS = [
  { key: 'serve', label: 'Serve / Return', hint: 'Ace, double fault, or a missed return' },
  { key: 'ue', label: 'Unforced Error', hint: 'A miss with no real pressure — their own mistake' },
  { key: 'forced', label: 'Induced / Forced Error', hint: 'The opponent forced the mistake' },
  { key: 'win', label: 'Winner', hint: 'A clean shot the opponent could not reach' },
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
    Array<{
      winner: Side;
      outcome: ManualOutcome;
      significance?: PointSignificance[];
      server?: Side;
      rallyLength?: RallyLength;
    }>
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
  /**
   * Rally length — asked only when a rally actually happened (not for a
   * serve/return outcome). Mirrors `ballStepDone`'s skip-friendly pattern: the
   * step is DONE once answered OR explicitly skipped, never blocking on a value.
   */
  const [rallyStepDone, setRallyStepDone] = useState(false);
  const [pendingRallyLength, setPendingRallyLength] = useState<RallyLength | undefined>(undefined);
  const [rallyCustomOpen, setRallyCustomOpen] = useState(false);
  const [rallyCustomValue, setRallyCustomValue] = useState('');

  const [gameNoteOpen, setGameNoteOpen] = useState(false);
  const [gameNoteDraft, setGameNoteDraft] = useState('');
  const [gameNotes, setGameNotes] = useState<string[]>([]);

  const [saveOpen, setSaveOpen] = useState(false);
  /** Docs payload built from the full-report capture — see openSaveModal. */
  const [saveSections, setSaveSections] = useState<DocsSectionPayload[] | undefined>(undefined);
  const [preparingSave, setPreparingSave] = useState(false);
  /**
   * Set when the report capture succeeded but one or more page tiles failed
   * to upload (or all of them did) — see openSaveModal. Shown next to the
   * Save button so a partial or total image failure is never silent again.
   */
  const [saveImageWarning, setSaveImageWarning] = useState<string | null>(null);
  /** The rendered report node — captured as one image for the Doc. See openSaveModal. */
  const reportCaptureRef = useRef<HTMLDivElement>(null);

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
  /** Break/set/match point on the point about to be played — DERIVED, never asked. */
  const pointSignificanceNow = useMemo(
    () => derivePointSignificance(board, format, servingNow),
    [board, format, servingNow],
  );

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
   * The structured report — the same `SideReport[]` shape the decoder
   * produces, so it renders through the same `MatchReportView` used on the
   * decoder side rather than a parallel implementation. This is ALSO the node
   * `openSaveModal` captures as one image for the Doc — the on-screen report
   * and the Doc's picture are the exact same render.
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
   * PART 1 of the image-export build — the STRUCTURED data, independent of
   * whatever the Google Doc ends up showing.
   *
   * Every logged point (winner, outcome, stroke, ball type, rally length,
   * server, derived significance) plus the computed aggregate stats, stored
   * verbatim in `player_entries.metadata` (a jsonb column that already existed
   * on this table but nothing was ever writing to). This is what makes a
   * future "compare matches" / "player trends over time" view possible — it
   * does not depend on, or get affected by, what the Doc image looks like.
   * `version: 1` so a later change to this shape can be told apart from today's.
   */
  const matchMetadata = useMemo(
    () => ({
      manualMatch: {
        version: 1,
        playerName: playerName.trim() || 'Player',
        opponentName: opponentName.trim() || 'Opponent',
        matchDate,
        format,
        startingScore,
        finish: finishReason,
        board,
        points,
        stats: aggregateManualStats(points),
        gameNotes,
      },
    }),
    [playerName, opponentName, matchDate, format, startingScore, finishReason, board, points, gameNotes],
  );

  /**
   * Capture the report EXACTLY as it renders on screen, cut it into page-sized
   * tiles, upload each through the same Drive pipeline every screenshot uses,
   * and build one Docs section per tile.
   *
   * WHY TILES RATHER THAN ONE IMAGE — a single full-report PNG asked Docs for
   * an inline image over a hundred inches tall, which it would not place; the
   * Doc ended up with the already-written text and no picture. One page-box
   * per tile keeps every insert ordinary and fast. See sliceCaptureIntoPages.
   *
   * The report is already mounted (just scrolled, since it runs long) by the
   * time the coach can reach this button, so there is no off-screen render or
   * viewport trick needed — the capture reads the node's full height
   * regardless of what is currently visible.
   *
   * A capture/upload failure is NOT fatal: the modal still opens and the save
   * falls back to the plain-text body — and `matchMetadata` above is
   * unaffected either way, since the structured record is separate from
   * whatever image (or lack of one) reaches the Doc.
   *
   * TILE UPLOADS — resolve-once, allSettled, keep-partial.
   * Every tile used to upload via `Promise.all`, each independently asking
   * `/api/google/upload-image` to find-or-create the SAME destination folder
   * from scratch. For a multi-tile report that is N concurrent calls racing
   * the same find-or-create check (see `findOrCreateFolder`), and `Promise.all`
   * discards every tile that DID succeed the instant any ONE of them rejects —
   * which the old bare `catch { setSaveSections(undefined) }` then swallowed
   * with no trace. Tile 1 now resolves (and reports back) the folder id first;
   * the rest reuse it via `Promise.allSettled`, so one failure can no longer
   * erase the others, and whichever failure DOES happen is logged instead of
   * discarded.
   */
  const openSaveModal = useCallback(async () => {
    setPreparingSave(true);
    setSaveImageWarning(null);
    try {
      const node = reportCaptureRef.current;
      if (!node) throw new Error('Report not ready to capture');
      const captured = await captureNodeAsPng(node);
      const tiles = await sliceCaptureIntoPages(captured);

      const uploadTile = async (
        dataUrl: string,
        name: string,
        folderId?: string,
      ): Promise<{ url: string; folderId?: string }> => {
        const res = await fetch('/api/google/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, name, ...(folderId ? { folderId } : {}) }),
        });
        const data = (await res.json()) as { url?: string; folderId?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error ?? 'Report image upload failed');
        return { url: data.url, folderId: data.folderId };
      };

      // Tile 1 resolves the folder (or fails on its own); tiles 2..N reuse
      // whatever id it resolved, or — if tile 1 itself failed — each still
      // gets its own independent attempt rather than being skipped outright.
      let resolvedFolderId: string | undefined;
      const first = await uploadTile(tiles[0].dataUrl, 'match-report-1.png').then(
        (v) => {
          resolvedFolderId = v.folderId;
          return { status: 'fulfilled' as const, value: v };
        },
        (reason) => ({ status: 'rejected' as const, reason }),
      );
      const rest = await Promise.allSettled(
        tiles
          .slice(1)
          .map((t, i) => uploadTile(t.dataUrl, `match-report-${i + 2}.png`, resolvedFolderId)),
      );
      const settled: Array<PromiseSettledResult<{ url: string; folderId?: string }>> = [first, ...rest];

      const sections: DocsSectionPayload[] = [];
      const failures: string[] = [];
      settled.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          sections.push({
            // Only the first successful tile carries the heading; the rest
            // continue it, so the Doc reads as one report rather than N.
            ...(sections.length === 0 ? { heading: 'Match Report', headingLevel: 'h2' as const } : {}),
            imageUrl: result.value.url,
            imageObjectSizePt: reportImageObjectSize(tiles[i]),
          });
        } else {
          failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        }
      });

      if (failures.length) {
        console.error(
          `[openSaveModal] ${failures.length}/${tiles.length} report image tile(s) failed to upload:`,
          failures,
        );
      }

      if (!sections.length) {
        // Every tile failed — say so rather than silently falling back to text.
        setSaveSections(undefined);
        setSaveImageWarning(
          `Report image upload failed (${failures[0] ?? 'unknown error'}) — the Doc will be saved as text only.`,
        );
      } else {
        setSaveSections(sections);
        if (failures.length) {
          setSaveImageWarning(
            `${failures.length} of ${tiles.length} report image${tiles.length === 1 ? '' : 's'} failed to upload (${failures[0]}) — the Doc will be missing ${failures.length === 1 ? 'that page' : 'those pages'}.`,
          );
        }
      }
    } catch (e) {
      console.error('[openSaveModal] report capture failed:', e instanceof Error ? e.message : e);
      setSaveSections(undefined);
      setSaveImageWarning(
        `Report capture failed (${e instanceof Error ? e.message : 'unknown error'}) — the Doc will be saved as text only.`,
      );
    } finally {
      setPreparingSave(false);
      setSaveOpen(true);
    }
  }, []);

  const resetMenus = useCallback(() => {
    setPickWinner(null);
    setCat(null);
    setPendingOutcome(null);
    setBallStepDone(false);
    setRallyStepDone(false);
    setPendingRallyLength(undefined);
    setRallyCustomOpen(false);
    setRallyCustomValue('');
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
      // FEATURE A — stamp the server AND the derived significance from the board
      // BEFORE the point was applied, so both describe the situation the point
      // was actually played into.
      const server = currentServer(origin, board);
      const significance = derivePointSignificance(board, format, server);
      setPoints((p) => [
        ...p,
        { winner, outcome, server, significance, rallyLength: pendingRallyLength },
      ]);
      resetMenus();
      if (gameEndedRegular) {
        setGameNoteDraft('');
        setGameNoteOpen(true);
      }
    },
    [board, format, origin, pendingRallyLength, resetMenus],
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
        <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.55, color: '#444' }}>
          Configure the match, then record points. Tap who won the point, pick the outcome,
          then confirm with <strong>Add point</strong>. Break, set and match points are shown
          automatically — no need to flag them.
        </p>

        {/* Collapsed by default — a returning coach doesn't need this every time. */}
        <details style={{ marginBottom: 16 }}>
          <summary style={{ fontSize: 12, color: '#666', cursor: 'pointer', userSelect: 'none', fontWeight: 600 }}>
            How this works
          </summary>
          <div style={{ ...surface, marginTop: 8, background: '#fff' }}>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, color: '#333' }}>
              <li>
                <strong>Who won the point</strong> — tap the player's name.
              </li>
              <li>
                <strong>Outcome</strong> — Serve/Return, Unforced Error, Induced/Forced Error, or Winner.
              </li>
              <li>
                <strong>Stroke</strong> — which shot ended the point (skipped for serve outcomes).
              </li>
              <li>
                <strong>Ball type</strong> — what ball caused an error, deep or angled for example.{' '}
                <em>Optional — "Not sure — skip" moves on.</em>
              </li>
              <li>
                <strong>Rally length</strong> — how many shots the point ran.{' '}
                <em>Optional — skip if you didn't count.</em>
              </li>
            </ol>
            <p style={{ fontSize: 12, color: '#666', margin: '12px 0 0', lineHeight: 1.6 }}>
              Two things you never have to enter: who is <strong>serving</strong> (it alternates by game
              from the server you pick at the start) and whether a point is a{' '}
              <strong>break, set, or match point</strong> — both are worked out from the score and shown
              automatically.
            </p>
          </div>
        </details>

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
        <h2 style={{ color: '#111', fontSize: 20, fontWeight: 800, margin: '0 0 12px' }}>Match summary</h2>

        {/* Deliberately OUTSIDE reportCaptureRef below — this explains the
            report, it isn't part of it, so it must never end up in the Doc's
            captured image. */}
        <details style={{ marginBottom: 12 }}>
          <summary style={{ fontSize: 12, color: '#666', cursor: 'pointer', userSelect: 'none', fontWeight: 600 }}>
            What do AM and EER mean?
          </summary>
          <div style={{ ...surface, marginTop: 8, background: '#fff' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.6, color: '#333' }}>
              <strong>AM — Aggressive Margin.</strong> Winners minus unforced errors. Above zero means a
              side created more than it gave away; below zero means the reverse.
            </p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#333' }}>
              <strong>EER — Error Efficiency Ratio.</strong> Winners divided by unforced errors. Above 1
              means winners outnumbered unforced errors; the higher it is, the more efficient the side
              was being aggressive.
            </p>
          </div>
        </details>

        {/* The structured report + charts — the same component the decoder uses.
            No `analysis` prop: manual logging has no OCR integrity warnings.
            This exact node is what openSaveModal captures as the Doc's image —
            the ref must stay on the fixed-white-background wrapper, not the
            page's dark chrome, so the capture matches what a reader expects. */}
        <div ref={reportCaptureRef} style={{ ...surface, background: '#fff', padding: 20, overflowX: 'auto' }}>
          <MatchReportView reports={reports} />
        </div>

        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 12, color: '#666', cursor: 'pointer', userSelect: 'none' }}>
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
          {/*
            ONE combined action, replacing the previous pair of buttons. This
            still does everything the "Save to player folder" button always
            did (persist `matchMetadata` to `player_entries.metadata`, capture
            + upload the full-report image, insert it into the player's Doc,
            with the entry save NEVER failing on a Docs problem — see
            openSaveModal and the entries route's EntryDocStatus). The old
            second button called /api/google/create-document directly:
            plain text, no player folder, no structured persistence — strictly
            worse at everything this one already does, so it's gone rather
            than kept redundant alongside a better path.
          */}
          <button
            type="button"
            disabled={preparingSave}
            onClick={openSaveModal}
            style={{ ...btnLight, background: '#111', color: '#fff', borderColor: '#111' }}
          >
            {preparingSave ? 'Capturing report…' : 'Save & Export to Google Doc'}
          </button>
          <button type="button" onClick={() => setPhase('setup')} style={{ ...btnLight, background: '#fff' }}>
            New match
          </button>
        </div>

        {/* Honest partial/total image-upload failure — see openSaveModal. The
            entry itself still saves either way; this only ever describes what
            happened to the picture(s), matching SaveReportModal's own
            "saved, but the Doc didn't get X" wording for the same reason: a
            report that silently lost its image used to look identical to one
            that didn't. */}
        {saveImageWarning ? (
          <p
            style={{
              margin: '10px 0 0',
              fontSize: 13,
              lineHeight: 1.5,
              color: '#8A6D00',
              background: 'rgba(255,196,0,0.12)',
              border: '1px solid rgba(255,196,0,0.45)',
              borderRadius: 10,
              padding: '10px 12px',
            }}
          >
            {saveImageWarning}
          </p>
        ) : null}

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
          metadata={matchMetadata}
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
      <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>What ball caused it?</div>
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
        style={{ border: 'none', background: 'transparent', color: '#666', cursor: 'pointer', fontWeight: 600 }}
      >
        Back
      </button>
    </div>
  ) : null;

  /**
   * Rally length — asked for every outcome that actually involved a rally
   * (winner, unforced error, forced error), never for a serve/return outcome.
   * Sits after the ball-type step (when there is one), before the confirm.
   */
  const needsRallyStep =
    !!pendingOutcome && pendingOutcome.kind !== 'serve' && !needsBallStep && !rallyStepDone;

  const setRallyLength = (v: RallyLength | null) => {
    setPendingRallyLength(v ?? undefined);
    setRallyStepDone(true);
    setRallyCustomOpen(false);
    setRallyCustomValue('');
  };

  const rallyBack = () => {
    // Undo whichever step immediately precedes this one, mirroring how the
    // ball-type panel's own Back fully re-opens the stroke picker.
    if (pendingOutcome && isErrorOutcome(pendingOutcome)) {
      setBallStepDone(false);
    } else {
      setPendingOutcome(null);
    }
  };

  const rallyPanel = needsRallyStep ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>How long was the rally?</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {RALLY_LENGTH_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            style={{ ...btnLight, minHeight: 48, flex: '1 1 30%' }}
            onClick={() => setRallyLength(n)}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          style={{ ...btnLight, minHeight: 48, flex: '1 1 30%' }}
          onClick={() => setRallyLength('5+')}
        >
          5+
        </button>
        <button
          type="button"
          style={{ ...btnLight, minHeight: 48, flex: '1 1 30%' }}
          onClick={() => setRallyCustomOpen((v) => !v)}
        >
          Custom
        </button>
      </div>
      {rallyCustomOpen ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            min={1}
            value={rallyCustomValue}
            onChange={(e) => setRallyCustomValue(e.target.value)}
            placeholder="Number of shots"
            style={{ ...inp, flex: 1 }}
            autoFocus
          />
          <button
            type="button"
            disabled={!Number.isInteger(Number(rallyCustomValue)) || Number(rallyCustomValue) < 1}
            style={{ ...btnLight, flex: 'none', minHeight: 44, padding: '0 16px', background: '#111', color: '#fff', borderColor: '#111' }}
            onClick={() => setRallyLength(Number(rallyCustomValue))}
          >
            Use
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setRallyLength(null)}
        style={{ ...btnLight, minHeight: 44, background: '#fff', fontSize: 14 }}
      >
        Not sure — skip
      </button>
      <button
        type="button"
        onClick={rallyBack}
        style={{ border: 'none', background: 'transparent', color: '#666', cursor: 'pointer', fontWeight: 600 }}
      >
        Back
      </button>
    </div>
  ) : null;

  const confirmPanel =
    pendingOutcome && pickWinner && !needsBallStep && !needsRallyStep ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        {pendingRallyLength !== undefined ? (
          <p style={{ margin: 0, fontSize: 13, color: '#111' }}>
            Rally: <strong>{rallyLengthLabel(pendingRallyLength)}</strong>
          </p>
        ) : null}
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
            if (pendingOutcome && pendingOutcome.kind !== 'serve') {
              setRallyStepDone(false);
              setPendingRallyLength(undefined);
            } else {
              setPendingOutcome(null);
              setBallStepDone(false);
            }
          }}
          style={{ border: 'none', background: 'transparent', color: '#666', cursor: 'pointer', fontWeight: 600 }}
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
        {/* Break/Set/Match Point — DERIVED from the score, never asked. */}
        {pointSignificanceNow.length > 0 ? (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {pointSignificanceNow.map((sig, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.2,
                  color: '#fff',
                  background: sig.kind === 'match' ? '#B3261E' : sig.kind === 'set' ? '#B45309' : '#8A3FFC',
                }}
              >
                {significanceLabel(sig.kind).toUpperCase()} —{' '}
                {sig.side === 'player' ? playerName.trim() || 'Player' : opponentName.trim() || 'Opponent'}
              </span>
            ))}
          </div>
        ) : null}
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

      {/* First-point hint only — gone as soon as one point is logged, no storage needed. */}
      {points.length === 0 && !pendingOutcome && !pickWinner ? (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#666', lineHeight: 1.5 }}>
          Tap who won the point to begin — you can go Back at any step.
        </p>
      ) : null}

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
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>Outcome</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {OUTCOME_CATS.map((c, i) => (
                  <button
                    key={c.key}
                    type="button"
                    style={{
                      ...btnLight,
                      minHeight: 64,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      justifyContent: 'center',
                      gap: 3,
                      paddingLeft: 14,
                      paddingRight: 14,
                    }}
                    onClick={() => setCat(c.key)}
                  >
                    <span>{i + 1}) {c.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>{c.hint}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPickWinner(null)}
                style={{ border: 'none', background: 'transparent', color: '#666', cursor: 'pointer', fontWeight: 600 }}
              >
                Back
              </button>
            </div>
          ) : cat === 'serve' ? (
            /* Only the serve/return outcomes that are actually POSSIBLE given
               who served and who won — see serveOutcomesFor for the full
               matrix. An ace that loses the point, or a double fault that wins
               it, can no longer be logged because they can no longer be
               tapped. */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>
                {servingNow === 'player' ? playerName.trim() || 'Player' : opponentName.trim() || 'Opponent'} served
                — how did the point end?
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {serveOutcomesFor(servingNow, pickWinner).map((o) => (
                  <button
                    key={o.detail}
                    type="button"
                    style={{ ...btnLight }}
                    onClick={() => setPendingOutcome({ kind: 'serve', detail: o.detail })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#666', lineHeight: 1.5 }}>
                Only outcomes possible for this server and point winner are shown.
              </p>
              <button
                type="button"
                onClick={() => setCat(null)}
                style={{ width: '100%', border: 'none', background: 'transparent', color: '#666', cursor: 'pointer' }}
              >
                Back
              </button>
            </div>
          ) : (
            /* FEATURE D — the same stroke list serves winners and both error kinds. */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>
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
                style={{ border: 'none', background: 'transparent', color: '#666', cursor: 'pointer', fontWeight: 600 }}
              >
                Back
              </button>
            </div>
          )}
        </>
      )}

      {ballTypePanel}

      {rallyPanel}

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
