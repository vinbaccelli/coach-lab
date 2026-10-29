'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Camera, Play } from 'lucide-react';
import { filterReports, groupByMonth, type Report, type ReportKind } from '@/lib/reports/deriveBlocks';
import { usePlayerReports } from '@/components/reports/usePlayerReports';
import PlayerNav, { PlayerNotFound } from '@/components/reports/PlayerNav';
import { chipStyle, FOCUS_CSS, formatDateKey, KIND_CHIP, measure, mutedText, wrap } from '@/components/reports/reportStyles';

const FILTERS: Array<{ key: ReportKind | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'technical', label: 'Technical' },
  { key: 'match', label: 'Match' },
];

/** The row headline in the index: a technical day is named by its date (the chip already says what it is). */
function rowTitle(r: Report): string {
  if (r.kind === 'technical') return formatDateKey(r.dateKey, { weekday: 'long', day: 'numeric', month: 'long' });
  return reportTitle(r);
}

export function reportTitle(r: Report): string {
  if (r.kind === 'technical') return `Technical analysis, ${formatDateKey(r.dateKey)}`;
  return r.title || (r.opponent ? `Match vs ${r.opponent}` : `Match analysis, ${formatDateKey(r.dateKey)}`);
}

export default function ReportsIndexClient({ playerId }: { playerId: string }) {
  const { playerName, reports, loading, error, notFound, reload } = usePlayerReports(playerId);
  const [kind, setKind] = useState<ReportKind | 'all'>('all');
  const [query, setQuery] = useState('');

  const months = useMemo(() => groupByMonth(filterReports(reports, kind, query)), [reports, kind, query]);
  const filtering = kind !== 'all' || query.trim() !== '';
  if (notFound) return <PlayerNotFound />;

  return (
    <div className="rpt" style={wrap}>
      <style>{FOCUS_CSS}</style>
      <PlayerNav playerId={playerId} playerName={playerName} current="reports" />
      <h1 style={{ margin: '4px 0 16px', fontSize: 'clamp(24px, 6vw, 32px)', lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.01em' }}>
        Reports
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by date, opponent or note"
          aria-label="Search reports"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            minHeight: 44,
            padding: '10px 14px',
            borderRadius: 12,
            border: '1px solid var(--cl-border)',
            background: 'var(--cl-bg-panel)',
            fontSize: 16, // 16px keeps iOS Safari from zooming the page on focus
          }}
        />
        <div role="group" aria-label="Report type" style={{ display: 'flex', gap: 8 }}>
          {FILTERS.map((f) => {
            const on = kind === f.key;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={on}
                onClick={() => setKind(f.key)}
                style={{
                  minHeight: 44,
                  padding: '0 16px',
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--cl-action-primary)' : 'var(--cl-border)'}`,
                  background: on ? 'var(--cl-action-primary)' : 'var(--cl-bg-panel)',
                  color: on ? 'var(--cl-text-on-fill)' : 'var(--cl-text-primary)',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <p role="status" style={{ ...mutedText, padding: '24px 0' }}>Loading reports…</p>
      ) : error ? (
        <div role="alert" style={{ padding: '24px 0' }}>
          <p style={{ margin: '0 0 12px', color: 'var(--cl-destructive-text)', fontSize: 14 }}>{error}</p>
          <button type="button" onClick={() => void reload()} style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', fontWeight: 700, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      ) : months.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>
            {filtering ? 'No reports match' : 'No reports yet'}
          </p>
          <p style={{ ...mutedText, ...measure, margin: 0, marginInline: 'auto' }}>
            {filtering
              ? 'Try another word, or show All reports.'
              : 'Save a screenshot from the analysis app to start a report. Match Decoder and Manual match stats add Match analysis reports.'}
          </p>
        </div>
      ) : (
        months.map((g) => (
          <section key={g.monthKey} aria-label={g.label} style={{ marginTop: 20 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--cl-text-secondary)', letterSpacing: 0 }}>{g.label}</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {g.reports.map((r) => (
                <li key={r.key} style={{ borderTop: '1px solid var(--cl-border-subtle)' }}>
                  <Link
                    href={`/players/${playerId}/reports/${r.linkId}`}
                    style={{ display: 'block', padding: '14px 2px', color: 'inherit', textDecoration: 'none', minHeight: 44 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={chipStyle(r.kind)}>{KIND_CHIP[r.kind].label}</span>
                      {r.kind === 'match' ? (
                        <span style={{ ...mutedText, fontSize: 12 }}>{formatDateKey(r.dateKey, { day: 'numeric', month: 'short' })}</span>
                      ) : null}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{rowTitle(r)}</div>
                    {r.opponent && r.title ? <div style={{ ...mutedText, marginTop: 2 }}>vs {r.opponent}</div> : null}
                    {r.screenshotCount > 0 || r.hasVideo ? (
                      <div style={{ ...mutedText, fontSize: 12, marginTop: 6, display: 'flex', gap: 14 }}>
                        {r.screenshotCount > 0 ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Camera size={13} aria-hidden /> {r.screenshotCount} screenshot{r.screenshotCount === 1 ? '' : 's'}
                          </span>
                        ) : null}
                        {r.hasVideo ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Play size={13} aria-hidden /> Video
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
