'use client';

/**
 * TEMP-DEBUG-MATCHDECODER — evidence collector for the "works in Python, returns
 * nothing in the browser" gap.
 *
 * Python's `image_to_data` hands back a FLAT token list. tesseract.js does not:
 * its worker returns `blocks → paragraphs → lines → words`, and only the main
 * thread's `circularize()` derives a flat `.words` array from it — and only when
 * `page.blocks` is non-null. Meanwhile the library's TypeScript `Page` interface
 * declares `words: Word[]` unconditionally, so `data.words` type-checks whether
 * or not it exists at runtime. That combination can produce zero tokens with no
 * error and no type failure, which is exactly the observed symptom.
 *
 * Rather than guess which of those it is on the user's machine, this records
 * what the browser ACTUALLY returned — the raw result's key list, whether the
 * flat array exists, how many words the nested structure holds, and a sample
 * token — so one screenshot of the dev page settles it.
 *
 * Remove this file and its call sites with the grep tag once the gap is closed.
 */

export interface RawOcrShape {
  label: string;
  imagePx: string;
  /** Top-level keys tesseract.js actually returned. */
  resultKeys: string[];
  /** Does the flat `data.words` array exist, and how long is it? */
  hasFlatWords: boolean;
  flatWordCount: number;
  /** Does `data.blocks` exist, and how many words are nested inside it? */
  hasBlocks: boolean;
  blockCount: number;
  nestedWordCount: number;
  /** Whichever source produced usable tokens. */
  tokenSource: 'flat words' | 'nested blocks' | 'NONE';
  /** First few tokens as the pipeline sees them, post-normalisation. */
  sampleTokens: Array<{ text: string; xFrac: number; yFrac: number; conf: number }>;
  /** Raw shape of one word object, so a field-name mismatch is visible. */
  firstWordKeys: string[];
  bboxSample: string;
}

export interface SectionTrace {
  screenshotIndex: number;
  section: string;
  titleFound: boolean;
  anchorY: number;
  bandPx: string;
  bandTokenCount: number;
  frameTokenCount: number;
  picked: string[];
}

let rawShapes: RawOcrShape[] = [];
let sectionTraces: SectionTrace[] = [];

export function resetTrace(): void {
  rawShapes = [];
  sectionTraces = [];
}

export function recordRawShape(shape: RawOcrShape): void {
  // Keep only the first few — one real screenshot answers the question.
  if (rawShapes.length < 4) rawShapes.push(shape);
}

export function recordSectionTrace(trace: SectionTrace): void {
  sectionTraces.push(trace);
}

export function getTrace(): { rawShapes: RawOcrShape[]; sectionTraces: SectionTrace[] } {
  return { rawShapes, sectionTraces };
}
