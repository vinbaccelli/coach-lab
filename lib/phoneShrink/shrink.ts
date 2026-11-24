'use client';

import { shrinkBitrate, type ShrinkTier } from '@/lib/phoneShrink/tier';

/** Read a video file's pixel size and length (metadata only, nothing is decoded). */
export async function probeVideo(file: File): Promise<{ w: number; h: number; sec: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error('metadata'));
      setTimeout(() => rej(new Error('timeout')), 8000);
    });
    return { w: v.videoWidth, h: v.videoHeight, sec: v.duration };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface ShrinkHandle { cancel: () => void }

/**
 * Re-encode `file` to H.264 / MP4 at w x h with the phone's own hardware encoder (WebCodecs, via
 * mediabunny). The MP4 has a proper seek index, so frame stepping stays exact. Returns null when it
 * cannot be done (no encoder, error, cancelled): the caller then opens the original file.
 */
export async function shrinkVideoFile(
  file: File,
  target: { w: number; h: number; tier: ShrinkTier },
  onProgress: (fraction: number) => void,
  handle: ShrinkHandle,
): Promise<File | null> {
  try {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
    const mb = await import('mediabunny');
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const out = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: out });
    const conversion = await mb.Conversion.init({
      input,
      output,
      video: { width: target.w, height: target.h, fit: 'fill', codec: 'avc', bitrate: shrinkBitrate(target.tier) },
    });
    if (!conversion.isValid) return null;
    handle.cancel = () => { void conversion.cancel(); };
    conversion.onProgress = (p) => onProgress(Math.max(0, Math.min(1, p)));
    await conversion.execute();
    if (!out.buffer) return null;
    const base = file.name.replace(/\.[^.]+$/, '') || 'video';
    return new File([out.buffer], `${base}-${target.h >= target.w ? target.w : target.h}p.mp4`, { type: 'video/mp4' });
  } catch {
    return null;
  }
}
