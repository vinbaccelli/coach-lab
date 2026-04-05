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
    // When there is only one frame use opacity directly; otherwise fade from 0 → opacity.
    const alpha =
      ghostFrames.length === 1
        ? opacity
        : (i / (ghostFrames.length - 1)) * opacity;
    ctx.globalAlpha = alpha;
    ctx.drawImage(ghostFrames[i], 0, 0);
  }
  ctx.globalAlpha = 1.0;
}
