'use client';

/**
 * Google Docs export for the match report.
 *
 * THE SHAPE THE DOC GETS
 * One combined block per recipient: Side A's six sections, then Side B's six,
 * sequential — so whoever opens the doc studies their own side first and the
 * opponent's immediately after. In doubles both teammates receive the identical
 * TEAM report; there is no per-individual split, because SwingVision has no
 * per-teammate attribution to split on.
 *
 * IMAGES ARE UPLOADED ONCE, NOT ONCE PER RECIPIENT
 * Charts rasterise to PNG and go to the coach's own Drive via
 * /api/google/upload-image, which returns a link-readable URL that the Docs API
 * can fetch. Those URLs are cached by their source SVG for the whole export, so
 * saving to four people costs one set of uploads and four cheap Docs writes —
 * not four sets of uploads.
 *
 * WHY EACH SECTION MAY BECOME SEVERAL DOC SECTIONS
 * `insertSessionAtTop`'s `SessionSection` carries at most one image, so a report
 * section with two charts emits a headed section followed by image-only ones.
 * The reading order is preserved; only the container splits.
 */

import type { SideReport } from '@/lib/matchAnalysis/reportModel';

export interface DocsSectionPayload {
  heading?: string;
  imageUrl?: string;
  lines?: string[];
  notes?: string;
  headingLevel?: 'h2' | 'h3';
}

/** Which side's report goes into the document. */
export type DocsScope = 'A' | 'B' | 'both';

/**
 * Rasterise a standalone SVG string to a PNG data URL.
 *
 * Drawn at 2× and composited onto an opaque white fill: Docs places images on a
 * white page, and a transparent PNG would drop every dark label into invisibility
 * if the reader ever switched the page colour.
 */
export async function svgToPngDataUrl(svg: string, scale = 2): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Chart image failed to rasterise'));
      img.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Upload a PNG data URL to the coach's Drive; returns a Docs-fetchable URL. */
async function uploadPng(dataUrl: string, name: string): Promise<string> {
  const res = await fetch('/api/google/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, name }),
  });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? 'Chart upload failed');
  return data.url;
}

/**
 * Upload every chart in the report exactly once.
 *
 * Keyed by the SVG source, so a chart that legitimately appears in both sides'
 * reports (the head-to-head comparison) is stored and referenced once.
 */
export async function uploadReportCharts(
  reports: SideReport[],
  onProgress?: (done: number, total: number) => void,
  scope: DocsScope = 'both',
): Promise<Map<string, string>> {
  const unique: string[] = [];
  for (const report of reports.filter((r) => scope === 'both' || r.sideId === scope)) {
    for (const section of report.sections) {
      for (const svg of section.charts) if (!unique.includes(svg)) unique.push(svg);
    }
  }

  const urls = new Map<string, string>();
  for (let i = 0; i < unique.length; i++) {
    onProgress?.(i, unique.length);
    const png = await svgToPngDataUrl(unique[i]);
    urls.set(unique[i], await uploadPng(png, `match-report-chart-${i + 1}.png`));
  }
  onProgress?.(unique.length, unique.length);
  return urls;
}

/**
 * Flatten both side reports into the section list the Docs writer consumes.
 *
 * Omitted metrics are written as "Label: not available — <reason>" rather than
 * being skipped, so the exported document carries the same honest gaps the screen
 * shows. A reader must be able to tell "zero" from "unknown" in the doc too.
 */
export function buildDocsSections(
  reports: SideReport[],
  chartUrls: Map<string, string>,
  scope: DocsScope = 'both',
): DocsSectionPayload[] {
  const out: DocsSectionPayload[] = [];
  const chosen = reports.filter((r) => scope === 'both' || r.sideId === scope);

  chosen.forEach((report) => {
    // Side title as a real H2 — the top of the document's type hierarchy.
    out.push({
      heading: report.label,
      headingLevel: 'h2',
      notes:
        'Every figure below was read from the uploaded SwingVision screenshots. Nothing is estimated, and anything that could not be read is named rather than filled in.',
    });

    for (const section of report.sections) {
      // Section title as H3, one level under the side.
      const lines: string[] = [];
      for (const row of section.rows) {
        if (row.label === '•') {
          lines.push(row.value ?? '');
          continue;
        }
        if (row.value === null) {
          lines.push(`${row.label} — ${row.note ?? 'not available'}`);
          continue;
        }
        // "Label   value (opponent: x)" then the plain-language line under it, so
        // a reader gets the number and its meaning without decoding a table.
        const comparison = row.opponent ? `  (opponent: ${row.opponent})` : '';
        lines.push(`${row.label}: ${row.value}${comparison}`);
        if (row.note) lines.push(`    ${row.note}`);
        if (row.context) lines.push(`    ${row.context}`);
      }

      const noteParts = [section.explanation, ...section.notes];
      if (section.coverage) noteParts.push(section.coverage);

      const charts = section.charts.map((svg) => chartUrls.get(svg)).filter((u): u is string => Boolean(u));

      out.push({
        heading: `${section.number}. ${section.heading}`,
        headingLevel: 'h3',
        lines: lines.length ? lines : undefined,
        notes: noteParts.filter(Boolean).join(' '),
        imageUrl: charts[0],
      });
      for (const url of charts.slice(1)) out.push({ imageUrl: url });
    }
  });

  return out;
}

export interface SaveTarget {
  playerId: string;
  displayName: string;
}

export interface SaveOutcome {
  playerId: string;
  displayName: string;
  ok: boolean;
  error?: string;
  /**
   * The entry saved, but its Google Doc did not update.
   *
   * Distinct from `error`: `ok` stays true because the report IS stored against
   * the player. Previously the route returned 200 whether or not the Docs write
   * succeeded, so a save that never reached Google was reported as a clean
   * success — the same silent failure the manual recorder hit.
   */
  docWarning?: string;
}

/**
 * Push the combined report into each selected person's Match Analysis doc.
 *
 * Sequential and best-effort per person: one recipient's Docs failure must not
 * abort the others, and the caller gets a per-person result so a partial save is
 * reported as a partial save rather than a success.
 */
export async function saveReportToPlayers(
  targets: SaveTarget[],
  sections: DocsSectionPayload[],
  folderLabel: string,
  summaryText: string,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<SaveOutcome[]> {
  const results: SaveOutcome[] = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    onProgress?.(i, targets.length, target.displayName);
    try {
      const res = await fetch(`/api/players/${target.playerId}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'match',
          folder_label: folderLabel,
          body_text: summaryText,
          source: 'match_decoder',
          sections,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        doc?: { ok?: boolean; reason?: string };
      };
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      results.push({
        playerId: target.playerId,
        displayName: target.displayName,
        ok: true,
        ...(data.doc && data.doc.ok === false && data.doc.reason
          ? { docWarning: data.doc.reason }
          : {}),
      });
    } catch (e) {
      results.push({
        playerId: target.playerId,
        displayName: target.displayName,
        ok: false,
        error: e instanceof Error ? e.message : 'Save failed',
      });
    }
  }
  onProgress?.(targets.length, targets.length, '');
  return results;
}
