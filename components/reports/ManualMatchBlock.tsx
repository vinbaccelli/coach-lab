'use client';

import { useMemo } from 'react';
import MatchReportView from '@/components/decoder/MatchReportView';
import { buildManualReport } from '@/lib/tennis/manualReportModel';
import { manualMatchToReportInput } from '@/lib/reports/manualMatchInput';
import type { ManualMatchData } from '@/lib/reports/deriveBlocks';

/**
 * The manual-match report, rebuilt from the logged points exactly as the recorder
 * shows it (same model, same renderer). `fallbackText` is the compiled plain-text
 * report saved with the entry, shown if an old row's points no longer fit the model.
 */
export default function ManualMatchBlock({ match, fallbackText }: { match: ManualMatchData; fallbackText: string }) {
  const reports = useMemo(() => {
    try {
      return buildManualReport(manualMatchToReportInput(match));
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
