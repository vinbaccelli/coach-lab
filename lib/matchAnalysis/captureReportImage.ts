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

function decodedSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Captured report image failed to decode'));
    img.src = dataUrl;
  });
}

/** Google Docs' usable page width at 1" margins on US Letter (8.5in − 2×1in, in points). */
const DOC_PAGE_WIDTH_PT = 468;

/**
 * The `objectSize` a Docs `insertInlineImage` request should use so a TALL
 * portrait capture keeps its real proportions.
 *
 * Every other image this app inserts (a chart, a screenshot) is roughly
 * landscape, so `insertSessionAtTop` has always used one fixed 440×248pt box —
 * fine for those, but it would squash a full multi-section report into an
 * illegibly thin strip. This sizes to the page's full width instead and lets
 * the height follow the capture's own aspect ratio, however tall that makes it
 * — Docs simply flows the image across as many pages as it needs.
 */
export function reportImageObjectSize(captured: CapturedImage): { width: number; height: number } {
  const width = DOC_PAGE_WIDTH_PT;
  const height = Math.max(1, Math.round(width * (captured.height / captured.width)));
  return { width, height };
}
