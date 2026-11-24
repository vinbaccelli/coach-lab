/**
 * What goes into a report PDF, as plain data. PURE: no DOM, no jsPDF, no network.
 *
 * `reportToPdfItems` flattens one derived `Report` (lib/reports/deriveBlocks.ts) into a list of
 * items; `renderReportPdf.ts` draws them. Splitting the two keeps the structure testable
 * (tests/reportPdf.test.ts) and keeps the drawing code free of report rules.
 *
 * Videos are NEVER embedded: a video is a title, a thumbnail address and a link.
 * Charts of match reports are the same SVG strings the in-app report draws, sanitized by the
 * same allowlist (components/reports/sanitizeSvg.ts) before they are rasterized.
 */

import type { Report, ReportBlock } from '@/lib/reports/deriveBlocks';
import { driveFileId } from '@/lib/reports/driveId';
import { safeHttpUrl } from '@/lib/reports/safeUrl';
import { sanitizeSvg } from '@/components/reports/sanitizeSvg';
import { formatClock, formatDateKey } from '@/components/reports/reportStyles';
import { buildManualReport } from '@/lib/tennis/manualReportModel';
import { manualMatchToReportInput } from '@/lib/reports/manualMatchInput';
import type { SideReport } from '@/lib/matchAnalysis/reportModel';

export type PdfItem =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string; muted?: boolean }
  | { kind: 'bullets'; lines: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'image'; sources: string[]; openUrl: string | null; caption: string }
  | { kind: 'chart'; svg: string; caption?: string }
  | { kind: 'video'; url: string | null; label: string; thumbUrl: string | null };

export interface PdfReport {
  key: string;
  title: string;
  /** Date, kind and opponent, one line. */
  meta: string;
  items: PdfItem[];
}

/** Longest edge, in pixels, an embedded screenshot is scaled down to. */
export const PDF_IMAGE_MAX_PX = 1000;
export const PDF_JPEG_QUALITY = 0.7;

// ── text ──────────────────────────────────────────────────────────────────

/**
 * jsPDF's built-in fonts only cover Latin-1 (WinAnsi). Common typographic characters are mapped to a
 * Latin-1 equivalent; anything else outside Latin-1 becomes "?" instead of corrupting the line.
 */
const MAP: Record<string, string> = {
  '→': '->', '←': '<-', '↑': '^', '≥': '>=', '≤': '<=', '≈': '~', '−': '-', '–': '-', '—': '-', '…': '...',
  '‘': "'", '’': "'", '“': '"', '”': '"', '•': '-', ' ': ' ', '↗': '', '✓': 'v', '×': 'x',
};

export function toPdfText(input: string): string {
  let out = '';
  for (const ch of input) {
    const mapped = MAP[ch];
    if (mapped !== undefined) out += mapped;
    else if (ch === '\n' || ch === '\t') out += ch === '\t' ? '  ' : ch;
    else if (ch.charCodeAt(0) < 32) out += '';
    else if (ch.charCodeAt(0) <= 0xff) out += ch;
    else out += '?';
  }
  return out;
}

export function pdfFilename(name: string, fallback: string): string {
  const safe = toPdfText(name).replace(/[^\p{L}\p{N}_.\- ]+/gu, '').trim().replace(/\s+/g, '-');
  return `${safe || fallback}.pdf`.replace(/\.pdf\.pdf$/i, '.pdf');
}

// ── report ────────────────────────────────────────────────────────────────

export function pdfReportTitle(r: Report): string {
  if (r.kind === 'technical') return `Technical analysis, ${formatDateKey(r.dateKey)}`;
  return r.title || (r.opponent ? `Match vs ${r.opponent}` : `Match analysis, ${formatDateKey(r.dateKey)}`);
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The addresses tried for one screenshot, in the order the in-app page tries them (DriveImage.tsx). */
export function imageSources(url: string, fallbackUrl?: string): string[] {
  const id = driveFileId(url);
  return [url, ...(id ? [`https://lh3.googleusercontent.com/d/${id}=w1200`] : []), ...(fallbackUrl ? [fallbackUrl] : [])]
    .map((u) => safeHttpUrl(u))
    .filter((u): u is string => u !== null);
}

function sideReportItems(sides: SideReport[]): PdfItem[] {
  const items: PdfItem[] = [];
  const both = sides.length > 1;
  for (const side of sides) {
    if (both) items.push({ kind: 'heading', level: 2, text: side.label });
    for (const s of side.sections) {
      if (!s.present && s.rows.length === 0 && s.charts.length === 0) continue;
      items.push({ kind: 'heading', level: both ? 3 : 2, text: `${s.number}. ${s.heading}` });
      if (s.explanation) items.push({ kind: 'paragraph', text: s.explanation, muted: true });
      const rows = s.rows.filter((r) => r.value !== null || r.note);
      if (rows.length) {
        const hasOpp = rows.some((r) => r.opponent);
        items.push({
          kind: 'table',
          head: hasOpp ? ['Measure', 'Value', 'Opponent'] : ['Measure', 'Value'],
          rows: rows.map((r) => (hasOpp ? [r.label, r.value ?? 'n/a', r.opponent ?? ''] : [r.label, r.value ?? 'n/a'])),
        });
      }
      for (const svg of s.charts) {
        const clean = sanitizeSvg(svg);
        if (clean) items.push({ kind: 'chart', svg: clean });
      }
      for (const n of s.notes) items.push({ kind: 'paragraph', text: n, muted: true });
      if (s.coverage) items.push({ kind: 'paragraph', text: s.coverage, muted: true });
    }
  }
  return items;
}

function blockItems(b: ReportBlock, r: Report): PdfItem[] {
  switch (b.type) {
    case 'text':
      return [
        ...(b.heading ? [{ kind: 'heading', level: 2, text: b.heading } as PdfItem] : []),
        ...b.paragraphs.map((p): PdfItem => ({ kind: 'paragraph', text: p })),
      ];
    case 'video': {
      const url = safeHttpUrl(b.url);
      return [{
        kind: 'video',
        url,
        label: b.videoId ? 'Video on YouTube' : 'Video',
        thumbUrl: b.videoId && /^[\w-]{6,20}$/.test(b.videoId) ? `https://i.ytimg.com/vi/${b.videoId}/hqdefault.jpg` : null,
      }];
    }
    case 'screenshots':
      return [
        { kind: 'heading', level: 2, text: 'Screenshots' },
        ...b.images.map((img, i): PdfItem => ({
          kind: 'image',
          sources: imageSources(img.url, img.fallbackUrl),
          openUrl: safeHttpUrl(img.url),
          caption: `${i + 1} of ${b.images.length} - ${formatDateKey(localDay(img.takenAt), { day: 'numeric', month: 'short' })}, ${formatClock(img.takenAt)}`,
        })),
      ];
    case 'measurements':
      return [
        { kind: 'heading', level: 2, text: 'Measurements' },
        {
          kind: 'table',
          head: ['Measurement', 'Value', 'Snapshot'],
          rows: b.rows.map((m) => [m.label, `${Math.round(m.value * 10) / 10}${m.unit}`, `${m.snapshot}${m.timeSec !== null ? ` - ${m.timeSec.toFixed(1)}s` : ''}`]),
        },
      ];
    case 'sections': {
      const items: PdfItem[] = [];
      for (const s of b.sections) {
        if (s.heading) items.push({ kind: 'heading', level: s.headingLevel === 'h2' ? 2 : 3, text: s.heading });
        if (s.lines.length) items.push({ kind: 'bullets', lines: s.lines });
        if (s.notes) items.push({ kind: 'paragraph', text: s.notes, muted: true });
        if (s.imageUrl) items.push({ kind: 'image', sources: imageSources(s.imageUrl), openUrl: safeHttpUrl(s.imageUrl), caption: s.heading ?? 'Chart' });
      }
      return items;
    }
    case 'decoderReport':
      return [
        ...b.integrityWarnings.map((w): PdfItem => ({ kind: 'paragraph', text: w, muted: true })),
        ...sideReportItems(b.reports),
      ];
    case 'manualMatch':
      try {
        return sideReportItems(buildManualReport(manualMatchToReportInput(b.match)));
      } catch {
        // An old row whose points no longer fit the model: the plain-text body saved with it, as the page does.
        return [{ kind: 'paragraph', text: r.fallbackText || 'This match report could not be displayed.' }];
      }
  }
}

export function reportToPdfItems(r: Report): PdfReport {
  const items = r.blocks.flatMap((b) => blockItems(b, r));
  const kind = r.kind === 'technical' ? 'Technical analysis' : 'Match analysis';
  return {
    key: r.key,
    title: pdfReportTitle(r),
    meta: `${kind} - ${formatDateKey(r.dateKey, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${r.opponent ? ` - vs ${r.opponent}` : ''}`,
    items: items.length ? items : [{ kind: 'paragraph', text: 'This report is empty.', muted: true }],
  };
}

/** All of a player's reports in order (oldest first), with the contents list the PDF opens with. */
export function reportsToPdfDocument(playerName: string, reports: Report[]): { title: string; contents: string[]; reports: PdfReport[] } {
  const ordered = [...reports].sort((a, b) => a.sortTime - b.sortTime);
  const parts = ordered.map(reportToPdfItems);
  return {
    title: playerName.trim() ? `${playerName.trim()} - reports` : 'Player reports',
    contents: parts.map((p, i) => `${i + 1}. ${p.title}`),
    reports: parts,
  };
}

/** Counts used by the progress bar and the tests. */
export function countImages(items: PdfItem[]): number {
  return items.reduce((n, it) => n + (it.kind === 'image' || it.kind === 'chart' || (it.kind === 'video' && it.thumbUrl) ? 1 : 0), 0);
}
