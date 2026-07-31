/**
 * The no-AI SwingVision Match Decoder — data model.
 *
 * WHY THIS SHAPE
 * The old Gemini decoder's failure mode was fabrication: it invented per-point
 * depth/positioning that was never on screen, because a language model asked to
 * "write a report" will happily fill gaps with something plausible. This model
 * makes that structurally impossible rather than relying on a prompt not to do
 * it: every extracted value is wrapped in `Extracted<T>`, which carries exactly
 * which screenshot and which OCR read produced it. A field that was never read is
 * OMITTED from the object — never zero, never a guess — so the analysis engine
 * (a later phase) can only compute what the coach's screenshots actually show,
 * and the report can only contain what the model actually holds.
 */

/** One OCR read: what tesseract saw, and how confident it was. */
export interface OcrRegionRead {
  screenshotIndex: number;
  rawText: string;
  /** Tesseract's own word-confidence, 0–100. */
  confidence: number;
}

/** A value plus the exact read that produced it — the anti-fabrication unit. */
export interface Extracted<T> {
  value: T;
  source: OcrRegionRead;
}

export type ScreenType = 'timeline' | 'player_stats' | 'placement_map' | 'unrecognized';

export interface ClassifiedScreenshot {
  index: number;
  type: ScreenType;
  /** How sure the classifier is — count of markers matched, not an OCR confidence. */
  confidence: number;
  /** Which marker phrases matched, for the debug view and for tuning the classifier. */
  matchedMarkers: string[];
  /**
   * The full-frame OCR text this classification was decided from.
   *
   * Kept because it is the ONLY page-wide evidence available downstream: the
   * section fabrication gate needs to ask "does the exact word 'Serves' appear
   * anywhere on this screenshot" and cannot answer that from `matchedMarkers`,
   * which holds loose classification regexes (`Serves?`) that also match the
   * "Serve" inside a "First Serve" donut label.
   */
  rawText: string;
}

/**
 * Fractional crop rect, relative to the full screenshot — [0,1] on both axes,
 * same normalized-coordinate convention the skeleton zone uses elsewhere in this
 * app. Resolution-independent: the same rect works whether the coach's phone
 * screenshot is 1170×2532 or something else entirely.
 */
export interface CropRectFraction {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One named region to crop, upscale and OCR independently as a single string. */
export interface RegionMapEntry {
  label: string;
  rect: CropRectFraction;
}

/**
 * One value inside a section band, picked by POSITION rather than its own
 * crop: `column` says which side of the band it's on, `relativeY` says how far
 * below the section's TITLE it sits (as a fraction of the full image height —
 * calibrated from a real screenshot, so the same offset holds regardless of
 * the section's absolute position, which can shift when an info-box above it
 * changes height).
 */
export interface FieldSpec {
  key: string;
  label: string;
  column: 'left' | 'right';
  relativeY: number;
  kind: 'number' | 'percent';
}

/**
 * One stat section (Overall / Serves / Returns / Groundstrokes): a title to
 * anchor on, a generous band to search for it in, and the fields whose
 * position is known relative to wherever that title actually lands.
 */
export interface SectionSpec {
  title: string;
  titleAliases: RegExp[];
  /**
   * Band to re-OCR for values, expressed RELATIVE to wherever the title was
   * actually found: from `titleY - bandAbove` to `titleY + bandBelow`. The
   * section's absolute position is never assumed, because real captures are
   * scrolled and put the same section at different heights.
   */
  bandAbove: number;
  bandBelow: number;
  /**
   * Absolute fallback, used ONLY when the title is present in the page's text
   * but its token could not be located positionally — never as a way to search
   * a page that doesn't have the section.
   */
  fallbackTitleY: number;
  fields: FieldSpec[];
}

/** One slice of a donut legend: the word that identifies it, and the name we store. */
export interface DistributionLabelSpec {
  /** Canonical name recorded in the result — not whatever spelling OCR returned. */
  display: string;
  /** Matches the token that identifies this slice. First word only for multi-word labels. */
  anchor: RegExp;
}

/**
 * A donut legend (Shot Distribution / Shot Spin Distribution).
 *
 * Unlike SectionSpec, these have NO column/row grid: the percentages sit
 * scattered around the donut wherever the slice happens to fall, and both
 * orders occur ("2,9% Second Serve" puts the value first, "(50.5%) Flat" wraps
 * it in parens). So instead of a positional grid, each slice is found by its
 * LABEL word and paired with the nearest percentage token — see
 * `extractDistribution`.
 */
export interface DistributionSpec {
  key: 'shotDistribution' | 'spinDistribution';
  title: string;
  /**
   * The donut's own heading, located anywhere in the frame. Needed because the
   * slice labels alone are ambiguous: "Forehand" also appears as a
   * Groundstrokes row label, so a whole-image label search would pair that row's
   * percentage into the distribution. Anchoring to the heading scopes the search
   * to the donut.
   */
  titleAliases: RegExp[];
  bandAbove: number;
  bandBelow: number;
  fallbackTitleY: number;
  labels: DistributionLabelSpec[];
}

/**
 * "Everyone's Shots" is a real SwingVision screen (combined stats, not
 * attributed to either player) — 'both' represents that honestly rather than
 * forcing it onto whichever player was seen first.
 */
export type StatPlayerSlot = 'A' | 'B' | 'both';

export interface PlayerStatBlock {
  screenshotIndex: number;
  player: StatPlayerSlot;
  playerNameRaw?: Extracted<string>;

  overall?: {
    shotsInPercent?: Extracted<number>;
    shotsPerHour?: Extracted<number>;
    longestRally?: Extracted<number>;
    ralliesOver5?: Extracted<number>;
  };
  serves?: {
    percentInDeuce?: Extracted<number>;
    percentInAd?: Extracted<number>;
    avgSpeedDeuce?: Extracted<number>;
    avgSpeedAd?: Extracted<number>;
  };
  /**
   * Splits Ad/Deuce, mirroring Serves — confirmed against a real screenshot's
   * layout (previously guessed as one undifferentiated `percentIn`/`avgSpeed`,
   * which real calibration data showed was wrong: Returns has the same
   * two-column Ad/Deuce structure Serves does).
   */
  returns?: {
    percentInAd?: Extracted<number>;
    percentInDeuce?: Extracted<number>;
    avgSpeedAd?: Extracted<number>;
    avgSpeedDeuce?: Extracted<number>;
  };
  groundstrokes?: {
    forehandPercentIn?: Extracted<number>;
    forehandAvgSpeed?: Extracted<number>;
    backhandPercentIn?: Extracted<number>;
    backhandAvgSpeed?: Extracted<number>;
  };
  /** Shot-type distribution donut legend — whatever slices were readable. */
  shotDistribution: Array<{ label: Extracted<string>; percent: Extracted<number> }>;
  /** Spin-type distribution donut legend. */
  spinDistribution: Array<{ label: Extracted<string>; percent: Extracted<number> }>;
}

// ── Phase 2: the point-by-point TIMELINE ──────────────────────────────────

/**
 * Which stroke the label names. `Service` (not `Serve`) because that is the
 * word SwingVision prints — canonical labels are kept spelling-identical to
 * the screen so a report never shows a phrase the coach can't find in the app.
 */
export type OutcomeShot =
  | 'Forehand'
  | 'Backhand'
  | 'Service'
  | 'Return'
  | 'Volley'
  | 'Forehand Volley'
  | 'Backhand Volley'
  | 'Slice'
  | 'Forehand Slice'
  | 'Backhand Slice'
  | 'Smash'
  | 'Drop Shot'
  | 'Lob';

/**
 * What happened. `Unspecified` covers a bare stroke label ("Service") that
 * carries no result word — recorded honestly as "a serve, outcome not stated
 * on this row" rather than being promoted to a winner or an error.
 */
export type OutcomeResult =
  | 'Winner'
  | 'Unforced Error'
  | 'Forced Error'
  | 'Error'
  | 'Ace'
  | 'Double Fault'
  | 'Fault'
  | 'Let'
  | 'Unspecified';

export interface ParsedOutcome {
  /** Assembled from matched vocabulary terms only, e.g. "Forehand Winner". */
  canonical: string;
  shot?: OutcomeShot;
  result: OutcomeResult;
  /**
   * 'server' only when the stroke is structurally a serve, so the game header
   * alone identifies who hit it. Everything else is 'unknown': the sole
   * on-screen cue for who won a rally point is the small coloured dot, which
   * does not survive OCR, and guessing it is precisely the fabrication this
   * decoder exists to eliminate.
   */
  hitter: 'server' | 'unknown';
  /** 'fuzzy' means at least one vocabulary word matched within edit tolerance rather than verbatim. */
  quality: 'exact' | 'fuzzy';
}

/**
 * One point row.
 *
 * `scoreAfter` is the score the point PRODUCED — the state of the game once it
 * was over.
 *
 * WHY THIS, AND NOT "the score it was played at" (which this field used to hold)
 * Two facts settle it, and both were missed by the row-count check that appeared
 * to confirm the other reading:
 *
 *  1. NO POINT CAN EVER RESULT IN 0-0. So a row labelled 0-0 cannot be a
 *     score-after label for any point — it is the game-start SERVICE row, which
 *     is what identifies the server. It is therefore a marker, not a point (see
 *     `ServiceMarker`).
 *  2. Under the old reading the 0-0 row WAS point 1, carrying the outcome
 *     "Service", and the delta to the next row said the RETURNER won it. A bare
 *     "Service" cannot end a point in the returner's favour — a serve the
 *     returner wins is a serve that started a rally. The old reading made real
 *     captures incoherent.
 *
 * Both readings yield the same POINT COUNT (a 6-point game shows 7 rows either
 * way), which is why counting rows never exposed the difference. What differs is
 * which row's outcome pairs with which point's winner — they are offset by one,
 * so the old reading misattributed roughly half of all outcomes to the wrong
 * side. See lib/matchAnalysis/attribution.
 *
 * SERVER'S SCORE IS LISTED FIRST — verified by cross-checking headers'
 * holds/breaks against how each game ended.
 */
export interface TimelinePoint {
  screenshotIndex: number;
  /** Row position in the full image, kept so a value can be found again by eye. */
  rowY: number;
  /** Canonicalised "40-30" / "AD-40": the score this point PRODUCED. Absent on the deciding point. */
  scoreAfter?: Extracted<string>;
  /**
   * SwingVision's "Finish" row: the deciding point of the game. It carries no
   * score (the game ended, so there is no next state to print), so its winner
   * comes from the header's holds/breaks instead of from a delta.
   */
  isFinish: boolean;
  outcome?: Extracted<ParsedOutcome>;
  /** Right-column text that matched NOTHING in the vocabulary — surfaced, never coerced. */
  unrecognizedOutcomeText?: string;
  flags: string[];
}

export interface GameMeta {
  raw: string;
  durationMin?: number;
  pointCount?: number;
  breakPointsSaved?: number;
  breakPointsFaced?: number;
}

/**
 * A game header — "Arthur holds for 2 - 0".
 *
 * `holds` means the SERVER won the game, `breaks` means the RETURNER did, so
 * the named player is the game's winner either way and the server follows from
 * which verb it was. The score is printed from the named player's side, which
 * makes `gamesPlayed` (the two numbers summed) a position in the set that is
 * comparable across headers naming either player — the key the stitcher orders
 * on.
 */
export interface GameHeader {
  /** The header row's text, when a header row was found at all. */
  raw?: Extracted<string>;
  /** Exactly what OCR read before the verb; absent when unreadable (e.g. a CJK name under an English model). */
  playerRaw?: string;
  /**
   * EVERY PARSED FIELD IS OPTIONAL, because a game's EXISTENCE must not depend on
   * its header being readable.
   *
   * On real captures headers OCR badly — the same game's name comes back
   * "Arthur" on one screenshot and "Seg Arthur" on another, and sometimes the
   * whole header row fails to parse. Previously a game with an unparseable
   * header produced no game at all: its points fell through to `orphanPoints`
   * and the game silently vanished from the match. A game is defined by its
   * STRUCTURE — a 0-0 service row, its points, its Finish row, its meta count —
   * and that structure survives a bad header read. So an unnamed game is still a
   * game here; it just carries less about itself.
   */
  outcome?: 'holds' | 'breaks';
  gamesForNamedPlayer?: number;
  gamesForOpponent?: number;
  gameScoreRaw?: string;
  gamesPlayed?: number;
  meta?: GameMeta;
  flags: string[];
}

/**
 * The game-start "Service" row, labelled 0-0.
 *
 * A MARKER, not a scored point: no point can produce a score of 0-0, so this row
 * cannot be a point under score-after semantics. On screen it identifies who is
 * serving the game, which is why its outcome text is retained here — it is a
 * cross-check against the header's holds/breaks rather than something to discard.
 *
 * Keeping it out of `points` matters twice over: counted as a point it would add
 * a phantom point to every game, AND it would shift every outcome↔winner pairing
 * in the game by one row.
 */
export interface ServiceMarker {
  rowY: number;
  scoreRaw?: string;
  outcomeRaw?: string;
}

export interface TimelineGame {
  screenshotIndex: number;
  headerRowY: number;
  header: GameHeader;
  /**
   * False when this game was recovered from its STRUCTURE alone — a run of point
   * rows ending at a 0-0 service row, with no parseable header above them. Such a
   * game is real and its points are real; only its identity is missing, and the
   * stitcher tries to recover that from where it sits among its neighbours.
   */
  headerParsed: boolean;
  /** Chronological (screen order reversed — SwingVision lists most-recent-first). */
  points: TimelinePoint[];
  serviceMarker?: ServiceMarker;
  /** Resolved once every header across the match has been read; absent when the opponent could not be named. */
  serverName?: string;
  gameWinnerName?: string;
  flags: string[];
}

/** Row-level evidence for the harness: what each row was read as, and why it was or wasn't emitted. */
export interface TimelineRowDebug {
  yFrac: number;
  leftText: string;
  /** The 0.30–0.35 dead zone (dots/avatars) — shown to confirm it only ever holds junk. */
  midText: string;
  rightText: string;
  kind: 'game-header' | 'meta' | 'point' | 'service-marker' | 'skipped';
  reason?: string;
}

export interface TimelineScreenshotResult {
  screenshotIndex: number;
  games: TimelineGame[];
  /** Points above the first header — a scroll cut their game off the top of the capture. */
  orphanPoints: TimelinePoint[];
  rows: TimelineRowDebug[];
  tokenCount: number;
  /** Which OCR pass the rows came from, so a weak read is visible rather than inferred. */
  tokenSource: '2x full-frame band' | 'native full-frame fallback';
}

export interface StitchedGame {
  /**
   * Dedup identity: the header's VERB + SCORE, deliberately WITHOUT the player
   * name. Exactly one game exists per game-score within a set, so verb+score
   * identifies it uniquely — and unlike the name, both survive OCR. Keying on the
   * name split one real game into two ("Arthur breaks 3-2" and "Seg Arthur breaks
   * 3-2"), halving its points and breaking its meta count.
   */
  key: string;
  /** Absent when the header was unreadable AND position could not be recovered. */
  gamesPlayed?: number;
  header: GameHeader;
  /** True when every capture of this game had an unreadable header. */
  unnamed: boolean;
  /** Set when gamesPlayed was recovered from the game's neighbours on a capture. */
  gamesPlayedInferred?: boolean;
  serverName?: string;
  gameWinnerName?: string;
  points: TimelinePoint[];
  /** Every screenshot this game was seen on — overlap is evidence, not noise. */
  sourceScreenshots: number[];
  /** Points re-seen on another screenshot, confirming the overlap match. */
  overlapConfirmedPoints: number;
  /**
   * The game's OWN point count, read off its meta line ("4 min · 6 points · …").
   *
   * This is ground truth printed on the screenshot, and it is the only
   * independent check on whether stitching produced the right number of points.
   * A stitched game whose point count disagrees with this is a stitching error,
   * not a judgement call — see `pointCountMatchesMeta`.
   */
  expectedPointCount?: number;
  /** null when the meta line was unreadable, so there is nothing to check against. */
  pointCountMatchesMeta: boolean | null;
  /**
   * True only when this game's points are backed by the count printed on the
   * screenshot. False means the captures could NOT be reconciled and the list is
   * known not to match — surfaced so the report can tell the coach rather than
   * folding an unverified count into per-side tallies as if it were fact.
   */
  pointsVerifiedAgainstMeta: boolean;
  /** What each contributing capture saw ALONE, before any merge — the evidence trail. */
  perCaptureCounts: Array<{
    screenshotIndex: number;
    points: number;
    sawStart: boolean;
    sawFinish: boolean;
    matchesMeta: boolean;
  }>;
  /** How the final point list was arrived at — shown in the harness. */
  mergeStrategy:
    | 'single capture'
    /** One capture's own count equalled the meta line, so it was used verbatim. */
    | 'authoritative capture (matches meta count)'
    | 'complete capture (no merge needed)'
    | 'merged across captures'
    /** Tier-1 (score+outcome) found no anchor; aligned on the score progression instead. */
    | 'merged across captures (score-progression aligned)';
  flags: string[];
}

export interface StitchIssue {
  kind:
    | 'gap'
    | 'conflict'
    | 'duplicate-score'
    | 'order-uncertain'
    | 'unnamed-player'
    | 'orphan-points';
  detail: string;
  screenshotIndexes: number[];
}

export interface PlayerResolution {
  /** Distinct readable header names, in order of first appearance. */
  players: string[];
  /** Raw OCR name → canonical name, after fuzzy grouping of the same name across captures. */
  canonicalOf: Record<string, string>;
  flags: string[];
}

export interface StitchedTimeline {
  games: StitchedGame[];
  issues: StitchIssue[];
  resolution: PlayerResolution;
  orphanPoints: TimelinePoint[];
}

export interface MatchDecodeResult {
  classified: ClassifiedScreenshot[];
  playerStats: PlayerStatBlock[];
  timeline: TimelineScreenshotResult[];
  stitchedTimeline: StitchedTimeline;
}

/** Name the pipeline shipped under while it was Phase 1 only. */
export type MatchDecodePhase1Result = MatchDecodeResult;
