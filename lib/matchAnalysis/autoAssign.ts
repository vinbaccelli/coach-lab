/**
 * AUTOMATIC SIDE ASSIGNMENT — the coach types two names, the app does the rest.
 *
 * WHAT THIS REPLACES
 * The setup step used to ask the coach to map every OCR'd game-header name to a
 * side, and every stats screenshot to a side — around ten dropdowns. That was
 * unacceptable on two counts. It is work the app can do itself, and it is work
 * the coach CANNOT do reliably: header names OCR so badly that one player
 * fragments into several clusters ("= Arthur", "Seg Arthur", "WF IF") plus an
 * unreadable opponent, and a single wrong guess silently dropped attributed
 * points from 28 to 22. Asking a human to untangle garbled OCR is asking them to
 * guess, and their guess then corrupts the numbers.
 *
 * THE STRUCTURE THAT MAKES IT AUTOMATIC: SERVE ALTERNATES EVERY GAME.
 * `gamesPlayed` IS the game number — games completed when that game ended — so
 * game N's server is fixed by the PARITY of N. Verified against the real match:
 * odd games all served by one player, even games all by the other, with no
 * exceptions. Combined with the header's holds/breaks (which says whether the
 * named player served or returned), the entire assignment collapses to a SINGLE
 * BIT: which side serves the odd-numbered games.
 *
 * That bit is inferred from a fuzzy match between a header name and one of the
 * two typed names — "Seg Arthur" still contains "Arthur", so the garbled
 * clusters that defeated manual mapping resolve fine here. If no name matches at
 * all the bit is defaulted and the coach can flip it with one toggle; a single
 * binary choice, not per-cluster archaeology.
 *
 * WHY THIS IS NOT FABRICATION. Serve alternation is a rule of tennis, not a
 * guess about this match, and the parity assignment is CROSS-CHECKED against
 * every game whose header did parse: if holds/breaks disagrees with parity
 * anywhere, that is reported rather than silently overridden. The one place
 * alternation genuinely can break is a set boundary, and that shows up as
 * exactly such a contradiction.
 */

import type { PlayerStatBlock, StitchedTimeline } from '@/lib/matchDecoder/types';
import { levenshtein } from '@/lib/matchDecoder/outcomeVocabulary';
import type { SideId } from '@/lib/matchAnalysis/types';

const other = (s: SideId): SideId => (s === 'A' ? 'B' : 'A');

const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Does an OCR'd name plausibly refer to the typed one?
 *
 * Deliberately generous in one direction only: OCR ADDS junk far more often than
 * it deletes the whole name, so containment carries most of the weight
 * ("segarthur" contains "arthur"). Whole-token edit distance catches the rest.
 * A miss is harmless — that cluster simply casts no vote.
 */
export function nameLikelyMatches(ocrName: string, typedName: string): boolean {
  const a = normalise(ocrName);
  const b = normalise(typedName);
  if (!a || !b || b.length < 3) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return ocrName
    .split(/\s+/)
    .map(normalise)
    .some((token) => token.length >= 4 && levenshtein(token, b) <= Math.min(2, Math.floor(b.length / 3)));
}

export interface AutoAssignment {
  /** Which side serves the ODD-numbered games. The single bit the whole mapping turns on. */
  oddGamesServedBy: SideId;
  /** How that bit was decided — shown to the coach so a default is never mistaken for a finding. */
  orientationBasis: 'matched a typed name' | 'defaulted — use Swap sides if reversed';
  /** Server side per stitched game, derived from parity. Name-independent. */
  serverSideByGameKey: Record<string, SideId>;
  /** Auto-derived cluster→side, so the garbled OCR clusters resolve without the coach. */
  clusterToSide: Record<string, SideId | null>;
  /** Auto-derived stats screenshot→side. `null` = combined ("Everyone's Shots"), deliberately unassigned. */
  statsScreenshotToSide: Record<number, SideId | null>;
  /** Plain-language account of what was decided automatically. */
  notes: string[];
  /** Things the app genuinely could not determine — the only cases worth asking about. */
  ambiguities: string[];
}

/**
 * Work out every side assignment from the timeline's own structure plus the two
 * typed names.
 */
export function autoAssignSides(
  timeline: StitchedTimeline,
  playerStats: PlayerStatBlock[],
  sideNames: { A: string[]; B: string[] },
): AutoAssignment {
  const notes: string[] = [];
  const ambiguities: string[] = [];

  const nameMatchesSide = (ocrName: string): SideId | null => {
    const hitsA = sideNames.A.some((n) => n.trim() && nameLikelyMatches(ocrName, n));
    const hitsB = sideNames.B.some((n) => n.trim() && nameLikelyMatches(ocrName, n));
    if (hitsA && !hitsB) return 'A';
    if (hitsB && !hitsA) return 'B';
    return null;
  };

  // ── 1. The orientation bit: which side serves odd-numbered games ──────────
  const votes: Record<SideId, number> = { A: 0, B: 0 };
  for (const game of timeline.games) {
    const n = game.gamesPlayed;
    const cluster = game.header.playerRaw?.trim();
    const verb = game.header.outcome;
    if (n === undefined || !cluster || !verb) continue;
    const namedSide = nameMatchesSide(cluster);
    if (!namedSide) continue;
    // holds ⇒ the named player served this game; breaks ⇒ the opponent did.
    const serverThisGame: SideId = verb === 'holds' ? namedSide : other(namedSide);
    const oddServer: SideId = n % 2 === 1 ? serverThisGame : other(serverThisGame);
    votes[oddServer] += 1;
  }

  let oddGamesServedBy: SideId = 'A';
  let orientationBasis: AutoAssignment['orientationBasis'] = 'defaulted — use Swap sides if reversed';
  if (votes.A > votes.B) {
    oddGamesServedBy = 'A';
    orientationBasis = 'matched a typed name';
  } else if (votes.B > votes.A) {
    oddGamesServedBy = 'B';
    orientationBasis = 'matched a typed name';
  }

  if (orientationBasis === 'matched a typed name') {
    notes.push(
      `Sides identified automatically: a game header matched one of your typed names, so Side ${oddGamesServedBy} is the one serving odd-numbered games (${votes[oddGamesServedBy]} game(s) agreed).`,
    );
    if (votes[other(oddGamesServedBy)] > 0) {
      ambiguities.push(
        `${votes[other(oddGamesServedBy)]} game header(s) pointed the opposite way to the majority. Serve should alternate every game, so one of those headers was probably misread — or a set boundary falls between them. Check "Swap sides" looks right.`,
      );
    }
  } else {
    notes.push(
      'No game header name matched either typed name (the headers OCR poorly), so which side is A and which is B was chosen arbitrarily. Everything else is still correct — use Swap sides if the two are the wrong way round.',
    );
  }

  // ── 2. Server per game, from parity alone ─────────────────────────────────
  const serverSideByGameKey: Record<string, SideId> = {};
  let positioned = 0;
  for (const game of timeline.games) {
    const n = game.gamesPlayed;
    if (n === undefined) {
      ambiguities.push(
        `A game could not be placed in the match order, so which side served it is unknown and its points are not attributed.`,
      );
      continue;
    }
    serverSideByGameKey[game.key] = n % 2 === 1 ? oddGamesServedBy : other(oddGamesServedBy);
    positioned += 1;
  }
  notes.push(
    `Server worked out for ${positioned} of ${timeline.games.length} game(s) from serve alternation — no reliance on the OCR'd header names.`,
  );

  // ── 3. Cluster → side, derived (not asked) ────────────────────────────────
  // Kept because the attribution layer falls back to it, and because it lets a
  // garbled cluster be resolved from the game it appears in rather than by the
  // coach guessing what "WF IF" was supposed to say.
  const clusterVotes = new Map<string, Record<SideId, number>>();
  for (const game of timeline.games) {
    const cluster = game.header.playerRaw?.trim();
    const verb = game.header.outcome;
    const serverSide = serverSideByGameKey[game.key];
    if (!cluster || !verb || !serverSide) continue;
    // The header names the game's WINNER: holds ⇒ the server, breaks ⇒ the returner.
    const namedSide: SideId = verb === 'holds' ? serverSide : other(serverSide);
    const tally = clusterVotes.get(cluster) ?? { A: 0, B: 0 };
    tally[namedSide] += 1;
    clusterVotes.set(cluster, tally);
  }
  const clusterToSide: Record<string, SideId | null> = {};
  for (const [cluster, tally] of clusterVotes) {
    clusterToSide[cluster] = tally.A === tally.B ? null : tally.A > tally.B ? 'A' : 'B';
  }
  if (clusterVotes.size > 0) {
    notes.push(
      `${clusterVotes.size} garbled header name(s) resolved automatically from the games they appear in — you never have to identify them.`,
    );
  }

  // ── 4. Stats screenshots → side, from their own "X's Shots" header ────────
  const statsScreenshotToSide: Record<number, SideId | null> = {};
  let statsMatched = 0;
  let statsCombined = 0;
  const unresolvedStats: number[] = [];
  for (const block of playerStats) {
    const header = block.playerNameRaw?.value ?? '';
    if (/everyone/i.test(header) || block.player === 'both') {
      // "Everyone's Shots" is both players combined — it belongs to neither side,
      // and folding it into one would double-count that side's shots.
      statsScreenshotToSide[block.screenshotIndex] = null;
      statsCombined += 1;
      continue;
    }
    const matched = header ? nameMatchesSide(header) : null;
    if (matched) {
      statsScreenshotToSide[block.screenshotIndex] = matched;
      statsMatched += 1;
      continue;
    }
    // Fall back to the extractor's own A/B grouping (distinct names seen, in
    // order), oriented by the same bit as everything else.
    if (block.player === 'A' || block.player === 'B') {
      statsScreenshotToSide[block.screenshotIndex] =
        block.player === 'A' ? oddGamesServedBy : other(oddGamesServedBy);
      unresolvedStats.push(block.screenshotIndex);
    } else {
      statsScreenshotToSide[block.screenshotIndex] = null;
      unresolvedStats.push(block.screenshotIndex);
    }
  }
  if (statsMatched > 0) {
    notes.push(`${statsMatched} stats screenshot(s) matched to a side by their own "…'s Shots" heading.`);
  }
  if (statsCombined > 0) {
    notes.push(
      `${statsCombined} "Everyone's Shots" screenshot(s) left unassigned — that screen is both players combined, so attributing it to one side would overstate them.`,
    );
  }
  if (unresolvedStats.length > 0) {
    ambiguities.push(
      `Stats screenshot(s) #${unresolvedStats.join(', #')} had no readable player heading, so they were grouped by the order their names appeared. If the serve/return numbers look swapped between sides, use Swap sides or set them under Advanced.`,
    );
  }

  return {
    oddGamesServedBy,
    orientationBasis,
    serverSideByGameKey,
    clusterToSide,
    statsScreenshotToSide,
    notes,
    ambiguities,
  };
}

/** Flip every A↔B assignment — the coach's one-click correction. */
export function swapAssignment(a: AutoAssignment): AutoAssignment {
  const flipRecord = <K extends string | number>(r: Record<K, SideId | null>): Record<K, SideId | null> =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, v === null || v === undefined ? null : other(v as SideId)]),
    ) as Record<K, SideId | null>;
  return {
    ...a,
    oddGamesServedBy: other(a.oddGamesServedBy),
    serverSideByGameKey: Object.fromEntries(
      Object.entries(a.serverSideByGameKey).map(([k, v]) => [k, other(v)]),
    ),
    clusterToSide: flipRecord(a.clusterToSide),
    statsScreenshotToSide: flipRecord(a.statsScreenshotToSide),
  };
}
