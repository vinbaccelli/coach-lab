/**
 * The manual match report — the same product surface as the decoder's.
 *
 * WHY THIS MAPS ONTO `SideReport` RATHER THAN INVENTING A SHAPE
 * `SideReport[]` is already consumed by three things: `MatchReportView` (the
 * on-screen report), `buildDocsSections` (the Google Docs payload) and
 * `saveReportToPlayers`. Emitting that shape means the manual recorder reuses
 * all three unchanged instead of growing a parallel renderer and exporter that
 * would drift from the decoder's.
 *
 * The CHARTS are the decoder's own `svgCharts` helpers, which take plain
 * `{label, value}` items and know nothing about where the numbers came from.
 * So the two reports share one visual system by construction, not by imitation.
 *
 * WHAT MANUAL DELIBERATELY DOES NOT SHOW
 * No shot-distribution or spin donuts, and no serve/return accuracy-by-court
 * bars. Those need SwingVision's per-shot totals and video-derived spin/placement
 * data, which point-by-point logging simply does not have. They are omitted
 * rather than approximated — a chart built from a guess is worse than no chart.
 *
 * WHAT MANUAL HAS THAT THE DECODER DOES NOT
 * Forced (induced) errors as a category of their own, the BALL that caused each
 * error described on four axes (depth / direction / height / speed), RALLY
 * LENGTH, and FIRST vs SECOND SERVE. All of them come from the coach's own eyes
 * and have no equivalent in the screenshot pipeline.
 */

import type { ReportSection, ReportStatRow, SideReport } from '@/lib/matchAnalysis/reportModel';
import {
  compareBarChart,
  divergingBarChart,
  donutChart,
  fmtNum,
  hBarChart,
  statTiles,
  type BarItem,
} from '@/lib/matchAnalysis/svgCharts';
import type { Side } from '@/lib/tennis/gameScore';
import type { FormattedBoard } from '@/lib/tennis/matchFormat';
import {
  aggregateManualStats,
  ERROR_CAUSE_DIMENSIONS,
  mergedCauseTallies,
  RALLY_LENGTH_BUCKETS,
  type FinishReason,
  type LoggedPoint,
  type ManualStats,
} from '@/lib/tennis/compileManualReport';

export type ManualReportInput = {
  playerName: string;
  opponentName: string;
  points: LoggedPoint[];
  board?: FormattedBoard;
  startingScoreNote?: string | null;
  finish?: FinishReason;
  gameNotes?: string[];
};

/** `player` is always side A, so A/B ordering matches the recorder's own labels. */
const SIDE_OF: Record<Side, 'A' | 'B'> = { player: 'A', opponent: 'B' };

const other = (s: Side): Side => (s === 'player' ? 'opponent' : 'player');

function row(
  label: string,
  value: string | null,
  note?: string,
  extra?: Partial<ReportStatRow>,
): ReportStatRow {
  return { label, value, note, tier: 'simple', ...extra };
}

/** `{stroke: n}` tallies → chart items, biggest first, zeroes dropped. */
function tallyItems(t: Record<string, number>): BarItem[] {
  return Object.entries(t)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, value]) => ({ label, value }));
}

function scoreLine(board?: FormattedBoard): string | null {
  if (!board) return null;
  const sets = board.sets.length ? board.sets.map(([a, b]) => `${a}-${b}`).join(', ') : null;
  const games = `${board.games[0]}-${board.games[1]}`;
  return sets ? `Sets ${sets} · games ${games}` : `Games ${games}`;
}

/**
 * The caveat that has to travel with every number in a manual report.
 *
 * A manual log covers the points the coach actually recorded — which is not the
 * same as the whole match when it was stopped early, or started from a score
 * already in progress. Saying so on the report itself means the totals cannot be
 * mistaken for a complete match record later.
 */
function coverageNote(input: ManualReportInput, st: ManualStats): string {
  const base = `Counted from ${st.totalPoints} manually logged point${st.totalPoints === 1 ? '' : 's'}.`;
  if (input.finish === 'stopped_early') {
    return `${base} The match was finished early, so this is a partial record.`;
  }
  if (input.startingScoreNote) {
    return `${base} The match began from a score already in progress, so earlier points are not included.`;
  }
  return base;
}

// ── sections ───────────────────────────────────────────────────────────────

function sectionHeadline(input: ManualReportInput, st: ManualStats, side: Side): ReportSection {
  const me = side;
  const them = other(side);
  const mine = st.pointsWon[me];
  const theirs = st.pointsWon[them];
  const myWinners = Object.values(st.winnersByStroke[me]).reduce((a, b) => a + b, 0);
  const myUe = Object.values(st.ueByStroke[me]).reduce((a, b) => a + b, 0);
  const myForced = Object.values(st.forcedByStroke[me]).reduce((a, b) => a + b, 0);
  const diff = myWinners - myUe;
  const ratio = myUe === 0 ? myWinners : myWinners / myUe;

  const charts = [
    statTiles({
      title: 'Headline indices',
      tiles: [
        { label: 'Points won', value: String(mine), formula: `of ${st.totalPoints} logged` },
        { label: 'Winners', value: String(myWinners) },
        { label: 'Unforced errors', value: String(myUe) },
        { label: 'Forced errors conceded', value: String(myForced) },
        { label: 'Winner–error differential', value: String(diff), formula: 'winners − unforced' },
        { label: 'Error efficiency', value: fmtNum(ratio, 2), formula: 'winners ÷ unforced' },
      ],
    }),
    compareBarChart({
      title: 'Head to head',
      aLabel: input.playerName,
      bLabel: input.opponentName,
      groups: [
        { label: 'Points won', a: st.pointsWon.player, b: st.pointsWon.opponent },
        {
          label: 'Winners',
          a: Object.values(st.winnersByStroke.player).reduce((x, y) => x + y, 0),
          b: Object.values(st.winnersByStroke.opponent).reduce((x, y) => x + y, 0),
        },
        {
          label: 'Unforced errors',
          a: Object.values(st.ueByStroke.player).reduce((x, y) => x + y, 0),
          b: Object.values(st.ueByStroke.opponent).reduce((x, y) => x + y, 0),
        },
        {
          label: 'Forced errors',
          a: Object.values(st.forcedByStroke.player).reduce((x, y) => x + y, 0),
          b: Object.values(st.forcedByStroke.opponent).reduce((x, y) => x + y, 0),
        },
      ],
    }),
    divergingBarChart({
      title: 'Winner–Error Differential (Winners − Unforced Errors)',
      items: [
        {
          label: input.playerName,
          value:
            Object.values(st.winnersByStroke.player).reduce((x, y) => x + y, 0) -
            Object.values(st.ueByStroke.player).reduce((x, y) => x + y, 0),
        },
        {
          label: input.opponentName,
          value:
            Object.values(st.winnersByStroke.opponent).reduce((x, y) => x + y, 0) -
            Object.values(st.ueByStroke.opponent).reduce((x, y) => x + y, 0),
        },
      ],
    }),
  ];

  const rows: ReportStatRow[] = [
    row('Points won', String(mine), `Out of ${st.totalPoints} logged points.`, {
      opponent: String(theirs),
      howComputed: 'Counted from the logged points.',
    }),
    row('Winners', String(myWinners), 'Point-ending shots this side hit.', {
      howComputed: 'Points logged as a winner and won by this side.',
    }),
    row('Unforced errors', String(myUe), 'Mistakes with no pressure from the opponent.', {
      howComputed: 'Points logged as an unforced error and lost by this side.',
    }),
    row(
      'Forced errors conceded',
      String(myForced),
      'Errors this side was pushed into by the opponent — counted apart from unforced errors, and never as opponent winners.',
      { tier: 'intermediate', howComputed: 'Points logged as an induced/forced error and lost by this side.' },
    ),
    row('Winner–error differential', String(diff), 'Above zero means more created than given away.', {
      tier: 'intermediate',
      howComputed: 'Winners − unforced errors.',
    }),
    row('Error efficiency ratio', fmtNum(ratio, 2), 'Winners per unforced error.', {
      tier: 'complex',
      howComputed: 'Winners ÷ unforced errors.',
    }),
  ];

  const notes = [coverageNote(input, st)];
  const sl = scoreLine(input.board);
  if (sl) {
    notes.push(
      input.finish === 'completed'
        ? `Final score — ${sl}.`
        : input.finish === 'stopped_early'
          ? `Score when the match was stopped — ${sl}.`
          : `Score so far — ${sl}.`,
    );
  }
  if (input.startingScoreNote) notes.push(input.startingScoreNote);

  return {
    id: 'general',
    number: 1,
    heading: 'General stats & indices',
    explanation:
      'The headline numbers: what this side created, what it gave away, and the balance between the two.',
    rows,
    charts,
    notes,
    present: st.totalPoints > 0,
    coverage: coverageNote(input, st),
  };
}

function sectionWinners(st: ManualStats, side: Side): ReportSection {
  const items = tallyItems(st.winnersByStroke[side]);
  const total = items.reduce((a, b) => a + b.value, 0);
  return {
    id: 'winners',
    number: 2,
    heading: 'Winners by stroke',
    explanation: 'Which shots finished points. The tallest bar is this side’s most reliable weapon.',
    rows: [
      row('Total winners', String(total), 'Every point-ending shot logged for this side.'),
      ...items.map((i) => row(i.label, String(i.value), undefined, { tier: 'simple' as const })),
    ],
    charts: items.length ? [hBarChart({ title: 'Winners by stroke', items })] : [],
    notes: items.length ? [] : ['No winners were logged for this side.'],
    present: total > 0,
  };
}

function sectionUnforced(st: ManualStats, side: Side): ReportSection {
  const items = tallyItems(st.ueByStroke[side]);
  const total = items.reduce((a, b) => a + b.value, 0);
  return {
    id: 'unforced-errors',
    number: 3,
    heading: 'Unforced errors by stroke',
    explanation:
      'Which stroke leaked the most free points. The tallest bar is the first thing to work on in practice.',
    rows: [
      row('Total unforced errors', String(total), 'Mistakes made with no pressure from the opponent.'),
      ...items.map((i) => row(i.label, String(i.value), undefined, { tier: 'simple' as const })),
    ],
    charts: items.length ? [hBarChart({ title: 'Unforced errors by stroke', items })] : [],
    notes: items.length ? [] : ['No unforced errors were logged for this side.'],
    present: total > 0,
  };
}

function sectionForced(st: ManualStats, side: Side): ReportSection {
  const items = tallyItems(st.forcedByStroke[side]);
  const total = items.reduce((a, b) => a + b.value, 0);
  return {
    id: 'forced-errors',
    number: 4,
    heading: 'Forced (induced) errors by stroke',
    explanation:
      'Errors the opponent pushed this side into. High numbers here are not carelessness — they are a sign of being outplayed on that wing.',
    rows: [
      row('Total forced errors', String(total), 'Errors conceded under genuine pressure.'),
      ...items.map((i) => row(i.label, String(i.value), undefined, { tier: 'simple' as const })),
    ],
    charts: items.length ? [hBarChart({ title: 'Forced errors by stroke', items })] : [],
    notes: items.length
      ? []
      : ['No forced errors were logged for this side — this category is only recorded when the coach selects it.'],
    present: total > 0,
  };
}

/**
 * What the ball that caused the errors was actually like — on four axes.
 *
 * REPLACES the old single "ball type" donut. That chart mixed axes ("Deep +
 * High" was depth and height at once, "Slice" was spin), so its slices were not
 * mutually exclusive and its percentages did not mean anything you could act on.
 *
 * ONE SECTION, FOUR CHARTS rather than four sections: a coach reads these
 * together — "short, to the backhand side, high and slow" is one picture of what
 * beats this player, and splitting it across four headings would bury that.
 * Each axis is charted only when it has data, since every one is independently
 * skippable while logging.
 */
function sectionErrorCause(st: ManualStats, side: Side): ReportSection {
  // Both error kinds share one picture: the question "what beat this player"
  // does not care whether the miss was scored unforced or forced.
  const merged = mergedCauseTallies(st.ueByErrorCause[side], st.forcedByErrorCause[side]);

  const perDimension = ERROR_CAUSE_DIMENSIONS.map((d) => {
    const items = tallyItems(merged[d.key]);
    return { dimension: d, items, total: items.reduce((a, b) => a + b.value, 0) };
  });
  const answered = perDimension.filter((d) => d.total > 0);
  const grandTotal = answered.reduce((a, b) => a + b.total, 0);

  const rows: ReportStatRow[] = [];
  for (const d of answered) {
    rows.push(
      row(d.dimension.label, String(d.total), `Errors with the ball's ${d.dimension.label.toLowerCase()} recorded.`),
    );
    rows.push(
      ...d.items.map((i) =>
        row(`${d.dimension.label} — ${i.label}`, String(i.value), undefined, { tier: 'simple' as const }),
      ),
    );
  }

  const notes: string[] = [];
  if (!grandTotal) {
    notes.push(
      'No ball descriptions were recorded — all four questions are optional and can be skipped while logging, or turned off entirely for the match.',
    );
  } else {
    const skipped = ERROR_CAUSE_DIMENSIONS.filter(
      (d) => !answered.some((a) => a.dimension.key === d.key),
    ).map((d) => d.label.toLowerCase());
    if (skipped.length) {
      notes.push(`Nothing was recorded for ${skipped.join(', ')} — those questions were skipped on every error.`);
    }
    notes.push(
      'Each axis is counted separately, so the four totals need not match: a coach may answer depth on one error and speed on another.',
    );
  }

  return {
    id: 'error-cause',
    number: 5,
    heading: 'What ball caused the errors',
    explanation:
      'The shot that drew the mistake, broken down by how deep it landed, where it went, how high it came through and how fast it was travelling — the tactical counterpart to "which stroke missed".',
    rows,
    charts: answered.map((d) =>
      hBarChart({ title: `Errors by the ball's ${d.dimension.label.toLowerCase()}`, items: d.items }),
    ),
    notes,
    present: grandTotal > 0,
  };
}

/** '2'/'3'/'4'/'5'/'5+' bucket label → the row/legend text. */
function bucketRowLabel(bucket: string): string {
  return bucket === '5+' ? '5+ shots' : `${bucket} shots`;
}

/**
 * `rallyLengthByEndingSide` keeps the RAW logged value (any positive integer,
 * or the literal '5+'); this buckets it into the five fixed, ordered display
 * categories the chart and rows use. Bucketing at read time, not at logging
 * time, keeps the stored point data exact.
 */
function rallyLengthItems(st: ManualStats, side: Side): BarItem[] {
  const buckets: Record<string, number> = { '2': 0, '3': 0, '4': 0, '5': 0, '5+': 0 };
  for (const [raw, count] of Object.entries(st.rallyLengthByEndingSide[side])) {
    const n = raw === '5+' ? '5+' : Number(raw);
    const b = n === '5+' ? '5+' : n <= 2 ? '2' : n >= 5 ? '5+' : String(n);
    buckets[b] = (buckets[b] ?? 0) + count;
  }
  return RALLY_LENGTH_BUCKETS.map((b) => ({ label: bucketRowLabel(b), value: buckets[b] })).filter(
    (i) => i.value > 0,
  );
}

function sectionRallyLength(st: ManualStats, side: Side): ReportSection {
  const items = rallyLengthItems(st, side);
  const total = items.reduce((a, b) => a + b.value, 0);
  const unspecified = st.rallyUnspecifiedByEndingSide[side];
  const notes: string[] = [];
  if (!items.length) {
    // No chart below — so this is the one note about it, worded so a "no
    // rally lengths" report never reads as a bug: either every qualifying
    // point skipped the (optional) step, or this side had none to begin with.
    notes.push(
      unspecified > 0
        ? `No rally lengths recorded for this side — every point this side ended (${unspecified}) skipped this optional step.`
        : 'No rally lengths were recorded for this side — this step is optional and can be skipped while logging.',
    );
  } else if (unspecified > 0) {
    notes.push(
      `${unspecified} point${unspecified === 1 ? '' : 's'} this side ended skipped the rally-length step and are not counted in the chart above.`,
    );
  }
  return {
    id: 'rally-length',
    number: 6,
    heading: 'Rally length',
    explanation:
      'How many shots the point ran before this side ended it, winner or error. Short rallies alongside a high error count is a different problem to solve than long rallies wearing a player down.',
    rows: [
      row(
        'Points with a rally length recorded',
        String(total),
        'Winners and errors this side ended, with a length logged.',
      ),
      ...items.map((i) => row(i.label, String(i.value), undefined, { tier: 'simple' as const })),
    ],
    charts: items.length ? [hBarChart({ title: 'Rally length distribution', items })] : [],
    notes,
    present: total > 0,
  };
}

function sectionServe(input: ManualReportInput, st: ManualStats): ReportSection {
  const a = st.servePointsBySide.player;
  const b = st.servePointsBySide.opponent;
  const chart = compareBarChart({
    title: 'Serve & return outcomes',
    aLabel: input.playerName,
    bLabel: input.opponentName,
    groups: [
      { label: 'Aces', a: a.aces, b: b.aces },
      { label: 'Double faults', a: a.doubleFaults, b: b.doubleFaults },
      { label: 'Return errors won', a: a.returnErrorsWon, b: b.returnErrorsWon },
    ],
  });
  const any = a.aces + a.doubleFaults + a.returnErrorsWon + b.aces + b.doubleFaults + b.returnErrorsWon > 0;
  return {
    id: 'serve-return',
    number: 7,
    heading: 'Serve & return',
    explanation:
      'What the serve won outright and what it gave away. "Return errors won" are points the server took because the return missed.',
    rows: [
      row('Aces', String(a.aces), 'Serves that were never returned.', { opponent: String(b.aces) }),
      row('Double faults', String(a.doubleFaults), 'Points given away before a rally started.', {
        opponent: String(b.doubleFaults),
      }),
      row('Points won on return errors', String(a.returnErrorsWon), 'The opponent missed the return.', {
        opponent: String(b.returnErrorsWon),
        tier: 'intermediate',
      }),
    ],
    charts: any ? [chart] : [],
    notes: [
      'Serve outcomes are attributed using the server derived from the starting server and the game count, not a per-point selection.',
      'Serve speed is not available from manual logging — it needs the video-based decoder.',
    ],
    present: any,
  };
}

/**
 * FIRST vs SECOND SERVE.
 *
 * Present only when the recorder actually asked — the question sits behind the
 * "Advanced serve stats" setting, and each individual point can still skip it.
 * When nothing was recorded this section renders as absent rather than as a
 * match played entirely on first serves.
 *
 * DOUBLE FAULTS ARE SECOND SERVES and are counted as such without ever being
 * asked (see aggregateManualStats). Leaving them out would compute the
 * second-serve win rate over only the second serves that landed, which flatters
 * every player who double-faults.
 */
function sectionServeNumber(input: ManualReportInput, st: ManualStats, side: Side): ReportSection {
  const me = st.serveNumberBySide[side];
  const them = st.serveNumberBySide[other(side)];
  const known = me.first + me.second;
  const pct = (n: number, of: number): string | null => (of === 0 ? null : `${fmtNum((n / of) * 100, 1)}%`);
  const oppKnown = them.first + them.second;

  const rows: ReportStatRow[] = [
    row('First serves', String(me.first), 'Points played on a first serve.', {
      opponent: String(them.first),
      howComputed: 'Serve points this side served with the serve number logged as first.',
    }),
    row('Second serves', String(me.second), 'Points played on a second serve, double faults included.', {
      opponent: String(them.second),
      howComputed: 'Serve points logged as second, plus every double fault (a double fault is a second serve by definition).',
    }),
    row('First-serve percentage', pct(me.first, known), 'How often the point started on a first serve.', {
      opponent: pct(them.first, oppKnown),
      tier: 'intermediate',
      howComputed: 'First serves ÷ (first + second serves with a number recorded).',
    }),
    row('Second-serve percentage', pct(me.second, known), 'The share of points played on a second ball.', {
      opponent: pct(them.second, oppKnown),
      tier: 'intermediate',
      howComputed: 'Second serves ÷ (first + second serves with a number recorded).',
    }),
    row('Points won on first serve', pct(me.firstWon, me.first), `${me.firstWon} of ${me.first} first-serve points.`, {
      opponent: pct(them.firstWon, them.first),
      tier: 'intermediate',
      howComputed: 'First-serve points this side won ÷ first-serve points this side served.',
    }),
    row('Points won on second serve', pct(me.secondWon, me.second), `${me.secondWon} of ${me.second} second-serve points.`, {
      opponent: pct(them.secondWon, them.second),
      tier: 'intermediate',
      howComputed: 'Second-serve points this side won ÷ second-serve points this side served.',
    }),
  ];

  const charts: string[] = [];
  if (known > 0) {
    charts.push(
      statTiles({
        title: 'Serve numbers',
        tiles: [
          { label: 'First-serve %', value: pct(me.first, known) ?? '—', formula: `${me.first} of ${known}` },
          {
            label: 'Won on 1st serve',
            value: pct(me.firstWon, me.first) ?? '—',
            formula: `${me.firstWon} of ${me.first}`,
          },
          {
            label: 'Won on 2nd serve',
            value: pct(me.secondWon, me.second) ?? '—',
            formula: `${me.secondWon} of ${me.second}`,
          },
        ],
      }),
    );
  }
  if (known > 0 || oppKnown > 0) {
    charts.push(
      compareBarChart({
        title: 'First and second serve',
        aLabel: input.playerName,
        bLabel: input.opponentName,
        groups: [
          {
            label: 'First serves',
            a: st.serveNumberBySide.player.first,
            b: st.serveNumberBySide.opponent.first,
          },
          {
            label: 'Second serves',
            a: st.serveNumberBySide.player.second,
            b: st.serveNumberBySide.opponent.second,
          },
          {
            label: 'Won on 1st',
            a: st.serveNumberBySide.player.firstWon,
            b: st.serveNumberBySide.opponent.firstWon,
          },
          {
            label: 'Won on 2nd',
            a: st.serveNumberBySide.player.secondWon,
            b: st.serveNumberBySide.opponent.secondWon,
          },
        ],
      }),
    );
  }

  const notes: string[] = [];
  if (!st.serveNumberRecorded) {
    notes.push(
      'No serve numbers were recorded for this match — the first/second serve question was either turned off in the recorder or skipped on every point.',
    );
  } else {
    notes.push('Double faults are counted as second serves and are never asked for — a missed second serve is what a double fault is.');
    if (me.unspecified > 0) {
      notes.push(
        `${me.unspecified} serve point${me.unspecified === 1 ? '' : 's'} this side served had no serve number recorded and are excluded from every percentage above.`,
      );
    }
  }

  return {
    id: 'serve-number',
    number: 8,
    heading: 'First & second serve',
    explanation:
      'How often this side got a first serve in, and how much each ball was worth once it did — the difference between a player who is losing points and one who is losing second-serve points.',
    rows,
    charts,
    notes,
    present: st.serveNumberRecorded > 0,
  };
}

function sectionSummary(input: ManualReportInput, st: ManualStats, side: Side): ReportSection {
  const me = side;
  const winners = Object.values(st.winnersByStroke[me]).reduce((a, b) => a + b, 0);
  const ue = Object.values(st.ueByStroke[me]).reduce((a, b) => a + b, 0);
  const worstUe = tallyItems(st.ueByStroke[me])[0];
  const bestWinner = tallyItems(st.winnersByStroke[me])[0];
  const mergedCause = mergedCauseTallies(st.ueByErrorCause[me], st.forcedByErrorCause[me]);
  // The single loudest signal across all four axes — "deep" and "fast" compete
  // on equal footing, since either could be the thing that actually beat them.
  const worstBall = ERROR_CAUSE_DIMENSIONS.flatMap((d) =>
    tallyItems(mergedCause[d.key]).map((i) => ({ ...i, label: `${i.label} (${d.label.toLowerCase()})` })),
  ).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))[0];

  const notes: string[] = [];
  if (bestWinner) notes.push(`Most productive shot: ${bestWinner.label} (${bestWinner.value} winner${bestWinner.value === 1 ? '' : 's'}).`);
  if (worstUe) notes.push(`Most costly stroke: ${worstUe.label} (${worstUe.value} unforced error${worstUe.value === 1 ? '' : 's'}).`);
  if (worstBall) notes.push(`Ball that caused the most trouble: ${worstBall.label} (${worstBall.value}).`);
  const bigPoints = st.breakPoints + st.setPoints + st.matchPoints;
  if (bigPoints) {
    const parts: string[] = [];
    if (st.breakPoints) parts.push(`${st.breakPoints} break point${st.breakPoints === 1 ? '' : 's'}`);
    if (st.setPoints) parts.push(`${st.setPoints} set point${st.setPoints === 1 ? '' : 's'}`);
    if (st.matchPoints) parts.push(`${st.matchPoints} match point${st.matchPoints === 1 ? '' : 's'}`);
    notes.push(`${parts.join(', ')} played — derived automatically from the score, not flagged by hand.`);
  }
  if (input.gameNotes?.length) notes.push(...input.gameNotes.map((n, i) => `Game note ${i + 1}: ${n}`));
  if (!notes.length) notes.push('Not enough logged points to draw a pattern yet.');

  return {
    id: 'summary',
    number: 9,
    heading: 'Coach’s summary',
    explanation: 'The short version — what worked, what cost points, and what to take into practice.',
    rows: [
      row('Winners vs unforced errors', `${winners} vs ${ue}`, 'The balance this session was built on.'),
    ],
    charts: [],
    notes,
    present: true,
  };
}

// ── entry point ────────────────────────────────────────────────────────────

/** Build one side's report. */
export function buildManualSideReport(input: ManualReportInput, side: Side): SideReport {
  const st = aggregateManualStats(input.points);
  return {
    sideId: SIDE_OF[side],
    label: side === 'player' ? input.playerName : input.opponentName,
    sections: [
      sectionHeadline(input, st, side),
      sectionWinners(st, side),
      sectionUnforced(st, side),
      sectionForced(st, side),
      sectionErrorCause(st, side),
      sectionRallyLength(st, side),
      sectionServe(input, st),
      sectionServeNumber(input, st, side),
      sectionSummary(input, st, side),
    ],
  };
}

/**
 * Both sides, player first — the shape `MatchReportView`, `buildDocsSections`
 * and `saveReportToPlayers` already consume.
 */
export function buildManualReport(input: ManualReportInput): SideReport[] {
  return [buildManualSideReport(input, 'player'), buildManualSideReport(input, 'opponent')];
}
