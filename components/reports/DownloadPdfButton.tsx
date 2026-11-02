'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { Report } from '@/lib/reports/deriveBlocks';
import { pdfFilename, reportsToPdfDocument } from '@/lib/reports/pdf/reportPdfModel';
import type { PdfProgress } from '@/lib/reports/pdf/renderReportPdf';

/**
 * "Download PDF" (one report) and "Download all reports" (a player). The PDF is built in the browser from the
 * report data already on the page, so it adds no endpoint and no new access: whoever can see the page can
 * export it (the same `players` entitlement as the profile, enforced by /api/players/[id]).
 *
 * The build runs in small steps that yield to the browser, shows how far it has got, and can be cancelled.
 * When it finishes the file is downloaded and an "Open PDF" link stays on screen, because some phone
 * browsers ignore a scripted download.
 */
export default function DownloadPdfButton({
  label,
  playerName,
  reports,
  filenameBase,
}: {
  label: string;
  playerName: string;
  reports: Report[];
  filenameBase: string;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PdfProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [href, setHref] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const revoke = useCallback(() => {
    setHref((h) => {
      if (h) URL.revokeObjectURL(h);
      return null;
    });
  }, []);
  useEffect(() => () => {
    ctl.current?.abort();
    revoke();
  }, [revoke]);

  const run = useCallback(async () => {
    if (busy || reports.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    revoke();
    setProgress({ done: 0, total: 1, label: 'Preparing' });
    const c = new AbortController();
    ctl.current = c;
    try {
      // The PDF code (and jsPDF) is loaded only when a coach asks for a PDF.
      const { renderReportsPdf } = await import('@/lib/reports/pdf/renderReportPdf');
      const input = reportsToPdfDocument(playerName, reports);
      const single = reports.length === 1;
      const result = await renderReportsPdf(
        { title: single ? input.reports[0].title : input.title, contents: single ? undefined : input.contents, reports: input.reports },
        { signal: c.signal, onProgress: setProgress },
      );
      const url = URL.createObjectURL(new Blob([result.data], { type: 'application/pdf' }));
      setHref(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfFilename(filenameBase, 'report');
      document.body.appendChild(a);
      a.click();
      a.remove();
      const kb = Math.max(1, Math.round(result.bytes / 1024));
      setMessage(
        `PDF ready (${kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`}, ${result.pages} page${result.pages === 1 ? '' : 's'})` +
          (result.images.failed > 0 ? `. ${result.images.failed} image${result.images.failed === 1 ? ' was' : 's were'} unavailable and shown as a placeholder.` : '.'),
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setMessage('PDF cancelled.');
      else setError('The PDF could not be built. Try again.');
    } finally {
      ctl.current = null;
      setBusy(false);
      setProgress(null);
    }
  }, [busy, reports, playerName, filenameBase, revoke]);

  const pct = progress ? Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100)) : 0;

  return (
    <div data-pdf-export style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', maxWidth: '100%' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || reports.length === 0}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 16px', borderRadius: 12,
            border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)',
            fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: reports.length === 0 ? 0.5 : 1,
          }}
        >
          <Download size={16} aria-hidden /> {busy ? 'Building PDF…' : label}
        </button>
        {busy ? (
          <button
            type="button"
            onClick={() => ctl.current?.abort()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 14px', borderRadius: 12, border: '1px solid var(--cl-border)', background: 'transparent', color: 'var(--cl-text-secondary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            <X size={16} aria-hidden /> Cancel
          </button>
        ) : null}
      </div>
      {busy && progress ? (
        <div role="status" aria-live="polite" style={{ width: 'min(320px, 100%)' }}>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--cl-bg-secondary)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--cl-accent)', transition: 'width 120ms linear' }} />
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--cl-text-secondary)' }}>{progress.label} · {pct}%</p>
        </div>
      ) : null}
      {!busy && message ? (
        <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--cl-text-secondary)' }}>
          {message}{' '}
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cl-accent)', fontWeight: 600 }}>Open PDF</a>
          ) : null}
        </p>
      ) : null}
      {error ? <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--cl-destructive-text)' }}>{error}</p> : null}
    </div>
  );
}
