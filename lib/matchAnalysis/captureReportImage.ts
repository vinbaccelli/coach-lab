'use client';

/**
 * Full-report DOM capture — renders the on-screen `MatchReportView` node
 * exactly as displayed (charts, stat tiles, spacing, colours) into one PNG,
 * for the Google Doc export.
 *
 * WHY html-to-image OVER html2canvas
 * html-to-image serialises the target node — its full scrollHeight/
 * scrollWidth, not just whatever is inside the current viewport — into an SVG
 * `<foreignObject>`, then rasterises that through an off-screen `<img>` +
 * canvas. A report many screens tall (8–9 chart sections) captures WHOLE, with
 * no scrolling, no resizing, and no off-screen re-render trick: the node is
 * already mounted on the summary screen (just scrolled) by the time the coach
 * can click Save, and this reads it as-is.
 *
 * The report's charts are raw inline `<svg>` markup (see MatchReportView,
 * svgCharts.ts) and every style on the page is inline — no external
 * stylesheet, no web fonts — exactly the conditions this technique handles
 * cleanly, with nothing to fail on cross-origin CSS or font loading.
 */
import { toPng } from 'html-to-image';

export type CapturedImage = {
  dataUrl: string;
  width: number;
  height: number;
};

/**
 * Google Docs rejects an inserted image somewhere north of ~25 megapixels. A
 * full two-sided report (8 sections × 2 sides, each with rows of text and a
 * chart) can run to several thousand CSS pixels tall, so a FLAT pixelRatio of
 * 2 risks quietly failing on exactly the longest, most-complete matches.
 */
const MAX_CAPTURE_MEGAPIXELS = 20;
const MAX_PIXEL_RATIO = 2;
/**
 * A floor only to keep the ratio a sane, positive number — NOT a legibility
 * guarantee. The image is presentation-only (the structured data saved
 * alongside it is the actual record — see the recorder's `matchMetadata`), so
 * staying under Docs' size ceiling always wins over sharpness: an
 * unrealistically long report gets a softer image rather than risking the
 * upload failing outright.
 */
const MIN_PIXEL_RATIO = 0.3;

/**
 * Capture `node` as a PNG, with a solid white background — a Doc page is
 * always white, and a transparent capture would drop the report's dark text
 * if a reader's theme ever showed through.
 *
 * The pixel ratio is chosen from the node's OWN size rather than fixed: sharp
 * (2×) for a short report, scaled down automatically for a long one so the
 * output always stays under Docs' image size ceiling instead of failing
 * unpredictably on whichever match happened to run long.
 */
export async function captureNodeAsPng(node: HTMLElement): Promise<CapturedImage> {
  const cssPixels = Math.max(1, node.scrollWidth) * Math.max(1, node.scrollHeight);
  const budgetRatio = Math.sqrt((MAX_CAPTURE_MEGAPIXELS * 1_000_000) / cssPixels);
  const pixelRatio = Math.min(MAX_PIXEL_RATIO, Math.max(MIN_PIXEL_RATIO, budgetRatio));

  const dataUrl = await toPng(node, {
    pixelRatio,
    backgroundColor: '#ffffff',
    cacheBust: true,
  });
  const { width, height } = await decodedSize(dataUrl);
  return { dataUrl, width, height };
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Captured report image failed to decode'));
    img.src = dataUrl;
  });
}

function decodedSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return decodeImage(dataUrl).then((img) => ({ width: img.naturalWidth, height: img.naturalHeight }));
}

/** Google Docs' usable page box at 1" margins on US Letter, in points. */
const DOC_PAGE_WIDTH_PT = 468;
const DOC_PAGE_HEIGHT_PT = 648;

/**
 * The `objectSize` a Docs `insertInlineImage` request should use so a capture
 * keeps its real proportions at the page's full width.
 */
export function reportImageObjectSize(captured: CapturedImage): { width: number; height: number } {
  const width = DOC_PAGE_WIDTH_PT;
  const height = Math.max(1, Math.round(width * (captured.height / captured.width)));
  return { width, height };
}

/**
 * Cut a tall capture into PAGE-SIZED tiles.
 *
 * WHY THIS EXISTS — a full report is roughly 700 CSS px wide and many thousands
 * tall, so inserting it as ONE inline image asked Docs for an object about 468
 * × 6000–10000 PT: an image over a hundred inches tall, from a single PNG of
 * ~20 megapixels that Google also has to fetch server-side before it can place
 * it. That is far outside what an inline image is meant to be, and the retry
 * path could not save it either — `drive.google.com/thumbnail?sz=w1600` will
 * not render a strip that long. The Doc was left holding the text that had
 * already been written and no picture: precisely the reported symptom.
 *
 * Each tile is instead exactly one page box, so every insert is an ordinary,
 * fast, unremarkable image — and the report reads down the document page by
 * page the way a printed report would.
 */
export async function sliceCaptureIntoPages(captured: CapturedImage): Promise<CapturedImage[]> {
  const img = await decodeImage(captured.dataUrl);
  const sliceHeightPx = Math.max(
    1,
    Math.round(captured.width * (DOC_PAGE_HEIGHT_PT / DOC_PAGE_WIDTH_PT)),
  );
  if (captured.height <= sliceHeightPx) return [captured];

  const slices: CapturedImage[] = [];
  for (let top = 0; top < captured.height; top += sliceHeightPx) {
    const h = Math.min(sliceHeightPx, captured.height - top);
    const canvas = document.createElement('canvas');
    canvas.width = captured.width;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable while slicing the report');
    // Opaque white behind every tile, for the same reason the capture itself
    // is composited onto white: a Doc page is white and a transparent PNG
    // would drop the report's dark text.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, top, captured.width, h, 0, 0, captured.width, h);
    slices.push({ dataUrl: canvas.toDataURL('image/png'), width: captured.width, height: h });
  }
  return slices;
}
