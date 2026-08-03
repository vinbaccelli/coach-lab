/**
 * Match analysis — the data model between extraction and the report.
 *
 * TWO SIDES, NEVER INDIVIDUALS.
 * A side is one player (singles) or two (doubles). Every metric attributes to a
 * SIDE, and there is deliberately no per-teammate field anywhere in this file.
 * That is not a simplification — SwingVision tracks per side/court and does not
 * reliably say which teammate hit a given ball in doubles, so a per-individual
 * breakdown would be attribution we invented. The same shape serves singles,
 * where a side happens to have one member.
 *
 * NAMES ARE MANUAL. Side labels come from the coach in the setup step, never
 * from OCR. The extractor's OCR'd header names survive only as opaque CLUSTER
 * TOKENS used to work out which side a game belongs to — they are never shown
 * and never treated as a person's name.
 *
 * OMISSION IS A FIRST-CLASS RESULT. Every metric is a `Metric`, which is either
 * a value or an explicit omission with a reason. Nothing defaults to zero: "no
 * unforced errors were recorded" and "we could not tell" are different claims,
 * and a report that conflates them is lying quietly.
 */

import type { OutcomeShot, PlayerStatBlock, StitchedTimeline, TimelinePoint } from '@/lib/matchDecoder/types';

export type SideId = 'A' | 'B';

export interface SideSetup {
  id: SideId;
  /** 1 name (singles) or 2 (doubles). Manual, never OCR'd. */
  playerNames: string[];
}

export interface MatchSetup {
  format: 'singles' | 'doubles';
  sides: [SideSetup, SideSetup];
  /**
   * Server side per stitched game, keyed by `StitchedGame.key`.
   *
   * THE PRIMARY MAPPING, and the reason setup needs only two names. It is derived
   * from serve alternation (game N's server is fixed by the parity of N) rather
   * than from any OCR'd name, so it covers games whose header never parsed —
   * which the cluster route below structurally cannot.
   */
  serverSideByGameKey: Record<string, SideId>;
  /**
   * Which side each OCR'd header-name cluster belongs to.
   *
   * AUTO-DERIVED, never asked for: each garbled cluster is resolved from the game
   * it appears in, not by the coach identifying what "WF IF" was meant to say.
   * Retained as the fallback the attribution layer uses when a game has no entry
   * in `serverSideByGameKey`.
   */
  clusterToSide: Record<string, SideId | null>;
  /**
   * Which side each `player_stats` screenshot describes — auto-derived from its
   * own "…'s Shots" heading. `null` means deliberately unassigned ("Everyone's
   * Shots" is both players combined).
   */
  statsScreenshotToSide: Record<number, SideId | null>;
  /** The coach's one-click correction if A and B came out the wrong way round. */
  swapSides: boolean;
}

/** A number that may honestly not exist. */
export type Metric =
  | { present: true; value: number }
  | { present: false; reason: string };

export const metric = (value: number): Metric => ({ present: true, value });
export const omitted = (reason: string): Metric => ({ present: false, reason });

/**
 * A side expressed RELATIVE TO WHO SERVED — the name-independent half of
 * attribution. The score delta and the header's holds/breaks both speak this
 * language, so it resolves even when no player name was readable and before the
 * coach has assigned sides.
 */
export type RelativeSide = 'server' | 'returner';

/**
 * Who won a point, whose racket ended it, and how confidently we know each.
 *
 * The `*Relative` fields come from stage 1 (score delta + header) and need no
 * names. The `*Side` fields are stage 2 — the same answer mapped onto A/B, which
 * requires the coach's cluster→side assignment. Keeping both means an unassigned
 * or unreadable name degrades the report's per-side totals WITHOUT destroying the
 * attribution itself, which is what previously made this look broken.
 */
export interface PointAttribution {
  point: TimelinePoint;
  gameKey: string;
  /** The side that served this game (stage 2). */
  serverSide?: SideId;
  /** Who won the point, relative to the server (stage 1 — always computable when the chain is intact). */
  winnerRelative?: RelativeSide;
  /** Whose racket produced the labelled outcome, relative to the server (stage 1). */
  hitterRelative?: RelativeSide;
  /** The side that WON the point (stage 2). */
  winnerSide?: SideId;
  /** The side whose racket produced the labelled outcome (stage 2). */
  hitterSide?: SideId;
  /** How the point's winner was established — shown in the report's provenance. */
  basis: 'score-delta' | 'game-header (deciding point)' | 'unattributed';
  /** Why attribution failed, when it did. */
  reason?: string;
  flags: string[];
}

export interface StrokeCount {
  stroke: OutcomeShot | 'Unknown';
  count: number;
}

export interface SideAnalysis {
  id: SideId;
  /** "Vin & Marco" / "Arthur" — from setup. */
  label: string;
  playerNames: string[];

  /** Rally winners (excludes aces, which are counted separately). */
  winners: Metric;
  winnersByStroke: StrokeCount[];
  unforcedErrors: Metric;
  unforcedErrorsByStroke: StrokeCount[];
  aces: Metric;
  doubleFaults: Metric;

  /** Winners − Unforced Errors. NOT Aggressive Margin — the forced-error term is unavailable. */
  winnerErrorDifferential: Metric;
  /** Winners ÷ Unforced Errors. */
  errorEfficiencyRatio: Metric;
  /** Unforced errors as a share of the points this side is attributed in. */
  ueIncidencePercent: Metric;

  /** Points won, from attribution. */
  pointsWon: Metric;

  /**
   * Point-ending shots attributed to this side — the denominator behind every
   * rate below. Exposed rather than hidden, because a rate whose base you can't
   * see is a rate you can't check.
   */
  pointEndingShots: Metric;
  /** Aces per double fault. Above 1 means the serve won more than it gave away. */
  aceToDoubleFaultRatio: Metric;
  /**
   * Unforced errors as a share of ALL shots hit.
   *
   * The figure coaches usually quote (recreational play sits around 8–12%), and
   * the one this decoder CANNOT produce: SwingVision's stats screens report
   * shots-per-hour and percentages, never a total shot count. Always omitted with
   * that reason, so the absence is explained rather than silently substituted
   * with the point-ending rate, which has a completely different base.
   */
  ueRateOfAllShots: Metric;

  /** From Phase 1 stats screens assigned to this side. */
  stats: PlayerStatBlock[];
  serveReturn: {
    servePercentInAd: Metric;
    servePercentInDeuce: Metric;
    serveSpeedAd: Metric;
    serveSpeedDeuce: Metric;
    returnPercentInAd: Metric;
    returnPercentInDeuce: Metric;
    returnSpeedAd: Metric;
    returnSpeedDeuce: Metric;
  };
  shotDistribution: Array<{ label: string; percent: number }>;
  spinDistribution: Array<{ label: string; percent: number }>;

  /** Honest coverage, printed on every section built from the timeline. */
  coverage: {
    pointsTotal: number;
    pointsAttributed: number;
    gamesTotal: number;
    gamesWithKnownServer: number;
    statsScreenshots: number[];
  };

  /**
   * WHICH GAMES THE COUNTS ABOVE ARE ACTUALLY BUILT FROM.
   *
   * Stitching checks every game's point count against the "N points" printed on
   * its own meta line, and that check has THREE outcomes — collapsing them to a
   * boolean would throw away the distinction that matters:
   *
   *  - VERIFIED    the stitched count equals the meta line. Counted.
   *  - UNCHECKED   the meta line was unreadable, so there was nothing to check
   *                against. Counted, and said so — "we couldn't check" is not
   *                evidence of a problem, and discarding these would throw away
   *                good data for no reason.
   *  - CONTRADICTED the stitched count disagrees with the meta line. The game is
   *                known to hold a wrong number of points, so it is EXCLUDED from
   *                every count here. Its size is still reported below, so the
   *                reader knows the true totals are higher by an unknown margin
   *                rather than being handed a clean-looking number built partly
   *                on data we know is wrong.
   */
  verification: {
    gamesVerified: number;
    gamesUnchecked: number;
    gamesContradicted: number;
    /** Points counted in the metrics above. */
    pointsCounted: number;
    /** Points sitting inside contradicted games, deliberately NOT counted. */
    pointsExcluded: number;
    /** Which games were excluded, so the coach can re-shoot exactly those. */
    excludedGames: string[];
  };
}

export interface MatchAnalysis {
  setup: MatchSetup;
  sides: [SideAnalysis, SideAnalysis];
  attributions: PointAttribution[];
  /** Overall UE incidence across both sides. */
  overallUeIncidencePercent: Metric;
  /**
   * Share of counted points that ended in a mistake (unforced error or double
   * fault) rather than a winner — the "most points are lost, not won" framing.
   */
  errorEndedPointsPercent: Metric;
  /**
   * Contradictions between the score delta and an outcome's own polarity — e.g. a
   * Double Fault on a point the delta says the server won. Surfaced, not silently
   * overridden.
   */
  integrityWarnings: string[];
  /** Carried through from stitching so the report can show gaps honestly. */
  timeline: StitchedTimeline;
}
