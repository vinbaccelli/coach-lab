'use client';

import { recognizeFullFrame } from '@/lib/matchDecoder/ocr';
import type { ClassifiedScreenshot, ScreenType } from '@/lib/matchDecoder/types';

/**
 * Marker phrases per screen type, checked against one full-frame OCR pass.
 * Deliberately literal string/regex matching, not a trained classifier — the
 * whole point of this decoder is that every decision is traceable to text that
 * is actually on screen, and SwingVision's own chrome (section headers, screen
 * titles) already spells out what kind of screen this is. No image model, no
 * guessing from layout shape.
 *
 * Each screen type needs at least MIN_MATCHES markers before it's accepted, so
 * a single stray OCR misread (tesseract reading "%" on an unrelated screen)
 * can't misclassify it. Confidence is `matched / required-ish`, capped at 1 —
 * a classification signal, not an OCR-accuracy number.
 */
interface MarkerSet {
  type: Exclude<ScreenType, 'unrecognized'>;
  /** Each entry: an array of alternative phrases — any ONE counts as a hit for that slot. */
  markerGroups: RegExp[][];
  minMatches: number;
}

const MARKER_SETS: MarkerSet[] = [
  {
    type: 'player_stats',
    markerGroups: [
      // "Arthur's Shots" / a name + possessive + "Shots", OR the combined screen.
      [/['’]s\s+Shots/i, /Everyone['’]s\s+Shots/i],
      [/Overall/i],
      [/Serves?/i],
      [/Returns?/i],
      [/Groundstrokes?/i],
    ],
    // 1, not 2: a real player_stats screen turns out to be TWO screenshots —
    // one with the name header + Overall/Serves/Returns, a second (scrolled)
    // with Groundstrokes + the shot/spin distribution donuts and no repeat of
    // the "'s Shots" header. That second screenshot may only hit ONE marker
    // group (Groundstrokes), so requiring 2 would drop it from classification
    // entirely — and a dropped classification means extractPlayerStats never
    // runs on it at all. A single distinctive tennis-stat word is still a
    // fair signal on its own; it's disambiguated from timeline/placement_map
    // by never matching THEIR markers, not by needing a second player_stats one.
    minMatches: 1,
  },
  {
    type: 'timeline',
    markerGroups: [
      [/\b\d+\s*-\s*\d+\b/], // a running score, "2-0" etc.
      [/holds? for/i, /breaks? for/i],
      [/Unforced Error/i, /Forced Error/i, /Winner/i, /Double Fault/i, /\bAce\b/i],
    ],
    minMatches: 2,
  },
  {
    type: 'placement_map',
    markerGroups: [
      [/SHOT PLACEMENT/i, /SERVE PLACEMENT/i, /PLACEMENT/i],
      [/FILTER/i],
    ],
    minMatches: 1,
  },
];

/** Marker matching only — no OCR. Lets one full-frame pass feed both
 *  classification and section location instead of paying for two. */
export function classifyFromText(text: string, index: number): ClassifiedScreenshot {

  let best: ClassifiedScreenshot = {
    index,
    type: 'unrecognized',
    confidence: 0,
    matchedMarkers: [],
    rawText: text,
  };

  for (const set of MARKER_SETS) {
    const matched: string[] = [];
    for (const group of set.markerGroups) {
      const hit = group.find((re) => re.test(text));
      if (hit) matched.push(hit.source);
    }
    if (matched.length >= set.minMatches && matched.length > best.matchedMarkers.length) {
      best = {
        index,
        type: set.type,
        confidence: Math.min(1, matched.length / set.markerGroups.length),
        matchedMarkers: matched,
        rawText: text,
      };
    }
  }

  return best;
}

export async function classifyScreenshot(
  image: ImageBitmap,
  index: number,
): Promise<ClassifiedScreenshot> {
  const read = await recognizeFullFrame(image, index);
  return classifyFromText(read.rawText, index);
}

export async function classifyScreenshots(
  images: ImageBitmap[],
): Promise<ClassifiedScreenshot[]> {
  const out: ClassifiedScreenshot[] = [];
  // Sequential: one shared tesseract worker (see tesseractWorker.ts) — running
  // these concurrently would just queue on the same WASM instance for no gain.
  for (let i = 0; i < images.length; i++) {
    out.push(await classifyScreenshot(images[i], i));
  }
  return out;
}
