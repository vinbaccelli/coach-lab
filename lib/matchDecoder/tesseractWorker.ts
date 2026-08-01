'use client';

/**
 * Shared tesseract.js worker, self-hosted — matches the rest of the app's
 * client-side-model convention (mediapipePose.ts, selfieSegmenter.ts): heavy
 * recognition runs in the browser, in a Worker, off assets served from our own
 * /public rather than a CDN. next.config.js explicitly disables the `canvas`
 * fallback and the codebase avoids server-side image processing on Vercel
 * (see lib/stroMotionDraft/captureSource.ts, the yt-dlp comment in
 * app/api/video/resolve/route.ts) — OCR follows that same rule for the same
 * reason: no native deps, no serverless cold-start tax, no per-image cost.
 *
 * ASSETS (copied from node_modules into /public/tesseract at build time — see
 * the setup note at the bottom of this file):
 *   worker.min.js                      — tesseract.js's own worker script
 *   tesseract-core-simd-lstm.wasm(.js) — the WASM recognizer (SIMD path)
 *   tesseract-core-lstm.wasm(.js)      — non-SIMD fallback, same directory
 *   eng.traineddata.gz                 — English language data
 * Without self-hosting, tesseract.js defaults every one of these to
 * cdn.jsdelivr.net, which is exactly the dependency this app has repeatedly
 * gone out of its way to avoid.
 */

import type { Worker as TesseractWorker } from 'tesseract.js';

let workerPromise: Promise<TesseractWorker> | null = null;

async function createSharedWorker(): Promise<TesseractWorker> {
  // MUST be an absolute URL, not a root-relative path. tesseract.js's default
  // `workerBlobURL: true` spawns the worker from a Blob whose body is literally
  // `importScripts("${workerPath}")` (src/worker/browser/spawnWorker.js) — and a
  // root-relative "/tesseract/worker.min.js" throws "The URL is invalid" from
  // inside that blob's script context (verified: this failed exactly that way
  // until switched to an absolute origin). Same fix lib/stroMotionDraft/
  // selfieSegmenter.ts already uses for MediaPipe's `solutionPath`, for the
  // identical reason.
  const assetDir = `${window.location.origin}/tesseract`;
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1 /* OEM.LSTM_ONLY */, {
    workerPath: `${assetDir}/worker.min.js`,
    // A directory, not a file: getCore.js appends the right filename itself
    // (SIMD vs non-SIMD) based on runtime feature detection — both are
    // self-hosted in the same directory so neither path touches a CDN.
    corePath: assetDir,
    langPath: assetDir,
    gzip: true,
    cacheMethod: 'none', // screenshots are one-off; no benefit to IndexedDB caching
  }).catch((e: unknown) => {
    // One-time diagnostic on init failure only — not per-recognition, so it
    // stays quiet across a normal 10-25-screenshot decode run.
    console.error('[tesseract] createWorker failed:', e);
    throw e;
  });
  return worker;
}

/**
 * The one tesseract worker this module hands out. Recognition is inherently
 * serial per worker (it's one WASM instance), so every caller shares this
 * promise rather than spinning up N workers for N regions — that would just
 * make N copies pay the ~1-2s WASM init cost concurrently for no speed gain.
 */
export function getSharedWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createSharedWorker().catch((e) => {
      // Do not cache a failed init: a transient WASM-compile hiccup or a
      // slow-loading trained-data fetch would otherwise poison every OCR call
      // for the rest of the session with the same stale error.
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** Warm the worker ahead of the first real recognition, so it isn't paid mid-upload. */
export function preloadTesseract(): void {
  if (typeof window === 'undefined') return;
  void getSharedWorker();
}

/**
 * Release the worker. Call when leaving the decoder — a live WASM worker with
 * loaded language data is a real memory cost to carry around the rest of the
 * session for a feature the coach may only use once per match.
 */
export async function disposeTesseractWorker(): Promise<void> {
  if (!workerPromise) return;
  const p = workerPromise;
  workerPromise = null;
  try {
    const worker = await p;
    await worker.terminate();
  } catch {
    /* already gone */
  }
}
