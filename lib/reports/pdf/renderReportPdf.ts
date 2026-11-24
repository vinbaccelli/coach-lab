/**
 * Draws report PDFs (lib/reports/pdf/reportPdfModel.ts) with jsPDF, the library the match report PDF
 * (lib/matchAnalysis/downloadReportPdf.ts) already uses. No new dependency.
 *
 * WHY NOT THE MATCH PDF'S "PHOTOGRAPH THE PAGE" APPROACH
 * That export rasterizes the on-screen node into one tall PNG (up to 20 megapixels) and slices it: no
 * selectable text, no clickable links, large files, and a canvas bigger than iOS allows (~16.7 MP). Here text
 * is real text, links are real links, and only screenshots and charts are images, each scaled to at most
 * PDF_IMAGE_MAX_PX on its longest edge and stored as JPEG.
 *
 * RULES
 *  - One image failing never fails the PDF: the next address is tried, then a visible "Image unavailable"
 *    tile (with a link to open it) is drawn and the PDF finishes. The result says how many failed.
 *  - The UI stays responsive: images are loaded off the main thread (browser decode), at most IMAGE_CONCURRENCY
 *    at a time, and the drawing loop yields to the browser after every item.
 *  - Cancelable: an aborted signal stops at the next item and rejects with an AbortError.
 *  - Videos are never embedded: a thumbnail (or a plain tile when it cannot be fetched), the label and a link.
 */

import {
  PDF_IMAGE_MAX_PX,
  PDF_JPEG_QUALITY,
  countImages,
  toPdfText,
  type PdfItem,
  type PdfReport,
} from '@/lib/reports/pdf/reportPdfModel';

export interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface PdfImageLoader {
  /** Try each address in order; null when none can be read. Never throws. */
  loadImage(sources: string[], maxPx: number, signal?: AbortSignal): Promise<LoadedImage | null>;
  /** Rasterize chart SVG markup; null when it cannot be drawn. Never throws. */
  rasterizeSvg(svg: string, maxPx: number, signal?: AbortSignal): Promise<LoadedImage | null>;
}

export interface PdfProgress {
  done: number;
  total: number;
  label: string;
}

export interface PdfDocumentInput {
  title: string;
  /** Contents list lines (several reports); omitted for a single report. */
  contents?: string[];
  reports: PdfReport[];
}

export interface RenderResult {
  data: ArrayBuffer;
  pages: number;
  images: { ok: number; failed: number };
  bytes: number;
}

// ── geometry (A4, points) ─────────────────────────────────────────────────

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - MARGIN - 8;
const IMAGE_CONCURRENCY = 3;
const IMAGE_TIMEOUT_MS = 20_000;

type Rgb = [number, number, number];
const TEXT: Rgb = [28, 28, 30];
const MUTED: Rgb = [108, 108, 112];
const LINK: Rgb = [0, 98, 204];
const RULE: Rgb = [210, 210, 214];

const yieldToUi = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function abortError(): Error {
  const e = new Error('PDF export cancelled');
  e.name = 'AbortError';
  return e;
}

// ── browser image loading ─────────────────────────────────────────────────

/** Width and height of chart SVG markup, from its width/height or viewBox; 800x400 when it has neither. */
export function parseSvgSize(svg: string): { width: number; height: number } {
  const head = svg.slice(0, svg.indexOf('>') + 1);
  const num = (name: string) => {
    const m = new RegExp(`\\b${name}="([\\d.]+)(?:px)?"`, 'i').exec(head);
    return m ? Number(m[1]) : NaN;
  };
  const vb = /viewBox="\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*"/i.exec(head);
  const w = num('width') || (vb ? Number(vb[1]) : NaN);
  const h = num('height') || (vb ? Number(vb[2]) : NaN);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: w, height: h } : { width: 800, height: 400 };
}

function drawToJpeg(img: HTMLImageElement, srcW: number, srcH: number, maxPx: number): LoadedImage | null {
  if (!srcW || !srcH) return null;
  const scale = Math.min(1, maxPx / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  // A cross-origin image served without CORS headers taints the canvas and this throws: the caller tries the next address.
  const dataUrl = canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY);
  canvas.width = 0;
  canvas.height = 0;
  return { dataUrl, width: w, height: h };
}

function loadOne(src: string, maxPx: number, signal?: AbortSignal, svgSize?: { width: number; height: number }): Promise<LoadedImage | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    const img = new Image();
    let settled = false;
    const finish = (v: LoadedImage | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), IMAGE_TIMEOUT_MS);
    if (!svgSize) {
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
    }
    img.decoding = 'async';
    img.onload = () => {
      try {
        finish(drawToJpeg(img, svgSize?.width ?? img.naturalWidth, svgSize?.height ?? img.naturalHeight, maxPx));
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = src;
  });
}

export const browserImageLoader: PdfImageLoader = {
  async loadImage(sources, maxPx, signal) {
    for (const src of sources) {
      const got = await loadOne(src, maxPx, signal);
      if (got) return got;
      if (signal?.aborted) return null;
    }
    return null;
  },
  async rasterizeSvg(svg, maxPx, signal) {
    const size = parseSvgSize(svg);
    // Scale small charts up so text stays sharp when the chart is drawn at page width.
    const target = Math.max(size.width, Math.min(maxPx, 1000));
    const k = target / Math.max(size.width, size.height);
    const sized = { width: size.width * k, height: size.height * k };
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return loadOne(src, maxPx, signal, sized);
  },
};

/** Start tasks with at most `limit` running; resolves each task's own promise in order of the input. */
export function runPool<T>(tasks: Array<() => Promise<T>>, limit: number): Array<Promise<T>> {
  const results: Array<Promise<T>> = [];
  let next = 0;
  let running = 0;
  const resolvers: Array<(v: T | PromiseLike<T>) => void> = [];
  const rejecters: Array<(e: unknown) => void> = [];
  tasks.forEach((_, i) => results.push(new Promise<T>((res, rej) => { resolvers[i] = res; rejecters[i] = rej; })));
  const pump = () => {
    while (running < limit && next < tasks.length) {
      const i = next++;
      running++;
      tasks[i]().then(resolvers[i], rejecters[i]).finally(() => { running--; pump(); });
    }
  };
  pump();
  return results;
}

// ── drawing ───────────────────────────────────────────────────────────────

type Doc = import('jspdf').jsPDF;

export async function renderReportsPdf(
  input: PdfDocumentInput,
  opts: { onProgress?: (p: PdfProgress) => void; signal?: AbortSignal; loader?: PdfImageLoader } = {},
): Promise<RenderResult> {
  const { onProgress, signal } = opts;
  const loader = opts.loader ?? browserImageLoader;
  const { jsPDF } = await import('jspdf');
  const doc: Doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.setProperties({ title: toPdfText(input.title) });

  let y = MARGIN;
  const stats = { ok: 0, failed: 0 };
  const total = input.reports.reduce((n, r) => n + countImages(r.items), 0) + input.reports.length;
  let done = 0;
  const tick = (label: string) => {
    done++;
    onProgress?.({ done, total, label });
  };
  const check = () => {
    if (signal?.aborted) throw abortError();
  };

  const newPage = () => {
    doc.addPage();
    y = MARGIN;
  };
  const need = (h: number) => {
    if (y + h > BOTTOM) newPage();
  };
  const color = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);

  const writeLines = (text: string, size: number, opts2: { bold?: boolean; muted?: boolean; x?: number; width?: number; link?: string } = {}) => {
    doc.setFont('helvetica', opts2.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    color(opts2.link ? LINK : opts2.muted ? MUTED : TEXT);
    const x = opts2.x ?? MARGIN;
    const width = opts2.width ?? CONTENT_W;
    const lh = size * 1.35;
    const lines = doc.splitTextToSize(toPdfText(text), width) as string[];
    for (const line of lines) {
      need(lh);
      doc.text(line, x, y + size, { baseline: 'alphabetic' });
      if (opts2.link) doc.link(x, y, Math.min(width, doc.getTextWidth(line)), lh, { url: opts2.link });
      y += lh;
    }
  };

  const drawTable = (head: string[], rows: string[][]) => {
    const widths = head.length === 3 ? [CONTENT_W * 0.5, CONTENT_W * 0.2, CONTENT_W * 0.3] : [CONTENT_W * 0.66, CONTENT_W * 0.34];
    const size = 9.5;
    const lh = size * 1.3;
    const row = (cells: string[], bold: boolean, muted: boolean) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const wrapped = cells.map((c, i) => doc.splitTextToSize(toPdfText(c), widths[i] - 8) as string[]);
      const h = Math.max(...wrapped.map((w) => w.length)) * lh + 6;
      need(h);
      color(muted ? MUTED : TEXT);
      let x = MARGIN;
      wrapped.forEach((lines, i) => {
        lines.forEach((l, j) => doc.text(l, x, y + 3 + size + j * lh));
        x += widths[i];
      });
      y += h;
      doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    };
    row(head, true, true);
    for (const r of rows) row(r, false, false);
    y += 8;
  };

  const placeholder = (caption: string, openUrl: string | null) => {
    const h = 84;
    need(h + 20);
    doc.setFillColor(242, 242, 245);
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.roundedRect(MARGIN, y, CONTENT_W, h, 6, 6, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    color(MUTED);
    doc.text('Image unavailable', MARGIN + CONTENT_W / 2, y + 36, { align: 'center' });
    if (openUrl) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      color(LINK);
      doc.text('Open image', MARGIN + CONTENT_W / 2, y + 56, { align: 'center' });
      doc.link(MARGIN, y, CONTENT_W, h, { url: openUrl });
    }
    y += h + 4;
    writeLines(caption, 8.5, { muted: true });
    y += 8;
  };

  const drawImage = (img: LoadedImage, caption: string | undefined, openUrl: string | null, maxH: number) => {
    let w = CONTENT_W;
    let h = (img.height / img.width) * w;
    if (h > maxH) {
      h = maxH;
      w = (img.width / img.height) * h;
    }
    need(h + (caption ? 22 : 8));
    const x = MARGIN + (CONTENT_W - w) / 2;
    doc.addImage(img.dataUrl, 'JPEG', x, y, w, h, undefined, 'FAST');
    if (openUrl) doc.link(x, y, w, h, { url: openUrl });
    y += h + 4;
    if (caption) writeLines(caption, 8.5, { muted: true });
    y += 8;
  };

  const drawVideo = (it: Extract<PdfItem, { kind: 'video' }>, thumb: LoadedImage | null) => {
    const boxW = 240;
    const boxH = 135;
    need(boxH + 12);
    const top = y;
    if (thumb) {
      doc.addImage(thumb.dataUrl, 'JPEG', MARGIN, top, boxW, boxH, undefined, 'FAST');
    } else {
      doc.setFillColor(36, 36, 40);
      doc.rect(MARGIN, top, boxW, boxH, 'F');
    }
    // A play mark, so the tile reads as a video even without the picture.
    doc.setFillColor(255, 255, 255);
    const cx = MARGIN + boxW / 2;
    const cy = top + boxH / 2;
    doc.triangle(cx - 10, cy - 15, cx - 10, cy + 15, cx + 16, cy, 'F');
    const tx = MARGIN + boxW + 16;
    const tw = CONTENT_W - boxW - 16;
    const saved = y;
    y = top + 4;
    writeLines(it.label, 12, { bold: true, x: tx, width: tw });
    if (it.url) {
      writeLines(it.url, 9, { x: tx, width: tw, link: it.url });
      doc.link(MARGIN, top, boxW, boxH, { url: it.url });
    } else {
      writeLines('The address of this video is not a web link.', 9, { muted: true, x: tx, width: tw });
    }
    writeLines('Videos are not included in the PDF.', 8.5, { muted: true, x: tx, width: tw });
    y = Math.max(saved, top + boxH) + 14;
  };

  const drawItem = async (it: PdfItem, loaded: LoadedImage | null | undefined) => {
    switch (it.kind) {
      case 'heading': {
        const size = it.level === 1 ? 22 : it.level === 2 ? 15 : 12;
        y += it.level === 1 ? 0 : it.level === 2 ? 10 : 6;
        need(size * 1.35 + 24);
        writeLines(it.text, size, { bold: true });
        y += it.level === 3 ? 2 : 4;
        break;
      }
      case 'paragraph':
        writeLines(it.text, it.muted ? 9.5 : 10.5, { muted: it.muted });
        y += 6;
        break;
      case 'bullets':
        for (const l of it.lines) writeLines(`-  ${l}`, 10.5, { x: MARGIN + 6, width: CONTENT_W - 6 });
        y += 6;
        break;
      case 'table':
        drawTable(it.head, it.rows);
        break;
      case 'image':
        if (loaded) {
          stats.ok++;
          drawImage(loaded, it.caption, it.openUrl, 520);
        } else {
          stats.failed++;
          placeholder(it.caption, it.openUrl);
        }
        break;
      case 'chart':
        if (loaded) {
          stats.ok++;
          drawImage(loaded, it.caption, null, 300);
        } else {
          stats.failed++;
          placeholder('Chart unavailable', null);
        }
        break;
      case 'video':
        drawVideo(it, loaded ?? null);
        break;
    }
  };

  // Several reports: reserve the contents page(s) now, fill them once the page of every report is known.
  const multi = input.reports.length > 1 && !!input.contents?.length;
  let contentsPages = 0;
  if (multi) {
    const perPage = Math.floor((PAGE_H - MARGIN * 2) / 17) - 1;
    contentsPages = Math.max(1, Math.ceil((input.contents!.length + 4) / perPage));
    for (let i = 1; i < contentsPages; i++) doc.addPage();
    doc.addPage();
    y = MARGIN;
  }
  const startPages: number[] = [];

  for (let ri = 0; ri < input.reports.length; ri++) {
    check();
    const report = input.reports[ri];
    if (ri > 0) newPage();
    startPages.push(doc.getNumberOfPages());
    onProgress?.({ done, total, label: `Report ${ri + 1} of ${input.reports.length}` });

    writeLines(report.title, 22, { bold: true });
    writeLines(report.meta, 10, { muted: true });
    y += 10;

    // Start loading this report's images now (a few at a time); draw in order as they arrive.
    const jobs: Array<() => Promise<LoadedImage | null>> = [];
    const jobIndex = new Map<number, number>();
    report.items.forEach((it, i) => {
      if (it.kind === 'image' && it.sources.length) {
        jobIndex.set(i, jobs.length);
        jobs.push(() => loader.loadImage(it.sources, PDF_IMAGE_MAX_PX, signal));
      } else if (it.kind === 'chart') {
        jobIndex.set(i, jobs.length);
        jobs.push(() => loader.rasterizeSvg(it.svg, PDF_IMAGE_MAX_PX, signal));
      } else if (it.kind === 'video' && it.thumbUrl) {
        jobIndex.set(i, jobs.length);
        jobs.push(() => loader.loadImage([it.thumbUrl as string], 640, signal));
      }
    });
    const pending = runPool(jobs, IMAGE_CONCURRENCY);

    let imageNo = 0;
    for (let i = 0; i < report.items.length; i++) {
      check();
      const it = report.items[i];
      const j = jobIndex.get(i);
      let loaded: LoadedImage | null | undefined;
      if (j !== undefined) {
        imageNo++;
        loaded = await pending[j].catch(() => null);
        check();
        tick(`${it.kind === 'chart' ? 'Chart' : it.kind === 'video' ? 'Video thumbnail' : 'Screenshot'} ${imageNo}`);
      }
      await drawItem(it, loaded);
      await yieldToUi();
    }
    tick(`Report ${ri + 1} of ${input.reports.length}`);
  }

  // Contents (several reports), then the footer on every page.
  if (multi) {
    doc.setPage(1);
    y = MARGIN;
    writeLines(input.title, 22, { bold: true });
    y += 8;
    writeLines('Contents', 13, { bold: true });
    y += 4;
    input.contents!.forEach((line, i) => {
      if (y + 17 > BOTTOM) {
        doc.setPage(doc.getCurrentPageInfo().pageNumber + 1);
        y = MARGIN;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      color(LINK);
      const text = doc.splitTextToSize(toPdfText(line), CONTENT_W - 40)[0] as string;
      doc.text(text, MARGIN, y + 11);
      color(MUTED);
      doc.text(String(startPages[i]), MARGIN + CONTENT_W, y + 11, { align: 'right' });
      doc.link(MARGIN, y, CONTENT_W, 15, { pageNumber: startPages[i], top: 0 });
      y += 17;
    });
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    color(MUTED);
    doc.text(`${toPdfText(input.title)}  -  page ${p} of ${pages}`, PAGE_W / 2, PAGE_H - 24, { align: 'center' });
  }

  const data = doc.output('arraybuffer') as ArrayBuffer;
  return { data, pages, images: stats, bytes: data.byteLength };
}
