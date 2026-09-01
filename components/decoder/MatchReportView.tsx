'use client';

/**
 * The report — the product surface.
 *
 * Deliberately quiet: generous whitespace, one text colour for values and a
 * lighter one for explanations, hairline rules instead of boxes-inside-boxes, no
 * accent colour competing with the charts. It is laid out to survive being read
 * on screen AND pasted into a Google Doc, which is why the charts are the same
 * SVG the exporter rasterises rather than a screen-only variant.
 *
 * A metric with no value renders its REASON in place of a number — never a dash
 * that could pass for zero, never a blank cell. That is the whole discipline of
 * this decoder made visible: the reader can always tell measured from unknown.
 */

import React from 'react';
import type { ReportSection, SideReport } from '@/lib/matchAnalysis/reportModel';
import type { MatchAnalysis } from '@/lib/matchAnalysis/types';

export default function MatchReportView({
  reports,
  analysis,
}: {
  reports: SideReport[];
  /**
   * Decoder-only context, used solely for the integrity warnings above the
   * report. OPTIONAL so the manual match recorder can render through this same
   * component: manual logging has no OCR to contradict itself, so it has no
   * integrity warnings to show — and everything below this block is driven
   * entirely by `reports`.
   */
  analysis?: MatchAnalysis;
}) {
  return (
    <div>
      {analysis && analysis.integrityWarnings.length > 0 && (
        <div style={warnBox}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
            {analysis.integrityWarnings.length} consistency check(s) flagged
          </div>
          {analysis.integrityWarnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 4 }}>{w}</div>
          ))}
          <div style={{ fontSize: 10, color: 'var(--cl-text-secondary)', marginTop: 6 }}>
            These are reported rather than corrected — an automatic fix would be a guess about which of two
            readings was wrong.
          </div>
        </div>
      )}

      {reports.map((report, idx) => (
        <section key={report.sideId} style={{ marginBottom: 56 }}>
          <div style={sideHeader}>
            <div style={{ fontSize: 11, letterSpacing: 1.2, color: 'var(--cl-text-secondary)', fontWeight: 700 }}>
              SIDE {report.sideId}
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, margin: '4px 0 0', letterSpacing: -0.4 }}>
              {report.label}
            </h2>
          </div>
          {report.sections.map((section) => (
            <SectionBlock key={section.id} section={section} />
          ))}
          {idx === 0 && <hr style={{ border: 0, borderTop: '1px solid var(--cl-border)', margin: '48px 0 0' }} />}
        </section>
      ))}
    </div>
  );
}

function SectionBlock({ section }: { section: ReportSection }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>
        <span style={{ color: '#C7C7CC', marginRight: 8 }}>{section.number}</span>
        {section.heading}
      </h3>
      <p style={{ fontSize: 12.5, color: 'var(--cl-text-secondary)', lineHeight: 1.6, margin: '0 0 18px', maxWidth: 640 }}>
        {section.explanation}
      </p>

      {!section.present && (
        <div style={{ fontSize: 12, color: 'var(--cl-text-muted)', fontStyle: 'italic', marginBottom: 14 }}>
          Not available for this side.
        </div>
      )}

      {section.rows.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 640, marginBottom: 22 }}>
          {section.rows.some((r) => r.opponent) && (
            <thead>
              <tr>
                <th style={{ ...cell, textAlign: 'left', fontSize: 9.5, color: '#A8A8AE', fontWeight: 600 }} />
                <th style={{ ...cell, textAlign: 'right', fontSize: 9.5, color: '#A8A8AE', fontWeight: 600 }}>
                  opponent
                </th>
                <th style={{ ...cell, textAlign: 'right', fontSize: 9.5, color: '#A8A8AE', fontWeight: 600 }}>
                  this side
                </th>
              </tr>
            </thead>
          )}
          <tbody>
            {section.rows.map((row, i) =>
              row.label === '•' ? (
                <tr key={i}>
                  <td colSpan={3} style={{ ...cell, fontSize: 13, lineHeight: 1.6, paddingLeft: 0 }}>
                    <span style={{ color: '#C7C7CC', marginRight: 8 }}>—</span>
                    {row.value}
                  </td>
                </tr>
              ) : (
                <tr key={i}>
                  <td style={{ ...cell, color: 'var(--cl-text-secondary)', width: '54%' }}>
                    <span style={{ color: 'var(--cl-text-primary)' }}>{row.label}</span>
                    {row.note && row.value !== null && (
                      <div style={{ fontSize: 10.5, color: 'var(--cl-text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                        {row.note}
                      </div>
                    )}
                    {row.context && row.value !== null && (
                      <div style={{ fontSize: 10.5, color: 'var(--cl-text-muted)', marginTop: 3, lineHeight: 1.5, fontStyle: 'italic' }}>
                        {row.context}
                      </div>
                    )}
                    {row.howComputed && row.value !== null && (
                      <div style={{ fontSize: 9.5, color: '#C0C0C6', marginTop: 3, lineHeight: 1.45 }}>
                        {row.howComputed}
                      </div>
                    )}
                  </td>
                  {/* Opponent column: the comparison a coach reads first. */}
                  <td style={{ ...cell, textAlign: 'right', fontSize: 12, color: '#A8A8AE', width: '16%' }}>
                    {row.opponent ?? ''}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700, fontSize: 16, width: '30%' }}>
                    {row.value !== null ? (
                      row.value
                    ) : (
                      <span style={{ fontWeight: 400, fontSize: 10.5, color: '#A8A8AE' }}>{row.note}</span>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}

      {section.charts.map((svg, i) => (
        <div
          key={i}
          style={{ marginBottom: 20, maxWidth: 640, overflowX: 'auto' }}
          // The chart markup is generated by lib/matchAnalysis/svgCharts from
          // numbers, and every interpolated string passes through `esc()` there.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ))}

      {section.notes.map((note, i) => (
        <p key={i} style={footnote}>{note}</p>
      ))}
      {section.coverage && <p style={{ ...footnote, color: '#A8A8AE' }}>{section.coverage}</p>}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: '9px 4px',
  fontSize: 13,
  borderBottom: '1px solid #F0F0F0',
  verticalAlign: 'top',
};
const footnote: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--cl-text-muted)',
  lineHeight: 1.6,
  margin: '0 0 8px',
  maxWidth: 640,
};
const sideHeader: React.CSSProperties = {
  borderBottom: '2px solid var(--cl-text-primary)',
  paddingBottom: 12,
  marginBottom: 32,
};
const warnBox: React.CSSProperties = {
  border: '1px solid var(--cl-warning)',
  background: 'rgba(255,149,0,0.06)',
  borderRadius: 10,
  padding: 14,
  marginBottom: 32,
  color: 'var(--cl-text-primary)',
};
