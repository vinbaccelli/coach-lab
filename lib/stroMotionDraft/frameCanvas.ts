/**
 * Turn a captured frame into something transformers.js' `RawImage.fromCanvas` accepts, on the page OR inside a worker.
 * The racket models used `instanceof HTMLCanvasElement` and `document.createElement('canvas')`, neither of which exists in a
 * worker; this duck-types the canvas and falls back to OffscreenCanvas. Main-thread behaviour is unchanged.
 */
export type FrameSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

export function isCanvasLike(f: FrameSource): f is CanvasLike {
  return typeof (f as { getContext?: unknown }).getContext === 'function';
}

/** Draw a bitmap into a fresh canvas (HTML canvas on the page, OffscreenCanvas in a worker). Throws if the bitmap is detached. */
export function bitmapToCanvas(frame: ImageBitmap): CanvasLike {
  const w = frame.width;
  const h = frame.height;
  let canvas: CanvasLike;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    canvas = c;
  } else {
    canvas = new OffscreenCanvas(w, h);
  }
  (canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D).drawImage(frame, 0, 0);
  return canvas;
}

export function frameToCanvas(frame: FrameSource): CanvasLike {
  return isCanvasLike(frame) ? frame : bitmapToCanvas(frame);
}
