'use client';

export interface MultiplierFrame {
  imageData: ImageBitmap;
  timestamp: number;
  region: { x: number; y: number; w: number; h: number };
}

export class ObjectMultiplier {
  private frames: MultiplierFrame[] = [];

  async captureFrame(
    video: HTMLVideoElement,
    region: { x: number; y: number; w: number; h: number },
  ): Promise<MultiplierFrame> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = Math.round(region.x * vw);
    const sy = Math.round(region.y * vh);
    const sw = Math.round(region.w * vw);
    const sh = Math.round(region.h * vh);

    const bitmap = await createImageBitmap(video, sx, sy, sw, sh);
    const frame: MultiplierFrame = {
      imageData: bitmap,
      timestamp: video.currentTime,
      region,
    };
    this.frames.push(frame);
    return frame;
  }

  async autoCaptureSequence(
    video: HTMLVideoElement,
    region: { x: number; y: number; w: number; h: number },
    frameCount: number,
    spanSeconds: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<MultiplierFrame[]> {
    const clampedCount = Math.max(2, Math.min(12, frameCount));
    const startTime = video.currentTime;
    const endTime = Math.min(video.duration, startTime + spanSeconds);
    const actualSpan = endTime - startTime;
    const interval = actualSpan / (clampedCount - 1);

    const wasPaused = video.paused;
    if (!wasPaused) video.pause();

    const captured: MultiplierFrame[] = [];

    for (let i = 0; i < clampedCount; i++) {
      const targetTime = startTime + i * interval;
      video.currentTime = targetTime;

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
      });

      const frame = await this.captureFrame(video, region);
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

    return captured;
  }

  drawOverlay(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    opacity = 0.6,
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

      const dx = frame.region.x * canvasW;
      const dy = frame.region.y * canvasH;
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
