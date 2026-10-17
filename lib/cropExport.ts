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
  /** Fraction of the range rendered so far (0..1), reported from the paint loop. */
  onRenderProgress?: (fraction: number) => void;
  /**
   * Draws on top of each video frame, right after it is drawn: `mediaTime` is
   * the source video's time, `ow`×`oh` the output size (Metrics export:
   * skeleton + drawings). Omitted, nothing else is drawn.
   */
  drawOverlay?: (ctx: CanvasRenderingContext2D, mediaTime: number, ow: number, oh: number) => void;
}

export type EditExportResult =
  | { ok: true; blob: Blob; ext: string }
  | { ok: false; error: string; cancelled?: true };

const CANCELLED: EditExportResult = { ok: false, error: 'Export cancelled.', cancelled: true };

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
    maxHeight = null, videoBitsPerSecond, signal, pauseWhenHidden = false, onRenderProgress, drawOverlay,
  }: EditExportOptions = {},
): Promise<EditExportResult> {
  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, error: 'Recording is not supported in this browser.' };
  }
  if (signal?.aborted) return CANCELLED;

  const url = URL.createObjectURL(srcBlob);
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

    const canvasStream = (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(30);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    // Carry the recording's audio (mic/webcam) through, if any.
    try {
      const vAny = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      const srcStream = vAny.captureStream?.() ?? vAny.mozCaptureStream?.();
      srcStream?.getAudioTracks().forEach((t) => tracks.push(t));
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
    const draw = () => {
      // Always the video's CURRENT frame: a slow frame is dropped, never caught up.
      if (video.readyState >= 2) {
        ctx.drawImage(video, cx, cy, cw, ch, 0, 0, ow, oh);
        if (drawOverlay) {
          try { drawOverlay(ctx, video.currentTime, ow, oh); } catch { /* the frame itself is already drawn */ }
        }
      }
      if (onRenderProgress && progressSpan > 0) onRenderProgress((video.currentTime - inPoint) / progressSpan);
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
    await video.play().catch(() => {});

    // Time spent paused in a hidden tab (pauseWhenHidden) — not part of the clip.
    let pausedMs = 0;
    let pausedAt = 0;
    let onVisibility: (() => void) | null = null;
    let guardTimer: ReturnType<typeof setTimeout> | null = null;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      reachedOutPoint = done;
      video.onended = done;
      signal?.addEventListener('abort', done, { once: true });
      // Failsafe: stop if the video stalls past the length we expect to render.
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      const spanS = Number.isFinite(outPoint) ? outPoint - inPoint : Math.max(0, dur - inPoint);
      const guardMs = spanS * 1000 + 5000;
      if (!pauseWhenHidden) {
        if (guardMs > 5000) setTimeout(done, guardMs);
        return;
      }
      // Same failsafe, counting only the time the render was running.
      const activeMs = () => Date.now() - startedAt - pausedMs - (pausedAt ? Date.now() - pausedAt : 0);
      const guard = () => {
        if (settled) return;
        if (guardMs > 5000 && !pausedAt && activeMs() >= guardMs) { done(); return; }
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
          void video.play().catch(() => {});
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
    try { video.pause(); } catch { /* noop */ }

    if (signal?.aborted) {
      try { recorder.stop(); } catch { /* noop */ }
      canvasStream.getTracks().forEach((t) => t.stop());
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
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
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
