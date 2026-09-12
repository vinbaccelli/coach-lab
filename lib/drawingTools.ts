/**
 * Drawing tool helpers for Fabric.js canvas.
 * Tools: pen, angle, circle, arrow, arrowAngle, bodyCircle, text
 */
import type { Canvas as FabricCanvas, Object as FabricObject } from 'fabric';

export type ToolType =
  | 'select'
  | 'pen'
  | 'line'
  | 'angle'
  | 'circle'
  | 'rect'
  | 'triangle'
  | 'arrow'
  | 'arrowAngle'
  | 'bodyCircle'
  | 'text'
  | 'skeleton'
  | 'ballShadow'
  | 'swingPath'
  | 'manualSwing'
  | 'jointChain'
  | 'erase'
  | 'zoom'
  | 'objectMultiplier'
  | 'ruler';

export interface DrawingOptions {
  color: string;
  lineWidth: number;
  fontSize: number;
  dashed: boolean;
  /** When true, manual/auto swing paths draw an arrowhead at the final segment (like the Arrow tool). */
  arrowAtEnd?: boolean;
}

/**
 * Bearing of the arrow p1->p2, in degrees, 0..360, clockwise from +x.
 *
 * ONE convention for every consumer. The on-canvas pill used
 * `Math.abs(atan2(dy,dx))` (0..180, direction-blind) while the value committed
 * to the data column used `(atan2(dy,dx)+360)%360` (0..360), so the SAME arrow
 * showed two different numbers — an arrow drawn up-and-right read 30 on the
 * video and 330 in the column. 0..360 is the one that keeps direction, which is
 * what an arrow means, so that is the one both now use.
 *
 * Canvas Y grows DOWNWARD, so a positive bearing tilts down-right: 0 = left to
 * right, 90 = straight down, 180 = right to left.
 */
export function arrowBearingDeg(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): number {
  const deg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  return Math.round((deg + 360) % 360);
}

/**
 * Smallest angle between two bearings, 0..180.
 *
 * A plain `Math.abs(a - b)` on 0..360 bearings wraps: two arrows 20 apart that
 * straddle 0 (350 and 10) differ by 340 that way. The differential a coach
 * wants is always the short way round.
 */
export function angleDifferenceDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.round(d > 180 ? 360 - d : d);
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

/**
 * Take a snapshot of the merged video + canvas as a PNG data URL, at the
 * video's NATIVE resolution.
 *
 * `videoBounds` is the video's rect inside `overlayCanvas`, in BACKING-STORE
 * pixels with zoom/pan applied — get it from `CanvasOverlay.getVideoBounds()`,
 * never by recomputing it here.
 *
 * Why it is required: the overlay canvas is CONTAINER-sized and the video is
 * letterboxed within it (plus DPR scaling, plus a zoom/pan transform), so the
 * annotations occupy only a sub-rect of the canvas. Blitting the whole canvas
 * over the frame — which this function used to do — stretches the letterbox
 * bars onto the video and shifts every annotation by the letterbox offset,
 * scaled by canvasSize/videoRectSize. It only looked right when the container
 * aspect happened to match the video's.
 *
 * When bounds are unavailable we return the clean video frame rather than a
 * knowingly misaligned composite.
 */
export function captureFrame(
  videoEl: HTMLVideoElement,
  overlayCanvas: HTMLCanvasElement,
  videoBounds?: { dx: number; dy: number; dw: number; dh: number } | null,
): string {
  const w = videoEl.videoWidth || videoEl.clientWidth;
  const h = videoEl.videoHeight || videoEl.clientHeight;

  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext('2d')!;

  // Draw current video frame
  ctx.drawImage(videoEl, 0, 0, w, h);

  // Lift ONLY the region of the overlay that sits over the video, and map it
  // onto the full output frame.
  if (videoBounds && videoBounds.dw > 0 && videoBounds.dh > 0) {
    ctx.drawImage(
      overlayCanvas,
      videoBounds.dx, videoBounds.dy, videoBounds.dw, videoBounds.dh,
      0, 0, w, h,
    );
  }

  return tmp.toDataURL('image/png');
}

/** Download a data URL as a file */
export function downloadDataURL(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
