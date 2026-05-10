/** Configurable singles scoring — sets, games, tiebreaks, no-ad. */

import type { Side } from '@/lib/tennis/gameScore';

export type MatchFormatConfig = {
  bestOf: 1 | 3 | 5;
  gamesPerSet: 6 | 4;
  tiebreakAtDeadlock: boolean;
  tiebreakTarget: 7 | 10;
  finalSetRule: 'standard' | 'no_tb' | 'super_tb';
  noAd: boolean;
};

export type GamePhase = 'regular' | 'tiebreak' | 'supertiebreak';

export type FormattedBoard = {
  sets: [number, number][];
  games: [number, number];
  ip: number;
  io: number;
  phase: GamePhase;
  tbIp: number;
  tbIo: number;
};

export function emptyFormattedBoard(): FormattedBoard {
  return {
    sets: [],
    games: [0, 0],
    ip: 0,
    io: 0,
    phase: 'regular',
    tbIp: 0,
    tbIo: 0,
  };
}

export function defaultMatchFormat(): MatchFormatConfig {
  return {
    bestOf: 3,
    gamesPerSet: 6,
    tiebreakAtDeadlock: true,
    tiebreakTarget: 7,
    finalSetRule: 'standard',
    noAd: false,
  };
}

function setsWon(board: FormattedBoard, side: 0 | 1): number {
  let w = 0;
  for (const [a, b] of board.sets) {
    if (side === 0 && a > b) w++;
    if (side === 1 && b > a) w++;
  }
  return w;
}

function setsNeeded(bestOf: 1 | 3 | 5): number {
  return Math.ceil(bestOf / 2);
}

function matchOver(board: FormattedBoard, cfg: MatchFormatConfig): boolean {
  const need = setsNeeded(cfg.bestOf);
  return setsWon(board, 0) >= need || setsWon(board, 1) >= need;
}

function isDecidingSet(board: FormattedBoard, cfg: MatchFormatConfig): boolean {
  const need = setsNeeded(cfg.bestOf);
  const p = setsWon(board, 0);
  const o = setsWon(board, 1);
  return p === need - 1 && o === need - 1;
}

function deadlockGames(cfg: MatchFormatConfig, g: [number, number]): boolean {
  if (!cfg.tiebreakAtDeadlock) return false;
  const t = cfg.gamesPerSet;
  return (t === 6 && g[0] === 6 && g[1] === 6) || (t === 4 && g[0] === 4 && g[1] === 4);
}

function tbWon(a: number, b: number, target: number): boolean {
  const mx = Math.max(a, b);
  const lead = Math.abs(a - b);
  return mx >= target && lead >= 2;
}

function appendSet(board: FormattedBoard, ga: number, gb: number): FormattedBoard {
  const sets = [...board.sets, [ga, gb] as [number, number]];
  return {
    ...board,
    sets,
    games: [0, 0],
    ip: 0,
    io: 0,
    phase: 'regular',
    tbIp: 0,
    tbIo: 0,
  };
}

function completeSetFromGames(board: FormattedBoard, cfg: MatchFormatConfig): FormattedBoard {
  const ga = board.games[0];
  const gb = board.games[1];
  let nb = appendSet(board, ga, gb);
  if (matchOver(nb, cfg)) return nb;
  return nb;
}

export function applyFormattedPoint(
  prev: FormattedBoard,
  winner: Side,
  cfg: MatchFormatConfig,
): FormattedBoard {
  if (matchOver(prev, cfg)) return prev;

  const b: FormattedBoard = {
    sets: [...prev.sets.map((x) => [...x] as [number, number])],
    games: [...prev.games] as [number, number],
    ip: prev.ip,
    io: prev.io,
    phase: prev.phase,
    tbIp: prev.tbIp,
    tbIo: prev.tbIo,
  };

  const wi = winner === 'player' ? 0 : 1;

  if (b.phase === 'tiebreak' || b.phase === 'supertiebreak') {
    const deciding = isDecidingSet(b, cfg);
    let target =
      b.phase === 'supertiebreak'
        ? 10
        : cfg.tiebreakTarget;

    if (b.phase === 'tiebreak' && deciding && cfg.finalSetRule === 'super_tb') {
      target = 10;
    }

    if (wi === 0) b.tbIp += 1;
    else b.tbIo += 1;

    if (tbWon(b.tbIp, b.tbIo, target)) {
      let ga = b.games[0];
      let gb = b.games[1];
      if (wi === 0) ga += 1;
      else gb += 1;
      const fin = {
        ...b,
        games: [ga, gb] as [number, number],
        phase: 'regular' as const,
        tbIp: 0,
        tbIo: 0,
        ip: 0,
        io: 0,
      };
      return completeSetFromGames(fin, cfg);
    }
    return b;
  }

  let ip = b.ip;
  let io = b.io;
  if (wi === 0) ip += 1;
  else io += 1;

  if (cfg.noAd && ip >= 3 && io >= 3) {
    const nb = { ...b, ip: 0, io: 0, games: [...b.games] as [number, number] };
    if (wi === 0) nb.games[0] += 1;
    else nb.games[1] += 1;
    return afterGameWon(nb, cfg);
  }

  const winRegular = (a: number, o: number) => {
    if (cfg.noAd) return a >= 4 && a > o;
    return a >= 4 && a - o >= 2;
  };

  if (winRegular(ip, io)) {
    const nb = { ...b, ip: 0, io: 0, games: [...b.games] as [number, number] };
    nb.games[0] += 1;
    return afterGameWon(nb, cfg);
  }
  if (winRegular(io, ip)) {
    const nb = { ...b, ip: 0, io: 0, games: [...b.games] as [number, number] };
    nb.games[1] += 1;
    return afterGameWon(nb, cfg);
  }

  return { ...b, ip, io };
}

function afterGameWon(b: FormattedBoard, cfg: MatchFormatConfig): FormattedBoard {
  const g = b.games;
  if (deadlockGames(cfg, g)) {
    const deciding = isDecidingSet(b, cfg);
    if (deciding && cfg.finalSetRule === 'super_tb') {
      return { ...b, phase: 'supertiebreak', tbIp: 0, tbIo: 0, ip: 0, io: 0 };
    }
    if (deciding && cfg.finalSetRule === 'no_tb') {
      const gt = cfg.gamesPerSet;
      const ga = g[0];
      const gb = g[1];
      if ((ga >= gt && ga - gb >= 2) || (gb >= gt && gb - ga >= 2)) {
        return completeSetFromGames(b, cfg);
      }
      return { ...b, phase: 'tiebreak', tbIp: 0, tbIo: 0, ip: 0, io: 0 };
    }
    return { ...b, phase: 'tiebreak', tbIp: 0, tbIo: 0, ip: 0, io: 0 };
  }

  const gt = cfg.gamesPerSet;
  const ga = g[0];
  const gb = g[1];
  if ((ga >= gt && ga - gb >= 2) || (gb >= gt && gb - ga >= 2)) {
    return completeSetFromGames(b, cfg);
  }

  return b;
}

export function formatFormattedScoreLine(
  b: FormattedBoard,
  cfg: MatchFormatConfig,
  names: { player: string; opponent: string },
): string {
  const setStr = b.sets.map(([x, y]) => `${x}-${y}`).join(', ');
  const g = `${b.games[0]}-${b.games[1]}`;
  let pts: string;
  if (b.phase === 'tiebreak' || b.phase === 'supertiebreak') {
    pts = `${b.tbIp}-${b.tbIo} TB`;
  } else {
    pts = formatRegularPoints(b.ip, b.io, cfg.noAd);
  }
  const head = setStr ? `${setStr} · ` : '';
  return `${head}${names.player} ${g} (${pts})`;
}

function formatRegularPoints(ip: number, io: number, noAd: boolean): string {
  const lab = (n: number) => {
    if (n >= 3) return '40';
    if (n === 2) return '30';
    if (n === 1) return '15';
    return '0';
  };
  if (!noAd && ip >= 3 && io >= 3) {
    if (ip === io) return 'Deuce';
    return ip > io ? 'Ad–In' : 'Ad–Out';
  }
  return `${lab(ip)}–${lab(io)}`;
}
