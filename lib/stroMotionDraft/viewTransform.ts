'use client';

/**
 * THE ONE COORDINATE SPACE — mask-editor rebuild, Phase 1.
 *
 * FRAME space is canonical: integer pixels, origin top-left, extent
 * `frame.width × frame.height` (the captured ImageBitmap for that draft frame).
 * The mask lives in FRAME space at identity (`idx = fy * frame.width + fx`), and
 * the display canvases carry a backing store of exactly FRAME size. Everything
 * that relates FRAME space to the screen goes through a single `ViewTransform`.
 *
 * WHY THIS MODULE EXISTS
 * The old editor had TWO independent authorities for one number: the true scale
 * was an implicit product (`zoom * containerWidth / frame.width`, expressed as
 * `width: zoom*100%` + `translate(pan)`), recoverable only by MEASURING the
 * transformed canvas with getBoundingClientRect — and that measurement was then
 * divided by `canvas.width`, which was assigned inside a render effect that could
 * abort before reaching the assignment (a closed ImageBitmap makes drawImage
 * throw). When it aborted, `canvas.width` was the HTML default 300×150, every
 * click mapped into the top-left sliver of the mask, and the brush wrote real
 * pixels nobody could see while every log reported success.
 *
 * Here the scale is stated, not measured. `containerToFrame` and
 * `frameToContainer` are exact inverses, so a point at container position P maps
 * to frame pixel P' and renders back at P by construction. Nothing else in the
 * editor is permitted to compute a scale factor.
 *
 * Pure math: no React, no DOM, no canvas. Everything here is unit-testable and
 * is what the Phase 1 verification predicts against.
 */

export interface ViewTransform {
  /** FRAME px → container CSS px. The ONLY scale factor in the editor. */
  scale: number;
  /** Container CSS px position of FRAME pixel (0,0). */
  tx: number;
  /** Container CSS px position of FRAME pixel (0,0). */
  ty: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Contain-fit scale: the largest scale at which the whole frame fits the
 * container. Deliberately generic rather than assuming the container matches the
 * frame's aspect ratio — a letterboxed container is the stricter case, and it
 * keeps `ty` non-zero so vertical alignment is actually exercised.
 */
export function baseScale(container: Size, frame: Size): number {
  if (frame.width <= 0 || frame.height <= 0) return 1;
  if (container.width <= 0 || container.height <= 0) return 1;
  return Math.min(container.width / frame.width, container.height / frame.height);
}

/**
 * The frame stays centred in the container at every zoom; `pan` then displaces it
 * in container CSS px. Centring inside the transform (rather than as a separate
 * CSS concern) is what keeps `tx`/`ty` complete — the returned transform is the
 * WHOLE relationship between the two spaces, with nothing left implicit.
 */
export function makeViewTransform(
  container: Size,
  frame: Size,
  zoom: number,
  pan: Point,
): ViewTransform {
  const scale = baseScale(container, frame) * zoom;
  return {
    scale,
    tx: (container.width - frame.width * scale) / 2 + pan.x,
    ty: (container.height - frame.height * scale) / 2 + pan.y,
  };
}

/** FRAME px → container CSS px. */
export function frameToContainer(vt: ViewTransform, fx: number, fy: number): Point {
  return { x: fx * vt.scale + vt.tx, y: fy * vt.scale + vt.ty };
}

/**
 * Container CSS px → FRAME px. Exact inverse of `frameToContainer`.
 *
 * Phase 2 feeds this `clientX - containerRect.left` from a pointer event on the
 * UNTRANSFORMED container. It must never be handed a rect measured off a
 * transformed element.
 */
export function containerToFrame(vt: ViewTransform, cx: number, cy: number): Point {
  return { x: (cx - vt.tx) / vt.scale, y: (cy - vt.ty) / vt.scale };
}

/** FRAME-space rect → the container CSS px rect it occupies. */
export function frameRectToContainer(vt: ViewTransform, rect: Rect): Rect {
  const origin = frameToContainer(vt, rect.x, rect.y);
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * vt.scale,
    height: rect.height * vt.scale,
  };
}

/**
 * The CSS the display canvases carry. Paired with a canvas whose backing store
 * AND CSS width/height are both the frame's intrinsic size, so `scale` is the
 * only scaling in the chain — the same number `containerToFrame` divides by.
 */
export function cssTransform(vt: ViewTransform): string {
  return `translate(${vt.tx}px, ${vt.ty}px) scale(${vt.scale})`;
}

/**
 * Round-trip residual, in FRAME px, for a container point. Zero by construction;
 * exposed so the Phase 1 harness can assert it rather than assume it.
 */
export function roundTripError(vt: ViewTransform, cx: number, cy: number): number {
  const f = containerToFrame(vt, cx, cy);
  const back = frameToContainer(vt, f.x, f.y);
  return Math.max(Math.abs(back.x - cx), Math.abs(back.y - cy));
}

/** True when the mask is exactly frame-sized — the invariant the editor requires. */
export function isFrameSizedMask(
  mask: { width: number; height: number; data: { length: number } },
  frame: Size,
): boolean {
  return (
    mask.width === frame.width &&
    mask.height === frame.height &&
    mask.data.length === frame.width * frame.height
  );
}
