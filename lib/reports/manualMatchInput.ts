import type { ManualMatchData } from '@/lib/reports/deriveBlocks';
import type { ManualReportInput } from '@/lib/tennis/manualReportModel';
import { describeStartingScore } from '@/lib/tennis/startingScore';

/** The starting-score one-liner, from the `startingScore` object the recorder stores. */
export function startingScoreNote(m: ManualMatchData): string | null {
  const s = m.startingScore as Record<string, unknown> | undefined;
  if (!s || typeof s.gamesPlayer !== 'number' || typeof s.gamesOpponent !== 'number') return null;
  try {
    return describeStartingScore(s as unknown as Parameters<typeof describeStartingScore>[0], {
      player: m.playerName,
      opponent: m.opponentName,
    });
  } catch {
    return null;
  }
}

/**
 * What `buildManualReport` needs, rebuilt from the `metadata.manualMatch` the
 * recorder saved. It is the same input the recorder's own on-screen report uses
 * (components/ManualMatchRecorder.tsx `reports`), so the saved report and the live
 * one cannot drift apart.
 */
export function manualMatchToReportInput(m: ManualMatchData): ManualReportInput {
  return {
    playerName: m.playerName,
    opponentName: m.opponentName,
    points: m.points as ManualReportInput['points'],
    board: m.board as ManualReportInput['board'],
    startingScoreNote: startingScoreNote(m),
    finish: m.finish as ManualReportInput['finish'],
    gameNotes: m.gameNotes,
  };
}
