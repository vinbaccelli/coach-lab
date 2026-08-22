/**
 * FEATURE E — start a match from an existing score.
 *
 * Seeds a board so the coach can pick up a match already in progress (e.g. "4-2,
 * 15-0, I'm serving") and log from there. There is NO persistence and no resume:
 * this is purely an initial value for the score state.
 *
 * The seeded games are NOT logged points, so every statistic still describes
 * only the points actually recorded from this moment on. The report says so
 * explicitly rather than implying the numbers cover the whole match.
 */

import type { Side } from '@/lib/tennis/gameScore';
import {
  emptyFormattedBoard,
  type FormattedBoard,
  type MatchFormatConfig,
} from '@/lib/tennis/matchFormat';

/** Point labels in the order they appear in a game. */
export const POINT_LABELS = ['0', '15', '30', '40', 'Ad'] as const;
export type PointLabel = (typeof POINT_LABELS)[number];

/** Raw integer points behind each label — the unit `FormattedBoard` stores. */
export function pointLabelToRaw(label: PointLabel): number {
  return POINT_LABELS.indexOf(label);
}

export type StartingScore = {
  gamesPlayer: number;
  gamesOpponent: number;
  pointsPlayer: PointLabel;
  pointsOpponent: PointLabel;
  /** Who serves the game that is currently in progress. */
  server: Side;
};

export function defaultStartingScore(): StartingScore {
  return {
    gamesPlayer: 0,
    gamesOpponent: 0,
    pointsPlayer: '0',
    pointsOpponent: '0',
    server: 'player',
  };
}

export type SeedResult =
  | { ok: true; board: FormattedBoard; gamesAtStart: number }
  | { ok: false; error: string };

/**
 * Build a board from a manual score, refusing states the scoring engine could
 * never have produced.
 *
 * Rejecting is deliberate: silently clamping a nonsense score would leave the
 * coach logging against a board that disagrees with the one in their head.
 */
export function seedBoardFromScore(score: StartingScore, cfg: MatchFormatConfig): SeedResult {
  const gp = Math.floor(score.gamesPlayer);
  const go = Math.floor(score.gamesOpponent);

  if (!Number.isFinite(gp) || !Number.isFinite(go) || gp < 0 || go < 0) {
    return { ok: false, error: 'Games must be zero or more.' };
  }

  const target = cfg.gamesPerSet;
  const setWon = (a: number, b: number) => a >= target && a - b >= 2;
  if (setWon(gp, go) || setWon(go, gp)) {
    return {
      ok: false,
      error: `That game score (${gp}-${go}) has already won the set. Start from a score inside an unfinished set.`,
    };
  }
  if (gp > target + 1 || go > target + 1) {
    return { ok: false, error: `Games cannot exceed ${target + 1} in a set of ${target}.` };
  }
  if (cfg.tiebreakAtDeadlock && gp === target && go === target) {
    return {
      ok: false,
      error: `${gp}-${go} starts a tiebreak, which cannot be seeded yet. Start from the game before it.`,
    };
  }

  const ip = pointLabelToRaw(score.pointsPlayer);
  const io = pointLabelToRaw(score.pointsOpponent);

  if (cfg.noAd && (score.pointsPlayer === 'Ad' || score.pointsOpponent === 'Ad')) {
    return { ok: false, error: 'This format is no-ad, so there is no advantage point.' };
  }
  if (cfg.noAd && ip >= 3 && io >= 3) {
    return { ok: false, error: 'This format is no-ad, so 40-40 is decided immediately.' };
  }
  if (score.pointsPlayer === 'Ad' && io !== 3) {
    return { ok: false, error: 'Advantage is only possible from deuce (40-40).' };
  }
  if (score.pointsOpponent === 'Ad' && ip !== 3) {
    return { ok: false, error: 'Advantage is only possible from deuce (40-40).' };
  }

  const board: FormattedBoard = {
    ...emptyFormattedBoard(),
    games: [gp, go],
    ip,
    io,
  };

  return { ok: true, board, gamesAtStart: gp + go };
}

/** Human-readable one-liner for the report header, or null when unseeded. */
export function describeStartingScore(score: StartingScore, names: { player: string; opponent: string }): string | null {
  const fresh =
    score.gamesPlayer === 0 &&
    score.gamesOpponent === 0 &&
    score.pointsPlayer === '0' &&
    score.pointsOpponent === '0';
  if (fresh) return null;
  return `Started from ${score.gamesPlayer}-${score.gamesOpponent}, ${score.pointsPlayer}-${score.pointsOpponent} (${score.server === 'player' ? names.player : names.opponent} serving)`;
}
