/**
 * Phase 2 — STITCHING scrolled timeline captures into one match timeline.
 *
 * THE PROBLEM
 * A coach shoots 10–25 screenshots of the same scrolling feed. Consecutive
 * captures OVERLAP, the same game appears on several of them at different
 * heights, and no screenshot carries a page number or timestamp to order it by.
 * Sorting by filename is not sound (the coach may shoot out of order, and file
 * names carry no guarantee), and asking a model to "figure out the order" is
 * exactly the fabrication route this decoder replaces.
 *
 * THE KEY: gamesPlayed, READ OFF THE HEADER
 * Every game header prints the running game score from the named player's side
 * — "Arthur holds for 2 - 0", "对手 breaks for 2 - 2". Summing the two numbers
 * gives how many games had been completed when that game ended, and that sum is
 * comparable across headers naming EITHER player: 1-0 → 1, 2-0 → 2, 1-2 → 3,
 * 2-2 → 4. So chronological order is a plain ascending sort on a number that was
 * literally on screen. No interpolation, no inference from scroll position, and
 * the same input always yields the same order.
 *
 * DEDUP: the same game seen twice is the same header text. Identity is
 * (canonical player, holds/breaks, game score) — all three read from the header.
 * Overlap is therefore not a problem to be worked around but the evidence that
 * two captures are adjacent, and it is REPORTED (`overlapConfirmedPoints`).
 *
 * WHAT IS NEVER DONE: no missing game is invented, no point is interpolated, no
 * set number is assumed (headers don't print one). Gaps and contradictions are
 * emitted as `StitchIssue`s for the coach to see — a hole in the data stays a
 * visible hole.
 */

import { levenshtein } from '@/lib/matchDecoder/outcomeVocabulary';
import type {
  GameHeader,
  PlayerResolution,
  StitchIssue,
  StitchedGame,
  StitchedTimeline,
  TimelineGame,
  TimelinePoint,
  TimelineScreenshotResult,
} from '@/lib/matchDecoder/types';

// ── player name resolution ────────────────────────────────────────────────

/** Same name, two captures, one OCR slip apart ("Arthur" / "Arthar"). */
function sameName(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/[^a-z]/g, '');
  const y = b.toLowerCase().replace(/[^a-z]/g, '');
  if (!x || !y) return false;
  if (x === y) return true;
  const tolerance = Math.max(x.length, y.length) >= 5 ? 1 : 0;
  return tolerance > 0 && levenshtein(x, y) <= tolerance;
}

/**
 * Group the header names seen across every capture into canonical players.
 *
 * The canonical spelling for a group is the one OCR returned MOST OFTEN (ties
 * broken by first appearance) — a majority vote across captures, not a guess.
 *
 * A match between two of Vin's players yields two names. A match against an
 * unnamed opponent yields one, because SwingVision writes the opponent as 对手
 * and an English tesseract model cannot render CJK at all: those headers come
 * back with no readable name. That is reported (`opponent-unnamed`), and it is
 * the reason server attribution can come back unresolved rather than being
 * completed by elimination.
 */
export function resolveTimelinePlayers(perScreenshot: TimelineScreenshotResult[]): PlayerResolution {
  const groups: Array<{ canonical: string; variants: Map<string, number> }> = [];

  const ordered = [...perScreenshot].sort((a, b) => a.screenshotIndex - b.screenshotIndex);
  for (const shot of ordered) {
    const byRow = [...shot.games].sort((a, b) => a.headerRowY - b.headerRowY);
    for (const game of byRow) {
      const raw = game.header.playerRaw?.trim();
      if (!raw) continue;
      const hit = groups.find((g) => Array.from(g.variants.keys()).some((v) => sameName(v, raw)));
      if (hit) hit.variants.set(raw, (hit.variants.get(raw) ?? 0) + 1);
      else groups.push({ canonical: raw, variants: new Map([[raw, 1]]) });
    }
  }

  const flags: string[] = [];
  const canonicalOf: Record<string, string> = {};
  const players: string[] = [];

  for (const group of groups) {
    let best = group.canonical;
    let bestCount = -1;
    for (const [variant, count] of group.variants) {
      if (count > bestCount) {
        best = variant;
        bestCount = count;
      }
    }
    players.push(best);
    for (const variant of group.variants.keys()) canonicalOf[variant] = best;
  }

  if (players.length === 0) flags.push('no-player-names-readable');
  else if (players.length === 1) flags.push('opponent-unnamed');
  else if (players.length > 2) flags.push('more-than-two-player-names');

  return { players, canonicalOf, flags };
}

/**
 * Fill in `serverName` and `gameWinnerName` on every game, from the header alone.
 *
 * holds  → the named player was SERVING and won the game.
 * breaks → the named player was RETURNING and won the game, so the OPPONENT served.
 *
 * The winner is therefore always the named player; the server needs the opponent's
 * identity, which exists only when exactly two names were resolved. When it
 * doesn't, `serverName` is left undefined and flagged — the analysis engine will
 * see "unknown" rather than a 50/50 assignment.
 */
export function annotateServers(
  perScreenshot: TimelineScreenshotResult[],
  resolution: PlayerResolution,
): void {
  const twoPlayers = resolution.players.length === 2;

  for (const shot of perScreenshot) {
    for (const game of shot.games) {
      const raw = game.header.playerRaw?.trim();
      const named = raw ? resolution.canonicalOf[raw] : undefined;

      if (!named) {
        game.flags.push('server-unresolved: header player unreadable');
        continue;
      }
      game.gameWinnerName = named;

      if (game.header.outcome === 'holds') {
        game.serverName = named;
        continue;
      }
      const opponent = twoPlayers ? resolution.players.find((p) => p !== named) : undefined;
      if (opponent) game.serverName = opponent;
      else game.flags.push('server-unresolved: opponent not named on any capture');
    }
  }
}

// ── point merging across overlapping captures ─────────────────────────────

/** Identity of a point for overlap matching: what it scored to, and what ended it. */
function pointKey(p: TimelinePoint): string {
  const score = p.scoreAfter?.value ?? (p.isFinish ? 'FINISH' : '?');
  const outcome = p.outcome?.value.canonical ?? p.unrecognizedOutcomeText ?? '?';
  return `${score}|${outcome}`;
}

/**
 * The SCORE PROGRESSION key — the point's resulting score alone.
 *
 * A game is a walk through score states: 0-0 → 15-0 → 15-15 → … → game. Each
 * point produces exactly one state, so the state a point left behind identifies
 * it within its game, independently of how well the outcome column was read.
 *
 * This is the anchor of last resort, and it exists because `pointKey` proved too
 * strict on real captures: two scrolled shots of the same game shared a point
 * whose OUTCOME text OCR'd differently on each ("Backhand Unforced Error" vs a
 * misread of it). Same point, two keys, no overlap detected — so the merge gave
 * up and appended, double-counting that point (8 rows for a 7-point game). The
 * score is the same on both captures because it is a short, high-contrast,
 * closed-alphabet string; the outcome phrase is long prose and is where OCR
 * actually differs.
 */
function scoreProgressionKey(p: TimelinePoint): string {
  return p.scoreAfter?.value ?? (p.isFinish ? 'FINISH' : '?');
}

type PointKeyFn = (p: TimelinePoint) => string;

/**
 * Does `incoming` carry a strictly better read of the same point?
 *
 * When two captures show one point, one may have resolved its outcome and the
 * other not. Aligning them is the chance to keep the better read — and it costs
 * nothing, because the point itself is already known to be the same one.
 */
function isRicherRead(existing: TimelinePoint, incoming: TimelinePoint): boolean {
  if (!existing.outcome && incoming.outcome) return true;
  if (!existing.scoreAfter && incoming.scoreAfter) return true;
  return false;
}

interface MergeResult {
  points: TimelinePoint[];
  overlapConfirmed: number;
  flags: string[];
}

/**
 * Merge one capture's chronological point list into the accumulated one.
 *
 * Each capture's INTERNAL order is trustworthy (it is the order the rows sat on
 * screen). So the merge walks `incoming` with a cursor into `merged`: a point
 * whose key is already present at or after the cursor is the same point seen
 * again — the cursor advances and the overlap is counted. A point with no match
 * is inserted AT the cursor, i.e. between the two already-known points it sat
 * between on its own capture. That position is determined entirely by the
 * matched neighbours; nothing is inferred from the score progression.
 *
 * If NOTHING in `incoming` matches, the two captures share no points for this
 * game and there is no anchor to position them against. Those points are then
 * appended and flagged `order-uncertain` rather than being guessed into place.
 */
function alignWith(
  merged: TimelinePoint[],
  incoming: TimelinePoint[],
  keyFn: PointKeyFn,
): { points: TimelinePoint[]; overlapConfirmed: number; anchored: boolean } {
  const keys = new Set(merged.map(keyFn));
  // A '?' key carries no identity — a point with neither score nor Finish marker
  // must never be treated as matching another one just because both are unknown.
  const anchored = incoming.some((p) => keyFn(p) !== '?' && keys.has(keyFn(p)));
  if (!anchored) return { points: merged, overlapConfirmed: 0, anchored: false };

  const out = [...merged];
  let cursor = 0;
  let overlapConfirmed = 0;

  for (const p of incoming) {
    const key = keyFn(p);
    let found = -1;
    if (key !== '?') {
      for (let i = cursor; i < out.length; i++) {
        if (keyFn(out[i]) === key) {
          found = i;
          break;
        }
      }
    }
    if (found >= 0) {
      // Same point, seen twice. Keep whichever capture read it better.
      if (isRicherRead(out[found], p)) {
        out[found] = { ...p, flags: Array.from(new Set([...out[found].flags, ...p.flags])) };
      }
      cursor = found + 1;
      overlapConfirmed++;
    } else {
      out.splice(cursor, 0, { ...p, flags: [...p.flags, 'position-from-overlap'] });
      cursor++;
    }
  }

  return { points: out, overlapConfirmed, anchored: true };
}

/**
 * Merge one capture's chronological point list into the accumulated one.
 *
 * Each capture's INTERNAL order is trustworthy (it is the order the rows sat on
 * screen), so alignment is a cursor walk: a point whose key already appears at or
 * after the cursor is the same point seen again, and one with no match is
 * inserted AT the cursor — between the two known points it sat between on its own
 * capture. Position comes from matched neighbours; nothing is extrapolated.
 *
 * TWO TIERS, because one key is not enough on real captures.
 *
 *   1. (score + outcome) — the precise key. Preferred: it tells two repeated
 *      deuce rows apart when their outcomes differ.
 *   2. (score alone) — the SCORE PROGRESSION fallback, used only when tier 1
 *      found no anchor at all.
 *
 * Tier 2 exists because tier 1 demonstrably failed on real data: two captures of
 * one 7-point game shared a point whose outcome phrase OCR'd differently on each,
 * so no overlap was detected, the lists were appended end-to-end, and the shared
 * point was counted twice — 8 rows for a 7-point game. The score is a short
 * closed-alphabet string and reads identically on both captures; the outcome is
 * prose and is where OCR diverges. Falling back to the score recovers the anchor.
 *
 * Tier 2 is a FALLBACK, never the default: score alone cannot separate repeated
 * deuce states, so it is used only when the precise key has already come up empty
 * — i.e. when the alternative is appending blind and over-counting.
 *
 * If NEITHER tier anchors, the captures genuinely share no point. Those points
 * are appended and flagged `order-uncertain` rather than being guessed into place.
 */
function mergePointLists(merged: TimelinePoint[], incoming: TimelinePoint[]): MergeResult {
  const precise = alignWith(merged, incoming, pointKey);
  if (precise.anchored) {
    return { points: precise.points, overlapConfirmed: precise.overlapConfirmed, flags: [] };
  }

  const byScore = alignWith(merged, incoming, scoreProgressionKey);
  if (byScore.anchored) {
    return {
      points: byScore.points,
      overlapConfirmed: byScore.overlapConfirmed,
      flags: ['merged-by-score-progression'],
    };
  }

  const appended = incoming.map((p) => ({ ...p, flags: [...p.flags, 'order-uncertain'] }));
  const flags: string[] = [];
  if (merged.length && appended.length) flags.push('order-uncertain');
  return { points: [...merged, ...appended], overlapConfirmed: 0, flags };
}

// ── the stitcher ──────────────────────────────────────────────────────────

/** A readable label for a game in messages, whether or not its header parsed. */
export function gameLabel(game: { header: GameHeader; gamesPlayed?: number }): string {
  if (game.header.raw?.value) return game.header.raw.value;
  const gp = game.header.gamesPlayed ?? game.gamesPlayed;
  return gp === undefined ? 'an unnamed game' : `an unnamed game at ${gp} games played`;
}

/**
 * Recover the game-score of games whose header did not parse, from WHERE THEY SIT.
 *
 * Within one capture the feed is continuous and ordered, so an unnamed game's
 * neighbours pin it exactly: if the game chronologically before it ended at 4
 * games played and the one after at 6, the unnamed game is 5. This is read off
 * the on-screen ordering, not invented — and it is the only thing that lets a
 * game whose header misread rejoin the match timeline in the right place.
 *
 * Filled left-to-right in chronological order so a run of consecutive unnamed
 * games resolves by cascade. Anything still ambiguous is left undefined.
 */
function inferGamesPlayedForUnnamed(perScreenshot: TimelineScreenshotResult[]): void {
  for (const shot of perScreenshot) {
    // Chronological within a capture is DESCENDING y — the feed is most-recent-first.
    const chronological = [...shot.games].sort((a, b) => b.headerRowY - a.headerRowY);
    for (let i = 0; i < chronological.length; i++) {
      const game = chronological[i];
      if (game.header.gamesPlayed !== undefined) continue;
      const before = chronological[i - 1]?.header.gamesPlayed;
      const after = chronological[i + 1]?.header.gamesPlayed;

      let inferred: number | undefined;
      if (before !== undefined && after !== undefined) {
        // Only when the gap is exactly one game wide is the answer unique.
        if (after - before === 2) inferred = before + 1;
      } else if (before !== undefined) inferred = before + 1;
      else if (after !== undefined) inferred = after - 1;

      if (inferred !== undefined && inferred >= 0) {
        game.header.gamesPlayed = inferred;
        game.flags.push(`games-played ${inferred} inferred from neighbouring games on capture #${shot.screenshotIndex}`);
      }
    }
  }
}

/**
 * Identity of a game — VERB + GAME SCORE, deliberately WITHOUT the player name.
 *
 * The name was the bug. On real captures the same game's header reads "Arthur"
 * on one screenshot and "Seg Arthur" on another; those are three edits apart, so
 * name clustering put them in different groups and the ONE game became TWO
 * half-games — each with roughly half the points, so neither matched its meta
 * count, and the match showed "breaks for 3-2" twice.
 *
 * Verb and score are the reliable part of the header, and they are sufficient:
 * exactly one game exists per game-score within a set. (Across sets the score
 * restarts and two games can collide — headers print no set number, so that case
 * is reported as a conflict rather than silently merged.)
 *
 * A game whose header did not parse at all keys on its recovered position, and
 * adopts the named key when a capture elsewhere DID read that game's header — so
 * the named and unnamed views of one game stitch together instead of double-counting.
 */
function makeGameKeyFn(perScreenshot: TimelineScreenshotResult[]): (game: TimelineGame) => string {
  const namedKeyByGamesPlayed = new Map<number, string>();
  for (const shot of perScreenshot) {
    for (const game of shot.games) {
      const { outcome, gamesForNamedPlayer: a, gamesForOpponent: b, gamesPlayed } = game.header;
      if (outcome && a !== undefined && b !== undefined && gamesPlayed !== undefined) {
        namedKeyByGamesPlayed.set(gamesPlayed, `${outcome}|${a}-${b}`);
      }
    }
  }

  return (game: TimelineGame): string => {
    const { outcome, gamesForNamedPlayer: a, gamesForOpponent: b, gamesPlayed } = game.header;
    if (outcome && a !== undefined && b !== undefined) return `${outcome}|${a}-${b}`;
    if (gamesPlayed !== undefined) return namedKeyByGamesPlayed.get(gamesPlayed) ?? `unnamed|${gamesPlayed}`;
    return `unpositioned|#${game.screenshotIndex}|${game.headerRowY.toFixed(3)}`;
  };
}

/**
 * Build the single ordered match timeline from every timeline capture.
 *
 * Deterministic throughout: grouping is by a key read off the screen, ordering
 * is an ascending sort on `gamesPlayed` (ties broken by earliest capture, then
 * by position on that capture), and point merging is the anchored walk above.
 * The same screenshots in any upload order produce the same timeline.
 */
export function stitchTimeline(
  perScreenshot: TimelineScreenshotResult[],
  resolution: PlayerResolution,
): StitchedTimeline {
  const issues: StitchIssue[] = [];
  for (const flag of resolution.flags) {
    issues.push({
      kind: flag === 'more-than-two-player-names' ? 'conflict' : 'unnamed-player',
      detail:
        flag === 'opponent-unnamed'
          ? 'Only one player name was readable on any header (SwingVision writes an unnamed opponent in a script the English OCR model cannot read). Server is resolved only for that player\'s service games.'
          : flag === 'no-player-names-readable'
            ? 'No header player name was readable — server attribution is unavailable for every game.'
            : `Resolved ${resolution.players.length} distinct player names (${resolution.players.join(', ')}) — a singles match should have two. Names may have been misread.`,
      screenshotIndexes: perScreenshot.map((s) => s.screenshotIndex),
    });
  }

  // Recover positions for header-less games BEFORE keying, so they can adopt the
  // named key of the same game seen on another capture.
  inferGamesPlayedForUnnamed(perScreenshot);
  const keyOf = makeGameKeyFn(perScreenshot);

  // Group every game seen anywhere by its on-screen identity.
  const groups = new Map<string, TimelineGame[]>();
  const ordered = [...perScreenshot].sort((a, b) => a.screenshotIndex - b.screenshotIndex);
  for (const shot of ordered) {
    // Chronological within a capture = BOTTOM-UP, because the feed is
    // most-recent-first. Descending y gives that.
    const byRow = [...shot.games].sort((a, b) => b.headerRowY - a.headerRowY);
    for (const game of byRow) {
      const key = keyOf(game);
      const list = groups.get(key);
      if (list) list.push(game);
      else groups.set(key, [game]);
    }
  }

  const stitched: StitchedGame[] = [];

  for (const [key, instances] of groups) {
    // The point count printed on the game's own meta line — ground truth from
    // the screenshot, and the arbiter for everything below.
    const expectedPointCount = instances.map((g) => g.header.meta?.pointCount).find((n) => typeof n === 'number');

    const sawFinish = (g: TimelineGame) => g.points.some((p) => p.isFinish);

    /** What each capture saw on its own, before any merge — the evidence behind every choice below. */
    const perCaptureCounts = instances
      .map((g) => ({
        screenshotIndex: g.screenshotIndex,
        points: g.points.length,
        sawStart: Boolean(g.serviceMarker),
        sawFinish: sawFinish(g),
        matchesMeta: expectedPointCount !== undefined && g.points.length === expectedPointCount,
      }))
      .sort((a, b) => a.screenshotIndex - b.screenshotIndex);

    /**
     * Did this capture see the WHOLE game?
     *
     * WHEN THE META COUNT IS KNOWN IT IS THE ONLY EVIDENCE THAT COUNTS. The
     * boundary heuristic below (saw the 0-0 service row AND the Finish row) is a
     * fallback for games whose meta line was unreadable — used on its own it can
     * declare a capture complete that quietly dropped a middle row, and that
     * capture would then be trusted verbatim with a count the screenshot itself
     * contradicts. A number printed on the screen beats an inference about
     * boundaries every time.
     */
    const isComplete = (g: TimelineGame): boolean => {
      if (expectedPointCount !== undefined) return g.points.length === expectedPointCount;
      return Boolean(g.serviceMarker) && sawFinish(g);
    };

    /**
     * THE AUTHORITATIVE CAPTURE: one whose own point count equals the meta line.
     *
     * If a single capture already agrees with the number printed on the
     * screenshot, it IS the game — merging anything into it can only move the
     * count away from a figure we know to be right. Ties break on the lowest
     * screenshot index so the choice is stable.
     */
    const authoritative = instances
      .filter((g) => expectedPointCount !== undefined && g.points.length === expectedPointCount)
      .sort((a, b) => a.screenshotIndex - b.screenshotIndex)[0];

    /**
     * SPINE CHOICE, IN PRIORITY ORDER: the authoritative capture, then one that
     * looks complete, then simply the one that saw the most.
     */
    const spine =
      authoritative ??
      [...instances].sort((a, b) => {
        const aWhole = isComplete(a) ? 1 : 0;
        const bWhole = isComplete(b) ? 1 : 0;
        if (aWhole !== bWhole) return bWhole - aWhole;
        return b.points.length - a.points.length || a.screenshotIndex - b.screenshotIndex;
      })[0];

    let points = [...spine.points];
    let overlapConfirmedPoints = 0;
    const flags: string[] = [...spine.flags];
    let mergeStrategy: StitchedGame['mergeStrategy'] = 'single capture';

    const spineKeys = points.map(pointKey);
    const spineHasRepeats = new Set(spineKeys).size !== spineKeys.length;

    /**
     * WHEN ONE CAPTURE ALREADY HAS THE WHOLE GAME, DO NOT MERGE INTO IT.
     *
     * Merging can only ever corrupt a complete, self-consistent read, and at
     * deuce it demonstrably does: a game can legitimately contain several
     * identical (score, outcome) rows — 40-40 repeats every time the players
     * return to deuce — so the merge key is genuinely ambiguous there. Aligning a
     * partial second view against those repeats can collapse two distinct deuce
     * points into one or duplicate a third.
     *
     * The other captures are still WALKED, to count how many of their points the
     * complete view confirms. That overlap is kept as evidence; it just isn't
     * allowed to change the point list.
     */
    if (instances.length > 1 && (authoritative !== undefined || isComplete(spine))) {
      mergeStrategy = authoritative
        ? 'authoritative capture (matches meta count)'
        : 'complete capture (no merge needed)';
      const spineKeySet = new Set(spineKeys);
      for (const other of instances) {
        if (other === spine) continue;
        overlapConfirmedPoints += other.points.filter((p) => spineKeySet.has(pointKey(p))).length;
        for (const f of other.flags) if (!flags.includes(f)) flags.push(f);
      }
    } else if (instances.length > 1) {
      mergeStrategy = 'merged across captures';
      for (const other of instances) {
        if (other === spine) continue;
        const result = mergePointLists(points, other.points);
        points = result.points;
        overlapConfirmedPoints += result.overlapConfirmed;
        for (const f of result.flags) if (!flags.includes(f)) flags.push(f);
        for (const f of other.flags) if (!flags.includes(f)) flags.push(f);
      }
      if (flags.includes('merged-by-score-progression')) {
        mergeStrategy = 'merged across captures (score-progression aligned)';
      }
      // Repeated keys only make a MERGE ambiguous. On a single authoritative
      // capture they are simply what a deuce game looks like, and flagging them
      // there would cry wolf on correct data.
      if (spineHasRepeats || new Set(points.map(pointKey)).size !== points.length) {
        flags.push('duplicate-score-in-game');
      }
    }

    const pointCountMatchesMeta =
      expectedPointCount === undefined ? null : points.length === expectedPointCount;
    if (pointCountMatchesMeta === false) flags.push('point-count-disagrees-with-meta');

    /**
     * IS THIS GAME'S POINT LIST TRUSTWORTHY?
     *
     * True only when the list is backed by the number printed on the screenshot.
     * False means the captures could not be reconciled — the count is the best
     * that alignment could do, and it is known NOT to match the meta line. That
     * distinction has to travel with the data: a silently-wrong count feeds
     * straight into per-side winner and error tallies, where it is invisible.
     *
     * `null` (no meta line readable) is a third state on purpose — "not checkable"
     * is not the same claim as "checked and wrong".
     */
    const pointsVerifiedAgainstMeta = pointCountMatchesMeta === true;
    if (pointCountMatchesMeta === false) {
      flags.push('POINTS UNVERIFIED: could not be reconciled against the meta count');
    }

    // Prefer a header that actually PARSED — a capture that read this game's
    // header names it for every other capture that didn't.
    const named = instances.find((g) => g.headerParsed);
    const withMeta = instances.find((g) => g.header.meta);
    const baseHeader = named ? named.header : spine.header;
    const header: GameHeader = withMeta ? { ...baseHeader, meta: withMeta.header.meta } : baseHeader;
    const unnamed = !named;
    const gamesPlayed = header.gamesPlayed ?? instances.map((g) => g.header.gamesPlayed).find((n) => n !== undefined);
    const gamesPlayedInferred = unnamed && gamesPlayed !== undefined;

    const sourceScreenshots = Array.from(new Set(instances.map((g) => g.screenshotIndex))).sort(
      (a, b) => a - b,
    );

    stitched.push({
      key,
      gamesPlayed,
      header,
      unnamed,
      ...(gamesPlayedInferred ? { gamesPlayedInferred: true } : {}),
      serverName: spine.serverName ?? instances.find((g) => g.serverName)?.serverName,
      gameWinnerName: spine.gameWinnerName ?? instances.find((g) => g.gameWinnerName)?.gameWinnerName,
      points,
      sourceScreenshots,
      overlapConfirmedPoints,
      expectedPointCount,
      pointCountMatchesMeta,
      pointsVerifiedAgainstMeta,
      perCaptureCounts,
      mergeStrategy,
      flags,
    });

    if (flags.includes('duplicate-score-in-game')) {
      issues.push({
        kind: 'duplicate-score',
        detail: `Game "${gameLabel({ header, gamesPlayed })}" repeats a (score, outcome) row — legitimate at deuce, where 40-40 recurs — and no single capture showed the whole game, so it had to be merged. Aligning repeated rows across captures is ambiguous: a point may have been collapsed or duplicated here. Re-shoot this game in one capture to resolve it.`,
        screenshotIndexes: sourceScreenshots,
      });
    }
    if (pointCountMatchesMeta === false) {
      const seen = perCaptureCounts
        .map((c) => `#${c.screenshotIndex} saw ${c.points}`)
        .join(', ');
      issues.push({
        kind: 'duplicate-score',
        detail: `Game "${gameLabel({ header, gamesPlayed })}": POINTS UNVERIFIED — stitched to ${points.length}, but the meta line printed on the screenshot says ${expectedPointCount} (${seen}). No single capture matched the meta count, and the captures could not be reconciled by outcome or by score progression — most likely a misread score in one of them. The points shown are the best alignment available and are NOT verified; treat this game's counts as unreliable rather than as fact. Re-shooting this game in one capture would resolve it.`,
        screenshotIndexes: sourceScreenshots,
      });
    }
    if (flags.includes('order-uncertain')) {
      issues.push({
        kind: 'order-uncertain',
        detail: `Game "${gameLabel({ header, gamesPlayed })}" was seen on captures ${sourceScreenshots.join(', ')} with NO shared point rows, so the extra capture's points could not be anchored. They are appended and flagged, not positioned.`,
        screenshotIndexes: sourceScreenshots,
      });
    }
  }

  // CHRONOLOGY: ascending games-completed. Ties are a contradiction, not a
  // preference — two different games cannot both have ended at the same count.
  // A game whose position could not be recovered at all sorts to the end rather
  // than being slotted somewhere plausible.
  stitched.sort((a, b) => {
    const ap = a.gamesPlayed ?? Number.POSITIVE_INFINITY;
    const bp = b.gamesPlayed ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    const aFirst = Math.min(...a.sourceScreenshots);
    const bFirst = Math.min(...b.sourceScreenshots);
    if (aFirst !== bFirst) return aFirst - bFirst;
    return a.key.localeCompare(b.key);
  });

  for (let i = 1; i < stitched.length; i++) {
    const prev = stitched[i - 1];
    const cur = stitched[i];
    // Gap/collision checks only mean something when both positions are known.
    if (cur.gamesPlayed === undefined || prev.gamesPlayed === undefined) continue;
    if (cur.gamesPlayed === prev.gamesPlayed) {
      issues.push({
        kind: 'conflict',
        detail: `Two different games both report ${cur.gamesPlayed} games completed: "${gameLabel(prev)}" and "${gameLabel(cur)}". Headers do not print a set number, so this may be a set boundary (the count restarts) or a misread score — it is NOT resolved here.`,
        screenshotIndexes: Array.from(new Set([...prev.sourceScreenshots, ...cur.sourceScreenshots])),
      });
    } else if (cur.gamesPlayed > prev.gamesPlayed + 1) {
      issues.push({
        kind: 'gap',
        detail: `${cur.gamesPlayed - prev.gamesPlayed - 1} game(s) missing between "${gameLabel(prev)}" (${prev.gamesPlayed} played) and "${gameLabel(cur)}" (${cur.gamesPlayed} played) — no capture covered them.`,
        screenshotIndexes: Array.from(new Set([...prev.sourceScreenshots, ...cur.sourceScreenshots])),
      });
    }
  }

  // Cross-check: within a single capture, chronological order (bottom-up) must
  // agree with the gamesPlayed ordering. Disagreement means a header score was
  // misread, and it is reported rather than silently overridden by the sort.
  for (const shot of perScreenshot) {
    const chronological = [...shot.games].sort((a, b) => b.headerRowY - a.headerRowY);
    for (let i = 1; i < chronological.length; i++) {
      const here = chronological[i].header.gamesPlayed;
      const above = chronological[i - 1].header.gamesPlayed;
      if (here === undefined || above === undefined) continue;
      if (here <= above) {
        issues.push({
          kind: 'conflict',
          detail: `On capture #${shot.screenshotIndex}, "${gameLabel(chronological[i])}" sits below (earlier than) "${gameLabel(chronological[i - 1])}" on screen but reports the same or fewer games played. One of the two header scores was misread, or a set boundary falls between them.`,
          screenshotIndexes: [shot.screenshotIndex],
        });
      }
    }
  }

  const orphanPoints = ordered.flatMap((s) => s.orphanPoints);
  if (orphanPoints.length) {
    issues.push({
      kind: 'orphan-points',
      detail: `${orphanPoints.length} point row(s) appeared above the first game header on their capture, so no header identifies the server. They are kept unattributed.`,
      screenshotIndexes: Array.from(
        new Set(ordered.filter((s) => s.orphanPoints.length).map((s) => s.screenshotIndex)),
      ),
    });
  }

  return { games: stitched, issues, resolution, orphanPoints };
}
