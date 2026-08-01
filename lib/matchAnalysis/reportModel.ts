/**
 * The 6-section report, as DATA.
 *
 * ONE MODEL, TWO RENDERERS. The report page and the Google Docs export both
 * consume this. If a metric is omitted here, it is omitted in both places, with
 * the same wording — there is no path where the screen and the exported document
 * disagree about what the match showed.
 *
 * SECTION OMISSION IS HONEST, NOT SILENT. A section with no usable inputs is
 * still emitted, with `present: false` and the reasons its metrics were
 * unavailable. The reader learns "this could not be measured, because…", which is
 * information; a section that quietly disappears is not.
 *
 * THE FORCED-ERROR HOLE, STATED EVERY TIME IT MATTERS. SwingVision labels only
 * Winner / Unforced Error / Service Winner (= Ace) / Double Fault / Service. It
 * has no forced-error label, so:
 *   - Aggressive Margin (Winners + Forced Errors Induced − Unforced Errors) is
 *     NOT computed and NOT named anywhere in the output.
 *   - Winner–Error Differential (Winners − Unforced Errors) is computed instead,
 *     its formula printed beside it, and section 3 says plainly that forced
 *     errors were unavailable.
 */

import type { MatchAnalysis, Metric, SideAnalysis } from '@/lib/matchAnalysis/types';
import {
  type BarItem,
  compareBarChart,
  divergingBarChart,
  donutChart,
  fmtNum,
  hBarChart,
  statTiles,
} from '@/lib/matchAnalysis/svgCharts';

export interface ReportStatRow {
  label: string;
  /** Formatted value, or null when the metric is absent. */
  value: string | null;
  /** Why it's absent, or a plain-language gloss when present. */
  note?: string;
  /** How to read the number — a benchmark or a rule of thumb, in plain words. */
  context?: string;
  /** The arithmetic, so any figure can be checked rather than trusted. */
  howComputed?: string;
  /** The same measure for the other side, for at-a-glance comparison. */
  opponent?: string | null;
  /**
   * Reading difficulty. Rows are emitted simple → complex so a player meets the
   * headline counts before the derived indices; a club player should never hit a
   * ratio before they have seen the two numbers it divides.
   */
  tier: 'simple' | 'intermediate' | 'complex';
}

export interface ReportSection {
  id: string;
  number: number;
  heading: string;
  /** One short line: what this section means, in plain language. */
  explanation: string;
  rows: ReportStatRow[];
  /** Ready-to-render SVG markup strings. */
  charts: string[];
  /** Honest statements about what could not be measured. */
  notes: string[];
  present: boolean;
  /** Coverage line printed under timeline-derived sections. */
  coverage?: string;
}

export interface SideReport {
  sideId: 'A' | 'B';
  label: string;
  sections: ReportSection[];
}

// ── formatting helpers ────────────────────────────────────────────────────

const val = (m: Metric, decimals = 1, unit = ''): string | null =>
  m.present ? `${fmtNum(m.value, decimals)}${unit}` : null;

const num = (m: Metric): number | null => (m.present ? m.value : null);

const noteOf = (m: Metric, gloss: string): string => (m.present ? gloss : `Not available — ${m.reason}`);

function row(
  label: string,
  m: Metric,
  gloss: string,
  opts: {
    decimals?: number;
    unit?: string;
    context?: string;
    howComputed?: string;
    opponent?: Metric;
    tier?: ReportStatRow['tier'];
  } = {},
): ReportStatRow {
  const { decimals = 1, unit = '', tier = 'simple' } = opts;
  return {
    label,
    value: val(m, decimals, unit),
    note: noteOf(m, gloss),
    context: opts.context,
    howComputed: opts.howComputed,
    opponent: opts.opponent ? val(opts.opponent, decimals, unit) : undefined,
    tier,
  };
}

/** Order rows the way a reader should meet them. */
const TIER_ORDER: Record<ReportStatRow['tier'], number> = { simple: 0, intermediate: 1, complex: 2 };
const bySimplicity = (rows: ReportStatRow[]): ReportStatRow[] =>
  [...rows].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);

/**
 * The provenance line under every timeline-derived section.
 *
 * States coverage AND verification together, because either alone is misleading:
 * "41 of 58 points attributed" says nothing about whether those 41 came from
 * games whose totals SwingVision itself agrees with.
 */
function coverageLine(side: SideAnalysis): string {
  const c = side.coverage;
  const v = side.verification;
  const parts = [
    `Based on ${c.pointsAttributed} of ${c.pointsTotal} points attributed to a side, ` +
      `and ${c.gamesWithKnownServer} of ${c.gamesTotal} games with a known server.`,
    `${v.gamesVerified} game(s) verified against SwingVision's own point count`,
  ];
  if (v.gamesUnchecked > 0) parts.push(`${v.gamesUnchecked} could not be checked (meta line unreadable)`);
  if (v.gamesContradicted > 0) {
    parts.push(
      `${v.gamesContradicted} EXCLUDED because the points read disagree with SwingVision's count — ` +
        `${v.pointsExcluded} point(s) are therefore not counted anywhere above`,
    );
  }
  return `${parts[0]} ${parts.slice(1).join('; ')}.`;
}

/**
 * The note that must appear on any section whose numbers had data withheld.
 *
 * Returned as a list so a section with nothing excluded gets no note at all —
 * a reassurance printed on every section stops being read.
 */
function exclusionNotes(side: SideAnalysis): string[] {
  const v = side.verification;
  if (v.gamesContradicted === 0) return [];
  return [
    `EXCLUDED FROM THESE COUNTS: ${v.gamesContradicted} game(s) whose stitched point count disagrees with the "N points" printed on their own meta line — ${v.excludedGames.join('; ')}. ` +
      `Those ${v.pointsExcluded} point(s) are left out rather than folded in, because the screenshot itself says the read is wrong. The real totals are higher by an unknown amount. Re-shooting those games in a single capture would resolve them.`,
  ];
}

const strokeItems = (counts: SideAnalysis['winnersByStroke']): BarItem[] =>
  counts.map((c) => ({ label: String(c.stroke), value: c.count }));

// ── the six sections ──────────────────────────────────────────────────────

function section1(side: SideAnalysis, opponent: SideAnalysis, analysis: MatchAnalysis): ReportSection {
  const rows: ReportStatRow[] = bySimplicity([
    row('Points won', side.pointsWon, 'How many points this side actually took.', {
      decimals: 0, opponent: opponent.pointsWon, tier: 'simple',
      howComputed: 'Counted from the point-by-point timeline.',
    }),
    row('Winners', side.winners, 'Shots that ended the point outright in this side’s favour.', {
      decimals: 0, opponent: opponent.winners, tier: 'simple',
      howComputed: 'Points labelled “Winner” by SwingVision, credited to whoever won the point.',
    }),
    row('Unforced errors', side.unforcedErrors, 'Mistakes made with time and balance to play the shot — nobody forced them.', {
      decimals: 0, opponent: opponent.unforcedErrors, tier: 'simple',
      howComputed: 'Points labelled “Unforced Error”, credited to whoever LOST the point.',
    }),
    row('Aces', side.aces, 'Serves that won the point on their own.', {
      decimals: 0, opponent: opponent.aces, tier: 'simple',
      howComputed: 'SwingVision’s “Service Winner” label, which is its name for an ace.',
    }),
    row('Double faults', side.doubleFaults, 'Two missed serves in a row — a point handed over.', {
      decimals: 0, opponent: opponent.doubleFaults, tier: 'simple',
      howComputed: 'Counted from the timeline; always the server’s.',
    }),
    row('Point-ending shots', side.pointEndingShots, 'How many points this side finished, one way or the other.', {
      decimals: 0, opponent: opponent.pointEndingShots, tier: 'intermediate',
      howComputed: 'Winners + aces + unforced errors + double faults attributed to this side.',
      context: 'This is the base for the percentages below — worth knowing how big it is.',
    }),
    row('Winner-to-error ratio', side.errorEfficiencyRatio, 'Winners earned for every unforced error given away.', {
      decimals: 2, opponent: opponent.errorEfficiencyRatio, tier: 'intermediate',
      howComputed: 'Winners ÷ unforced errors.',
      context: 'Around 1.0 or better is strong for club level: you are creating as much as you spill. Below 0.5 means errors are paying for the winners.',
    }),
    row('Unforced error rate', side.ueIncidencePercent, 'Of the points this side ended, how many ended on a mistake.', {
      decimals: 1, unit: '%', opponent: opponent.ueIncidencePercent, tier: 'intermediate',
      howComputed: 'Unforced errors ÷ point-ending shots × 100.',
      context: 'Careful: this is a share of POINT-ENDING shots, not of all shots hit — so it is much higher than the 8–12% “errors per shot” figure coaches quote, and the two are not comparable.',
    }),
    row('Unforced errors per shot hit', side.ueRateOfAllShots, 'The classic “error rate” — errors as a share of every ball struck.', {
      decimals: 1, unit: '%', tier: 'complex',
      context: 'Recreational play typically sits around 8–12%.',
    }),
    row('Winner–Error Differential', side.winnerErrorDifferential, 'Whether this side created more than it gave away.', {
      decimals: 0, opponent: opponent.winnerErrorDifferential, tier: 'complex',
      howComputed: 'Winners − unforced errors.',
      context: 'Above zero means more shots won outright than points spilled. This is NOT Aggressive Margin — see the note below.',
    }),
    row('Aces per double fault', side.aceToDoubleFaultRatio, 'Whether the serve was a weapon or a liability.', {
      decimals: 2, opponent: opponent.aceToDoubleFaultRatio, tier: 'complex',
      howComputed: 'Aces ÷ double faults.',
      context: 'Above 1.0 means the serve won more points than it gave away outright.',
    }),
  ]);

  const charts: string[] = [
    statTiles({
      title: 'Headline indices',
      tiles: [
        {
          label: 'Winner–Error Differential',
          value: val(side.winnerErrorDifferential, 0) ?? 'n/a',
          formula: 'Winners − Unforced Errors',
        },
        {
          label: 'Error Efficiency Ratio',
          value: val(side.errorEfficiencyRatio, 2) ?? 'n/a',
          formula: 'Winners ÷ Unforced Errors',
        },
        {
          label: 'UE incidence',
          value: val(side.ueIncidencePercent, 1, '%') ?? 'n/a',
          formula: 'UE ÷ point-ending shots',
        },
      ],
    }),
    compareBarChart({
      title: 'Head to head',
      aLabel: side.label,
      bLabel: opponent.label,
      groups: [
        { label: 'Winners', a: num(side.winners), b: num(opponent.winners) },
        { label: 'Unforced errors', a: num(side.unforcedErrors), b: num(opponent.unforcedErrors) },
        { label: 'Aces', a: num(side.aces), b: num(opponent.aces) },
        { label: 'Double faults', a: num(side.doubleFaults), b: num(opponent.doubleFaults) },
      ],
    }),
  ];

  const diverging: BarItem[] = [side, opponent]
    .filter((s) => s.winnerErrorDifferential.present)
    .map((s) => ({
      label: s.label,
      value: s.winnerErrorDifferential.present ? s.winnerErrorDifferential.value : 0,
    }));
  if (diverging.length) {
    charts.push(divergingBarChart({ title: 'Winner–Error Differential (Winners − Unforced Errors)', items: diverging }));
  }

  const notes = [
    ...exclusionNotes(side),
    'Aggressive Margin is not reported. Its definition includes forced errors induced, and SwingVision does not label forced errors — so the figure shown here is the Winner–Error Differential, with its formula printed, rather than a familiar name over an altered formula.',
  ];
  if (analysis.errorEndedPointsPercent.present) {
    notes.push(
      `CONSISTENCY: ${fmtNum(analysis.errorEndedPointsPercent.value, 0)}% of the points counted here ended on a mistake (an unforced error or a double fault) rather than on a winner. At club level most points are LOST rather than won, so the fastest way to win more of them is usually to give away fewer — not to hit harder.`,
    );
  }
  if (analysis.overallUeIncidencePercent.present) {
    notes.push(
      `Across both sides, ${fmtNum(analysis.overallUeIncidencePercent.value, 1)}% of point-ending shots were unforced errors.`,
    );
  }

  return {
    id: 'general',
    number: 1,
    heading: 'General stats & indices',
    explanation:
      'The headline numbers: what this side created, what it gave away, and the balance between the two.',
    rows,
    charts,
    notes,
    present: rows.some((r) => r.value !== null),
    coverage: coverageLine(side),
  };
}

function section2(side: SideAnalysis): ReportSection {
  const items = strokeItems(side.unforcedErrorsByStroke);
  const total = side.unforcedErrors.present ? side.unforcedErrors.value : 0;
  const worst = side.unforcedErrorsByStroke[0];
  return {
    id: 'unforced-errors',
    number: 2,
    heading: 'Unforced errors by stroke',
    explanation:
      'Which stroke leaked the most free points. The tallest bar is the first thing to work on in practice.',
    rows: [
      row('Total unforced errors', side.unforcedErrors, 'Every unforced error attributed to this side.', {
        decimals: 0, tier: 'simple', howComputed: 'Counted from the point-by-point timeline.',
      }),
      ...items.map((i): ReportStatRow => ({
        label: `${i.label} unforced errors`,
        value: String(i.value),
        note: `Unforced errors struck off the ${String(i.label).toLowerCase()}.`,
        howComputed: 'Counted from the point-by-point timeline.',
        context:
          total > 0 ? `${fmtNum((i.value / total) * 100, 0)}% of this side’s unforced errors.` : undefined,
        tier: 'simple',
      })),
      ...(worst
        ? [{
            label: 'Where to start',
            value: String(worst.stroke),
            note: 'The stroke leaking the most free points — the first thing to take into practice.',
            howComputed: 'The stroke with the highest unforced-error count above.',
            tier: 'intermediate' as const,
          }]
        : []),
    ],
    charts: items.length ? [hBarChart({ title: 'Unforced errors by stroke', items })] : [],
    notes: [
      ...exclusionNotes(side),
      ...(items.length
        ? []
        : ['No unforced errors could be attributed to this side — see the coverage line for why.']),
    ],
    present: items.length > 0 || side.unforcedErrors.present,
    coverage: coverageLine(side),
  };
}

function section3(side: SideAnalysis, opponent: SideAnalysis): ReportSection {
  const items = strokeItems(side.winnersByStroke);
  const wTotal = side.winners.present ? side.winners.value : 0;
  const best = side.winnersByStroke[0];
  const opponentWinners = opponent.winners;
  return {
    id: 'winners',
    number: 3,
    heading: 'Winners',
    explanation: 'The shots that finished points outright — where this side’s offence actually came from.',
    rows: [
      row('Rally winners', side.winners, 'Winners struck during a rally (aces are counted separately).', {
        decimals: 0, opponent: opponentWinners, tier: 'simple',
        howComputed: 'Counted from the point-by-point timeline.',
      }),
      row('Aces', side.aces, 'Serves that won the point on their own.', {
        decimals: 0, tier: 'simple', howComputed: 'SwingVision’s “Service Winner” label.',
      }),
      ...items.map((i): ReportStatRow => ({
        label: `${i.label} winners`,
        value: String(i.value),
        note: `Winners struck off the ${String(i.label).toLowerCase()}.`,
        howComputed: 'Counted from the point-by-point timeline.',
        context: wTotal > 0 ? `${fmtNum((i.value / wTotal) * 100, 0)}% of this side’s winners.` : undefined,
        tier: 'simple',
      })),
      ...(best
        ? [{
            label: 'Main weapon',
            value: String(best.stroke),
            note: 'The stroke finishing the most points — the shot to build patterns around.',
            howComputed: 'The stroke with the highest winner count above.',
            tier: 'intermediate' as const,
          }]
        : []),
    ],
    charts: items.length ? [hBarChart({ title: 'Winners by stroke', items })] : [],
    notes: [
      ...exclusionNotes(side),
      'Forced errors induced are not reported: SwingVision labels only winners, unforced errors, aces and double faults, so there is no on-screen record of errors this side forced from its opponent. Nothing has been estimated in its place.',
    ],
    present: items.length > 0 || side.winners.present || side.aces.present,
    coverage: coverageLine(side),
  };
}

function section4(side: SideAnalysis, opponent: SideAnalysis): ReportSection {
  const sr = side.serveReturn;
  const osr = opponent.serveReturn;
  const rows: ReportStatRow[] = bySimplicity([
    row('Aces', side.aces, 'Serves that won the point on their own.', {
      decimals: 0, opponent: opponent.aces, tier: 'simple',
      howComputed: 'From the point-by-point timeline — the stats screens don’t report it.',
    }),
    row('Double faults', side.doubleFaults, 'Two missed serves in a row.', {
      decimals: 0, opponent: opponent.doubleFaults, tier: 'simple',
      howComputed: 'From the point-by-point timeline — the stats screens don’t report it.',
    }),
    row('Serve % in (Deuce court)', sr.servePercentInDeuce, 'How often serves to the deuce side landed in.', {
      decimals: 1, unit: '%', opponent: osr.servePercentInDeuce, tier: 'simple',
      howComputed: 'Read from SwingVision’s Serves section.',
    }),
    row('Serve % in (Ad court)', sr.servePercentInAd, 'How often serves to the advantage side landed in.', {
      decimals: 1, unit: '%', opponent: osr.servePercentInAd, tier: 'simple',
      howComputed: 'Read from SwingVision’s Serves section.',
      context: 'A big gap between the two courts usually means one wing of the box is uncomfortable.',
    }),
    row('Avg serve speed (Deuce)', sr.serveSpeedDeuce, 'Average pace on serves to the deuce side.', {
      decimals: 0, opponent: osr.serveSpeedDeuce, tier: 'simple',
      howComputed: 'Read from SwingVision’s Serves section.',
    }),
    row('Avg serve speed (Ad)', sr.serveSpeedAd, 'Average pace on serves to the advantage side.', {
      decimals: 0, opponent: osr.serveSpeedAd, tier: 'simple',
      howComputed: 'Read from SwingVision’s Serves section.',
    }),
    row('Return % in (Deuce court)', sr.returnPercentInDeuce, 'How often returns from the deuce side landed in.', {
      decimals: 1, unit: '%', opponent: osr.returnPercentInDeuce, tier: 'intermediate',
      howComputed: 'Read from SwingVision’s Returns section.',
      context: 'Getting returns in play is usually worth more than hitting them hard.',
    }),
    row('Return % in (Ad court)', sr.returnPercentInAd, 'How often returns from the advantage side landed in.', {
      decimals: 1, unit: '%', opponent: osr.returnPercentInAd, tier: 'intermediate',
      howComputed: 'Read from SwingVision’s Returns section.',
    }),
    row('Avg return speed (Deuce)', sr.returnSpeedDeuce, 'Average pace on returns from the deuce side.', {
      decimals: 0, opponent: osr.returnSpeedDeuce, tier: 'intermediate',
      howComputed: 'Read from SwingVision’s Returns section.',
    }),
    row('Avg return speed (Ad)', sr.returnSpeedAd, 'Average pace on returns from the advantage side.', {
      decimals: 0, opponent: osr.returnSpeedAd, tier: 'intermediate',
      howComputed: 'Read from SwingVision’s Returns section.',
    }),
    row('Aces per double fault', side.aceToDoubleFaultRatio, 'Whether the serve won more than it gave away.', {
      decimals: 2, opponent: opponent.aceToDoubleFaultRatio, tier: 'complex',
      howComputed: 'Aces ÷ double faults.',
      context: 'Above 1.0 means the serve was a net asset on outright points.',
    }),
  ]);

  const charts: string[] = [
    compareBarChart({
      title: 'Serve accuracy by court (%)',
      aLabel: side.label,
      bLabel: opponent.label,
      unit: '%',
      groups: [
        { label: 'Ad court', a: num(sr.servePercentInAd), b: num(osr.servePercentInAd) },
        { label: 'Deuce court', a: num(sr.servePercentInDeuce), b: num(osr.servePercentInDeuce) },
      ],
    }),
    compareBarChart({
      title: 'Return accuracy by court (%)',
      aLabel: side.label,
      bLabel: opponent.label,
      unit: '%',
      groups: [
        { label: 'Ad court', a: num(sr.returnPercentInAd), b: num(osr.returnPercentInAd) },
        { label: 'Deuce court', a: num(sr.returnPercentInDeuce), b: num(osr.returnPercentInDeuce) },
      ],
    }),
  ];

  return {
    id: 'serve-return',
    number: 4,
    heading: 'Serve & return',
    explanation:
      'Accuracy and speed on both wings of the court. Serve and return percentages come from SwingVision’s own stats screens; aces and double faults are counted from the timeline.',
    rows,
    charts,
    notes: [
      ...exclusionNotes(side),
      'SwingVision’s stats screens do not report ace or double-fault counts, so those two come from the point-by-point timeline instead. Both are attributable with certainty, because only the server can hit either.',
    ],
    present: rows.some((r) => r.value !== null),
  };
}

function section5(side: SideAnalysis): ReportSection {
  const charts: string[] = [];
  if (side.shotDistribution.length) {
    charts.push(
      donutChart({
        title: 'Shot distribution',
        slices: side.shotDistribution.map((s) => ({ label: s.label, value: s.percent })),
      }),
    );
  }
  if (side.spinDistribution.length) {
    charts.push(
      donutChart({
        title: 'Spin distribution',
        slices: side.spinDistribution.map((s) => ({ label: s.label, value: s.percent })),
      }),
    );
  }

  const rows: ReportStatRow[] = [
    ...side.shotDistribution.map((d): ReportStatRow => ({
      label: `${d.label} (share of shots)`,
      value: `${fmtNum(d.percent, 1)}%`,
      note: `How much of this side’s hitting was ${d.label.toLowerCase()}.`,
      howComputed: 'Read straight from SwingVision’s shot-distribution legend.',
      tier: 'simple',
    })),
    ...side.spinDistribution.map((d): ReportStatRow => ({
      label: `${d.label} (share of spin)`,
      value: `${fmtNum(d.percent, 1)}%`,
      note: `How much of this side’s hitting carried ${d.label.toLowerCase()}.`,
      howComputed: 'Read straight from SwingVision’s spin-distribution legend.',
      tier: 'intermediate',
    })),
  ];

  return {
    id: 'distribution',
    number: 5,
    heading: 'Shot & spin distribution',
    explanation:
      'What this side actually hit, and with what spin — the shape of their game rather than its outcomes.',
    rows,
    charts,
    notes: rows.length
      ? []
      : ['No distribution legend was read for this side — assign a stats screenshot showing the distribution donuts.'],
    present: rows.length > 0,
  };
}

/**
 * Section 6 — observations COMPUTED from the numbers above.
 *
 * Every line is a template filled from metrics that are present, and each states
 * the figures it rests on. There is no generated prose and no language model: a
 * sentence appears only when the comparison behind it is computable, so the
 * summary can never assert something the data doesn't hold.
 */
function section6(side: SideAnalysis, opponent: SideAnalysis): ReportSection {
  const rows: ReportStatRow[] = [];
  const observe = (text: string) => rows.push({ label: '•', value: text, tier: 'simple' });

  const d = side.winnerErrorDifferential;
  const od = opponent.winnerErrorDifferential;
  if (d.present) {
    observe(
      d.value > 0
        ? `Created more than given away: ${fmtNum(d.value, 0)} more winners than unforced errors.`
        : d.value < 0
          ? `Gave away more than created: ${fmtNum(Math.abs(d.value), 0)} more unforced errors than winners.`
          : 'Winners and unforced errors were exactly level.',
    );
  }
  if (d.present && od.present) {
    const gap = d.value - od.value;
    observe(
      gap === 0
        ? `Both sides finished level on differential (${fmtNum(d.value, 0)}).`
        : `Differential was ${fmtNum(Math.abs(gap), 0)} ${gap > 0 ? 'better' : 'worse'} than ${opponent.label} (${fmtNum(d.value, 0)} vs ${fmtNum(od.value, 0)}).`,
    );
  }

  const topUe = side.unforcedErrorsByStroke[0];
  if (topUe && side.unforcedErrors.present && side.unforcedErrors.value > 0) {
    const share = (topUe.count / side.unforcedErrors.value) * 100;
    observe(
      `Most unforced errors came off the ${String(topUe.stroke).toLowerCase()}: ${topUe.count} of ${fmtNum(side.unforcedErrors.value, 0)} (${fmtNum(share, 0)}%).`,
    );
  }

  const topWinner = side.winnersByStroke[0];
  if (topWinner && side.winners.present && side.winners.value > 0) {
    observe(
      `Main weapon was the ${String(topWinner.stroke).toLowerCase()}: ${topWinner.count} of ${fmtNum(side.winners.value, 0)} winners.`,
    );
  }

  const ad = side.serveReturn.servePercentInAd;
  const deuce = side.serveReturn.servePercentInDeuce;
  if (ad.present && deuce.present) {
    const gap = Math.abs(ad.value - deuce.value);
    observe(
      gap >= 10
        ? `Serve accuracy was uneven between courts: ${fmtNum(ad.value, 1)}% in the ad court vs ${fmtNum(deuce.value, 1)}% in the deuce court — a ${fmtNum(gap, 1)}-point gap.`
        : `Serve accuracy was consistent across both courts (${fmtNum(ad.value, 1)}% ad, ${fmtNum(deuce.value, 1)}% deuce).`,
    );
  }

  if (side.aces.present && side.doubleFaults.present) {
    observe(
      side.aces.value >= side.doubleFaults.value
        ? `Serve was a net asset: ${fmtNum(side.aces.value, 0)} aces against ${fmtNum(side.doubleFaults.value, 0)} double faults.`
        : `Serve cost more than it won: ${fmtNum(side.doubleFaults.value, 0)} double faults against ${fmtNum(side.aces.value, 0)} aces.`,
    );
  }

  return {
    id: 'summary',
    number: 6,
    heading: 'Coach’s summary',
    explanation:
      'Observations computed directly from the figures above. Each line names the numbers it rests on; nothing here is written by a language model.',
    rows,
    charts: [],
    notes: rows.length
      ? []
      : ['Not enough attributed data to draw any observation. The sections above show which inputs were missing.'],
    present: rows.length > 0,
  };
}

/** Build one side's six sections. */
export function buildSideReport(analysis: MatchAnalysis, sideId: 'A' | 'B'): SideReport {
  const side = analysis.sides.find((s) => s.id === sideId)!;
  const opponent = analysis.sides.find((s) => s.id !== sideId)!;
  return {
    sideId,
    label: side.label,
    sections: [
      section1(side, opponent, analysis),
      section2(side),
      section3(side, opponent),
      section4(side, opponent),
      section5(side),
      section6(side, opponent),
    ],
  };
}

/** Both sides, in order — the shape the Docs export writes sequentially. */
export function buildFullReport(analysis: MatchAnalysis): SideReport[] {
  return [buildSideReport(analysis, 'A'), buildSideReport(analysis, 'B')];
}
