/**
 * The precision crosshair is drawn inside the canvas zoom transform, so a 220 % zoom drew it
 * 2.2x bigger and a zoom-out drew it tiny. Scaling by the inverse of the zoom, about the
 * crosshair's own centre, keeps it the same size on screen at every zoom.
 */
export function counterZoomScale(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1;
}
