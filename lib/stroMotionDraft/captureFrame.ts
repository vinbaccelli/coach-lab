'use client';

const DECODABLE_TIMEOUT_MS = 5000;

/**
 * TEMP-DEBUG-VIDEOEL — makes the timeout self-diagnosing: says WHICH element the
 * capture was handed, by index among the document's <video> elements, alongside
 * every other one. `index=-1` means the target is detached from the document (a
 * stale ref); a healthy target is the element carrying the analysed source.
 * Deliberately inlined rather than imported from lib/tempVideoElProbe.ts so this
 * adds no new untracked build dependency. Remove with the grep tag once the
 * wrong-element question is settled.
 */
function describeTargetVideo(video: HTMLVideoElement, timeoutMs: number): string {
  const state = (v: HTMLVideoElement) =>
    `rs=${v.readyState} ${v.videoWidth}x${v.videoHeight} src=${v.currentSrc ? 'YES' : 'no'}`;
  let census = '';
  if (typeof document !== 'undefined') {
    const all = Array.from(document.querySelectorAll('video'));
    census =
      ` | target index=${all.indexOf(video)} of ${all.length}; ` +
      all.map((v, i) => `[${i}]${v === video ? '<==TARGET' : ''} ${state(v)}`).join(' ');
  }
  return (
    `video never became decodable within ${timeoutMs}ms (${state(video)}, ` +
    `connected=${video.isConnected})${census}`
  );
}

/**
 * Resolve once the element actually holds a decodable frame.
 *
 * createImageBitmap(video) throws the cryptic "The image source is not usable"
 * whenever the element has no decoded frame yet — readyState < HAVE_CURRENT_DATA,
 * or videoWidth/videoHeight still 0x0. Entering StroMotion captures immediately,
 * which is exactly when the element can still be loading, so the capture has to
 * gate on readiness rather than assume it.
 */
export function waitForDecodableFrame(
  video: HTMLVideoElement,
  timeoutMs = DECODABLE_TIMEOUT_MS,
): Promise<void> {
  const isReady = () =>
    video.readyState >= 2 /* HAVE_CURRENT_DATA */ &&
    video.videoWidth > 0 &&
    video.videoHeight > 0;

  if (isReady()) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let pollId = 0;
    let timeoutId = 0;

    const cleanup = () => {
      video.removeEventListener('loadeddata', onProgress);
      video.removeEventListener('canplay', onProgress);
      video.removeEventListener('loadedmetadata', onProgress);
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
    };

    const onProgress = () => {
      if (settled || !isReady()) return;
      settled = true;
      cleanup();
      resolve();
    };

    video.addEventListener('loadeddata', onProgress);
    video.addEventListener('canplay', onProgress);
    video.addEventListener('loadedmetadata', onProgress);

    // Safety net: readiness can arrive without a further event firing (e.g. the
    // element was already decoding when the listeners were attached).
    pollId = window.setInterval(onProgress, 50);

    // Recovery for the measured stuck state: the element still carries a source,
    // but sits at NETWORK_EMPTY with readyState 0 — i.e. the resource selection
    // algorithm is not running, so no amount of waiting will ever make it ready.
    // A single load() restarts resource selection and the listeners above pick up
    // the result. Deliberately narrow:
    //   - networkState must be NETWORK_EMPTY (0). A loading/idle element is
    //     progressing on its own; calling load() there would abort real work.
    //   - a source must still be present. If the src attribute was stripped (what
    //     cleanupVideoEl does), load() cannot recover it — we leave it alone and
    //     let the timeout report src=no, so a genuine teardown stays diagnosable
    //     instead of being masked by this nudge.
    if (
      video.networkState === 0 /* NETWORK_EMPTY */ &&
      video.readyState === 0 &&
      (video.currentSrc || video.getAttribute('src'))
    ) {
      try { video.load(); } catch { /* element torn down mid-flight */ }
    }

    timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Frame capture aborted: ${describeTargetVideo(video, timeoutMs)}`));
    }, timeoutMs);
  });
}

/**
 * LOW-LEVEL PRIMITIVE — captures from EXACTLY the element handed to it, pausing
 * and seeking that element. Do not call this with the coach's visible video: it
 * drags the playhead and fights the app's session/mode state for one shared
 * resource. Callers want `captureVideoFrameAtTime` (captureSource.ts), which
 * routes the capture onto a dedicated element and then calls this.
 *
 * Renamed from `captureVideoFrameAtTime` in Phase 2 so the isolating wrapper
 * could take that name — every existing call site keeps capturing through the
 * same public name and is now isolated automatically.
 */
export async function captureFrameFromElement(
  video: HTMLVideoElement,
  timeSec: number,
): Promise<ImageBitmap> {
  // Gate before pausing/seeking: duration is NaN and 'seeked' never fires while
  // the element is still at readyState 0.
  await waitForDecodableFrame(video);

  const wasPlaying = !video.paused;
  video.pause();

  const target = Math.max(
    0,
    Math.min(timeSec, Number.isFinite(video.duration) ? Math.max(0, video.duration - 1e-6) : timeSec),
  );

  await new Promise<void>((resolve) => {
    if (Math.abs(video.currentTime - target) < 0.001) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = target;
    window.setTimeout(resolve, 2500);
  });

  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  // The seek promise above resolves on its own 2500ms timeout even if the seek
  // never completed, so re-confirm readiness here. No-op when already ready.
  await waitForDecodableFrame(video);

  const bitmap = await normalizedFrameBitmap(video);
  if (wasPlaying) void video.play().catch(() => {});
  return bitmap;
}

/**
 * Grab the frame, GUARANTEEING it matches `video.videoWidth × videoHeight`.
 *
 * The pipeline carries two independent notions of "the frame's size":
 *   - masks are allocated at `video.videoWidth/videoHeight` (proposeFrameMask),
 *   - the picture is whatever `createImageBitmap(video)` hands back.
 * Nothing reconciled them. `videoWidth/videoHeight` are the element's DISPLAY
 * dimensions — already corrected for rotation metadata and non-square pixels —
 * whereas `createImageBitmap(video)` can, depending on browser and decode path,
 * return the raw STORED frame with that correction not applied. A phone clip shot
 * in portrait is the classic case: the element reports 1080×1920 while the decoded
 * frame is 1920×1080.
 *
 * That mismatch does not throw — the two have identical pixel counts — so the mask
 * is simply indexed at the wrong stride and the picture is drawn at the wrong
 * proportions, which is precisely "correct in the main view, wrong in the editor".
 *
 * The fast path is unchanged: when the bitmap already agrees, it is returned as-is
 * and this costs one comparison. Only on disagreement do we re-grab through a
 * canvas — and we re-draw from the ELEMENT, not from the mismatched bitmap,
 * because `drawImage(video, …)` applies the same display correction the element
 * uses on screen. Rescaling the bad bitmap would squash it rather than fix it.
 */
async function normalizedFrameBitmap(video: HTMLVideoElement): Promise<ImageBitmap> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const bitmap = await createImageBitmap(video);
  if (!w || !h || (bitmap.width === w && bitmap.height === h)) return bitmap;

  console.warn(
    `[captureFrame] decoded frame ${bitmap.width}x${bitmap.height} disagrees with ` +
      `element ${w}x${h} — re-grabbing via canvas so masks and picture share one size.`,
  );
  try { bitmap.close(); } catch { /* already released */ }

  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d');
  if (!ctx) return createImageBitmap(video);
  ctx.drawImage(video, 0, 0, w, h);
  return createImageBitmap(scratch);
}
