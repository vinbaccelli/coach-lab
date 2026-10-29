'use client';

import { useMemo } from 'react';
import MatchReportView from '@/components/decoder/MatchReportView';
import { sanitizeSvg } from '@/components/reports/sanitizeSvg';
import type { SideReport } from '@/lib/matchAnalysis/reportModel';

/**
 * A saved decoder report, drawn by the same component as a manual match. The stored
 * chart SVG is run through the allowlist sanitizer first (MatchReportView injects
 * it as HTML); a chart that does not survive is left out, the rest of the report stays.
 */
export default function DecoderReportBlock({ reports, integrityWarnings }: { reports: SideReport[]; integrityWarnings: string[] }) {
  const safe = useMemo(
    () =>
      reports.map((r) => ({
        ...r,
        sections: r.sections.map((s) => ({
          ...s,
          charts: s.charts.map((svg) => sanitizeSvg(svg)).filter((svg): svg is string => svg !== null),
        })),
      })),
    [reports],
  );
  return <MatchReportView reports={safe} integrityWarnings={integrityWarnings} />;
}
