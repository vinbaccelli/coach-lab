/** Singles point/game/set tracking using integer points-per-game (>=4, win by 2). */

export type Side = 'player' | 'opponent';

export type TennisBoard = {
  sets: [number, number][];
  games: [number, number];
  /** Raw points in current game */
  ip: number;
  io: number;
};

export function emptyBoard(): TennisBoard {
  return { sets: [], games: [0, 0], ip: 0, io: 0 };
}

export function applyPoint(prev: TennisBoard, winner: Side): TennisBoard {
  const b: TennisBoard = {
    sets: [...prev.sets.map((x) => [...x] as [number, number])],
    games: [...prev.games] as [number, number],
    ip: prev.ip,
    io: prev.io,
  };

  if (winner === 'player') b.ip += 1;
  else b.io += 1;

  const winGame = (a: number, o: number) => a >= 4 && a - o >= 2;
  if (winGame(b.ip, b.io)) {
    b.games[0] += 1;
    b.ip = 0;
    b.io = 0;
    maybeCompleteSet(b);
  } else if (winGame(b.io, b.ip)) {
    b.games[1] += 1;
    b.ip = 0;
    b.io = 0;
    maybeCompleteSet(b);
  }

  return b;
}

function maybeCompleteSet(b: TennisBoard) {
  const [ga, gb] = b.games;
  if (ga >= 6 && ga - gb >= 2) {
    b.sets.push([ga, gb]);
    b.games = [0, 0];
  } else if (gb >= 6 && gb - ga >= 2) {
    b.sets.push([ga, gb]);
    b.games = [0, 0];
  }
}

/** Tennis-style display for current game */
export function formatGamePoints(ip: number, io: number): string {
  const lab = (n: number) => {
    if (n >= 3) return '40';
    if (n === 2) return '30';
    if (n === 1) return '15';
    return '0';
  };
  if (ip >= 3 && io >= 3) {
    if (ip === io) return 'Deuce';
    return ip > io ? `Ad–In` : `Ad–Out`;
  }
  return `${lab(ip)}–${lab(io)}`;
}

export function formatFullScore(b: TennisBoard, names: { player: string; opponent: string }): string {
  const setStr = b.sets.map(([a, x]) => `${a}-${x}`).join(', ');
  const g = `${b.games[0]}-${b.games[1]}`;
  const p = formatGamePoints(b.ip, b.io);
  const header = setStr ? `${setStr} ` : '';
  return `${header}${names.player} ${g} (${p})`;
}
