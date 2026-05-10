import type { Side, TennisBoard } from '@/lib/tennis/gameScore';

export type ManualOutcome =
  | { kind: 'serve'; detail: 'double_fault' | 'ace' }
  | { kind: 'ue'; stroke: string }
  | { kind: 'winner'; stroke: string };

export type LoggedPoint = {
  winner: Side;
  outcome: ManualOutcome;
};

/** Plain-text report aligned with decoder sections (simplified aggregates). */
export function compileManualReport(
  playerName: string,
  opponentName: string,
  points: LoggedPoint[],
  board?: TennisBoard,
): string {
  const lines: string[] = [];
  lines.push(`GENERAL STATISTICS AND PERFORMANCE INDICES`);
  lines.push(`Players: ${playerName} vs ${opponentName}`);
  const setParts = board?.sets?.length
    ? `${board.sets.map(([a, b]) => `${a}-${b}`).join(', ')}`
    : '';
  const g = board ? `${board.games[0]}-${board.games[1]}` : '';
  const scoreLine =
    board && (setParts || g !== '0-0')
      ? `Final score snapshot — Sets: ${setParts || '(in progress)'} Games in set: ${g}`
      : '';
  if (scoreLine) lines.push(scoreLine);
  lines.push(`Total Points Played: ${points.length}`);

  let pPts = 0;
  let oPts = 0;
  let winners = 0;
  let ue = 0;
  let dfs = 0;
  let aces = 0;

  for (const pt of points) {
    if (pt.winner === 'player') pPts++;
    else oPts++;
    if (pt.outcome.kind === 'winner') winners++;
    if (pt.outcome.kind === 'ue') ue++;
    if (pt.outcome.kind === 'serve') {
      if (pt.outcome.detail === 'double_fault') dfs++;
      if (pt.outcome.detail === 'ace') aces++;
    }
  }

  const am = winners - ue;
  const eer = ue === 0 ? winners : winners / ue;
  lines.push(`Aggressive Margin (AM): ${am}`);
  lines.push(`Error Efficiency Ratio (EER): ${eer.toFixed(3)}`);
  lines.push(`Total UE count: ${ue}`);
  lines.push(`Double faults logged: ${dfs}`);
  lines.push(`Aces logged: ${aces}`);
  lines.push('');
  lines.push(`DETAILED UNFORCED ERROR ANALYSIS`);
  points.forEach((pt, i) => {
    if (pt.outcome.kind === 'ue') {
      lines.push(`Point ${i + 1}: ${pt.outcome.stroke} — ${pt.winner === 'player' ? opponentName : playerName} committed UE`);
    }
  });
  lines.push('');
  lines.push(`SERVE ANALYSIS`);
  points.forEach((pt, i) => {
    if (pt.outcome.kind === 'serve') {
      lines.push(`Point ${i + 1}: ${pt.outcome.detail === 'ace' ? 'Ace' : 'Double fault'}`);
    }
  });
  lines.push('');
  lines.push(`FORCED ERRORS INDUCED AND WINNERS`);
  points.forEach((pt, i) => {
    if (pt.outcome.kind === 'winner') {
      lines.push(`Point ${i + 1}: Winner (${pt.outcome.stroke}) by ${pt.winner === 'player' ? playerName : opponentName}`);
    }
  });
  lines.push('');
  lines.push(`COACHES SUMMARY`);
  lines.push(
    `Manual log summary for coaching review. Point totals — ${playerName}: ${pPts}, ${opponentName}: ${oPts}. Review UE vs Winners ratio above for session priorities.`,
  );

  return lines.join('\n');
}
