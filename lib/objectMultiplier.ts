'use client';

export interface MultiplierFrame {
  imageData: ImageBitmap;
  timestamp: number;
  region: { x: number; y: number; w: number; h: number };
}

const FPS = 10;
const FRAME_DT = 1 / FPS;

function colorDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/**
 * Lightweight background suppression from border colour — yields a premultiplied-style
 * cutout without blocking the UI (chunked on the main thread via await between frames).
 */
async function matteRacketFrame(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const w = bitmap.width;
  const h = bitmap.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    const copy = await createImageBitmap(bitmap);
    return copy;
  }
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
  let rs = 0;
  let gs = 0;
  let bs = 0;
  let n = 0;
  const sample = (x: number, y: number) => {
    const i = (Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))) * 4;
    rs += data[i];
    gs += data[i + 1];
    bs += data[i + 2];
    n++;
  };
  const step = Math.max(1, Math.floor(Math.min(w, h) / 28));
  for (let x = 0; x < w; x += step) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    sample(0, y);
    sample(w - 1, y);
  }
  const br = rs / Math.max(1, n);
  const bg = gs / Math.max(1, n);
  const bb = bs / Math.max(1, n);
  const T0 = 26;
  const T1 = 78;
  const out = ctx.createImageData(w, h);
  for (let i = 0; i < data.length; i += 4) {
    const d = colorDist(data[i], data[i + 1], data[i + 2], br, bg, bb);
    let a = 255;
    if (d < T1) {
      a = d <= T0 ? 0 : Math.round(((d - T0) / (T1 - T0)) * 255);
    }
    out.data[i] = data[i];
    out.data[i + 1] = data[i + 1];
    out.data[i + 2] = data[i + 2];
    out.data[i + 3] = a;
  }
  ctx.putImageData(out, 0, 0);
  const result = await createImageBitmap(c);
  bitmap.close();
  return result;
}

export class ObjectMultiplier {
  private frames: MultiplierFrame[] = [];

  async captureFrame(
    video: HTMLVideoElement,
    region: { x: number; y: number; w: number; h: number },
    matte = true,
  ): Promise<MultiplierFrame> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = Math.round(region.x * vw);
    const sy = Math.round(region.y * vh);
    const sw = Math.round(region.w * vw);
    const sh = Math.round(region.h * vh);

    let bitmap = await createImageBitmap(video, sx, sy, sw, sh);
    if (matte) {
      bitmap = await matteRacketFrame(bitmap);
    }
    const frame: MultiplierFrame = {
      imageData: bitmap,
      timestamp: video.currentTime,
      region,
    };
    this.frames.push(frame);
    return frame;
  }

  /**
   * Samples `frameCount` frames at exactly `FPS` (10fps) forward from the current video time.
   */
  async autoCaptureSequence(
    video: HTMLVideoElement,
    region: { x: number; y: number; w: number; h: number },
    frameCount: number,
    _spanSecondsUnused: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<MultiplierFrame[]> {
    const choices = [3, 5, 8, 10] as const;
    const clampedCount = choices.includes(frameCount as 3 | 5 | 8 | 10)
      ? (frameCount as 3 | 5 | 8 | 10)
      : 5;

    const wasPaused = video.paused;
    const startTime = video.currentTime;
    const span = (clampedCount - 1) * FRAME_DT;
    const endBoundary = startTime + span;
    const endTime =
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(video.duration, endBoundary)
        : endBoundary;

    if (!wasPaused) video.pause();

    const captured: MultiplierFrame[] = [];

    for (let i = 0; i < clampedCount; i++) {
      const targetTime = Math.min(endTime, startTime + i * FRAME_DT);
      video.currentTime = targetTime;

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
      });

      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const frame = await this.captureFrame(video, region, true);
      captured.push(frame);
      onProgress?.(i + 1, clampedCount);
    }

    video.currentTime = startTime;
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
    });

    if (!wasPaused) {
      void video.play().catch(() => {});
    }

    return captured;
  }

  drawOverlay(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    opacity = 0.52,
  ): void {
    if (this.frames.length === 0) return;

    ctx.save();
    for (let i = 0; i < this.frames.length; i++) {
      const frame = this.frames[i];
      const alpha =
        this.frames.length === 1
          ? opacity
          : ((i + 1) / this.frames.length) * opacity;
      ctx.globalAlpha = Math.max(0.08, alpha);

      const dx = frame.region.x * canvasW + i * 1.5;
      const dy = frame.region.y * canvasH - i * 0.8;
      const dw = frame.region.w * canvasW;
      const dh = frame.region.h * canvasH;
      ctx.drawImage(frame.imageData, dx, dy, dw, dh);
    }

    if (this.frames.length > 0) {
      const last = this.frames[this.frames.length - 1];
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#9333EA';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        last.region.x * canvasW,
        last.region.y * canvasH,
        last.region.w * canvasW,
        last.region.h * canvasH,
      );
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  clear(): void {
    for (const f of this.frames) {
      f.imageData.close();
    }
    this.frames = [];
  }

  getFrameCount(): number {
    return this.frames.length;
  }
}
