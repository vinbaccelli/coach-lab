'use client';

import DriveImage from '@/components/reports/DriveImage';
import ManualMatchBlock from '@/components/reports/ManualMatchBlock';
import VideoBlock from '@/components/reports/VideoBlock';
import { formatClock, formatDateKey, mutedText } from '@/components/reports/reportStyles';
import type { ReportBlock } from '@/lib/reports/deriveBlocks';

const body = { fontSize: 15, lineHeight: 1.6, margin: '0 0 12px' } as const;
const blockHeading = { margin: '0 0 12px', fontSize: 18, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' } as const;

function localDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ReportBlocks({ blocks, fallbackText }: { blocks: ReportBlock[]; fallbackText: string }) {
  if (blocks.length === 0) {
    return <p style={mutedText}>This report has no content yet.</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
      {blocks.map((b) => {
        switch (b.type) {
          case 'video':
            return <VideoBlock key={b.id} url={b.url} videoId={b.videoId} />;

          case 'text':
            return (
              <section key={b.id}>
                {b.heading ? <h2 style={blockHeading}>{b.heading}</h2> : null}
                {b.paragraphs.map((p, i) => (
                  <p key={i} style={{ ...body, whiteSpace: 'pre-wrap' }}>{p}</p>
                ))}
              </section>
            );

          case 'screenshots':
            return (
              <section key={b.id}>
                <h2 style={blockHeading}>Screenshots</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {b.images.map((img, i) => (
                    <figure key={`${img.entryId}-${i}`} style={{ margin: 0 }}>
                      <DriveImage url={img.url} fallbackUrl={img.fallbackUrl} alt={`Screenshot ${i + 1} of ${b.images.length}`} />
                      <figcaption style={{ ...mutedText, fontSize: 12, marginTop: 6 }}>
                        {i + 1} of {b.images.length} · {formatDateKey(localDay(img.takenAt), { day: 'numeric', month: 'short' })}, {formatClock(img.takenAt)}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            );

          case 'measurements':
            return (
              <section key={b.id}>
                <h2 style={blockHeading}>Measurements</h2>
                <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--cl-text-secondary)', fontSize: 12 }}>
                      <th style={{ padding: '6px 8px 6px 0', fontWeight: 600, width: '46%' }}>Measurement</th>
                      <th style={{ padding: '6px 8px', fontWeight: 600, width: '24%' }}>Value</th>
                      <th style={{ padding: '6px 0 6px 8px', fontWeight: 600 }}>Snapshot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--cl-border-subtle)' }}>
                        <td style={{ padding: '10px 8px 10px 0' }}>{r.label}</td>
                        <td style={{ padding: '10px 8px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {Math.round(r.value * 10) / 10}{r.unit}
                        </td>
                        <td style={{ padding: '10px 0 10px 8px', color: 'var(--cl-text-secondary)' }}>
                          {r.snapshot}{r.timeSec !== null ? ` · ${r.timeSec.toFixed(1)}s` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );

          case 'sections':
            return (
              <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {b.sections.map((s, i) => (
                  <section key={i}>
                    {s.heading ? (
                      s.headingLevel === 'h2' ? (
                        <h2 style={{ ...blockHeading, fontSize: 22 }}>{s.heading}</h2>
                      ) : (
                        <h3 style={{ ...blockHeading, fontSize: 17 }}>{s.heading}</h3>
                      )
                    ) : null}
                    {s.lines.length ? (
                      <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                        {s.lines.map((l, j) => (
                          <li key={j} style={{ fontSize: 15, lineHeight: 1.55, marginBottom: 4 }}>{l}</li>
                        ))}
                      </ul>
                    ) : null}
                    {s.notes ? <p style={{ ...body, color: 'var(--cl-text-secondary)', fontSize: 14 }}>{s.notes}</p> : null}
                    {s.imageUrl ? <DriveImage url={s.imageUrl} alt={s.heading ?? 'Report chart'} /> : null}
                  </section>
                ))}
              </div>
            );

          case 'manualMatch':
            return <ManualMatchBlock key={b.id} match={b.match} fallbackText={fallbackText} />;
        }
      })}
    </div>
  );
}
