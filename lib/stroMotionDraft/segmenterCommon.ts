'use client';

/**
 * Shared plumbing for the two selectable person segmenters — STEP 1 of the
 * Motion Layer segmentation overhaul.
 *
 * Both segmenters answer the same question ("which pixels of this crop are the
 * athlete?") and must be comparable on the SAME footage, so everything that
 * could bias an A/B lives here and is applied identically to both:
 *   - the confidence→alpha ramp (RAMP_LO/RAMP_HI),
 *   - the letterbox-to-square preprocessing,
 *   - the coverage log line.
 * The only thing that differs between the two paths is the model.
 *
 * Nothing downstream knows a choice exists: `segmentPersonInImage` in
 * selfieSegmenter.ts remains the single entry point and returns the same
 * AlphaMask format either way, so the skeleton-zone intersect and the bone-core
 * union operate unchanged.
 */

/**
 * CONFIDENCE → ALPHA RAMP.
 *
 * Was 0.3→0.6. Loosened to 0.15→0.5 to recover the uncertain periphery — hair,
 * a forearm against a similar-toned background, the trailing edge of a shoe —
 * which the model does report, at low confidence, and the old floor discarded
 * outright.
 *
 * The downside is contained by construction: this mask is only ever a candidate.
 * It is intersected with the thickened-skeleton zone and then union'd with the
 * bone cores downstream, so a looser ramp can add detail INSIDE the zone but
 * cannot leak background into the composite.
 *
 * Named so they are trivial to A/B and to revert: put them back to 0.3 / 0.6.
 */
export const RAMP_LO = 0.15;
export const RAMP_HI = 0.5;

/**
 * Soft (NOT binarized) alpha for a person-confidence in [0,1]. Feathered edges
 * are what downstream compositing already expects.
 */
export function rampAlpha(c: number): number {
  if (c <= RAMP_LO) return 0;
  if (c >= RAMP_HI) return 255;
  return Math.round(((c - RAMP_LO) / (RAMP_HI - RAMP_LO)) * 255);
}

/** Alpha at/below which a pixel doesn't count as covered (matches prior code). */
export const COVERED_MIN_ALPHA = 8;

export type SegmenterChoice = 'legacy' | 'multiclass';

/** localStorage key — the realm-proof, reload-proof form of the toggle. */
export const SEGMENTER_STORAGE_KEY = 'stroSegmenter';

/**
 * WHICH SEGMENTER RUNS — read fresh on every frame, so flipping it takes effect
 * immediately with no reload. TWO sources, checked in order:
 *
 *   1. window.__stroSegmenter        (set from the page's own realm)
 *   2. localStorage['stroSegmenter'] (survives reloads AND crosses realms)
 *
 * WHY localStorage EXISTS HERE. A `window` global set from a devtools/extension
 * eval does NOT necessarily reach the app: an extension content script runs in an
 * ISOLATED WORLD with its own `window`, so `window.__stroSegmenter = 'multiclass'`
 * can read back as 'multiclass' in the console and still be completely invisible
 * to this module — which is exactly "the flag is set but every frame logs
 * segmenter=legacy". localStorage is shared per-origin across those worlds, so it
 * works no matter where it is set from. It also survives a reload / Fast Refresh,
 * which a window global does not.
 *
 * Prefer the helper, which writes BOTH and is safe from either realm:
 *
 *   window.__stroSetSegmenter('multiclass')   // or 'legacy'
 *
 * or, from anywhere at all:
 *
 *   localStorage.setItem('stroSegmenter', 'multiclass'); // 'legacy' to revert
 *
 * Default is 'legacy' — the shipped behaviour — so nothing changes unless we
 * deliberately opt in.
 */
export function selectedSegmenter(): SegmenterChoice {
  return readSegmenterSelection().choice;
}

/**
 * The selection PLUS where it came from, so the log line can prove what was read
 * instead of leaving us to guess why legacy ran. Never throws: localStorage can
 * be blocked outright (private mode, third-party cookie policy).
 */
export function readSegmenterSelection(): {
  choice: SegmenterChoice;
  source: 'window' | 'localStorage' | 'default';
  rawWindow: unknown;
  rawStorage: string | null;
} {
  if (typeof window === 'undefined') {
    return { choice: 'legacy', source: 'default', rawWindow: undefined, rawStorage: null };
  }
  const rawWindow = (window as unknown as Record<string, unknown>).__stroSegmenter;
  let rawStorage: string | null = null;
  try {
    rawStorage = window.localStorage?.getItem(SEGMENTER_STORAGE_KEY) ?? null;
  } catch {
    rawStorage = null;
  }
  const norm = (v: unknown): SegmenterChoice | null => {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return s === 'multiclass' ? 'multiclass' : s === 'legacy' ? 'legacy' : null;
  };
  const fromWindow = norm(rawWindow);
  if (fromWindow) return { choice: fromWindow, source: 'window', rawWindow, rawStorage };
  const fromStorage = norm(rawStorage);
  if (fromStorage) return { choice: fromStorage, source: 'localStorage', rawWindow, rawStorage };
  return { choice: 'legacy', source: 'default', rawWindow, rawStorage };
}

/**
 * Install `window.__stroSetSegmenter(choice)` — sets BOTH the window global and
 * localStorage, so one call works whichever realm it is made from and survives a
 * reload. Idempotent; called when either segmenter module is first loaded.
 */
export function installSegmenterSwitch(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.__stroSetSegmenter === 'function') return;
  w.__stroSetSegmenter = (choice: unknown) => {
    const s = typeof choice === 'string' ? choice.trim().toLowerCase() : '';
    const next: SegmenterChoice = s === 'multiclass' ? 'multiclass' : 'legacy';
    w.__stroSegmenter = next;
    try { window.localStorage?.setItem(SEGMENTER_STORAGE_KEY, next); } catch { /* blocked */ }
    console.log(`[selfieSegmenter] segmenter set to '${next}' (window + localStorage) — takes effect on the NEXT frame`);
    return next;
  };
}

export interface SquareBox {
  canvas: HTMLCanvasElement;
  side: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Letterbox `image` into a SQUARE canvas, centred, with the remainder left black.
 *
 * Both models take a square input and STRETCH whatever they are given to fit —
 * they do not preserve aspect. Hand either one a tall athlete crop and the
 * subject arrives squashed, which is a genuine distribution shift for models
 * trained on upright, correctly proportioned people, and a very good way to make
 * them find nobody at all.
 *
 * Padding to square first costs nothing (black reads as background) and means
 * the model always sees the subject at true proportions, in either orientation.
 * Returns the canvas plus where the image sits inside it, so the mask can be
 * read back out of the padded region.
 */
export function letterboxToSquare(image: ImageBitmap): SquareBox | null {
  const iw = image.width;
  const ih = image.height;
  if (iw < 1 || ih < 1) return null;
  const side = Math.max(iw, ih);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, side, side);
  const offsetX = Math.round((side - iw) / 2);
  const offsetY = Math.round((side - ih) / 2);
  ctx.drawImage(image, offsetX, offsetY, iw, ih);
  return { canvas, side, offsetX, offsetY };
}

/**
 * TEMP-DEBUG-SKELZONE — ONE log line shape for BOTH segmenters, so 'legacy' and
 * 'multiclass' runs over the same frames can be compared by reading `coverage=`
 * down the console. `segmenter=` says which model actually produced the number.
 * Remove with the grep tag.
 */
export function logSegmenterCoverage(info: {
  segmenter: SegmenterChoice;
  inW: number;
  inH: number;
  side: number;
  maskW: number;
  maskH: number;
  covered: number;
  /** Segmenter-specific detail, e.g. the multiclass foreground class list. */
  extra?: string;
}): void {
  const total = Math.max(1, info.inW * info.inH);
  console.log(
    `[selfieSegmenter] segmenter=${info.segmenter} in=${info.inW}x${info.inH} ` +
      `padded=${info.side}x${info.side} maskOut=${info.maskW}x${info.maskH} ` +
      `ramp=${RAMP_LO}→${RAMP_HI}${info.extra ? ` ${info.extra}` : ''} ` +
      `coverage=${((info.covered / total) * 100).toFixed(2)}% (${info.covered}px)`,
  );
}
