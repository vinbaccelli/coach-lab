'use client';

export interface StroMotionConfig {
  enabled: boolean;
  startFrame: number;
  endFrame: number;
  ghostCount: number;
  opacity: number;
}

export function drawStroMotion(
  ctx: CanvasRenderingContext2D,
  ghostFrames: ImageBitmap[],
  opacity: number
): void {
  for (let i = 0; i < ghostFrames.length; i++) {
    ctx.globalAlpha = (i / Math.max(1, ghostFrames.length - 1)) * opacity;
    ctx.drawImage(ghostFrames[i], 0, 0);
  }
  ctx.globalAlpha = 1.0;
}
