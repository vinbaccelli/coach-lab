/**
 * The live PRESENTATION of the webcam PiP, published by Canvas.tsx and consumed
 * by the recording engine (contexts/RecordingContext.tsx).
 *
 * WHY THIS EXISTS. Canvas.tsx is the only place that knows how the coach's PiP
 * actually looks: background removal (the MediaPipe cutout canvas), the shape
 * (circle vs rounded rectangle), the rect the coach dragged/resized, and the
 * opacity. The recording composite used to draw the RAW webcam stream into a
 * hard-coded 16:9 rect in the bottom-right corner, so every one of those
 * settings was silently dropped the moment MediaRecorder started — background
 * removal appeared to "stop working" when recording began, and the PiP shape
 * and geometry were wrong in the recorded file.
 *
 * Everything here is a GETTER, deliberately: the recorder calls it once per
 * painted frame, so toggling background removal (or the shape, or dragging the
 * PiP) WHILE recording is reflected in the very next encoded frame. Nothing is
 * snapshotted at start().
 */

import type { WebcamPipMode } from '@/components/ToolPalette';

/** Normalized (0..1) PiP rect, relative to the canvas the PiP is drawn on. */
export interface NormalizedPipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WebcamPipPresentation {
  /**
   * The background-removed webcam canvas, or null when background removal is
   * off / not yet producing frames. Callers MUST fall back to the raw webcam
   * stream on null — a cutout that is still initializing must never blank the
   * webcam out of a recording.
   *
   * NOTE for consumers: Canvas draws this canvas MIRRORED (it is the selfie
   * view the coach sees); draw it the same way or the recording disagrees with
   * the screen. The raw-video fallback is NOT mirrored, matching Canvas.
   */
  getCutoutCanvas: () => HTMLCanvasElement | null;
  /** Current shape. 'hidden' means the coach asked for no PiP at all. */
  getPipMode: () => WebcamPipMode;
  /**
   * The PiP's on-screen aspect ratio (width / height, in canvas pixels).
   *
   * Consumers MUST derive height from width using this, not from the normalized
   * rect's own h: a composite of a different shape than the canvas (a
   * screen/tab grab vs. the drawing surface) would otherwise scale w and h by
   * different factors and squash a circular PiP into an ellipse.
   */
  getAspect: () => number;
  /**
   * Where the PiP sits, normalized against the canvas so the consumer can scale
   * it into a differently-sized composite. Null when it cannot be resolved yet
   * (no canvas mounted), in which case the consumer uses its own default.
   */
  getNormalizedRect: () => NormalizedPipRect | null;
  /** Coach's PiP opacity (0..1). */
  getOpacity: () => number;
}
