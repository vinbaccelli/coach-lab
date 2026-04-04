/**
 * Drawing tool helpers for Fabric.js canvas.
 * Tools: pen, angle, circle, arrow, arrowAngle, bodyCircle, text
 */
import type { Canvas as FabricCanvas, Object as FabricObject } from 'fabric';

export type ToolType =
  | 'select'
  | 'pen'
  | 'angle'
  | 'circle'
  | 'arrow'
  | 'arrowAngle'
  | 'bodyCircle'
  | 'text'
  | 'skeleton'
  | 'ballShadow'
  | 'swingPath'
  | 'erase';

export interface DrawingOptions {
  color: string;
  lineWidth: number;
  fontSize: number;
}

/** Calculate the angle (in degrees) between three points: vertex at b */
export function calcAngleDeg(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.sqrt(ab.x ** 2 + ab.y ** 2);
  const magCB = Math.sqrt(cb.x ** 2 + cb.y ** 2);
  if (magAB === 0 || magCB === 0) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return Math.round((Math.acos(cosAngle) * 180) / Math.PI);
}

/** Add an arrowhead at the end of a line */
export function makeArrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  headLen = 16,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const points = [
    { x: x2, y: y2 },
    {
      x: x2 - headLen * Math.cos(angle - Math.PI / 7),
      y: y2 - headLen * Math.sin(angle - Math.PI / 7),
    },
    {
      x: x2 - headLen * Math.cos(angle + Math.PI / 7),
      y: y2 - headLen * Math.sin(angle + Math.PI / 7),
    },
    { x: x2, y: y2 },
  ];
  return points;
}

/** Serialize all canvas objects (for undo/redo stack) */
export function serializeCanvas(canvas: FabricCanvas): string {
  return JSON.stringify(canvas.toJSON());
}

/** Restore canvas from a serialized JSON string */
export async function deserializeCanvas(
  canvas: FabricCanvas,
  json: string,
): Promise<void> {
  await canvas.loadFromJSON(JSON.parse(json));
  canvas.renderAll();
}

/** Take a snapshot of the merged video + canvas as a PNG data URL */
export function captureFrame(
  videoEl: HTMLVideoElement,
  overlayCanvas: HTMLCanvasElement,
): string {
  const w = videoEl.videoWidth || videoEl.clientWidth;
  const h = videoEl.videoHeight || videoEl.clientHeight;

  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext('2d')!;

  // Draw current video frame
  ctx.drawImage(videoEl, 0, 0, w, h);

  // Overlay the annotation canvas (scaled to match)
  ctx.drawImage(overlayCanvas, 0, 0, w, h);

  return tmp.toDataURL('image/png');
}

/** Download a data URL as a file */
export function downloadDataURL(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
