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

export type ExportRegion = { x: number; y: number; w: number; h: number };
/** In/out points in seconds on the SOURCE timeline. */
export type TrimRange = { start: number; end: number };

export interface EditExportOptions {
  /** Omit (or null) to keep the full frame. */
  region?: ExportRegion | null;
  /** Omit (or null) to keep the whole clip. */
  trim?: TrimRange | null;
  onProgress?: (msg: string) => void;
}

export type EditExportResult =
  | { ok: true; blob: Blob; ext: string }
  | { ok: false; error: string };

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
  { region = null, trim = null, onProgress }: EditExportOptions = {},
): Promise<EditExportResult> {
  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, error: 'Recording is not supported in this browser.' };
  }

  const url = URL.createObjectURL(srcBlob);
  const video = document.createElement('video');
  video.src = url;
  video.playsInline = true;
  video.muted = true; // muted so autoplay/play() is allowed; audio is taken from the stream

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not load the recording for export.'));
    });

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

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
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
        try { video.currentTime = inPoint; } catch { done(); }
      });
      video.onseeked = null;
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
      recorder = new MediaRecorder(combined, { mimeType: mime || undefined, videoBitsPerSecond: 5_000_000 });
    } catch {
      URL.revokeObjectURL(url);
      return { ok: false, error: 'MediaRecorder could not be created.' };
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };

    let raf = 0;
    let reachedOutPoint: (() => void) | null = null;
    const draw = () => {
      if (video.readyState >= 2) ctx.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);
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

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      reachedOutPoint = done;
      video.onended = done;
      // Failsafe: stop if the video stalls past the length we expect to render.
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      const spanS = Number.isFinite(outPoint) ? outPoint - inPoint : Math.max(0, dur - inPoint);
      const guardMs = spanS * 1000 + 5000;
      if (guardMs > 5000) setTimeout(done, guardMs);
    });

    cancelAnimationFrame(raf);
    try { video.pause(); } catch { /* noop */ }

    const duration = Date.now() - startedAt;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.requestData(); } catch { /* noop */ }
      try { recorder.stop(); } catch { resolve(); }
    });

    canvasStream.getTracks().forEach((t) => t.stop());
    URL.revokeObjectURL(url);

    let out = new Blob(chunks, { type: mime || 'video/webm' });
    if (out.size === 0) return { ok: false, error: 'Export produced an empty file.' };
    try {
      out = await webmFixDuration(out, duration, mime || 'video/webm');
    } catch { /* noop */ }

    if (/mp4/i.test(mime)) return { ok: true, blob: out, ext: 'mp4' };

    onProgress?.('Converting to MP4…');
    const conv = await convertWebmToMp4ForScreenRecord(out);
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
