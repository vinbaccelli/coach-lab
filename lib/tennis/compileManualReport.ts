import type { Side } from '@/lib/tennis/gameScore';
import type { FormattedBoard } from '@/lib/tennis/matchFormat';
import type { PointSignificance } from '@/lib/tennis/pointSignificance';
import { significanceLabel } from '@/lib/tennis/pointSignificance';

/**
 * FEATURE C — the ball that caused an error.
 *
 * Data-driven so the UI renders its buttons from this list and the report
 * aggregates from the same source; adding a sixth ball type is a one-line change
 * here and nowhere else.
 */
export const BALL_TYPES = ['Deep', 'Angled', 'Deep + High', 'Slice', 'Dropshot'] as const;
export type BallType = (typeof BALL_TYPES)[number];

/**
 * FEATURE B — serve/return point outcomes.
 *
 * `return_error` is the returner's mistake off the serve, so the SERVER wins the
 * point. It is tracked separately from a rally unforced error because its cause
 * (the serve) is different, and folding it into the UE total would quietly move
 * the Aggressive Margin.
 */
export const SERVE_OUTCOMES = [
  { detail: 'ace', label: 'Ace' },
  { detail: 'double_fault', label: 'Double fault' },
  { detail: 'return_error', label: 'Return error' },
] as const;
export type ServeDetail = (typeof SERVE_OUTCOMES)[number]['detail'];

/**
 * FEATURE D — stroke options shared by winners and errors.
 *
 * Volley / Smash / Drop Shot sit alongside the groundstrokes rather than in a
 * second "shot type" axis, matching how the recorder has always asked the
 * question: one tap, one stroke.
 */
export const STROKES = ['Forehand', 'Backhand', 'Volley', 'Smash', 'Drop Shot'] as const;
export type StrokeName = (typeof STROKES)[number];

/**
 * FEATURE — rally length.
 *
 * Only asked for outcomes where a rally actually happened — winners, unforced
 * errors, and forced errors, never a serve/return outcome (an ace, a double
 * fault or a return error is by definition a rally of zero real length). The
 * quick options cover the common cases; `Custom` stores the exact count the
 * coach typed. Either way the point keeps the RAW value — bucketing into the
 * five display categories (2/3/4/5/5+) happens only when a chart is built, so
 * no precision is thrown away at logging time.
 */
export const RALLY_LENGTH_OPTIONS = [2, 3, 4, 5] as const;
export type RallyLength = number | '5+';

/** The five fixed, ordered buckets a rally length is grouped into for display. */
export const RALLY_LENGTH_BUCKETS = ['2', '3', '4', '5', '5+'] as const;

export function bucketRallyLength(n: RallyLength): (typeof RALLY_LENGTH_BUCKETS)[number] {
  if (n === '5+') return '5+';
  if (n <= 2) return '2';
  if (n >= 5) return '5+';
  return String(n) as '3' | '4';
}

export function rallyLengthLabel(n: RallyLength): string {
  return n === '5+' ? '5+ shots' : n + (n === 1 ? ' shot' : ' shots');
}

/**
 * A point's ending.
 *
 * `forced` (induced error) is its OWN kind. It used to be folded in with
 * `winner` under a combined "Winner / Induced" button, which meant the winner
 * count — and therefore the Aggressive Margin — silently included errors the
 * opponent was forced into. Splitting them makes both numbers mean what they say.
 */
export type ManualOutcome =
  | { kind: 'serve'; detail: ServeDetail }
  | { kind: 'ue'; stroke: string; ballType?: BallType }
  | { kind: 'forced'; stroke: string; ballType?: BallType }
  | { kind: 'winner'; stroke: string };

export type LoggedPoint = {
  winner: Side;
  outcome: ManualOutcome;
  /**
   * What the point was worth — break/set/match point — DERIVED from the score
   * at the moment it was played (lib/tennis/pointSignificance.ts), never asked.
   * Absent (or empty) means the point was a plain hold with nothing riding on
   * the game beyond itself.
   */
  significance?: PointSignificance[];
  /** FEATURE A — derived from the serve rotation at the time the point was logged. */
  server?: Side;
  /** How long the rally ran, when asked (never for a serve/return outcome). */
  rallyLength?: RallyLength;
};

/** How the match ended, which changes how the report describes its own totals. */
export type FinishReason = 'completed' | 'stopped_early' | 'in_progress';

export type ManualReportContext = {
  board?: FormattedBoard;
  /** FEATURE E — one-liner when the match began from an existing score. */
  startingScoreNote?: string | null;
  /** FEATURE F — explicit finish vs the score running out. */
  finish?: FinishReason;
};

/** Outcomes that carry a ball type (FEATURE C). */
export function isErrorOutcome(
  o: ManualOutcome,
): o is Extract<ManualOutcome, { kind: 'ue' | 'forced' }> {
  return o.kind === 'ue' || o.kind === 'forced';
}

/** The side whose racket made the mistake — always the side that lost the point. */
function errorSide(pt: LoggedPoint): Side {
  return pt.winner === 'player' ? 'opponent' : 'player';
}

type Tally = Record<string, number>;

function bump(t: Tally, key: string) {
  t[key] = (t[key] ?? 0) + 1;
}

function tallyLines(t: Tally, indent = '  '): string[] {
  const entries = Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) return [indent + '(none recorded)'];
  return entries.map(([k, v]) => indent + k + ': ' + v);
}

export type ServeSideStats = { aces: number; doubleFaults: number; returnErrorsWon: number };

export type ManualStats = {
  totalPoints: number;
  pointsWon: Record<Side, number>;
  winners: number;
  unforcedErrors: number;
  forcedErrors: number;
  aces: number;
  doubleFaults: number;
  returnErrors: number;
  aggressiveMargin: number;
  errorEfficiencyRatio: number;
  winnersByStroke: Record<Side, Tally>;
  ueByStroke: Record<Side, Tally>;
  ueByBallType: Record<Side, Tally>;
  forcedByStroke: Record<Side, Tally>;
  forcedByBallType: Record<Side, Tally>;
  servePointsBySide: Record<Side, ServeSideStats>;
  breakPoints: number;
  setPoints: number;
  matchPoints: number;
  /**
   * Rally length, keyed by the side whose racket ENDED the point (the winner's
   * side for a winner, the erring side for an unforced/forced error) — the same
   * attribution convention as every other per-stroke breakdown here. Keyed by
   * the raw value's string form (e.g. "4", "9", "5+"); bucketing into the five
   * display categories happens at chart-build time.
   */
  rallyLengthByEndingSide: Record<Side, Tally>;
  /** Points that were eligible for a rally length (any non-serve outcome) but skipped. */
  rallyUnspecifiedByEndingSide: Record<Side, number>;
};

const emptySideTallies = (): Record<Side, Tally> => ({ player: {}, opponent: {} });

/**
 * Aggregate the logged points.
 *
 * Separated from the text builder so the numbers can be reused (or checked)
 * without going through string formatting.
 */
export function aggregateManualStats(points: LoggedPoint[]): ManualStats {
  const s: ManualStats = {
    totalPoints: points.length,
    pointsWon: { player: 0, opponent: 0 },
    winners: 0,
    unforcedErrors: 0,
    forcedErrors: 0,
    aces: 0,
    doubleFaults: 0,
    returnErrors: 0,
    aggressiveMargin: 0,
    errorEfficiencyRatio: 0,
    winnersByStroke: emptySideTallies(),
    ueByStroke: emptySideTallies(),
    ueByBallType: emptySideTallies(),
    forcedByStroke: emptySideTallies(),
    forcedByBallType: emptySideTallies(),
    servePointsBySide: {
      player: { aces: 0, doubleFaults: 0, returnErrorsWon: 0 },
      opponent: { aces: 0, doubleFaults: 0, returnErrorsWon: 0 },
    },
    breakPoints: 0,
    setPoints: 0,
    matchPoints: 0,
    rallyLengthByEndingSide: emptySideTallies(),
    rallyUnspecifiedByEndingSide: { player: 0, opponent: 0 },
  };

  for (const pt of points) {
    s.pointsWon[pt.winner] += 1;
    for (const sig of pt.significance ?? []) {
      if (sig.kind === 'break') s.breakPoints += 1;
      else if (sig.kind === 'set') s.setPoints += 1;
      else s.matchPoints += 1;
    }

    const o = pt.outcome;
    if (o.kind === 'winner') {
      s.winners += 1;
      bump(s.winnersByStroke[pt.winner], o.stroke);
      if (pt.rallyLength !== undefined) bump(s.rallyLengthByEndingSide[pt.winner], String(pt.rallyLength));
      else s.rallyUnspecifiedByEndingSide[pt.winner] += 1;
    } else if (o.kind === 'ue') {
      s.unforcedErrors += 1;
      const side = errorSide(pt);
      bump(s.ueByStroke[side], o.stroke);
      if (o.ballType) bump(s.ueByBallType[side], o.ballType);
      if (pt.rallyLength !== undefined) bump(s.rallyLengthByEndingSide[side], String(pt.rallyLength));
      else s.rallyUnspecifiedByEndingSide[side] += 1;
    } else if (o.kind === 'forced') {
      s.forcedErrors += 1;
      const side = errorSide(pt);
      bump(s.forcedByStroke[side], o.stroke);
      if (o.ballType) bump(s.forcedByBallType[side], o.ballType);
      if (pt.rallyLength !== undefined) bump(s.rallyLengthByEndingSide[side], String(pt.rallyLength));
      else s.rallyUnspecifiedByEndingSide[side] += 1;
    } else {
      // Serve/return outcomes. The serving side is `pt.server` when known; an ace
      // and a return error are both won by the server, a double fault lost by it.
      const server: Side = pt.server ?? (o.detail === 'double_fault' ? errorSide(pt) : pt.winner);
      if (o.detail === 'ace') {
        s.aces += 1;
        s.servePointsBySide[server].aces += 1;
      } else if (o.detail === 'double_fault') {
        s.doubleFaults += 1;
        s.servePointsBySide[server].doubleFaults += 1;
      } else {
        s.returnErrors += 1;
        s.servePointsBySide[server].returnErrorsWon += 1;
      }
    }
  }

  s.aggressiveMargin = s.winners - s.unforcedErrors;
  s.errorEfficiencyRatio = s.unforcedErrors === 0 ? s.winners : s.winners / s.unforcedErrors;
  return s;
}

function outcomeTag(o: ManualOutcome): string {
  if (o.kind === 'serve') {
    const found = SERVE_OUTCOMES.find((x) => x.detail === o.detail);
    return found ? found.label : o.detail;
  }
  const base =
    o.kind === 'ue'
      ? 'UE ' + o.stroke
      : o.kind === 'forced'
        ? 'Forced error ' + o.stroke
        : 'Winner ' + o.stroke;
  if (isErrorOutcome(o) && o.ballType) {
    return base + ' (off a ' + o.ballType.toLowerCase() + ' ball)';
  }
  return base;
}

const SIDES: Side[] = ['player', 'opponent'];

/** Plain-text report aligned with decoder sections (simplified aggregates). */
export function compileManualReport(
  playerName: string,
  opponentName: string,
  points: LoggedPoint[],
  ctx: ManualReportContext = {},
): string {
  const board = ctx.board;
  const nameOf = (s: Side) => (s === 'player' ? playerName : opponentName);
  const st = aggregateManualStats(points);
  const lines: string[] = [];

  lines.push('GENERAL STATISTICS AND PERFORMANCE INDICES');
  lines.push('Players: ' + playerName + ' vs ' + opponentName);

  if (board) {
    const setParts = board.sets.length ? board.sets.map(([a, b]) => a + '-' + b).join(', ') : '';
    const g = board.games[0] + '-' + board.games[1];
    const label =
      ctx.finish === 'completed'
        ? 'Final score'
        : ctx.finish === 'stopped_early'
          ? 'Score when the match was stopped'
          : 'Score so far';
    lines.push(
      label + ' — Sets: ' + (setParts || '(none completed)') + ' · Games in current set: ' + g,
    );
  }
  if (ctx.startingScoreNote) lines.push(ctx.startingScoreNote);
  if (ctx.finish === 'stopped_early') {
    lines.push(
      'NOTE: the match was finished early. Every figure below covers only the ' +
        points.length +
        ' point(s) actually logged.',
    );
  } else if (ctx.startingScoreNote) {
    lines.push(
      'NOTE: the games above include the score this match started from. Statistics cover only the ' +
        points.length +
        ' point(s) logged since then.',
    );
  }

  lines.push('Total Points Played: ' + st.totalPoints);
  lines.push(
    'Points won — ' + playerName + ': ' + st.pointsWon.player + ', ' + opponentName + ': ' + st.pointsWon.opponent,
  );
  lines.push('Aggressive Margin (AM): ' + st.aggressiveMargin);
  lines.push('Error Efficiency Ratio (EER): ' + st.errorEfficiencyRatio.toFixed(3));
  lines.push('Total winners: ' + st.winners);
  lines.push('Total UE count: ' + st.unforcedErrors);
  lines.push('Forced (induced) errors: ' + st.forcedErrors);
  lines.push('Aces logged: ' + st.aces);
  lines.push('Double faults logged: ' + st.doubleFaults);
  lines.push('Return errors logged: ' + st.returnErrors);
  lines.push('Break points played: ' + st.breakPoints);
  lines.push('Set points played: ' + st.setPoints);
  lines.push('Match points played: ' + st.matchPoints);
  lines.push('');

  lines.push('WINNER BREAKDOWN');
  for (const side of SIDES) {
    lines.push(nameOf(side) + ' — winners by stroke:');
    lines.push(...tallyLines(st.winnersByStroke[side]));
  }
  lines.push('');

  lines.push('DETAILED UNFORCED ERROR ANALYSIS');
  for (const side of SIDES) {
    lines.push(nameOf(side) + ' — unforced errors by stroke:');
    lines.push(...tallyLines(st.ueByStroke[side]));
    lines.push(nameOf(side) + ' — unforced errors by ball that caused them:');
    lines.push(...tallyLines(st.ueByBallType[side]));
  }
  lines.push('');

  lines.push('FORCED (INDUCED) ERROR ANALYSIS');
  for (const side of SIDES) {
    lines.push(nameOf(side) + ' — forced errors by stroke:');
    lines.push(...tallyLines(st.forcedByStroke[side]));
    lines.push(nameOf(side) + ' — forced errors by ball that caused them:');
    lines.push(...tallyLines(st.forcedByBallType[side]));
  }
  lines.push('');

  lines.push('SERVE AND RETURN ANALYSIS');
  for (const side of SIDES) {
    const sp = st.servePointsBySide[side];
    lines.push(
      nameOf(side) +
        ' serving — aces: ' +
        sp.aces +
        ', double faults: ' +
        sp.doubleFaults +
        ', points won on return errors: ' +
        sp.returnErrorsWon,
    );
  }
  points.forEach((pt, i) => {
    if (pt.outcome.kind === 'serve') {
      const who = pt.server ? ' (' + nameOf(pt.server) + ' serving)' : '';
      lines.push('Point ' + (i + 1) + ': ' + outcomeTag(pt.outcome) + who);
    }
  });
  lines.push('');

  lines.push('POINT HISTORY');
  points.forEach((pt, i) => {
    const sig = (pt.significance ?? [])
      .map((s) => significanceLabel(s.kind).toUpperCase() + ' — ' + nameOf(s.side))
      .join(' / ');
    const tag = sig ? ' [' + sig + ']' : '';
    const serving = pt.server ? ' · ' + nameOf(pt.server) + ' serving' : '';
    const rally = pt.rallyLength !== undefined ? ' · rally ' + rallyLengthLabel(pt.rallyLength) : '';
    lines.push(
      'Point ' + (i + 1) + ': ' + outcomeTag(pt.outcome) + ' — won by ' + nameOf(pt.winner) + serving + rally + tag,
    );
  });
  lines.push('');

  lines.push('COACHES SUMMARY');
  lines.push(
    'Manual log summary for coaching review. Point totals — ' +
      playerName +
      ': ' +
      st.pointsWon.player +
      ', ' +
      opponentName +
      ': ' +
      st.pointsWon.opponent +
      '. Review the winner/UE breakdowns above (and the ball types driving errors) for session priorities.',
  );

  return lines.join('\n');
}
