/**
 * Post-recording crop / trim export (Phase 3, Section 6).
 *
 * Editing happens ONLY at export time and is canvas-based — there is no live
 * cropping during capture and no browser-coordinate dependency:
 *   1. Load the recorded blob into a hidden <video>
 *   2. (trim) seek to the in-point
 *   3. Draw the cropped region of each frame into a canvas
 *   4. canvas.captureStream() -> MediaRecorder -> final blob
 *      (trim) stop at the out-point
 *   5. (best-effort) convert WebM -> MP4 for download
 *
 * `region` is in the recorded video's intrinsic pixel space; `trim` is in
 * seconds on the source timeline.
 *
 * CROP AND TRIM ARE ONE PASS. Running two passes would re-encode the recording
 * twice — double the wait and a second generation of compression loss — so both
 * edits are applied in this single render.
 */

import { webmFixDuration } from 'webm-fix-duration';
import { convertWebmToMp4ForScreenRecord } from '@/lib/ffmpegWebmToMp4';
import { scaledExportSize } from '@/lib/exportEstimate';
import { outputProgress } from '@/lib/exportOverlay';

export type ExportRegion = { x: number; y: number; w: number; h: number };
/** In/out points in seconds on the SOURCE timeline. */
export type TrimRange = { start: number; end: number };

export interface EditExportOptions {
  /** Omit (or null) to keep the full frame. */
  region?: ExportRegion | null;
  /** Omit (or null) to keep the whole clip. */
  trim?: TrimRange | null;
  onProgress?: (msg: string) => void;
  /**
   * The settings below are optional and used only by the Metrics export
   * (components/metrics/MetricsExportPanel.tsx). Omitted, the render is exactly
   * the Recording Hub's: full source size, 5 Mbps, crf 23 on MP4 conversion,
   * no cancel, no pausing.
   */
  /** Scale the output down so its height is at most this (aspect kept; never upscales). */
  maxHeight?: number | null;
  /** Recorder video bitrate (default 5 Mbps). Also caps the MP4 conversion when one is needed. */
  videoBitsPerSecond?: number;
  /** Abort → the render stops, nothing is returned but `{ ok: false, cancelled: true }`. */
  signal?: AbortSignal;
  /**
   * Pause the render (video + recorder) while the tab is hidden and resume when
   * it is visible again: hidden tabs stop requestAnimationFrame, so the frames
   * would otherwise be lost while the source keeps playing.
   */
  pauseWhenHidden?: boolean;
  /**
   * Fraction rendered so far (0..1), reported from the paint loop. With `holds`
   * it is on the OUTPUT timeline: (media seconds + hold seconds done) ÷ (range +
   * all holds), so it keeps moving while a hold stands still.
   */
  onRenderProgress?: (fraction: number) => void;
  /**
   * Draws on top of each video frame, right after it is drawn: `mediaTime` is
   * the source video's time, `ow`×`oh` the output size (Metrics export:
   * skeleton + drawings). `hold` is the index into `holds` while one is shown,
   * else null. Omitted, nothing else is drawn.
   */
  drawOverlay?: (ctx: CanvasRenderingContext2D, mediaTime: number, ow: number, oh: number, hold: number | null) => void;
  /**
   * Freeze points (Metrics export snapshot holds), in source seconds. At each
   * `at` the video is paused and seeked exactly to `at`, and that frame is drawn
   * on every paint for `seconds` (the recorder keeps receiving frames), then
   * playback continues. Audio is silent during a hold. Omitted or empty: the
   * render is exactly as before (the Recording Hub never passes any).
   */
  holds?: ReadonlyArray<{ at: number; seconds: number }>;
}

export type EditExportResult =
  | { ok: true; blob: Blob; ext: string }
  | { ok: false; error: string; cancelled?: true };

const CANCELLED: EditExportResult = { ok: false, error: 'Export cancelled.', cancelled: true };

/**
 * A hold's exact seek that has not reported 'seeked' by then is given up on:
 * the hold goes on with the frame the paused video shows, which is the first
 * frame painted at or after `at` — within one frame of it. (Fallback for
 * browsers that do not finish seeking a detached, hidden video — iOS Safari is
 * not verified; nothing is drawn over the canvas until a frame is decodable.)
 */
const HOLD_SEEK_TIMEOUT_MS = 300;

function even(n: number): number {
  const v = Math.max(0, Math.round(n));
  return v - (v % 2);
}

function pickMime(): string {
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return 'video/webm';
}

/**
 * Renders `srcBlob` with an optional crop region and/or trim range applied.
 * Both are optional: with neither, this is a straight re-encode.
 */
export async function exportEditedVideo(
  srcBlob: Blob,
  {
    region = null, trim = null, onProgress,
    maxHeight = null, videoBitsPerSecond, signal, pauseWhenHidden = false, onRenderProgress, drawOverlay, holds,
  }: EditExportOptions = {},
): Promise<EditExportResult> {
  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, error: 'Recording is not supported in this browser.' };
  }
  if (signal?.aborted) return CANCELLED;

  const url = URL.createObjectURL(srcBlob);
  // Holds only: the Web Audio route for the audio track (closed on every exit).
  let audioCtx: AudioContext | null = null;
  const closeAudio = () => { try { void audioCtx?.close(); } catch { /* noop */ } audioCtx = null; };
  const video = document.createElement('video');
  video.src = url;
  video.playsInline = true;
  video.muted = true; // muted so autoplay/play() is allowed; audio is taken from the stream

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not load the recording for export.'));
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    if (signal?.aborted) {
      URL.revokeObjectURL(url);
      return CANCELLED;
    }

    // Region defaults to the full frame, so a trim-only export needs no crop box.
    const src = region ?? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
    const cw = even(src.w);
    const ch = even(src.h);
    const cx = even(src.x);
    const cy = even(src.y);
    if (cw < 2 || ch < 2) {
      URL.revokeObjectURL(url);
      return { ok: false, error: region ? 'Crop region is too small.' : 'The recording has no video frames.' };
    }

    // Clamp the trim to the real clip. A MediaRecorder file can report a
    // non-finite duration, in which case only the in-point is trusted and the
    // render simply runs to the natural end.
    let inPoint = 0;
    let outPoint = Number.POSITIVE_INFINITY;
    if (trim) {
      const dur = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
      inPoint = Math.max(0, Math.min(trim.start, Number.isFinite(dur) ? dur : trim.start));
      outPoint = Math.max(inPoint + 0.1, Math.min(trim.end, dur));
      if (Number.isFinite(dur) && outPoint - inPoint < 0.1) {
        URL.revokeObjectURL(url);
        return { ok: false, error: 'Trimmed clip is too short.' };
      }
    }

    // Output size: the region itself unless `maxHeight` scales it down.
    const out = scaledExportSize(cw, ch, maxHeight);
    const ow = out.width;
    const oh = out.height;

    const canvas = document.createElement('canvas');
    canvas.width = ow;
    canvas.height = oh;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(url);
      return { ok: false, error: 'Canvas not available.' };
    }

    // Seek to the in-point BEFORE the recorder starts, so the trimmed head is
    // never encoded. Seeking a just-loaded element can resolve instantly or not
    // at all on a malformed file — time out rather than hang the export.
    if (inPoint > 0) {
      onProgress?.('Seeking…');
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        video.onseeked = done;
        setTimeout(done, 4000);
        signal?.addEventListener('abort', done, { once: true });
        try { video.currentTime = inPoint; } catch { done(); }
      });
      video.onseeked = null;
      if (signal?.aborted) {
        URL.revokeObjectURL(url);
        return CANCELLED;
      }
    }

    // Holds inside the range, in time order (`index` = position in `holds`).
    const holdList = (holds ?? [])
      .map((h, index) => ({ at: h.at, ms: h.seconds * 1000, index }))
      .filter((h) => Number.isFinite(h.at) && h.ms > 0 && h.at >= inPoint - 1e-3 && h.at < outPoint)
      .sort((a, b) => a.at - b.at || a.index - b.index);
    const totalHoldMs = holdList.reduce((sum, h) => sum + h.ms, 0);

    const canvasStream = (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(30);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    // Carry the recording's audio (mic/webcam) through, if any.
    try {
      const vAny = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      const srcStream = vAny.captureStream?.() ?? vAny.mozCaptureStream?.();
      const srcAudio = srcStream?.getAudioTracks() ?? [];
      // With holds: a paused element sends no audio at all, and the recorder
      // closes that gap — everything after a hold would play early by the
      // hold's length (measured: −2 s after two 2 s holds). Through Web Audio
      // the track runs on in real time: silence during a hold, in sync after.
      // Without holds the element's track goes in directly, as before.
      const holdAudio = holdList.length && srcAudio.length ? await realTimeAudio(srcAudio, signal) : null;
      if (holdAudio) { audioCtx = holdAudio.ctx; tracks.push(holdAudio.track); }
      else srcAudio.forEach((t) => tracks.push(t));
    } catch {
      /* audio optional */
    }

    const combined = new MediaStream(tracks);
    const mime = pickMime();

    let recorder: MediaRecorder;
    try {
      // Explicit audio bitrate: every crop/trim is a full re-encode of the audio
      // as well as the video, so leaving the allocation to the UA here quietly
      // added a second generation of loss on top of the capture.
      recorder = new MediaRecorder(combined, {
        mimeType: mime || undefined,
        videoBitsPerSecond: videoBitsPerSecond ?? 5_000_000,
        audioBitsPerSecond: 128_000,
      });
    } catch {
      closeAudio();
      URL.revokeObjectURL(url);
      return { ok: false, error: 'MediaRecorder could not be created.' };
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };

    let raf = 0;
    let reachedOutPoint: (() => void) | null = null;
    // Progress span: the trim range, else the clip (unknown length → no progress).
    const progressSpan = Number.isFinite(outPoint)
      ? outPoint - inPoint
      : (Number.isFinite(video.duration) ? video.duration - inPoint : 0);
    // Time spent paused in a hidden tab (pauseWhenHidden) — not part of the clip.
    let pausedMs = 0;
    let pausedAt = 0;

    let nextHold = 0;
    let holdDoneMs = 0;
    let hold: { k: number; startedAt: number; pausedMs0: number; ready: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;
    // Hold time shown so far: running time only (a hidden tab pauses it with the recorder).
    const holdElapsedMs = () => (hold
      ? Date.now() - hold.startedAt - (pausedMs - hold.pausedMs0) - (pausedAt ? Date.now() - pausedAt : 0)
      : 0);
    const startHold = (k: number) => {
      const h = holdList[k];
      try { video.pause(); } catch { /* noop */ }
      const st = { k, startedAt: Date.now(), pausedMs0: pausedMs, ready: false, timer: null as ReturnType<typeof setTimeout> | null };
      hold = st;
      // Until the exact frame is decoded nothing is drawn: the canvas keeps the last good frame.
      const onSeeked = () => { st.ready = true; if (st.timer) clearTimeout(st.timer); };
      video.addEventListener('seeked', onSeeked, { once: true });
      st.timer = setTimeout(() => { video.removeEventListener('seeked', onSeeked); st.ready = true; }, HOLD_SEEK_TIMEOUT_MS);
      try { video.currentTime = h.at; } catch { onSeeked(); }
    };
    const reportProgress = () => {
      if (!onRenderProgress || !(progressSpan > 0)) return;
      if (!holdList.length) { onRenderProgress((video.currentTime - inPoint) / progressSpan); return; }
      onRenderProgress(outputProgress(video.currentTime - inPoint, (holdDoneMs + holdElapsedMs()) / 1000, progressSpan, totalHoldMs / 1000));
    };
    const paint = (holdIndex: number | null) => {
      // Always the video's CURRENT frame: a slow frame is dropped, never caught up.
      if (video.readyState >= 2) {
        ctx.drawImage(video, cx, cy, cw, ch, 0, 0, ow, oh);
        if (drawOverlay) {
          try { drawOverlay(ctx, video.currentTime, ow, oh, holdIndex); } catch { /* the frame itself is already drawn */ }
        }
      }
    };
    const draw = () => {
      if (hold) {
        // Holding: the paused frame is drawn again on every paint so the
        // canvas stream keeps feeding the recorder; then playback continues.
        const h = holdList[hold.k];
        if (hold.ready) paint(h.index);
        reportProgress();
        if (holdElapsedMs() >= h.ms) {
          if (hold.timer) clearTimeout(hold.timer);
          holdDoneMs += h.ms;
          hold = null;
          nextHold++;
          void video.play().catch(() => {});
        }
        raf = requestAnimationFrame(draw);
        return;
      }
      if (nextHold < holdList.length && video.currentTime >= holdList[nextHold].at) {
        startHold(nextHold);
        reportProgress();
        raf = requestAnimationFrame(draw);
        return;
      }
      paint(null);
      reportProgress();
      // Out-point is checked on the paint loop (not `timeupdate`, which fires
      // only ~4x/second and would overshoot the cut by up to a quarter second).
      if (video.currentTime >= outPoint) {
        reachedOutPoint?.();
        return;
      }
      raf = requestAnimationFrame(draw);
    };

    onProgress?.(trim ? 'Rendering edit…' : 'Rendering crop…');
    const startedAt = Date.now();
    recorder.start(250);
    draw();
    // A hold at the in-point has already paused the video: it plays when the hold ends.
    if (!hold) await video.play().catch(() => {});

    let onVisibility: (() => void) | null = null;
    let guardTimer: ReturnType<typeof setTimeout> | null = null;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      reachedOutPoint = done;
      // The clip's end with a hold still to show (a last-frame hold the paint
      // loop had not reached): the loop holds it, seeking back, and the video
      // ends again after it.
      video.onended = () => { if (!hold && nextHold >= holdList.length) done(); };
      signal?.addEventListener('abort', done, { once: true });
      // Failsafe: stop if the video stalls past the length we expect to render
      // (the range plus every hold).
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      const spanS = Number.isFinite(outPoint) ? outPoint - inPoint : Math.max(0, dur - inPoint);
      const guardMs = spanS > 0 ? spanS * 1000 + 5000 + totalHoldMs : 0;
      if (!pauseWhenHidden) {
        if (guardMs > 0) setTimeout(done, guardMs);
        return;
      }
      // Same failsafe, counting only the time the render was running.
      const activeMs = () => Date.now() - startedAt - pausedMs - (pausedAt ? Date.now() - pausedAt : 0);
      const guard = () => {
        if (settled) return;
        if (guardMs > 0 && !pausedAt && activeMs() >= guardMs) { done(); return; }
        guardTimer = setTimeout(guard, 1000);
      };
      guardTimer = setTimeout(guard, 1000);
      onVisibility = () => {
        if (settled) return;
        if (document.visibilityState === 'hidden' && !pausedAt) {
          pausedAt = Date.now();
          try { video.pause(); } catch { /* noop */ }
          try { if (recorder.state === 'recording') recorder.pause(); } catch { /* noop */ }
        } else if (document.visibilityState === 'visible' && pausedAt) {
          pausedMs += Date.now() - pausedAt;
          pausedAt = 0;
          try { if (recorder.state === 'paused') recorder.resume(); } catch { /* noop */ }
          // During a hold the video stays paused; the paint loop plays it when the hold ends.
          if (!hold) void video.play().catch(() => {});
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(draw);
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      if (document.visibilityState === 'hidden') onVisibility();
    });
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
    if (guardTimer) clearTimeout(guardTimer);
    if (pausedAt) { pausedMs += Date.now() - pausedAt; pausedAt = 0; }

    cancelAnimationFrame(raf);
    const lastHold = hold as { timer: ReturnType<typeof setTimeout> | null } | null;
    if (lastHold?.timer) clearTimeout(lastHold.timer);
    try { video.pause(); } catch { /* noop */ }

    if (signal?.aborted) {
      try { recorder.stop(); } catch { /* noop */ }
      canvasStream.getTracks().forEach((t) => t.stop());
      closeAudio();
      URL.revokeObjectURL(url);
      return CANCELLED;
    }

    const duration = Date.now() - startedAt - pausedMs;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.requestData(); } catch { /* noop */ }
      try { recorder.stop(); } catch { resolve(); }
    });

    canvasStream.getTracks().forEach((t) => t.stop());
    closeAudio();
    URL.revokeObjectURL(url);

    let result = new Blob(chunks, { type: mime || 'video/webm' });
    if (result.size === 0) return { ok: false, error: 'Export produced an empty file.' };
    try {
      result = await webmFixDuration(result, duration, mime || 'video/webm');
    } catch { /* noop */ }

    if (/mp4/i.test(mime)) return { ok: true, blob: result, ext: 'mp4' };

    if (signal?.aborted) return CANCELLED;
    onProgress?.('Converting to MP4…');
    const conv = await convertWebmToMp4ForScreenRecord(
      result,
      videoBitsPerSecond !== undefined ? { videoBitsPerSecond } : undefined,
    );
    if (signal?.aborted) return CANCELLED;
    if (conv.ok) return { ok: true, blob: conv.blob, ext: 'mp4' };
    return { ok: false, error: 'Could not convert the edited recording to MP4.' };
  } catch (e) {
    closeAudio();
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

/**
 * The source's audio as a real-time Web Audio track: it keeps producing samples
 * (silence) while the source element is paused. Null when Web Audio is missing
 * or cannot start (no user activation) — the caller then uses the source track.
 */
async function realTimeAudio(srcAudio: MediaStreamTrack[], signal?: AbortSignal): Promise<{ ctx: AudioContext; track: MediaStreamTrack } | null> {
  const AC = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AC();
    if (ctx.state !== 'running') {
      // resume() can wait forever without a user gesture: give it half a second.
      await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
    }
    const track = ctx.state === 'running' && !signal?.aborted ? (() => {
      const dest = ctx!.createMediaStreamDestination();
      ctx!.createMediaStreamSource(new MediaStream(srcAudio)).connect(dest);
      return dest.stream.getAudioTracks()[0] ?? null;
    })() : null;
    if (track) return { ctx, track };
  } catch { /* fall through */ }
  try { void ctx?.close(); } catch { /* noop */ }
  return null;
}

/**
 * Crop-only export. Unchanged signature and behaviour — kept so existing
 * callers (app/analysis/page.tsx) are untouched; it now delegates to the
 * crop+trim renderer rather than carrying its own copy of the pipeline.
 */
export async function exportCroppedVideo(
  srcBlob: Blob,
  region: ExportRegion,
  onProgress?: (msg: string) => void,
): Promise<EditExportResult> {
  return exportEditedVideo(srcBlob, { region, onProgress });
}
