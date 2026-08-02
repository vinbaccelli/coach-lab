/**
 * The analysis engine — pure functions, per side, only from present data.
 *
 * THE OMISSION RULE, APPLIED WITHOUT EXCEPTION
 * Every number returned is a `Metric`: a value, or an omission carrying the
 * reason. There is no path that turns absent data into `0`, and none that turns
 * a zero denominator into `Infinity` or `NaN`. "This side hit no unforced errors"
 * and "we could not attribute this side's unforced errors" are different facts,
 * and the report renders them differently.
 *
 * WHAT SWINGVISION DOES NOT GIVE US, AND WHAT WE THEREFORE DO NOT CLAIM
 * Confirmed against real captures: the app labels only Winner, Unforced Error,
 * Service Winner (= Ace), Double Fault and Service. There is NO forced-error
 * label. Aggressive Margin is defined as
 *     Winners + Forced Errors Induced − Unforced Errors
 * and its middle term is simply unavailable. Rather than compute it with a term
 * silently dropped — which would report a smaller, differently-meaning number
 * under a name coaches recognise — this engine computes
 *     Winner–Error Differential = Winners − Unforced Errors
 * under its own honest name, and the report prints the formula next to it. A
 * familiar label over an altered formula is the most dangerous kind of quiet
 * misstatement, so the label changes with the formula.
 */

import type { Extracted, OutcomeShot, PlayerStatBlock, StitchedTimeline } from '@/lib/matchDecoder/types';
import { attributePoints } from '@/lib/matchAnalysis/attribution';
import {
  type MatchAnalysis,
  type MatchSetup,
  type Metric,
  type PointAttribution,
  type SideAnalysis,
  type SideId,
  type StrokeCount,
  metric,
  omitted,
} from '@/lib/matchAnalysis/types';

/** Label a side from its manual names: "Arthur" or "Vin & Marco". */
export function sideLabel(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (!clean.length) return 'Unnamed side';
  return clean.join(' & ');
}

/** A ratio that refuses to divide by zero. */
function ratio(numerator: number, denominator: number, whenZero: string): Metric {
  if (denominator === 0) return omitted(whenZero);
  return metric(numerator / denominator);
}

/** Pull a Phase 1 stat through, or say why it isn't there. */
function fromStats(
  blocks: PlayerStatBlock[],
  pick: (b: PlayerStatBlock) => Extracted<number> | undefined,
  label: string,
): Metric {
  if (!blocks.length) return omitted('no stats screenshot was assigned to this side');
  for (const b of blocks) {
    const hit = pick(b);
    if (hit) return metric(hit.value);
  }
  return omitted(`${label} was not present on the assigned stats screenshot(s)`);
}

function countByStroke(points: PointAttribution[], resultTest: (r: string) => boolean): StrokeCount[] {
  const counts = new Map<OutcomeShot | 'Unknown', number>();
  for (const a of points) {
    const outcome = a.point.outcome?.value;
    if (!outcome || !resultTest(outcome.result)) continue;
    const stroke: OutcomeShot | 'Unknown' = outcome.shot ?? 'Unknown';
    counts.set(stroke, (counts.get(stroke) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([stroke, count]) => ({ stroke, count }))
    .sort((a, b) => b.count - a.count || String(a.stroke).localeCompare(String(b.stroke)));
}

function analyseSide(
  id: SideId,
  setup: MatchSetup,
  attributions: PointAttribution[],
  statsBlocks: PlayerStatBlock[],
  timeline: StitchedTimeline,
): SideAnalysis {
  const names = setup.sides.find((s) => s.id === id)?.playerNames ?? [];

  /**
   * CONTRADICTED GAMES ARE EXCLUDED FROM EVERY COUNT BELOW.
   *
   * A game whose stitched point count disagrees with the "N points" printed on
   * its own meta line holds a wrong number of points — we know that for certain,
   * because the screenshot says so. Feeding it into a winners-or-errors tally
   * would make that tally wrong by an unknown margin, invisibly, and a headline
   * number a coach cannot defend is worse than a smaller number they can.
   *
   * Games whose meta line was simply unreadable are NOT excluded: "couldn't
   * check" is not evidence of a problem, and dropping them would discard good
   * data. They are counted, and reported as unchecked.
   */
  const contradictedKeys = new Set(
    timeline.games.filter((g) => g.pointCountMatchesMeta === false).map((g) => g.key),
  );
  const counted = attributions.filter((a) => !contradictedKeys.has(a.gameKey));
  const excluded = attributions.filter((a) => contradictedKeys.has(a.gameKey));

  const attributed = counted.filter((a) => a.winnerSide !== undefined);
  const hitByThisSide = counted.filter((a) => a.hitterSide === id);
  const wonByThisSide = attributed.filter((a) => a.winnerSide === id);

  const anyAttribution = attributed.length > 0;
  const noAttributionReason =
    'no point could be attributed to a side — check that each timeline name cluster is assigned to a side in setup, and that point scores were read';

  // Aces are counted separately from rally winners so neither inflates the other.
  const aceCount = hitByThisSide.filter((a) => a.point.outcome?.value.result === 'Ace').length;
  const rallyWinnerCount = hitByThisSide.filter((a) => a.point.outcome?.value.result === 'Winner').length;
  const ueCount = hitByThisSide.filter((a) => a.point.outcome?.value.result === 'Unforced Error').length;
  const dfCount = hitByThisSide.filter((a) => a.point.outcome?.value.result === 'Double Fault').length;

  const winners: Metric = anyAttribution ? metric(rallyWinnerCount) : omitted(noAttributionReason);
  const unforcedErrors: Metric = anyAttribution ? metric(ueCount) : omitted(noAttributionReason);
  const aces: Metric = anyAttribution ? metric(aceCount) : omitted(noAttributionReason);
  const doubleFaults: Metric = anyAttribution ? metric(dfCount) : omitted(noAttributionReason);

  const winnerErrorDifferential: Metric = anyAttribution
    ? metric(rallyWinnerCount - ueCount)
    : omitted(noAttributionReason);

  const errorEfficiencyRatio: Metric = !anyAttribution
    ? omitted(noAttributionReason)
    : ratio(
        rallyWinnerCount,
        ueCount,
        'this side was not attributed any unforced errors, so a winners-per-error ratio has no denominator',
      );

  // Incidence is over the points this side was actually attributed a shot in —
  // the only denominator we can defend.
  const ueIncidencePercent: Metric = !anyAttribution
    ? omitted(noAttributionReason)
    : ratio(
        ueCount * 100,
        hitByThisSide.length,
        'no shot was attributed to this side, so there is no base to express incidence against',
      );

  const shotDistribution = statsBlocks
    .flatMap((b) => b.shotDistribution)
    .map((s) => ({ label: s.label.value, percent: s.percent.value }));
  const spinDistribution = statsBlocks
    .flatMap((b) => b.spinDistribution)
    .map((s) => ({ label: s.label.value, percent: s.percent.value }));

  return {
    id,
    label: sideLabel(names),
    playerNames: names,

    winners,
    winnersByStroke: countByStroke(hitByThisSide, (r) => r === 'Winner'),
    unforcedErrors,
    unforcedErrorsByStroke: countByStroke(hitByThisSide, (r) => r === 'Unforced Error'),
    aces,
    doubleFaults,

    winnerErrorDifferential,
    errorEfficiencyRatio,
    ueIncidencePercent,
    pointsWon: anyAttribution ? metric(wonByThisSide.length) : omitted(noAttributionReason),

    pointEndingShots: hitByThisSide.length > 0
      ? metric(hitByThisSide.length)
      : omitted('no point-ending shot could be attributed to this side'),
    aceToDoubleFaultRatio: !anyAttribution
      ? omitted(noAttributionReason)
      : ratio(aceCount, dfCount, 'this side hit no double faults, so there is nothing to divide by'),
    // Structurally unavailable, always. See the field's doc comment.
    ueRateOfAllShots: omitted(
      "SwingVision's stats screens report shots-per-hour and percentages but never a total shot count, so unforced errors cannot be expressed as a share of all shots. The point-ending rate above uses a different, smaller base and is not comparable to the 8–12% figure coaches usually quote",
    ),

    stats: statsBlocks,
    serveReturn: {
      servePercentInAd: fromStats(statsBlocks, (b) => b.serves?.percentInAd, 'Serve % in (Ad)'),
      servePercentInDeuce: fromStats(statsBlocks, (b) => b.serves?.percentInDeuce, 'Serve % in (Deuce)'),
      serveSpeedAd: fromStats(statsBlocks, (b) => b.serves?.avgSpeedAd, 'Avg serve speed (Ad)'),
      serveSpeedDeuce: fromStats(statsBlocks, (b) => b.serves?.avgSpeedDeuce, 'Avg serve speed (Deuce)'),
      returnPercentInAd: fromStats(statsBlocks, (b) => b.returns?.percentInAd, 'Return % in (Ad)'),
      returnPercentInDeuce: fromStats(statsBlocks, (b) => b.returns?.percentInDeuce, 'Return % in (Deuce)'),
      returnSpeedAd: fromStats(statsBlocks, (b) => b.returns?.avgSpeedAd, 'Avg return speed (Ad)'),
      returnSpeedDeuce: fromStats(statsBlocks, (b) => b.returns?.avgSpeedDeuce, 'Avg return speed (Deuce)'),
    },
    shotDistribution,
    spinDistribution,

    verification: {
      gamesVerified: timeline.games.filter((g) => g.pointCountMatchesMeta === true).length,
      gamesUnchecked: timeline.games.filter((g) => g.pointCountMatchesMeta === null).length,
      gamesContradicted: contradictedKeys.size,
      pointsCounted: counted.length,
      pointsExcluded: excluded.length,
      excludedGames: timeline.games
        .filter((g) => g.pointCountMatchesMeta === false)
        .map(
          (g) =>
            `${g.header.raw?.value ?? `unnamed game at ${g.gamesPlayed ?? '?'} games played`} (${g.points.length} points read vs ${g.expectedPointCount} on its meta line)`,
        ),
    },

    coverage: {
      pointsTotal: attributions.length,
      pointsAttributed: attributed.length,
      gamesTotal: timeline.games.length,
      gamesWithKnownServer: timeline.games.filter((g) => {
        const cluster = g.header.playerRaw?.trim();
        return cluster ? Boolean(setup.clusterToSide[cluster]) : false;
      }).length,
      statsScreenshots: statsBlocks.map((b) => b.screenshotIndex),
    },
  };
}

/**
 * Build the full per-side analysis.
 *
 * `statsBySide` is derived from the coach's screenshot→side assignment rather
 * than from any OCR'd name, which is what keeps names manual end to end.
 */
export function computeMatchAnalysis(
  timeline: StitchedTimeline,
  playerStats: PlayerStatBlock[],
  setup: MatchSetup,
): MatchAnalysis {
  const { attributions, integrityWarnings } = attributePoints(timeline, setup);

  const statsFor = (id: SideId) =>
    playerStats.filter((b) => setup.statsScreenshotToSide[b.screenshotIndex] === id);

  const sideA = analyseSide('A', setup, attributions, statsFor('A'), timeline);
  const sideB = analyseSide('B', setup, attributions, statsFor('B'), timeline);

  // Match-wide incidence excludes contradicted games for the same reason the
  // per-side counts do — one denominator built partly on known-wrong data would
  // quietly misstate the whole match.
  const contradictedKeys = new Set(
    timeline.games.filter((g) => g.pointCountMatchesMeta === false).map((g) => g.key),
  );
  const countedAll = attributions.filter((a) => !contradictedKeys.has(a.gameKey));
  const totalHits = countedAll.filter((a) => a.hitterSide !== undefined).length;
  const totalUe = countedAll.filter(
    (a) => a.hitterSide !== undefined && a.point.outcome?.value.result === 'Unforced Error',
  ).length;

  const errorEnders = countedAll.filter(
    (a) => a.hitterSide !== undefined &&
      (a.point.outcome?.value.result === 'Unforced Error' || a.point.outcome?.value.result === 'Double Fault'),
  ).length;

  return {
    setup,
    sides: [sideA, sideB],
    attributions,
    overallUeIncidencePercent: ratio(
      totalUe * 100,
      totalHits,
      'no shot was attributed to either side, so match-wide incidence has no base',
    ),
    errorEndedPointsPercent: ratio(
      errorEnders * 100,
      totalHits,
      'no point-ending shot was attributed to either side, so there is no base for this',
    ),
    integrityWarnings: Array.from(new Set(integrityWarnings)),
    timeline,
  };
}
