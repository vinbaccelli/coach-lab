'use client';

import { useMemo } from 'react';
import MatchReportView from '@/components/decoder/MatchReportView';
import { buildManualReport, type ManualReportInput } from '@/lib/tennis/manualReportModel';
import { describeStartingScore } from '@/lib/tennis/startingScore';
import type { ManualMatchData } from '@/lib/reports/deriveBlocks';

function startingScoreNote(m: ManualMatchData): string | null {
  const s = m.startingScore as Record<string, unknown> | undefined;
  if (!s || typeof s.gamesPlayer !== 'number' || typeof s.gamesOpponent !== 'number') return null;
  try {
    return describeStartingScore(s as unknown as Parameters<typeof describeStartingScore>[0], { player: m.playerName, opponent: m.opponentName });
  } catch {
    return null;
  }
}

/**
 * The manual-match report, rebuilt from the logged points exactly as the recorder
 * shows it (same model, same renderer). `fallbackText` is the compiled plain-text
 * report saved with the entry, shown if an old row's points no longer fit the model.
 */
export default function ManualMatchBlock({ match, fallbackText }: { match: ManualMatchData; fallbackText: string }) {
  const reports = useMemo(() => {
    try {
      return buildManualReport({
        playerName: match.playerName,
        opponentName: match.opponentName,
        points: match.points as ManualReportInput['points'],
        board: match.board as ManualReportInput['board'],
        startingScoreNote: startingScoreNote(match),
        finish: match.finish as ManualReportInput['finish'],
        gameNotes: match.gameNotes,
      });
    } catch (e) {
      console.error('[reports] manual match could not be rebuilt:', e instanceof Error ? e.message : e);
      return null;
    }
  }, [match]);

  if (!reports) {
    return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.55 }}>{fallbackText || 'This match report could not be displayed.'}</pre>;
  }
  return <MatchReportView reports={reports} />;
}
