/**
 * SIDE ATTRIBUTION BY SCORE DELTA.
 *
 * THE PROBLEM IT SOLVES
 * SwingVision's timeline says WHAT ended each point ("Backhand Unforced Error")
 * but not WHOSE racket did it. The only on-screen cue is a small coloured dot
 * that does not survive OCR. Guessing from it — or splitting winners and errors
 * 50/50 — is exactly the fabrication this decoder replaces.
 *
 * THE METHOD, IN TWO SEPARATE STAGES
 *
 * Stage 1 is SERVER-RELATIVE and needs no names at all. Each point row is
 * labelled with the score the point PRODUCED, and the server's score is listed
 * first. So walking a game's rows and diffing consecutive scores says, for every
 * point, whether the SERVER or the RETURNER won it. The deciding "Finish" row
 * carries no score, and needs none: `holds` means the server won the game,
 * `breaks` means the returner did, and whoever won the game won its last point.
 *
 * Stage 2 maps 'server'/'returner' onto Side A/B, and is the ONLY stage that
 * needs the coach's cluster→side assignment.
 *
 * SPLITTING THE STAGES IS THE FIX FOR THE BUG THIS FILE HAD.
 * Previously every point's winner was computed only after resolving a side, so a
 * missing or unassigned header name left `hitterSide` undefined AND threw away
 * the server-relative answer, which had been perfectly computable. Attribution
 * appeared to "not run" whenever names were unresolved — which, with 对手
 * unreadable and names now typed manually, is most of the time. The relative
 * result is now always produced and always reported.
 *
 * THE POLARITY RULE — which racket, given who won
 *     Winner, Ace          → the point WINNER hit it
 *     Unforced Error,      → the point LOSER hit it
 *     Double Fault, Fault
 * Getting this backwards puts every error on the wrong side, so the two branches
 * are asserted against the two outcomes whose owner is fixed (below).
 *
 * SERVE OUTCOMES NEED NO DELTA AT ALL. Only the server can hit a serve, so an
 * Ace, a Double Fault or a bare "Service" is attributed to the server directly.
 * That keeps those points attributable even where the score chain is broken.
 *
 * INTEGRITY CROSS-CHECKS. An Ace is always won by the server; a Double Fault
 * always lost by the server. When the delta disagrees, a score was misread — it
 * is reported, never silently resolved in either direction.
 */

import type { StitchedGame, StitchedTimeline, TimelinePoint } from '@/lib/matchDecoder/types';
import type { MatchSetup, PointAttribution, RelativeSide, SideId } from '@/lib/matchAnalysis/types';

/** Ranks for the standard game-score ladder. */
const STANDARD_RANK: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, AD: 4 };

interface ScorePair {
  server: number;
  returner: number;
}

/**
 * Turn "40-30" into comparable ranks.
 *
 * A tiebreak counts 0,1,2,3… so its digits are compared as plain numbers; the
 * standard ladder is compared on its own rank scale. The two are never mixed:
 * the ladder is used only when BOTH sides are ladder values, otherwise both are
 * read numerically. Mixing them would make "15" rank 1 on one side and 15 on the
 * other and invert deltas.
 */
export function scoreToRanks(normalized: string): ScorePair | null {
  const parts = normalized.split('-');
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  const bothStandard = a in STANDARD_RANK && b in STANDARD_RANK;
  if (bothStandard) return { server: STANDARD_RANK[a], returner: STANDARD_RANK[b] };
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
  return { server: na, returner: nb };
}

/**
 * Who won the point that moved the game from `from` to `to`.
 *
 * Handles the advantage cases explicitly: AD-40 → 40-40 is the server LOSING the
 * advantage (their rank falls while the returner's holds), which a naive
 * "whose number went up" test would read as nobody scoring.
 */
export function winnerFromDelta(from: string, to: string): RelativeSide | null {
  const a = scoreToRanks(from);
  const b = scoreToRanks(to);
  if (!a || !b) return null;
  const dServer = b.server - a.server;
  const dReturner = b.returner - a.returner;

  if (dServer > 0 && dReturner <= 0) return 'server';
  if (dReturner > 0 && dServer <= 0) return 'returner';
  // Advantage surrendered: one side drops back to deuce, the other is unchanged.
  if (dServer < 0 && dReturner === 0) return 'returner';
  if (dReturner < 0 && dServer === 0) return 'server';
  return null;
}

const opposite = (s: RelativeSide): RelativeSide => (s === 'server' ? 'returner' : 'server');

/**
 * Who won the GAME, relative to the server — straight from the header verb.
 * `holds` = the server won it, `breaks` = the returner did. No names required,
 * which is what lets the deciding point resolve even when the header name is
 * unreadable.
 */
function gameWinnerRelative(game: StitchedGame): RelativeSide | null {
  // NEW CASE, not a change to validated behaviour: a game whose header never
  // parsed on any capture has no verb, so the deciding point cannot be resolved.
  // Returning null keeps it unattributed. The previous `=== 'holds' ? … : …`
  // would have silently called every such game a BREAK and handed its deciding
  // point to the returner.
  if (game.header.outcome === undefined) return null;
  return game.header.outcome === 'holds' ? 'server' : 'returner';
}

/**
 * Stage 2: which SIDE served this game.
 *
 * Prefers the direct per-game mapping, which the setup step derives from serve
 * alternation and which therefore needs no header name at all — so it also
 * covers games whose header never parsed, where the cluster route below has
 * nothing to key on. Falls back to the cluster mapping when a game has no direct
 * entry.
 *
 * STAGE 1 (score delta, polarity, integrity checks) IS UNTOUCHED by this — only
 * the name→side lookup changed.
 */
function serverSideOf(game: StitchedGame, setup: MatchSetup | undefined): SideId | undefined {
  if (!setup) return undefined;
  const direct = setup.serverSideByGameKey?.[game.key];
  if (direct) return direct;
  const cluster = game.header.playerRaw?.trim();
  if (!cluster) return undefined;
  const namedSide = setup.clusterToSide[cluster] ?? null;
  if (!namedSide) return undefined;
  const other: SideId = namedSide === 'A' ? 'B' : 'A';
  // holds → the named side served and won. breaks → the named side returned and
  // won, so the OTHER side served.
  return game.header.outcome === 'holds' ? namedSide : other;
}

const WINNER_RESULTS = new Set(['Winner', 'Ace']);
const ERROR_RESULTS = new Set(['Unforced Error', 'Double Fault', 'Fault', 'Error', 'Forced Error']);

/**
 * Attribute every point in the stitched timeline.
 *
 * `setup` is OPTIONAL. Without it, stage 1 still runs and every point carries its
 * server-relative winner and hitter — which is what the dev harness validates
 * against, name-independently. With it, stage 2 additionally resolves Side A/B.
 *
 * Returns one entry per point, INCLUDING unattributable ones, so coverage can be
 * reported honestly rather than presenting a filtered subset as the whole match.
 */
export function attributePoints(
  timeline: StitchedTimeline,
  setup?: MatchSetup,
): { attributions: PointAttribution[]; integrityWarnings: string[] } {
  const attributions: PointAttribution[] = [];
  const integrityWarnings: string[] = [];

  for (const game of timeline.games) {
    const serverSide = serverSideOf(game, setup);
    const returnerSide: SideId | undefined =
      serverSide === undefined ? undefined : serverSide === 'A' ? 'B' : 'A';
    const gameWinner = gameWinnerRelative(game);

    /**
     * The score the game stood at before the current point. Starts at 0-0 — the
     * game-start service row is a marker and is not in `points`, so the first
     * point's own label is the first state after 0-0.
     */
    let previousScore = '0-0';
    /** Set when a row's score was unreadable: the next delta would span two points. */
    let chainBroken = false;

    game.points.forEach((point, i) => {
      const flags = [...point.flags];
      const isLast = i === game.points.length - 1;

      let winner: RelativeSide | null = null;
      let basis: PointAttribution['basis'] = 'unattributed';
      let reason: string | undefined;

      if (point.isFinish || !point.scoreAfter) {
        if (point.isFinish && isLast && gameWinner) {
          // The deciding point: no score to diff, but the header settles it.
          winner = gameWinner;
          basis = 'game-header (deciding point)';
        } else if (point.isFinish && isLast) {
          reason = 'the deciding point of a game whose header never parsed — holds/breaks is unknown, so its winner cannot be resolved';
        } else if (point.isFinish) {
          reason = 'a Finish row appeared before the end of the game — the game may be split across captures';
          chainBroken = true;
        } else {
          reason = 'this row\'s score was unreadable, so no delta could be taken';
          chainBroken = true;
        }
      } else if (chainBroken) {
        // A previous row's score was lost, so `previousScore` is stale and the
        // delta would cover more than one point. Resync and refuse this one.
        reason = 'the preceding row\'s score was unreadable, so this delta would span two points';
        previousScore = point.scoreAfter.value;
        chainBroken = false;
      } else {
        winner = winnerFromDelta(previousScore, point.scoreAfter.value);
        if (winner) {
          basis = 'score-delta';
        } else {
          reason = `score did not advance readably from ${previousScore} to ${point.scoreAfter.value}`;
        }
        previousScore = point.scoreAfter.value;
      }

      // ── the racket ──
      const outcome = point.outcome?.value;
      let hitter: RelativeSide | undefined;
      if (outcome) {
        if (outcome.hitter === 'server') {
          // A serve. Only the server can have hit it — no delta needed.
          hitter = 'server';
        } else if (winner) {
          if (WINNER_RESULTS.has(outcome.result)) hitter = winner;
          else if (ERROR_RESULTS.has(outcome.result)) hitter = opposite(winner);
          // 'Unspecified' / 'Let' end no point in a countable way — left undefined.
        }
      }

      // ── integrity cross-checks (name-independent) ──
      if (winner && outcome?.result === 'Ace' && winner !== 'server') {
        integrityWarnings.push(
          `Game "${game.header.raw?.value ?? 'unnamed game'}": an Ace can only be won by the server, but the score delta says the returning side won that point. A score around it was probably misread.`,
        );
        flags.push('integrity: ace vs delta');
      }
      if (winner && outcome?.result === 'Double Fault' && winner !== 'returner') {
        integrityWarnings.push(
          `Game "${game.header.raw?.value ?? 'unnamed game'}": a Double Fault always loses the point for the server, but the score delta says the serving side won it. A score around it was probably misread.`,
        );
        flags.push('integrity: double fault vs delta');
      }

      attributions.push({
        point,
        gameKey: game.key,
        serverSide,
        winnerRelative: winner ?? undefined,
        hitterRelative: hitter,
        winnerSide: winner && serverSide ? (winner === 'server' ? serverSide : returnerSide) : undefined,
        hitterSide: hitter && serverSide ? (hitter === 'server' ? serverSide : returnerSide) : undefined,
        basis,
        reason: winner ? undefined : reason,
        flags,
      });
    });
  }

  // Orphan points (their game header was scrolled off) can never be attributed:
  // no header means no server, so not even the relative answer exists.
  for (const point of timeline.orphanPoints) {
    attributions.push({
      point,
      gameKey: '(orphan)',
      basis: 'unattributed',
      reason: 'this point sat above the first game header on its capture, so no server is known',
      flags: [...point.flags, 'orphan'],
    });
  }

  return { attributions, integrityWarnings: Array.from(new Set(integrityWarnings)) };
}
