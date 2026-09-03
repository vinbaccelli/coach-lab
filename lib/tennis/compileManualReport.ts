import type { Side } from '@/lib/tennis/gameScore';
import type { FormattedBoard } from '@/lib/tennis/matchFormat';
import type { PointSignificance } from '@/lib/tennis/pointSignificance';
import { significanceLabel } from '@/lib/tennis/pointSignificance';

/**
 * FEATURE C — the ball that caused an error, described on FOUR independent axes.
 *
 * REPLACES the old single `BALL_TYPES` list ('Deep' | 'Angled' | 'Deep + High' |
 * 'Slice' | 'Dropshot'), which forced one tap to stand for several unrelated
 * properties at once: "Deep + High" mixed depth with height, "Slice" described
 * spin, and a deep-AND-fast ball could only be logged as one of the two. Splitting
 * it into depth / direction / height / speed means each tap answers exactly one
 * question, every combination is expressible, and each axis can be charted on its
 * own instead of a single donut of overlapping categories.
 *
 * Data-driven so the UI renders its four panels from this list and the report
 * aggregates from the same source; every axis is INDEPENDENTLY optional — the
 * coach may answer all four, some, or none.
 */
export const ERROR_CAUSE_DIMENSIONS = [
  { key: 'depth', label: 'Depth', question: 'How deep was the ball?', options: ['Short', 'Half Court', 'Deep'] },
  { key: 'direction', label: 'Direction', question: 'Where did it go?', options: ['Right', 'Left', 'Center'] },
  /*
    HEIGHT is height-and-trajectory, not a pure three-step ramp. 'Slice' is a
    kind of ball rather than a level — a skidding, backspun trajectory that
    stays low but is not the same thing as merely low — so it sits AFTER the
    Flat → Medium → High ramp instead of inside it, leaving that ordering
    intact for the eye while still being one tap away.
  */
  { key: 'height', label: 'Height', question: 'How high was it?', options: ['Flat', 'Medium', 'High', 'Slice'] },
  { key: 'speed', label: 'Speed', question: 'How fast was it?', options: ['Slow', 'Medium', 'Fast'] },
] as const;

export type ErrorCauseDimension = (typeof ERROR_CAUSE_DIMENSIONS)[number]['key'];

/** Every axis optional and independent — a skipped axis is simply absent. */
export type ErrorCause = {
  depth?: string;
  direction?: string;
  height?: string;
  speed?: string;
};

export const ERROR_CAUSE_KEYS = ERROR_CAUSE_DIMENSIONS.map((d) => d.key) as readonly ErrorCauseDimension[];

/** True when at least one of the four axes was actually answered. */
export function hasErrorCause(c: ErrorCause | undefined): c is ErrorCause {
  return !!c && ERROR_CAUSE_KEYS.some((k) => !!c[k]);
}

/**
 * FEATURE B — serve/return point outcomes.
 *
 * `return_error` is the returner's mistake off the serve, so the SERVER wins the
 * point. It is tracked separately from a rally unforced error because its cause
 * (the serve) is different, and folding it into the UE total would quietly move
 * the Aggressive Margin.
 */
export const SERVE_OUTCOMES = [
  { detail: 'ace', label: 'Ace', pointGoesTo: 'server' },
  { detail: 'double_fault', label: 'Double fault', pointGoesTo: 'returner' },
  { detail: 'return_error', label: 'Return error', pointGoesTo: 'server' },
] as const;
export type ServeDetail = (typeof SERVE_OUTCOMES)[number]['detail'];

/**
 * FEATURE D — stroke options shared by winners and errors.
 *
 * Volley / Smash / Drop Shot sit alongside the groundstrokes rather than in a
 * second "shot type" axis, matching how the recorder has always asked the
 * question: one tap, one stroke.
 */
export const STROKES = ['Forehand', 'Backhand', 'Volley', 'Swing Volley', 'Smash', 'Drop Shot'] as const;
export type StrokeName = (typeof STROKES)[number];

/**
 * Which outcomes are actually POSSIBLE given who served and who won the point.
 *
 * THE FULL MATRIX, worked through per category:
 *
 *   SERVE / RETURN — every one of these is decided by the serve itself, so each
 *   has exactly ONE side it can hand the point to. That makes the whole
 *   category filterable:
 *     · Ace           → only the SERVER can win this way. Impossible when the
 *                       returner won: you cannot ace someone and lose the point.
 *     · Double fault  → only the RETURNER can win this way. Impossible when the
 *                       server won: a double fault always LOSES the server the
 *                       point. (And the returner can never "have" a double
 *                       fault at all — only the server serves.)
 *     · Return error  → the RETURNER missed the return, so only the SERVER can
 *                       win this way. Impossible when the returner won.
 *   So: server won → { ace, return_error }; returner won → { double_fault }.
 *   Ace / return_error can never co-appear with double_fault, because the first
 *   two require the server to win and the third requires them to lose.
 *
 *   WINNER — either side can hit a winner on any point, serving or returning
 *   (a serve+1 forehand, a return winner). Nothing to filter.
 *
 *   UNFORCED ERROR — attributed to whoever LOST the point, and either side can
 *   miss unforced whether they served or returned. Nothing to filter.
 *
 *   FORCED / INDUCED ERROR — same: the loser was pushed into it, and either
 *   side can be pushed. Nothing to filter.
 *
 *   STROKE and BALL TYPE — orthogonal to who served. Any stroke can produce
 *   any of the three rally outcomes, and any ball can cause any error.
 *
 *   RALLY LENGTH — already excluded for serve/return outcomes elsewhere (an
 *   ace, double fault or return error has no rally to measure).
 *
 * So the serve/return category is the ONLY one with impossible combinations,
 * and this is the whole of that rule.
 */
export function serveOutcomesFor(
  server: Side,
  pointWinner: Side,
): ReadonlyArray<(typeof SERVE_OUTCOMES)[number]> {
  const goesTo = pointWinner === server ? 'server' : 'returner';
  return SERVE_OUTCOMES.filter((o) => o.pointGoesTo === goesTo);
}

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
 *
 * There is deliberately NO "5+" quick button: it recorded "more than five" and
 * nothing else, so a 6-shot rally and a 25-shot rally became the same datum.
 * Anything above five now goes through `Custom`, which takes the exact number.
 * The literal '5+' stays in the TYPE only so points logged before that change
 * (already written to `player_entries.metadata`) still read back and bucket.
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
  /**
   * `stroke` is set ONLY for `return_error`, and names the stroke the RETURNER
   * missed with. Optional because aces and double faults have no returner
   * stroke, and because points logged before this field existed have none.
   */
  | { kind: 'serve'; detail: ServeDetail; stroke?: string }
  | { kind: 'ue'; stroke: string; errorCause?: ErrorCause }
  | { kind: 'forced'; stroke: string; errorCause?: ErrorCause }
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
  /**
   * Which serve the point was played on — 1 for a first serve, 2 for a second.
   *
   * Asked for every outcome EXCEPT a double fault, which is a second-serve point
   * by definition and is derived rather than asked (see aggregateManualStats).
   * Optional twice over: the whole question is gated behind the recorder's
   * "Advanced serve stats" setting, and each individual instance can be skipped.
   */
  serveNumber?: 1 | 2;
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

/** Outcomes that carry an error cause (FEATURE C). */
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

/**
 * First/second-serve counting for one SERVING side.
 *
 * `first`/`second` are serve points whose serve number is known; `firstWon`/
 * `secondWon` are the subset the SERVER won. `unspecified` is every serve point
 * where the step was skipped (or never asked) — kept so a percentage is never
 * quietly computed over a denominator smaller than the coach thinks it is.
 */
export type ServeNumberStats = {
  first: number;
  second: number;
  firstWon: number;
  secondWon: number;
  unspecified: number;
};

/** A tally per error-cause axis: `{depth: {Deep: 3}, speed: {Fast: 1}, …}`. */
export type ErrorCauseTallies = Record<ErrorCauseDimension, Tally>;

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
  ueByErrorCause: Record<Side, ErrorCauseTallies>;
  forcedByStroke: Record<Side, Tally>;
  /**
   * Missed returns by the stroke that missed them, attributed to the RETURNER
   * (the side that made the error) — the same convention as ueByStroke.
   */
  returnErrorsByStroke: Record<Side, Tally>;
  forcedByErrorCause: Record<Side, ErrorCauseTallies>;
  servePointsBySide: Record<Side, ServeSideStats>;
  /**
   * First/second serve, keyed by the side that SERVED the point (not the side
   * that won it) — a serve statistic belongs to the server.
   */
  serveNumberBySide: Record<Side, ServeNumberStats>;
  /** Serve points across both sides that carry an explicit or derived serve number. */
  serveNumberRecorded: number;
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

const emptyCauseTallies = (): ErrorCauseTallies => ({ depth: {}, direction: {}, height: {}, speed: {} });

const emptySideCauseTallies = (): Record<Side, ErrorCauseTallies> => ({
  player: emptyCauseTallies(),
  opponent: emptyCauseTallies(),
});

const emptyServeNumbers = (): ServeNumberStats => ({
  first: 0,
  second: 0,
  firstWon: 0,
  secondWon: 0,
  unspecified: 0,
});

/** Tally whichever of the four axes the coach actually answered. */
function bumpCause(t: ErrorCauseTallies, c: ErrorCause | undefined) {
  if (!c) return;
  for (const k of ERROR_CAUSE_KEYS) {
    const v = c[k];
    if (v) bump(t[k], v);
  }
}

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
    ueByErrorCause: emptySideCauseTallies(),
    forcedByStroke: emptySideTallies(),
    returnErrorsByStroke: emptySideTallies(),
    forcedByErrorCause: emptySideCauseTallies(),
    servePointsBySide: {
      player: { aces: 0, doubleFaults: 0, returnErrorsWon: 0 },
      opponent: { aces: 0, doubleFaults: 0, returnErrorsWon: 0 },
    },
    serveNumberBySide: { player: emptyServeNumbers(), opponent: emptyServeNumbers() },
    serveNumberRecorded: 0,
    breakPoints: 0,
    setPoints: 0,
    matchPoints: 0,
    rallyLengthByEndingSide: emptySideTallies(),
    rallyUnspecifiedByEndingSide: { player: 0, opponent: 0 },
  };

  /**
   * Was the serve-number question asked at all in this log?
   *
   * The double-fault derivation below is only sound when it is joining real
   * answers. With "Advanced serve stats" off, nothing carries a serve number,
   * and deriving second serves from double faults alone would manufacture a
   * "100% second serve" match out of two or three points.
   */
  const serveNumberAsked = points.some((p) => p.serveNumber === 1 || p.serveNumber === 2);

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
      bumpCause(s.ueByErrorCause[side], o.errorCause);
      if (pt.rallyLength !== undefined) bump(s.rallyLengthByEndingSide[side], String(pt.rallyLength));
      else s.rallyUnspecifiedByEndingSide[side] += 1;
    } else if (o.kind === 'forced') {
      s.forcedErrors += 1;
      const side = errorSide(pt);
      bump(s.forcedByStroke[side], o.stroke);
      bumpCause(s.forcedByErrorCause[side], o.errorCause);
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
        // The RETURNER made the error, so it belongs to the other side.
        if (o.stroke) bump(s.returnErrorsByStroke[server === 'player' ? 'opponent' : 'player'], o.stroke);
      }
    }

    /**
     * FIRST / SECOND SERVE.
     *
     * Attributed to the SERVER (`pt.server`, the derived rotation) — a serve
     * number is a property of the serve, not of whoever happened to win.
     *
     * A DOUBLE FAULT is counted as a second serve WITHOUT being asked: missing
     * the second serve is what a double fault is, so asking would be a tap that
     * can only have one answer. Deriving it also keeps the denominator honest —
     * leave double faults out and second-serve win rate is computed over only
     * the second serves that went in, which flatters it.
     */
    const serveSide: Side | undefined =
      pt.server ??
      (pt.outcome.kind === 'serve'
        ? pt.outcome.detail === 'double_fault'
          ? errorSide(pt)
          : pt.winner
        : undefined);
    if (serveSide) {
      const isDoubleFault = pt.outcome.kind === 'serve' && pt.outcome.detail === 'double_fault';
      const n = isDoubleFault && serveNumberAsked ? 2 : pt.serveNumber;
      const bucket = s.serveNumberBySide[serveSide];
      if (n === 1) {
        bucket.first += 1;
        if (pt.winner === serveSide) bucket.firstWon += 1;
        s.serveNumberRecorded += 1;
      } else if (n === 2) {
        bucket.second += 1;
        if (pt.winner === serveSide) bucket.secondWon += 1;
        s.serveNumberRecorded += 1;
      } else {
        bucket.unspecified += 1;
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
  if (isErrorOutcome(o) && hasErrorCause(o.errorCause)) {
    return base + ' (off a ' + describeErrorCause(o.errorCause) + ' ball)';
  }
  return base;
}

/** "deep, center, high, fast" — only the axes that were answered. */
export function describeErrorCause(c: ErrorCause): string {
  return ERROR_CAUSE_KEYS.map((k) => c[k])
    .filter((v): v is string => !!v)
    .map((v) => v.toLowerCase())
    .join(', ');
}

/** Per-axis lines for the plain-text report, skipping axes with nothing in them. */
function causeLines(t: ErrorCauseTallies, indent = '  '): string[] {
  const out: string[] = [];
  for (const d of ERROR_CAUSE_DIMENSIONS) {
    const entries = Object.entries(t[d.key]);
    if (!entries.length) continue;
    out.push(indent + d.label + ':');
    out.push(...tallyLines(t[d.key], indent + '  '));
  }
  return out.length ? out : [indent + '(none recorded)'];
}

/** Merge the unforced and forced tallies for one side — one picture per axis. */
function mergedCauseTallies(a: ErrorCauseTallies, b: ErrorCauseTallies): ErrorCauseTallies {
  const out: ErrorCauseTallies = { depth: {}, direction: {}, height: {}, speed: {} };
  for (const k of ERROR_CAUSE_KEYS) {
    for (const [label, n] of Object.entries(a[k])) out[k][label] = (out[k][label] ?? 0) + n;
    for (const [label, n] of Object.entries(b[k])) out[k][label] = (out[k][label] ?? 0) + n;
  }
  return out;
}

export { mergedCauseTallies };

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
    lines.push(nameOf(side) + ' — unforced errors by the ball that caused them:');
    lines.push(...causeLines(st.ueByErrorCause[side]));
  }
  lines.push('');

  lines.push('FORCED (INDUCED) ERROR ANALYSIS');
  for (const side of SIDES) {
    lines.push(nameOf(side) + ' — forced errors by stroke:');
    lines.push(...tallyLines(st.forcedByStroke[side]));
    lines.push(nameOf(side) + ' — forced errors by the ball that caused them:');
    lines.push(...causeLines(st.forcedByErrorCause[side]));
  }
  lines.push('');

  lines.push('RETURN ERROR ANALYSIS');
  for (const side of SIDES) {
    lines.push(nameOf(side) + ' — missed returns by stroke:');
    lines.push(...tallyLines(st.returnErrorsByStroke[side]));
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
  if (st.serveNumberRecorded > 0) {
    lines.push('');
    lines.push('FIRST AND SECOND SERVE');
    for (const side of SIDES) {
      const sn = st.serveNumberBySide[side];
      const known = sn.first + sn.second;
      const pct = (n: number) => (known === 0 ? '—' : ((n / known) * 100).toFixed(1) + '%');
      const wonPct = (won: number, of: number) => (of === 0 ? '—' : ((won / of) * 100).toFixed(1) + '%');
      lines.push(
        nameOf(side) +
          ' serving — first serves: ' +
          sn.first +
          ' (' +
          pct(sn.first) +
          '), second serves: ' +
          sn.second +
          ' (' +
          pct(sn.second) +
          ')',
      );
      lines.push(
        '  points won on 1st serve: ' +
          sn.firstWon +
          '/' +
          sn.first +
          ' (' +
          wonPct(sn.firstWon, sn.first) +
          '), on 2nd serve: ' +
          sn.secondWon +
          '/' +
          sn.second +
          ' (' +
          wonPct(sn.secondWon, sn.second) +
          ')',
      );
      if (sn.unspecified > 0) {
        lines.push('  serve points with no serve number recorded: ' + sn.unspecified);
      }
    }
    lines.push(
      'Double faults count as second-serve points and are not asked for; every other serve number is the coach\'s own entry.',
    );
    lines.push('');
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
    const sn = pt.serveNumber ? ' · ' + (pt.serveNumber === 1 ? '1st serve' : '2nd serve') : '';
    lines.push(
      'Point ' + (i + 1) + ': ' + outcomeTag(pt.outcome) + ' — won by ' + nameOf(pt.winner) + serving + sn + rally + tag,
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
      '. Review the winner/UE breakdowns above (and the depth/direction/height/speed of the balls driving errors) for session priorities.',
  );

  return lines.join('\n');
}
