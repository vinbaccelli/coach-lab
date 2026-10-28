'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { findReportForEntry } from '@/lib/reports/deriveBlocks';
import { usePlayerReports } from '@/components/reports/usePlayerReports';
import ReportBlocks from '@/components/reports/ReportBlocks';
import StickyBack from '@/components/reports/StickyBack';
import { reportTitle } from '@/components/reports/ReportsIndexClient';
import { backLink, chipStyle, FOCUS_CSS, formatDateKey, KIND_CHIP, mutedText, wrap } from '@/components/reports/reportStyles';

export default function ReportViewClient({ playerId, entryId }: { playerId: string; entryId: string }) {
  const { playerName, reports, loading, error, reload } = usePlayerReports(playerId);
  const report = useMemo(() => findReportForEntry(reports, entryId), [reports, entryId]);

  // Arriving straight from "Saved to report": the row can lag the redirect by a beat, so look once more.
  const [retried, setRetried] = useState(false);
  useEffect(() => {
    if (loading || report || error || retried) return;
    const t = setTimeout(() => {
      setRetried(true);
      void reload({ quiet: true });
    }, 1500);
    return () => clearTimeout(t);
  }, [loading, report, error, retried, reload]);

  const back = (
    <>
      <style>{FOCUS_CSS}</style>
      <StickyBack>
        <Link href={`/players/${playerId}/reports`} style={backLink}>
          <ArrowLeft size={16} aria-hidden /> {playerName ? `${playerName} · Reports` : 'Reports'}
        </Link>
      </StickyBack>
    </>
  );

  if (loading || (!report && !error && !retried)) {
    return (
      <div className="rpt" style={wrap}>
        {back}
        <p role="status" style={{ ...mutedText, padding: '24px 0' }}>Loading report…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rpt" style={wrap}>
        {back}
        <div role="alert" style={{ padding: '24px 0' }}>
          <p style={{ margin: '0 0 12px', color: 'var(--cl-destructive-text)', fontSize: 14 }}>{error}</p>
          <button type="button" onClick={() => void reload()} style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', fontWeight: 700, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="rpt" style={wrap}>
        {back}
        <p style={{ margin: '24px 0 6px', fontSize: 16, fontWeight: 700 }}>This report wasn’t found</p>
        <p style={mutedText}>It may have been removed. Open the list to see what’s saved.</p>
      </div>
    );
  }

  return (
    <article className="rpt" style={wrap}>
      {back}
      <header style={{ margin: '4px 0 28px' }}>
        <span style={chipStyle(report.kind)}>{KIND_CHIP[report.kind].label}</span>
        <h1 style={{ margin: '10px 0 6px', fontSize: 'clamp(24px, 6vw, 34px)', lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.01em', textWrap: 'balance' as never }}>
          {reportTitle(report)}
        </h1>
        <p style={{ ...mutedText, margin: 0 }}>
          {formatDateKey(report.dateKey, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          {report.opponent ? ` · vs ${report.opponent}` : ''}
        </p>
      </header>
      <ReportBlocks blocks={report.blocks} fallbackText={report.fallbackText} />
      <nav aria-label="Report navigation" style={{ marginTop: 40, paddingTop: 8, borderTop: '1px solid var(--cl-border-subtle)' }}>
        <Link href={`/players/${playerId}/reports`} style={backLink}>
          <ArrowLeft size={16} aria-hidden /> All reports
        </Link>
      </nav>
    </article>
  );
}
