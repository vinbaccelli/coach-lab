/**
 * Post-recording crop export (Phase 3, Section 6).
 *
 * Cropping happens ONLY at export time and is canvas-based — there is no live
 * cropping during capture and no browser-coordinate dependency:
 *   1. Load the recorded blob into a hidden <video>
 *   2. Draw the cropped region of each frame into a canvas
 *   3. canvas.captureStream() -> MediaRecorder -> final blob
 *   4. (best-effort) convert WebM -> MP4 for download
 *
 * `region` is in the recorded video's intrinsic pixel space.
 */

import { webmFixDuration } from 'webm-fix-duration';
import { convertWebmToMp4ForScreenRecord } from '@/lib/ffmpegWebmToMp4';

export type ExportRegion = { x: number; y: number; w: number; h: number };

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

export async function exportCroppedVideo(
  srcBlob: Blob,
  region: ExportRegion,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true; blob: Blob; ext: string } | { ok: false; error: string }> {
  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, error: 'Recording is not supported in this browser.' };
  }

  const cw = even(region.w);
  const ch = even(region.h);
  const cx = even(region.x);
  const cy = even(region.y);
  if (cw < 2 || ch < 2) return { ok: false, error: 'Crop region is too small.' };

  const url = URL.createObjectURL(srcBlob);
  const video = document.createElement('video');
  video.src = url;
  video.playsInline = true;
  video.muted = true; // muted so autoplay/play() is allowed; audio is taken from the stream

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not load the recording for cropping.'));
    });

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(url);
      return { ok: false, error: 'Canvas not available.' };
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
    const draw = () => {
      if (video.readyState >= 2) ctx.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);
      raf = requestAnimationFrame(draw);
    };

    onProgress?.('Rendering crop…');
    const startedAt = Date.now();
    recorder.start(250);
    draw();
    await video.play().catch(() => {});

    await new Promise<void>((resolve) => {
      video.onended = () => resolve();
      // Failsafe: stop if the video stalls past its duration.
      const guardMs = (Number.isFinite(video.duration) ? video.duration * 1000 : 0) + 5000;
      if (guardMs > 5000) setTimeout(resolve, guardMs);
    });

    cancelAnimationFrame(raf);

    const duration = Date.now() - startedAt;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.requestData(); } catch { /* noop */ }
      try { recorder.stop(); } catch { resolve(); }
    });

    canvasStream.getTracks().forEach((t) => t.stop());
    URL.revokeObjectURL(url);

    let out = new Blob(chunks, { type: mime || 'video/webm' });
    if (out.size === 0) return { ok: false, error: 'Crop produced an empty file.' };
    try {
      out = await webmFixDuration(out, duration, mime || 'video/webm');
    } catch { /* noop */ }

    if (/mp4/i.test(mime)) return { ok: true, blob: out, ext: 'mp4' };

    onProgress?.('Converting to MP4…');
    const conv = await convertWebmToMp4ForScreenRecord(out);
    if (conv.ok) return { ok: true, blob: conv.blob, ext: 'mp4' };
    return { ok: false, error: 'Could not convert cropped recording to MP4.' };
  } catch (e) {
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
    return { ok: false, error: e instanceof Error ? e.message : 'Crop export failed.' };
  }
}
