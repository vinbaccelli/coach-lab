'use client';

/**
 * Phase 2 — TIMELINE (point-by-point) extraction from one screenshot.
 *
 * SAME STRATEGY AS PHASE 1, ONE AXIS DIFFERENT.
 * Phase 1 located a section by its TITLE and picked values at known offsets
 * below it. A timeline screen has no fixed grid to offset into: it is a feed of
 * rows whose count and spacing depend on how long each game was. So the
 * structure that gets anchored on here is the ROW — tokens are clustered by y
 * into rows, and within a row the COLUMN decides what a token means:
 *
 *     x < 0.30            the score      ("Finish", "40 - 30", "30-0")
 *     0.30 ≤ x < 0.35     dead zone      (coloured dots / avatars — junk)
 *     x ≥ 0.35            the outcome    ("Forehand Winner", "Double Fault")
 *
 * The dead zone is not merely ignored; it is recorded in `rows[].midText` so
 * the harness can show that nothing meaningful was ever discarded there. The
 * architect measured those dots as OCR-ing to junk like "e", "©", "dd", "HF" —
 * and crucially, as the ONLY on-screen indication of which player won a rally
 * point. Since that read is unreliable, point-winner is never inferred from it
 * (see `ParsedOutcome.hitter`).
 *
 * WHAT MAKES A ROW A POINT
 * A row is emitted only when the left column yields a parseable score (or the
 * "Finish" marker) OR the right column matches the outcome vocabulary. A row
 * that is entirely noise produces nothing. Every emitted point carries
 * `Extracted<T>` provenance — screenshot index, the raw OCR text, and the mean
 * confidence of the tokens that produced it — exactly like Phase 1's stats.
 *
 * WHY A 2× FULL-FRAME PASS RATHER THAN THE SHARED NATIVE-RES TOKENS
 * Phase 1 established, against real screenshots, that a 2× upscaled crop reads
 * this app's small text at 92–96% confidence where a native-resolution pass
 * misreads glyphs. A timeline screen is wall-to-wall small text, so the whole
 * frame gets that treatment. The shared native-res token pass (already computed
 * for classification) is kept as a deterministic fallback: it is used only when
 * the 2× pass produced no games and no points at all, so a marginal upscale
 * read cannot lose data the frame pass already had. Which pass was used is
 * reported in `tokenSource` rather than left to inference.
 */

import { recognizeBand, type OcrToken } from '@/lib/matchDecoder/ocr';
import { findPhrase, matchOutcome, normalizeWords, wordMatch } from '@/lib/matchDecoder/outcomeVocabulary';
import type {
  Extracted,
  ServiceMarker,
  GameHeader,
  GameMeta,
  TimelineGame,
  TimelinePoint,
  TimelineRowDebug,
  TimelineScreenshotResult,
} from '@/lib/matchDecoder/types';

/** Right edge of the score column. */
const SCORE_MAX_X = 0.3;
/** Left edge of the outcome column. Between the two lies the dot/avatar dead zone. */
const OUTCOME_MIN_X = 0.35;
/**
 * Row clustering tolerance, as a fraction of image height. Point rows sit ~0.04
 * apart on the calibrated 946×2048 capture, so 0.010 is comfortably inside half
 * a row's spacing — tight enough that a game header and the meta line beneath it
 * stay separate, loose enough that a tall bold header's tokens don't split.
 */
const ROW_MERGE_Y = 0.01;

// ── row grouping ──────────────────────────────────────────────────────────

export interface TokenRow {
  yFrac: number;
  tokens: OcrToken[];
  text: string;
}

/**
 * Cluster positioned tokens into visual rows.
 *
 * Greedy over y-sorted tokens: a token joins the open row while it sits within
 * `mergeY` of that row's running mean y, otherwise it opens a new one. Tokens
 * inside a row are then ordered by x, so the row's text reads left-to-right
 * regardless of the order tesseract emitted them in.
 */
export function groupTokensIntoRows(tokens: OcrToken[], mergeY = ROW_MERGE_Y): TokenRow[] {
  const sorted = [...tokens].sort((a, b) => a.yFrac - b.yFrac);
  const rows: OcrToken[][] = [];
  let current: OcrToken[] = [];
  let runningMean = 0;

  for (const t of sorted) {
    if (!current.length) {
      current = [t];
      runningMean = t.yFrac;
      continue;
    }
    if (t.yFrac - runningMean <= mergeY) {
      current.push(t);
      runningMean = current.reduce((s, x) => s + x.yFrac, 0) / current.length;
    } else {
      rows.push(current);
      current = [t];
      runningMean = t.yFrac;
    }
  }
  if (current.length) rows.push(current);

  return rows.map((group) => {
    const ordered = [...group].sort((a, b) => a.xFrac - b.xFrac);
    return {
      yFrac: ordered.reduce((s, x) => s + x.yFrac, 0) / ordered.length,
      tokens: ordered,
      text: ordered.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim(),
    };
  });
}

function joinTokens(tokens: OcrToken[]): string {
  return tokens.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim();
}

function meanConfidence(tokens: OcrToken[]): number {
  if (!tokens.length) return 0;
  return tokens.reduce((s, t) => s + t.confidence, 0) / tokens.length;
}

// ── score parsing ─────────────────────────────────────────────────────────

/**
 * OCR confusions for the CLOSED tennis-score alphabet {0, 15, 30, 40, AD}.
 *
 * Deliberately a tiny hand-checked table rather than a general fuzzy match: the
 * legal score strings are so short that a 1-edit neighbourhood around "0"
 * contains most single digits, which would silently rewrite a real 6 into a 0
 * in a tiebreak. Only unambiguous letter-for-digit substitutions are listed.
 * "AO" is intentionally ABSENT — it is equally reachable from "40" and "AD",
 * so it stays unrecognized instead of being resolved by coin-flip.
 */
const SCORE_CONFUSIONS: Record<string, string> = {
  O: '0',
  D: '0',
  IS: '15',
  I5: '15',
  '1S': '15',
  L5: '15',
  T5: '15',
  '3O': '30',
  SO: '30',
  '4O': '40',
  '4D': '40',
  A0: 'AD',
  AD: 'AD',
};

/** The standard game-score values. Anything else parseable is a tiebreak count. */
const STANDARD_SCORES = new Set(['0', '15', '30', '40', 'AD']);

interface SideParse {
  value: string;
  fuzzy: boolean;
}

function canonicaliseScoreSide(raw: string): SideParse | null {
  const cleaned = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!cleaned) return null;
  // Pure digits are taken verbatim — tiebreak games count 0,1,2,3… and
  // "correcting" those against the standard set would corrupt real values.
  if (/^\d+$/.test(cleaned)) return { value: cleaned, fuzzy: false };
  const mapped = SCORE_CONFUSIONS[cleaned];
  if (mapped) return { value: mapped, fuzzy: mapped !== cleaned };
  return null;
}

export interface ScoreParse {
  /** Canonical "40-30" / "AD-40". */
  normalized: string;
  fuzzy: boolean;
  /** Both sides are members of {0,15,30,40,AD}. */
  standard: boolean;
}

/**
 * Pull a score out of the left column's text.
 *
 * Tolerates every separator and spacing the app and OCR produce together —
 * "40 - 30", "30-0", en/em dashes — and tolerates leading junk, because a
 * stray dot glyph can land inside the score column.
 */
export function parseScoreText(text: string): ScoreParse | null {
  const normalizedDashes = text.replace(/[‐-―−]/g, '-');
  const m = normalizedDashes.match(/([0-9A-Za-z]{1,3})\s*-\s*([0-9A-Za-z]{1,3})/);
  if (!m) return null;
  const left = canonicaliseScoreSide(m[1]);
  const right = canonicaliseScoreSide(m[2]);
  if (!left || !right) return null;
  return {
    normalized: `${left.value}-${right.value}`,
    fuzzy: left.fuzzy || right.fuzzy,
    standard: STANDARD_SCORES.has(left.value) && STANDARD_SCORES.has(right.value),
  };
}

/** SwingVision's marker for the deciding point of a game. */
export function isFinishText(text: string): boolean {
  const words = normalizeWords(text);
  return words.some((w) => wordMatch(w, 'finish') !== null);
}

// ── game header parsing ───────────────────────────────────────────────────

/**
 * Parse "Arthur holds for 2 - 0" out of a row.
 *
 * Word-level rather than one regex, so an OCR slip in the verb ("hoids",
 * "breoks") still anchors: the verb and "for" are matched through the same
 * bounded fuzzy matcher the outcome vocabulary uses. Everything BEFORE the verb
 * is the player name, kept exactly as OCR read it — never normalised, never
 * guessed. On this match one player is named 对手 ("opponent"), which an English
 * tesseract model cannot render at all; that yields an empty or junk name, which
 * is reported as `header-player-unreadable` rather than being filled in.
 *
 * `holds` = the server won the game. `breaks` = the returner won it. Either way
 * the NAMED player is the winner, which is what makes the server derivable.
 */
export function parseGameHeaderText(text: string): {
  playerRaw?: string;
  outcome: 'holds' | 'breaks';
  gamesForNamedPlayer: number;
  gamesForOpponent: number;
  gameScoreRaw: string;
  flags: string[];
} | null {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length < 3) return null;

  for (let i = 0; i < words.length; i++) {
    const bare = words[i].toLowerCase().replace(/[^a-z]/g, '');
    const isHolds = wordMatch(bare, 'holds') !== null || wordMatch(bare, 'hold') !== null;
    const isBreaks = wordMatch(bare, 'breaks') !== null || wordMatch(bare, 'break') !== null;
    if (!isHolds && !isBreaks) continue;

    const next = (words[i + 1] ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (wordMatch(next, 'for') === null && next !== 'for') continue;

    const tail = words.slice(i + 2).join(' ').replace(/[‐-―−]/g, '-');
    const score = tail.match(/(\d+)\s*-\s*(\d+)/);
    if (!score) continue;

    const flags: string[] = [];
    const nameRaw = words.slice(0, i).join(' ').trim();
    // A name must contain at least one letter to be a name at all — a lone dot
    // glyph or a stray digit is not one.
    const playerRaw = /[A-Za-z]/.test(nameRaw) ? nameRaw : undefined;
    if (!playerRaw) flags.push('header-player-unreadable');

    return {
      playerRaw,
      outcome: isHolds ? 'holds' : 'breaks',
      gamesForNamedPlayer: Number(score[1]),
      gamesForOpponent: Number(score[2]),
      gameScoreRaw: `${score[1]} - ${score[2]}`,
      flags,
    };
  }
  return null;
}

/**
 * The line under a header: "4 min · 6 points · 1 of 1 break point saved".
 *
 * Every component is optional and the raw string is always retained, so a
 * partially-read meta line contributes what it has and nothing more.
 */
export function parseGameMetaText(text: string): GameMeta | null {
  const words = normalizeWords(text);
  const hasMinutes = /\d+\s*min/i.test(text);
  const hasPoints = findPhrase(words, ['points']) !== null || findPhrase(words, ['point']) !== null;
  const hasBreakPoint = findPhrase(words, ['break', 'point']) !== null || findPhrase(words, ['break', 'points']) !== null;
  if (!hasMinutes && !hasPoints && !hasBreakPoint) return null;

  const meta: GameMeta = { raw: text };
  const min = text.match(/(\d+)\s*min/i);
  if (min) meta.durationMin = Number(min[1]);
  const pts = text.match(/(\d+)\s*points?\b/i);
  if (pts) meta.pointCount = Number(pts[1]);
  const bp = text.match(/(\d+)\s*of\s*(\d+)\s*break\s*points?/i);
  if (bp) {
    meta.breakPointsSaved = Number(bp[1]);
    meta.breakPointsFaced = Number(bp[2]);
  }
  return meta;
}

// ── point row parsing ─────────────────────────────────────────────────────

/**
 * Turn a row into a point, the game-start service marker, or nothing.
 *
 * TWO ROWS ARE NOT POINTS, FOR DIFFERENT REASONS:
 *
 *  - A row scored 0-0 is the SERVICE marker. This is structural, not a heuristic:
 *    scores here are the state a point PRODUCED, and no point can produce 0-0. On
 *    screen it names the server. Counted as a point it would both add a phantom
 *    point and shift the whole game's outcome↔winner pairing by one row.
 *
 *  - "Finish" IS a point — the deciding one. It carries no score because the game
 *    ended, so there is no next state to print; its winner comes from the header's
 *    holds/breaks. Dropping it would silently lose one real point per game, and
 *    it is the point whose winner we know most certainly.
 */
function buildPoint(
  row: TokenRow,
  screenshotIndex: number,
): { point: TimelinePoint | null; service: ServiceMarker | null; reason: string } {
  const leftTokens = row.tokens.filter((t) => t.xFrac < SCORE_MAX_X);
  const rightTokens = row.tokens.filter((t) => t.xFrac >= OUTCOME_MIN_X);
  const leftText = joinTokens(leftTokens);
  const rightText = joinTokens(rightTokens);

  const score = parseScoreText(leftText);
  const outcome = matchOutcome(rightText);
  const isFinish = isFinishText(leftText) && !score;

  // 0-0 can only be the game-start service row.
  if (score && score.normalized === '0-0') {
    return {
      point: null,
      service: { rowY: row.yFrac, scoreRaw: leftText, outcomeRaw: rightText || undefined },
      reason: 'game-start service row (0-0 cannot be a point result)',
    };
  }

  // THE EMISSION GATE: a parsed score, the Finish marker, or a recognized
  // outcome. Anything else is a decorative row and produces no point.
  if (!score && !isFinish && !outcome) {
    return { point: null, service: null, reason: 'no score and no recognized outcome' };
  }

  const flags: string[] = [];
  const point: TimelinePoint = {
    screenshotIndex,
    rowY: row.yFrac,
    isFinish,
    flags,
  };

  if (score) {
    if (score.fuzzy) flags.push('score-ocr-corrected');
    if (!score.standard) flags.push('score-non-standard');
    const scoreAfter: Extracted<string> = {
      value: score.normalized,
      source: { screenshotIndex, rawText: leftText, confidence: meanConfidence(leftTokens) },
    };
    point.scoreAfter = scoreAfter;
  } else if (!isFinish) {
    flags.push('score-missing');
  }

  if (outcome) {
    if (outcome.quality === 'fuzzy') flags.push('outcome-ocr-corrected');
    point.outcome = {
      value: outcome,
      source: { screenshotIndex, rawText: rightText, confidence: meanConfidence(rightTokens) },
    };
  } else if (normalizeWords(rightText).join('').length >= 2) {
    // There WAS text in the outcome column and the vocabulary did not cover it.
    // Surfaced verbatim and flagged — this is the case that must never be
    // resolved to a plausible label.
    point.unrecognizedOutcomeText = rightText;
    flags.push('outcome-unrecognized');
  } else {
    flags.push('outcome-missing');
  }

  return { point, service: null, reason: 'emitted' };
}

// ── the extractor ─────────────────────────────────────────────────────────

interface ParsedRows {
  games: TimelineGame[];
  orphanPoints: TimelinePoint[];
  rows: TimelineRowDebug[];
}

/**
 * Walk the rows top-to-bottom, assembling games.
 *
 * On screen a game header sits ABOVE its points, and within a game the points
 * run most-recent-first (so "Finish" is directly under the header and "0-0" is
 * at the bottom). Points are therefore collected in screen order and REVERSED
 * at the end of each game to put them in chronological order — the order the
 * analysis engine will want, derived structurally rather than by reading the
 * scores and assuming a progression.
 *
 * Points seen before any header belong to a game whose header the scroll cut
 * off the top of the capture. They are kept as `orphanPoints` — real reads that
 * cannot be attributed to a server — instead of being attached to the first
 * header that happens to appear below them.
 */
function parseRows(rows: TokenRow[], screenshotIndex: number): ParsedRows {
  const games: TimelineGame[] = [];
  const orphanPoints: TimelinePoint[] = [];
  const debug: TimelineRowDebug[] = [];

  let currentGame: TimelineGame | null = null;
  let currentPointsScreenOrder: TimelinePoint[] = [];
  let justSawHeader = false;
  /** A meta line read while no game was open — handed to the unnamed game it belongs to. */
  let pendingMeta: GameMeta | null = null;

  const closeGame = () => {
    if (!currentGame) return;
    currentGame.points = [...currentPointsScreenOrder].reverse();
    games.push(currentGame);
    currentGame = null;
    currentPointsScreenOrder = [];
  };

  for (const row of rows) {
    const leftText = joinTokens(row.tokens.filter((t) => t.xFrac < SCORE_MAX_X));
    const midText = joinTokens(row.tokens.filter((t) => t.xFrac >= SCORE_MAX_X && t.xFrac < OUTCOME_MIN_X));
    const rightText = joinTokens(row.tokens.filter((t) => t.xFrac >= OUTCOME_MIN_X));

    const header = parseGameHeaderText(row.text);
    if (header) {
      closeGame();
      const headerFlags = [...header.flags];
      currentGame = {
        screenshotIndex,
        headerRowY: row.yFrac,
        header: {
          raw: {
            value: row.text,
            source: { screenshotIndex, rawText: row.text, confidence: meanConfidence(row.tokens) },
          },
          playerRaw: header.playerRaw,
          outcome: header.outcome,
          gamesForNamedPlayer: header.gamesForNamedPlayer,
          gamesForOpponent: header.gamesForOpponent,
          gameScoreRaw: header.gameScoreRaw,
          gamesPlayed: header.gamesForNamedPlayer + header.gamesForOpponent,
          flags: headerFlags,
        },
        headerParsed: true,
        points: [],
        flags: [],
      };
      justSawHeader = true;
      pendingMeta = null;
      debug.push({ yFrac: row.yFrac, leftText, midText, rightText, kind: 'game-header' });
      continue;
    }

    // The meta line sits directly under a header. It is accepted there, and ALSO
    // when no header parsed — in that case it is held as `pendingMeta` and handed
    // to the unnamed game its points are about to open. That matters because the
    // meta line carries the game's own point count, which is the arbiter for
    // whether stitching got the game right; losing it for exactly the games whose
    // headers misread would blind the check where it is needed most.
    const meta = parseGameMetaText(row.text);
    if (meta && (justSawHeader || !currentGame)) {
      if (currentGame) currentGame.header.meta = meta;
      else pendingMeta = meta;
      justSawHeader = false;
      debug.push({ yFrac: row.yFrac, leftText, midText, rightText, kind: 'meta' });
      continue;
    }
    justSawHeader = false;

    const { point, service, reason } = buildPoint(row, screenshotIndex);
    if (service) {
      // THE 0-0 SERVICE ROW ENDS A GAME BLOCK, so it CLOSES the open game.
      //
      // On screen a game reads header → meta → Finish → …points… → 0-0, because
      // points run most-recent-first. The 0-0 row is therefore the LAST row of
      // the block, and the next row should be the following game's header.
      //
      // Closing here is what stops two games merging into one. Previously this
      // branch only recorded the marker and left the game open, so whenever the
      // NEXT header failed to parse — routine, since header names OCR badly
      // ("Seg Arthur", "WF IF") — that game's points kept appending to the
      // previous game. The result was a single "game" carrying two games' points
      // with a 0-0 row stranded in the middle of it, and a point count that
      // silently corrupted every per-side tally built on it.
      //
      // If the next header is missed, its points now land in `orphanPoints`:
      // unattributable (no header ⇒ no server), but honestly separated rather
      // than corrupting a game that was read correctly.
      if (currentGame) {
        currentGame.serviceMarker = service;
        closeGame();
      }
      debug.push({ yFrac: row.yFrac, leftText, midText, rightText, kind: 'service-marker', reason });
      continue;
    }
    if (!point) {
      debug.push({ yFrac: row.yFrac, leftText, midText, rightText, kind: 'skipped', reason });
      continue;
    }
    // A POINT WITH NO OPEN GAME STARTS AN UNNAMED GAME.
    //
    // This is the fix for games disappearing. Points only reach this branch when
    // no header was parsed above them — either the header row failed OCR (routine:
    // real headers read as "Seg Arthur", "WF IF") or it was scrolled off the top
    // of the capture. Previously they became `orphanPoints`, so a game whose
    // header misread vanished from the match entirely, taking its whole point
    // count with it.
    //
    // The game is still fully evidenced by its structure — this run of points,
    // terminated by the 0-0 service row below it. So it becomes a real game with
    // an empty header; the stitcher then tries to recover its identity, either
    // from a capture where the same game's header DID parse, or from its position
    // among neighbouring games whose game-scores are known.
    if (!currentGame) {
      currentGame = {
        screenshotIndex,
        headerRowY: row.yFrac,
        header: { flags: ['header-not-found'], ...(pendingMeta ? { meta: pendingMeta } : {}) },
        headerParsed: false,
        points: [],
        flags: ['unnamed-game: no parseable header above these points'],
      };
    }
    pendingMeta = null;
    currentPointsScreenOrder.push(point);
    debug.push({
      yFrac: row.yFrac,
      leftText,
      midText,
      rightText,
      kind: 'point',
      reason: currentGame.headerParsed ? undefined : 'no parseable header above — unnamed game',
    });
  }

  closeGame();
  // Orphans are collected in SCREEN order, which is most-recent-first like every
  // other row. Reversing puts them in the same chronological order as a game's
  // points, so the two can be read side by side without one silently running
  // backwards.
  return { games, orphanPoints: orphanPoints.reverse(), rows: debug };
}

/**
 * Extract every game and point from one timeline screenshot.
 *
 * `frameTokens` is the shared native-resolution pass already taken for
 * classification, used strictly as a fallback (see the file header).
 */
export async function extractTimeline(
  image: ImageBitmap,
  screenshotIndex: number,
  frameTokens: OcrToken[] = [],
): Promise<TimelineScreenshotResult> {
  const band = await recognizeBand(image, { x: 0, y: 0, w: 1, h: 1 }, screenshotIndex, 2);
  let tokens = band.tokens;
  let tokenSource: TimelineScreenshotResult['tokenSource'] = '2x full-frame band';

  let parsed = parseRows(groupTokensIntoRows(tokens), screenshotIndex);

  // Deterministic fallback: only when the upscaled pass found nothing at all.
  if (!parsed.games.length && !parsed.orphanPoints.length && frameTokens.length) {
    const fallback = parseRows(groupTokensIntoRows(frameTokens), screenshotIndex);
    if (fallback.games.length || fallback.orphanPoints.length) {
      tokens = frameTokens;
      tokenSource = 'native full-frame fallback';
      parsed = fallback;
    }
  }

  return {
    screenshotIndex,
    games: parsed.games,
    orphanPoints: parsed.orphanPoints,
    rows: parsed.rows,
    tokenCount: tokens.length,
    tokenSource,
  };
}
