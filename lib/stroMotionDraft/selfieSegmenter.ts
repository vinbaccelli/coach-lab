'use client';

import type { AlphaMask } from '@/lib/stroMotionDraft/types';
import {
  COVERED_MIN_ALPHA,
  installSegmenterSwitch,
  letterboxToSquare,
  logSegmenterCoverage,
  rampAlpha,
  readSegmenterSelection,
  selectedSegmenter,
} from '@/lib/stroMotionDraft/segmenterCommon';

// Make `window.__stroSetSegmenter(...)` available as soon as this module loads.
installSegmenterSwitch();

/**
 * MediaPipe Selfie Segmentation — a true person-segmentation model, used as the
 * PRIMARY cut for the athlete in StroMotion.
 *
 * THIS FILE IS ALSO THE ENTRY POINT FOR BOTH SEGMENTERS.
 * `segmentPersonInImage` dispatches on `window.__stroSegmenter` ('legacy' —
 * default — or 'multiclass', see segmenterCommon.ts) and returns the same
 * AlphaMask either way. Callers, the skeleton-zone intersect and the bone-core
 * union are unaffected by the choice.
 *
 * SELF-HOSTED, NOT CDN
 * The assets are copied into /public/mediapipe-selfie from the installed
 * @mediapipe/selfie_segmentation package (a peer dependency of the direct
 * dependency @tensorflow-models/body-segmentation). This mirrors how every other
 * model in the app is served — /models/*.tflite, /mediapipe-wasm/* — and
 * deliberately does NOT follow lib/webcamSegmentation.ts, which pulls the same
 * solution from jsdelivr at runtime. The StroMotion pipeline must not acquire a
 * network dependency on a third-party CDN.
 *
 * WHY A CROP, NOT THE FRAME
 * Segmentation quality is dominated by how many input pixels land on the subject.
 * The model resizes its input to a fixed 256x256, so handing it a 1080x1920 frame
 * in which the athlete occupies ~15% wastes almost all of that budget on
 * background — and on a small-in-frame subject it does not merely lose detail, it
 * reports no person at all. Passing a crop around the athlete spends the entire
 * budget on them. The caller supplies the crop; this module returns a mask in the
 * INPUT IMAGE's pixel space, and the caller embeds it back to full frame.
 *
 * ORIENTATION IS THIS MODULE'S PROBLEM, NOT THE CALLER'S
 * The model input is square and the solution stretches to fill it, so a portrait
 * frame or a tall athlete crop would arrive squashed. Everything handed to the
 * model is padded to square here first, and the mask is read back out of that
 * padding — so callers pass whatever aspect they have and get a mask at exactly
 * the dimensions they passed, in either orientation.
 */

/**
 * WHY THIS DRIVES THE MEDIAPIPE SOLUTION DIRECTLY, NOT VIA
 * @tensorflow-models/body-segmentation
 *
 * The tfjs wrapper cannot work in a bundled app, and fails in the most misleading
 * way possible: it throws BEFORE issuing a single network request, so it looks like
 * a model that was never asked for rather than one that failed to load.
 *
 * The reason is in @mediapipe/selfie_segmentation's own packaging. Its bundle ends
 * with Closure's export-to-global calls:
 *
 *     Aa("SelfieSegmentation", nd); Aa("VERSION", "..."); }).call(this);
 *
 * — it registers `SelfieSegmentation` on the GLOBAL object and exports nothing
 * through `module.exports`. Its package.json then declares `"sideEffects": []`,
 * telling webpack the file has no side effects at all, so a bundler is free to
 * drop the module entirely once it sees no named export being read from it. It
 * does. The file never executes, `window.SelfieSegmentation` is never registered,
 * and body-segmentation's `new selfieSegmentation.SelfieSegmentation(...)` is
 * `new undefined(...)` — a synchronous TypeError inside the constructor, thrown
 * before `initialize()` (the thing that fetches wasm and weights) is ever reached.
 *
 * Hence: no fetch, no model, and a generic "unavailable" that named nothing.
 *
 * Loading the solution as a classic <script> is the only way this package hands
 * over its constructor, which is exactly what lib/webcamSegmentation.ts already
 * does for the webcam path. This does the same, from the SELF-HOSTED copy in
 * /public/mediapipe-selfie — the no-CDN rule above still stands.
 */

interface SelfieSolution {
  setOptions: (o: { modelSelection: number; selfieMode: boolean }) => void;
  onResults: (cb: (r: { segmentationMask?: CanvasImageSource }) => void) => void;
  initialize: () => Promise<void>;
  send: (input: { image: CanvasImageSource }) => Promise<void>;
}

/** Asset directory — self-hosted, mirroring every other model in the app. */
const SOLUTION_DIR = '/mediapipe-selfie';

/**
 * 'landscape' (144x256) is the faster variant; 'general' (256x256) keeps more
 * vertical detail, which matters because an athlete crop is usually TALLER than it
 * is wide. modelSelection 0 = general, 1 = landscape.
 */
const MODEL_SELECTION = 0;

let scriptPromise: Promise<void> | null = null;

function loadSolutionScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  const url = `${SOLUTION_DIR}/selfie_segmentation.js`;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) { resolve(); return; }
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${url} (is public${SOLUTION_DIR} deployed?)`));
    document.head.appendChild(s);
  }).catch((e) => {
    // A failed load must not be cached as "loaded" — clear it so the next frame
    // genuinely retries instead of inheriting a permanent failure.
    scriptPromise = null;
    throw e;
  });
  return scriptPromise;
}

let solutionPromise: Promise<SelfieSolution> | null = null;
/** Latest mask from onResults, claimed by the in-flight `send`. */
let latestMask: CanvasImageSource | null = null;

async function createSolution(): Promise<SelfieSolution> {
  await loadSolutionScript();
  const Ctor = (window as unknown as Record<string, unknown>).SelfieSegmentation as
    | (new (cfg: { locateFile: (f: string) => string }) => SelfieSolution)
    | undefined;
  if (typeof Ctor !== 'function') {
    throw new Error(
      'SelfieSegmentation missing from window after the solution script ran — ' +
      'the script loaded but did not register its global.',
    );
  }
  const solution = new Ctor({ locateFile: (file: string) => `${SOLUTION_DIR}/${file}` });
  solution.setOptions({ modelSelection: MODEL_SELECTION, selfieMode: false });
  solution.onResults((r) => { latestMask = r?.segmentationMask ?? null; });
  // THIS is the call that fetches the wasm runtime and the .tflite weights — the
  // network activity whose absence was the symptom.
  await solution.initialize();
  console.log(`[selfieSegmenter] solution initialized from ${SOLUTION_DIR} (modelSelection=${MODEL_SELECTION})`);
  return solution;
}

async function getSelfieSolution(): Promise<SelfieSolution | null> {
  if (typeof window === 'undefined') return null;
  if (!solutionPromise) {
    solutionPromise = createSolution().catch((e) => {
      // Surface the REAL error, and do not cache the failure: the old code kept a
      // null-resolving promise forever, so one early failure silently disabled
      // segmentation for the rest of the session with no further diagnostics.
      console.error('[selfieSegmenter] solution init FAILED:', e);
      solutionPromise = null;
      throw e;
    });
  }
  try {
    return await solutionPromise;
  } catch {
    return null;
  }
}

/**
 * The solution holds one graph and reports through a shared callback, so two
 * overlapping `send`s would race for `latestMask`. Frames are sequential in
 * practice; this makes that a guarantee rather than an assumption.
 */
let sendQueue: Promise<unknown> = Promise.resolve();

async function segmentCanvas(canvas: HTMLCanvasElement): Promise<CanvasImageSource | null> {
  const solution = await getSelfieSolution();
  if (!solution) return null;
  const run = sendQueue.then(async () => {
    latestMask = null;
    await solution.send({ image: canvas });
    return latestMask;
  });
  sendQueue = run.then(() => {}, () => {});
  return run;
}

/**
 * Warm whichever model is currently selected, so frame 1 doesn't pay the load.
 *
 * Called when Motion Layer opens (app/analysis/page.tsx), NOT at module load —
 * the point is to overlap model init with the coach picking frames. The log line
 * is how we can see from the console that the wiring actually fired, rather than
 * inferring it from a fast frame 1.
 */
export function preloadSelfieSegmenter(): void {
  if (typeof window === 'undefined') return;
  console.log(`[selfieSegmenter] PRELOAD requested — warming '${selectedSegmenter()}' ahead of the batch`);
  if (selectedSegmenter() === 'multiclass') {
    void import('@/lib/stroMotionDraft/multiclassSegmenter')
      .then((m) => m.preloadMulticlassSegmenter())
      .catch(() => { /* preload is best-effort */ });
    return;
  }
  void getSelfieSolution();
}

/**
 * PUBLIC ENTRY POINT — runs the selected segmenter (see `selectedSegmenter`) and
 * returns a soft AlphaMask at `image`'s own dimensions, or null when nothing was
 * found.
 *
 * THE SELECTION IS READ FRESH ON EVERY CALL and the raw values it read are
 * LOGGED, every frame, before anything else happens. That log is the whole point:
 * when a run comes back 'legacy' unexpectedly, the line says whether the flag was
 * simply not visible (`win=undefined ls=null` — set from the wrong realm, or lost
 * to a reload) or whether multiclass was chosen and then failed. Previously the
 * only evidence was "segmenter=legacy", which cannot distinguish the two.
 *
 * Default is 'legacy', so behaviour is unchanged until we opt in. When
 * 'multiclass' is selected but the model is unavailable or finds nobody, this
 * falls back to legacy so the frame is not lost — and logs at ERROR level, so a
 * fallback can never be quietly mistaken for a multiclass result during an A/B.
 */
export async function segmentPersonInImage(image: ImageBitmap): Promise<AlphaMask | null> {
  const sel = readSegmenterSelection();
  console.log(
    `[selfieSegmenter] SELECT choice=${sel.choice} via=${sel.source} ` +
      `win=${String(sel.rawWindow)} ls=${String(sel.rawStorage)}`,
  );

  if (sel.choice === 'multiclass') {
    try {
      const { segmentPersonMulticlass } = await import('@/lib/stroMotionDraft/multiclassSegmenter');
      const mask = await segmentPersonMulticlass(image);
      if (mask) return mask;
      console.error(
        '[selfieSegmenter] segmenter=multiclass SELECTED but returned NO MASK — ' +
          'falling back to legacy for this frame. The coverage/init logs above say why.',
      );
    } catch (e) {
      console.error(
        '[selfieSegmenter] segmenter=multiclass SELECTED but FAILED — falling back to legacy for this frame:',
        e,
      );
    }
  }
  return segmentPersonLegacy(image);
}

/**
 * Segment the person in `image`, returning a soft AlphaMask at the image's own
 * dimensions, or null when the model is unavailable or found nothing at all.
 *
 * The confidence ramp is soft rather than a hard threshold, so downstream
 * compositing sees the feathered edge it already handles. Its endpoints now live
 * in segmenterCommon.ts (RAMP_LO/RAMP_HI, loosened from 0.3→0.6 to 0.15→0.5) and
 * are shared with the multiclass path so the two are directly comparable.
 *
 * The input is padded to SQUARE (`letterboxToSquare`, now in segmenterCommon.ts
 * and shared with the multiclass path), so a portrait frame is not squashed
 * before the model ever looks at it.
 *
 * One earlier behaviour destroyed the evidence and is gone: this used to return
 * null whenever the result covered under 0.2% of its own area, which on a full
 * 1080x1920 frame means discarding anything under ~4,100px — a real but small
 * athlete — and reporting it upstream as "SEGMENTER EMPTY". Coverage is now the
 * CALLER's decision; this returns whatever the model actually said, and says so
 * out loud.
 */
async function segmentPersonLegacy(
  image: ImageBitmap,
): Promise<AlphaMask | null> {
  const boxed = letterboxToSquare(image);
  if (!boxed) return null;

  let maskSource: CanvasImageSource | null;
  try {
    maskSource = await segmentCanvas(boxed.canvas);
  } catch (e) {
    console.warn('[selfieSegmenter] send failed:', e);
    return null;
  }
  if (!maskSource) {
    console.warn('[selfieSegmenter] no mask returned for this frame');
    return null;
  }

  // Read the mask's pixels. It arrives at the model's own resolution; the sampling
  // loop below maps image pixels into it, so no rescale is needed here.
  const mw = Math.round(Number((maskSource as HTMLCanvasElement).width) || 0);
  const mh = Math.round(Number((maskSource as HTMLCanvasElement).height) || 0);
  if (mw < 1 || mh < 1) {
    console.warn(`[selfieSegmenter] mask has no dimensions (${mw}x${mh})`);
    return null;
  }
  const readCanvas = document.createElement('canvas');
  readCanvas.width = mw;
  readCanvas.height = mh;
  const readCtx = readCanvas.getContext('2d', { willReadFrequently: true });
  if (!readCtx) return null;
  readCtx.drawImage(maskSource, 0, 0);
  const rgba = readCtx.getImageData(0, 0, mw, mh).data;

  // Person confidence is carried in the COLOUR channels ("person = white,
  // background = black" — the same reading lib/webcamSegmentation.ts relies on),
  // NOT in alpha.
  //
  // Measured on a real frame: red reports 3.9% foreground where alpha reports
  // only 1.8% — alpha loses more than half the subject, which shows up as bits
  // of the athlete (a foot, an edge) simply missing. Taking the max across RGB
  // is robust to whichever channel the runtime happens to encode into.
  //
  // The mask covers the SQUARE canvas, so reading it back means walking the
  // image's own pixels and sampling the padded position each one came from.
  const iw = image.width;
  const ih = image.height;
  const alpha = new Uint8ClampedArray(iw * ih);
  let covered = 0;
  for (let y = 0; y < ih; y++) {
    const my = Math.min(mh - 1, Math.floor(((y + boxed.offsetY) * mh) / boxed.side));
    for (let x = 0; x < iw; x++) {
      const mx = Math.min(mw - 1, Math.floor(((x + boxed.offsetX) * mw) / boxed.side));
      const o = (my * mw + mx) * 4;
      const c = Math.max(rgba[o], rgba[o + 1], rgba[o + 2]) / 255;
      const a = rampAlpha(c);
      alpha[y * iw + x] = a;
      if (a > COVERED_MIN_ALPHA) covered++;
    }
  }

  // TEMP-DEBUG-SKELZONE — what went in, what came back, and how much of it was
  // person. `coverage` near 0 means the model genuinely found nobody; a healthy
  // subject-filling crop lands in the tens of percent. Same line shape as the
  // multiclass path, so the two are comparable frame-for-frame. Remove with the
  // grep tag.
  logSegmenterCoverage({
    segmenter: 'legacy',
    inW: iw,
    inH: ih,
    side: boxed.side,
    maskW: mw,
    maskH: mh,
    covered,
  });

  if (covered === 0) return null;
  return { width: iw, height: ih, data: alpha };
}
