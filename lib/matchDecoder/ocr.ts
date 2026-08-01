'use client';

import { getSharedWorker } from '@/lib/matchDecoder/tesseractWorker';
import type { CropRectFraction, OcrRegionRead } from '@/lib/matchDecoder/types';
import { recordRawShape } from '@/lib/matchDecoder/debugTrace';

/**
 * One recognized word, positioned as a fraction of the FULL screenshot (not the
 * cropped/upscaled canvas it was actually read from) — so a caller comparing a
 * token's position against a section's known layout never has to think about
 * crop-space vs image-space, only image-space fractions throughout.
 */
export interface OcrToken {
  text: string;
  confidence: number;
  xFrac: number;
  yFrac: number;
}

export interface BandRead {
  screenshotIndex: number;
  bandRect: CropRectFraction;
  tokens: OcrToken[];
  rawText: string;
  confidence: number;
}


/**
 * Every word tesseract found, from WHICHEVER shape the result carries.
 *
 * tesseract.js's worker returns only `blocks → paragraphs → lines → words`; the
 * flat `data.words` array is derived on the main thread by `circularize()`, and
 * only when `data.blocks` is non-null. The library's TypeScript `Page` type
 * declares `words: Word[]` regardless, so reading `data.words` compiles cleanly
 * and can still be `undefined` at runtime — yielding zero tokens, no error, and
 * every field reported as "none".
 *
 * Python's `image_to_data` has no such split, which is precisely why the same
 * screenshot extracts under Python and not in the browser.
 *
 * So: prefer the flat array when it is genuinely populated, otherwise walk the
 * nested structure ourselves. Depending on the library to have done it is the
 * fragile part, and it costs ~10 lines not to.
 */
interface TessWordLike {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}
interface TessPageLike {
  words?: TessWordLike[] | null;
  blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: TessWordLike[] }> }> }> | null;
}

function collectWords(data: unknown): { words: TessWordLike[]; source: 'flat words' | 'nested blocks' | 'NONE' } {
  const page = (data ?? {}) as TessPageLike;
  if (Array.isArray(page.words) && page.words.length > 0) {
    return { words: page.words, source: 'flat words' };
  }
  const nested: TessWordLike[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block?.paragraphs ?? []) {
      for (const line of para?.lines ?? []) {
        for (const w of line?.words ?? []) nested.push(w);
      }
    }
  }
  if (nested.length) return { words: nested, source: 'nested blocks' };
  return { words: [], source: 'NONE' };
}

/** Normalise one tesseract word into an OcrToken positioned in FULL-IMAGE fractions. */
function toToken(w: TessWordLike, canvasW: number, canvasH: number, rect: CropRectFraction): OcrToken | null {
  const b = w.bbox;
  if (!b || typeof b.x0 !== 'number') return null;
  return {
    text: w.text ?? '',
    confidence: typeof w.confidence === 'number' ? w.confidence : 0,
    xFrac: rect.x + (((b.x0 + b.x1) / 2) / canvasW) * rect.w,
    yFrac: rect.y + (((b.y0 + b.y1) / 2) / canvasH) * rect.h,
  };
}

function cropAndUpscale(image: ImageBitmap, rect: CropRectFraction, upscale: number): HTMLCanvasElement {
  const sx = Math.round(rect.x * image.width);
  const sy = Math.round(rect.y * image.height);
  const sw = Math.max(1, Math.round(rect.w * image.width));
  const sh = Math.max(1, Math.round(rect.h * image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * upscale));
  canvas.height = Math.max(1, Math.round(sh * upscale));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/**
 * Crop a SECTION BAND (full width, one vertical slice of the screenshot),
 * upscale, and recognize it as a block of text, returning every WORD tesseract
 * found with its position — not one flattened string.
 *
 * WHY A BAND OF WORDS, NOT A TIGHT PER-FIELD CROP OF TEXT
 * The original Phase 1 cropped a tight box around each individual number and
 * read it as one string. Verified against real SwingVision screenshots, that
 * MISREAD numbers ("80%"→"SO%", "72%"→"TOY,") — isolating a single short token
 * removes exactly the surrounding-text context tesseract's language model uses
 * to disambiguate a glyph. A section band (title + its value rows together)
 * reads at 92–96% confidence in the same test. So extraction is now two steps:
 * this function gets every token in a band with its position; the caller
 * (extractPlayerStats.ts) picks the right token by where it sits — the LABEL
 * (a section title, itself a reliable ~95%-confidence read) anchors a known
 * row/column offset, and the number at that position is the value.
 *
 * tesseract.js returns word-level data by default (`blocks: true` is the
 * library default), so no extra output options are needed here.
 */
export async function recognizeBand(
  image: ImageBitmap,
  rect: CropRectFraction,
  screenshotIndex: number,
  upscale = 2,
): Promise<BandRead> {
  const canvas = cropAndUpscale(image, rect, upscale);
  const worker = await getSharedWorker();
  const { data } = await worker.recognize(canvas);
  const { words } = collectWords(data);
  const tokens = words
    .map((w) => toToken(w, canvas.width, canvas.height, rect))
    .filter((t): t is OcrToken => t !== null);
  return {
    screenshotIndex,
    bandRect: rect,
    tokens,
    rawText: (data.text ?? '').trim(),
    confidence: typeof data.confidence === 'number' ? data.confidence : 0,
  };
}

/**
 * Crop `image` to `rect` (fractional, [0,1]), upscale, and recognize it as ONE
 * string. Used only where there is exactly one field of interest and no
 * positional picking is needed (the player-name header) — everywhere a value
 * has to be told apart from its neighbours by position, use `recognizeBand`.
 */
export async function recognizeRegion(
  image: ImageBitmap,
  rect: CropRectFraction,
  screenshotIndex: number,
  upscale = 2,
): Promise<OcrRegionRead> {
  const canvas = cropAndUpscale(image, rect, upscale);
  const worker = await getSharedWorker();
  const { data } = await worker.recognize(canvas);
  return {
    screenshotIndex,
    rawText: (data.text ?? '').trim(),
    confidence: typeof data.confidence === 'number' ? data.confidence : 0,
  };
}

/**
 * One full-frame recognition pass, returning every word WITH its position.
 *
 * Used for classification AND as the map that locates each section title. That
 * second job is why it returns tokens rather than a flat string: the section
 * bands used to be fixed y-fraction windows, which only work if every
 * screenshot frames the section identically. Real captures are SCROLLED — the
 * coach shoots the stats screen at several scroll offsets — so "Serves" can sit
 * anywhere vertically, the fixed window misses it, the in-band title search
 * never fires, and every field falls back to a position with nothing at it.
 * Finding the title anywhere in the frame first removes that whole failure mode.
 *
 */
export async function recognizeFullFrame(
  image: ImageBitmap,
  screenshotIndex: number,
): Promise<BandRead> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  const full: CropRectFraction = { x: 0, y: 0, w: 1, h: 1 };
  if (!ctx) return { screenshotIndex, bandRect: full, tokens: [], rawText: '', confidence: 0 };
  ctx.drawImage(image, 0, 0);

  const worker = await getSharedWorker();
  const { data } = await worker.recognize(canvas);
  const { words, source } = collectWords(data);
  // Positions matter here, not just the text: section titles are located by
  // scanning THESE tokens across the whole image, which is what lets a scrolled
  // screenshot anchor correctly.
  const tokens = words
    .map((w) => toToken(w, canvas.width, canvas.height, full))
    .filter((t): t is OcrToken => t !== null);

  // TEMP-DEBUG-MATCHDECODER — record what the browser really returned.
  const page = data as unknown as { words?: unknown[]; blocks?: unknown[] };
  let nestedCount = 0;
  for (const b of (page.blocks ?? []) as Array<{ paragraphs?: Array<{ lines?: Array<{ words?: unknown[] }> }> }>) {
    for (const par of b?.paragraphs ?? []) for (const l of par?.lines ?? []) nestedCount += (l?.words ?? []).length;
  }
  recordRawShape({
    label: `screenshot #${screenshotIndex}`,
    imagePx: `${image.width}x${image.height}`,
    resultKeys: Object.keys(data ?? {}),
    hasFlatWords: Array.isArray(page.words),
    flatWordCount: Array.isArray(page.words) ? page.words.length : 0,
    hasBlocks: Array.isArray(page.blocks),
    blockCount: Array.isArray(page.blocks) ? page.blocks.length : 0,
    nestedWordCount: nestedCount,
    tokenSource: source,
    sampleTokens: tokens.slice(0, 12).map((t) => ({
      text: t.text, xFrac: +t.xFrac.toFixed(3), yFrac: +t.yFrac.toFixed(3), conf: Math.round(t.confidence),
    })),
    firstWordKeys: words[0] ? Object.keys(words[0] as object) : [],
    bboxSample: words[0]?.bbox ? JSON.stringify(words[0].bbox) : '(no bbox on first word)',
  });

  return {
    screenshotIndex,
    bandRect: full,
    tokens,
    rawText: (data.text ?? '').trim(),
    confidence: typeof data.confidence === 'number' ? data.confidence : 0,
  };
}

/**
 * Pull the first number out of an OCR read, tolerant of the noise tesseract
 * commonly introduces around digits (stray `%`, `°`, unit suffixes, a
 * misread decimal comma). Returns null rather than 0 when nothing parses —
 * a failed parse must never silently become a zero in the data model.
 */
export function parseNumber(rawText: string): number | null {
  const m = rawText.replace(/,/g, '.').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Same, but only accepts the match when a `%` sign appears with it — avoids
 * treating a stray speed number ("89") as a percentage read from noise.
 *
 * Handles both decimal conventions and surrounding punctuation, all of which
 * occur in real SwingVision legends: "61,2%" (EU comma) → 61.2, "(50.5%)"
 * (parenthesised, spin legend) → 50.5, "17,5%" → 17.5.
 */
export function parsePercent(rawText: string): number | null {
  const m = rawText.match(/(-?\d+(?:[.,]\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
