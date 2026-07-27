'use client';

/**
 * Dedicated capture element — a <video> that the capture path owns exclusively.
 *
 * WHY THIS EXISTS
 * The StroMotion capture pipeline historically grabbed frames from the SAME
 * <video> the coach is watching (page.tsx `videoRef`). That element is managed by
 * the app's session/mode state, which can pause it, seek it, strip its src and
 * call load() on it (`cleanupVideoEl`) — so capture and playback fight over one
 * shared resource, and capture also drags the coach's playhead around: building a
 * background plate alone performs 11 seeks (backgroundPlate.ts PLATE_SAMPLES).
 *
 * The element created here is:
 *   - built imperatively via document.createElement — it never appears in React's
 *     render tree, so no reconciliation, key change, remount or effect cleanup can
 *     touch it;
 *   - referenced by nothing else in the app — `cleanupVideoEl`, `resetSession`,
 *     `removeVideoA` and `applyVideoStream` only ever address videoRef/videoRefB;
 *   - disposed explicitly by whoever created it.
 *
 * PHASE 2: this module is now WIRED IN. `captureVideoFrameAtTime` below is the
 * public capture entry point for the whole StroMotion pipeline — it resolves a
 * dedicated element mirroring the caller's video and captures from that. The
 * caller's element is only ever READ (its src / crossOrigin), never paused,
 * seeked or loaded.
 */

import { captureFrameFromElement, waitForDecodableFrame } from '@/lib/stroMotionDraft/captureFrame';

export interface CaptureSource {
  /** The private element. Exposed for diagnostics; do not hand it to app state. */
  readonly element: HTMLVideoElement;
  /** Resolve once the private element holds a decodable frame. */
  ready(timeoutMs?: number): Promise<void>;
  /** Seek to `timeSec` and grab that frame. */
  capture(timeSec: number): Promise<ImageBitmap>;
  /** Tear down the element and release any URL this source minted itself. */
  dispose(): void;
}

/**
 * Hidden but STILL IN THE DOCUMENT. WebKit is unreliable about decoding media
 * elements that are detached, and `display:none` can suppress decoding in some
 * engines — so we use the same offscreen-1x1-transparent trick the app already
 * uses for its webcam decoder (page.tsx webcamVideoRef).
 */
function applyHiddenStyle(el: HTMLVideoElement): void {
  el.style.position = 'absolute';
  el.style.opacity = '0';
  el.style.width = '1px';
  el.style.height = '1px';
  el.style.top = '-9999px';
  el.style.left = '-9999px';
  el.style.pointerEvents = 'none';
}

export interface CaptureSourceOptions {
  /**
   * Mirror the main element's rule exactly (page.tsx sets 'anonymous' for /api/
   * proxied sources). Getting this wrong taints the canvas, and the failure only
   * surfaces later as a SecurityError inside getImageData in backgroundPlate /
   * proposeFrameMask — not at capture time.
   */
  crossOrigin?: string | null;
  /** When true, dispose() revokes `src` (used by the from-blob constructor). */
  ownsUrl?: boolean;
}

export function createCaptureSource(src: string, opts: CaptureSourceOptions = {}): CaptureSource {
  if (typeof document === 'undefined') {
    throw new Error('createCaptureSource requires a browser document');
  }

  const el = document.createElement('video');
  // Set crossOrigin BEFORE src — after the resource selection algorithm starts it
  // has no effect on the already-chosen resource.
  if (opts.crossOrigin) el.crossOrigin = opts.crossOrigin;
  el.muted = true;
  el.defaultMuted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.setAttribute('aria-hidden', 'true');
  applyHiddenStyle(el);

  document.body.appendChild(el);
  el.src = src;
  el.load();

  let disposed = false;

  return {
    element: el,

    ready(timeoutMs?: number) {
      if (disposed) return Promise.reject(new Error('capture source disposed'));
      return waitForDecodableFrame(el, timeoutMs);
    },

    capture(timeSec: number) {
      if (disposed) return Promise.reject(new Error('capture source disposed'));
      // Same capture logic as the shared path — only the element differs. Pausing
      // and seeking here cannot disturb playback, because nothing renders this el.
      return captureFrameFromElement(el, timeSec);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      try { el.pause(); } catch { /* already torn down */ }
      try { el.removeAttribute('src'); } catch { /* ignore */ }
      try { el.load(); } catch { /* ignore */ }
      try { el.remove(); } catch { /* ignore */ }
      if (opts.ownsUrl) {
        try { URL.revokeObjectURL(src); } catch { /* ignore */ }
      }
    },
  };
}

/**
 * Revocation-proof variant: mints a PRIVATE object URL from the underlying blob.
 *
 * Sharing the main video's blob URL works right up until the app revokes it
 * (`revokeBlobUrl` runs on session reset, remove-video and re-upload) — at which
 * point a capture element still loading that URL dies with NETWORK_NO_SOURCE. A
 * source minted here is immune, because only dispose() revokes it.
 */
export function createCaptureSourceFromBlob(blob: Blob): CaptureSource {
  return createCaptureSource(URL.createObjectURL(blob), { ownsUrl: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — the registry, and the capture entry point the pipeline actually calls.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * First capture on a freshly-minted mirror pays the load; 5s (the
 * waitForDecodableFrame default) is sized for an element that is ALREADY
 * loading, which the mirror is not. Every later capture hits the ready path and
 * returns immediately, so a generous first-load budget costs nothing.
 */
const MIRROR_READY_TIMEOUT_MS = 15000;

/** Two: the analysis surface can hold a second video (videoRefB) side by side. */
const MAX_MIRRORS = 2;

interface Mirror {
  src: string;
  crossOrigin: string | null;
  source: CaptureSource;
}

/** Insertion-ordered; the oldest entry is evicted past MAX_MIRRORS. */
const mirrors = new Map<string, Mirror>();

/**
 * Serializes EVERY capture. The mirror is a single element shared by all capture
 * paths, and capture pauses + seeks it — so two overlapping captures would seek
 * the same element out from under each other and each get the other's frame.
 * (The old shared-element path had the same race; it just also had the coach's
 * video to fight with.) Real captures are already sequential within a caller —
 * backgroundPlate's 11 samples, exportDraft's per-frame loop — but page.tsx's
 * end-plate effect and syncStroDraft can fire concurrently, so the queue is load
 * bearing, not belt-and-braces.
 */
let captureQueue: Promise<unknown> = Promise.resolve();

/** The URL the element is actually playing, or null for srcObject/MediaStream. */
function resolveSrc(video: HTMLVideoElement): string | null {
  return video.currentSrc || video.getAttribute('src') || null;
}

function mirrorFor(video: HTMLVideoElement): Mirror | null {
  const src = resolveSrc(video);
  if (!src) return null;

  const crossOrigin = video.crossOrigin ?? null;
  const existing = mirrors.get(src);
  if (existing) {
    if (existing.crossOrigin === crossOrigin) return existing;
    // crossOrigin decided the resource fetch; it cannot be changed after the
    // fact, so the mirror has to be rebuilt or the canvas silently taints.
    dropMirror(src);
  }

  const mirror: Mirror = { src, crossOrigin, source: createCaptureSource(src, { crossOrigin }) };
  mirrors.set(src, mirror);
  while (mirrors.size > MAX_MIRRORS) {
    const oldest = mirrors.keys().next().value as string | undefined;
    if (oldest === undefined || oldest === src) break;
    dropMirror(oldest);
  }
  return mirror;
}

function dropMirror(src: string): void {
  const held = mirrors.get(src);
  if (!held) return;
  mirrors.delete(src);
  held.source.dispose();
}

/** Release every mirror. Safe to call at any time; the next capture rebuilds. */
export function disposeCaptureSources(): void {
  for (const src of Array.from(mirrors.keys())) dropMirror(src);
}

async function captureIsolated(video: HTMLVideoElement, timeSec: number): Promise<ImageBitmap> {
  const mirror = mirrorFor(video);

  // No mirrorable source — a MediaStream (webcam) carries no URL to hand a second
  // element. Capture direct, exactly as before Phase 2. StroMotion itself is gated
  // to html5 sources (page.tsx `stroMotionHtml5Only`), so this is the live-camera
  // path, not the StroMotion one.
  if (!mirror) return captureFrameFromElement(video, timeSec);

  try {
    await mirror.source.ready(MIRROR_READY_TIMEOUT_MS);
    return await mirror.source.capture(timeSec);
  } catch (err) {
    // Deliberately NO fallback to `video`: capturing from the coach's element is
    // the bug this replaces, and a silent fallback would resurrect it under load
    // while looking like it worked. Drop the mirror so the next attempt builds a
    // fresh element, and let the caller see the real failure.
    dropMirror(mirror.src);
    throw err;
  }
}

/**
 * Capture the frame at `timeSec` WITHOUT touching `video`.
 *
 * `video` is read only — its src and crossOrigin are used to resolve a dedicated
 * mirror element, and the seek/pause/decode all happen on that mirror. The
 * coach's playhead, play state and readyState are unaffected.
 */
export function captureVideoFrameAtTime(
  video: HTMLVideoElement,
  timeSec: number,
): Promise<ImageBitmap> {
  const run = captureQueue.then(
    () => captureIsolated(video, timeSec),
    () => captureIsolated(video, timeSec), // a failed predecessor must not block the queue
  );
  captureQueue = run.then(() => {}, () => {});
  return run;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMP-DEBUG-CAPTURESOURCE — Phase 1 isolation harness.
// Proves the dedicated element can load the current source and grab a real frame
// WITHOUT going through the StroMotion flow, and proves the visible video is not
// disturbed while it happens. Remove this block (grep the tag) once Phase 2 lands.
// ─────────────────────────────────────────────────────────────────────────────

interface VideoSnapshot {
  readyState: number;
  networkState: number;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
  paused: boolean;
  hasSrc: boolean;
}

function snapshot(v: HTMLVideoElement): VideoSnapshot {
  return {
    readyState: v.readyState,
    networkState: v.networkState,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
    currentTime: v.currentTime,
    paused: v.paused,
    hasSrc: !!(v.currentSrc || v.getAttribute('src')),
  };
}

/** The visible decoder: the loaded element carrying the analysed source. */
function findMainVideo(): HTMLVideoElement | null {
  const all = Array.from(document.querySelectorAll('video'));
  const loaded = all.filter((v) => (v.currentSrc || v.getAttribute('src')) && v.videoWidth > 0);
  if (!loaded.length) return null;
  return loaded.reduce((best, v) => (v.videoWidth * v.videoHeight > best.videoWidth * best.videoHeight ? v : best));
}

async function runCaptureSourceTest(timeSec?: number) {
  const main = findMainVideo();
  if (!main) {
    console.error('[CAPTURESOURCE-TEST] No loaded <video> found. Upload a video first.');
    return { ok: false, reason: 'no-loaded-video' as const };
  }

  const src = main.currentSrc || main.getAttribute('src')!;
  const before = snapshot(main);
  const target = timeSec ?? main.currentTime ?? 0;
  console.log('[CAPTURESOURCE-TEST] main BEFORE:', before, 'src:', src.slice(0, 80));

  const source = createCaptureSource(src, { crossOrigin: main.crossOrigin });
  const started = performance.now();
  let ok = false;
  let error: string | null = null;
  let frame: { width: number; height: number } | null = null;
  let previewDataUrl: string | null = null;

  try {
    await source.ready();
    console.log('[CAPTURESOURCE-TEST] dedicated element READY:', snapshot(source.element));

    const bitmap = await source.capture(target);
    frame = { width: bitmap.width, height: bitmap.height };

    // Paint it so a BLACK/empty frame is visibly distinguishable from a real one.
    const cnv = document.createElement('canvas');
    cnv.width = Math.min(320, bitmap.width);
    cnv.height = Math.round((cnv.width / bitmap.width) * bitmap.height);
    const ctx = cnv.getContext('2d');
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, cnv.width, cnv.height);
      previewDataUrl = cnv.toDataURL('image/png');
    }
    bitmap.close();
    ok = true;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error('[CAPTURESOURCE-TEST] capture FAILED:', error);
  } finally {
    source.dispose();
  }

  const after = snapshot(main);
  const disturbed =
    before.readyState !== after.readyState ||
    before.networkState !== after.networkState ||
    before.videoWidth !== after.videoWidth ||
    before.paused !== after.paused ||
    Math.abs(before.currentTime - after.currentTime) > 0.05;

  console.log('[CAPTURESOURCE-TEST] main AFTER:', after);
  console.log(
    `[CAPTURESOURCE-TEST] RESULT ok=${ok} elapsed=${Math.round(performance.now() - started)}ms ` +
      `frame=${frame ? `${frame.width}x${frame.height}` : 'none'} mainDisturbed=${disturbed}`,
  );
  if (disturbed) console.warn('[CAPTURESOURCE-TEST] main video CHANGED during capture — see BEFORE/AFTER above.');
  if (previewDataUrl) console.log('[CAPTURESOURCE-TEST] preview (paste in a new tab to view):', previewDataUrl);

  return { ok, error, frame, mainDisturbed: disturbed, before, after, previewDataUrl };
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__stroCaptureTest = runCaptureSourceTest;
}
