'use client';

/**
 * Motion Layer video, FIXED frame rate and a chosen size.
 *
 * The old export filmed the on-screen canvas with MediaRecorder: the output was the size of the phone's pane (660x1332 on an iPhone,
 * black bars included) and every frame was stamped with the real time its step took (about 140 ms), so a 24 fps plan came out at about
 * 7 fps. Here each step is drawn on an off-screen canvas of the video's own size and handed to the hardware encoder with an exact
 * timestamp (step / fps), so the file is the size and speed that was asked for however slowly the steps run.
 *
 * Returns null whenever the device cannot do it (no WebCodecs, no encodable codec): the caller then uses the old recorder, unchanged.
 */

/** Long-edge ceiling of a Motion Layer video: 1080p. */
export const EXPORT_MAX_LONG_EDGE = 1920;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The output size: the video's own size, shrunk (never enlarged) so its long edge is at most `maxLong`, both sides even. */
export function exportSize(vw: number, vh: number, maxLong: number = EXPORT_MAX_LONG_EDGE): { w: number; h: number } {
  const long = Math.max(vw, vh);
  const s = long > maxLong ? maxLong / long : 1;
  return { w: even(vw * s), h: even(vh * s) };
}

/** About 8 Mbit/s at 1080p, in proportion to the area, never below 1.5. */
export function exportBitrate(w: number, h: number): number {
  return Math.max(1_500_000, Math.round(8_000_000 * ((w * h) / (1920 * 1080))));
}

export interface FixedFpsEncoder {
  codec: string;
  /** Encodes the canvas as the next frame (step index = frames so far). */
  addFrame(): Promise<void>;
  /** Keeps the last frame on screen for `seconds` more (the final hold). */
  hold(seconds: number): Promise<void>;
  finish(): Promise<Blob>;
  cancel(): Promise<void>;
}

export async function createFixedFpsEncoder(
  canvas: HTMLCanvasElement,
  opts: { fps: number },
): Promise<FixedFpsEncoder | null> {
  try {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
    const mb = await import('mediabunny');
    const w = canvas.width, h = canvas.height;
    const bitrate = exportBitrate(w, h);
    const codec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9'], { width: w, height: h, bitrate });
    if (!codec) return null;
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target });
    const source = new mb.CanvasSource(canvas, { codec, bitrate });
    output.addVideoTrack(source, { frameRate: opts.fps });
    await output.start();
    const dt = 1 / opts.fps;
    let frames = 0;
    let pendingHold = 0;
    return {
      codec,
      async addFrame() {
        await source.add(frames * dt, dt);
        frames++;
      },
      async hold(seconds: number) {
        pendingHold += Math.max(0, seconds);
      },
      async finish() {
        // The hold is one more frame of the same picture, lasting `pendingHold` seconds.
        if (pendingHold > 0 && frames > 0) { await source.add(frames * dt, pendingHold); frames++; }
        await output.finalize();
        if (!target.buffer) throw new Error('empty output');
        return new Blob([target.buffer], { type: 'video/mp4' });
      },
      async cancel() { try { await output.cancel(); } catch { /* already closed */ } },
    };
  } catch {
    return null;
  }
}
