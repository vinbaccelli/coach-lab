'use client';

import { captureNodeAsPng, sliceCaptureIntoPages } from '@/lib/matchAnalysis/captureReportImage';

/**
 * Download the full match report as a local PDF — no Google involved.
 *
 * WHY IT REUSES THE DOC EXPORT'S CAPTURE
 * `captureNodeAsPng` + `sliceCaptureIntoPages` already produce exactly what a
 * PDF page needs: the report rendered as displayed (charts, stat tiles, spacing,
 * colours), cut into page-shaped tiles. Building a second rendering path would
 * mean two things that must look identical and would inevitably drift, so this
 * takes the same tiles the Doc export uploads and writes them into pages
 * instead. One capture pipeline, two destinations.
 *
 * jsPDF is imported DYNAMICALLY so it is code-split: the match report page does
 * not pay for it until a coach actually asks for a PDF.
 */

/** Page geometry, matching sliceCaptureIntoPages' tile aspect (US Letter, points). */
const PAGE_W_PT = 612;
const PAGE_H_PT = 792;

export type PdfDownloadResult = { pages: number; filename: string };

export async function downloadReportPdf(
  node: HTMLElement,
  filename: string,
): Promise<PdfDownloadResult> {
  const captured = await captureNodeAsPng(node);
  const tiles = await sliceCaptureIntoPages(captured);
  if (tiles.length === 0) throw new Error('Report produced no pages to write');

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: [PAGE_W_PT, PAGE_H_PT], compress: true });

  tiles.forEach((tile, i) => {
    if (i > 0) doc.addPage([PAGE_W_PT, PAGE_H_PT], 'portrait');
    // Fit the tile to the page width; a final short tile keeps its own height
    // rather than being stretched to fill the page.
    const drawW = PAGE_W_PT;
    const drawH = Math.min(PAGE_H_PT, (tile.height / tile.width) * PAGE_W_PT);
    doc.addImage(tile.dataUrl, 'PNG', 0, 0, drawW, drawH, undefined, 'FAST');
  });

  const safe = filename.replace(/[^\w.\- ]+/g, '').trim() || 'match-report';
  const out = safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
  doc.save(out);
  return { pages: tiles.length, filename: out };
}
