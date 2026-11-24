/**
 * Marks (lines, arrows, swing paths) are drawn inside the canvas zoom transform, so at 220 % a 3 px
 * line was 6.6 px and the arrow head 2.2x bigger. Drawing them through `constantSizeContext(ctx, 1/zoom)`
 * keeps line width and dash lengths the same size on screen at every zoom, while the geometry still
 * follows the video. Arrow head lengths read `getMarkScale()` for the same reason.
 */
let markScale = 1;
export const getMarkScale = (): number => markScale;
export const setMarkScale = (k: number): void => { markScale = Number.isFinite(k) && k > 0 ? k : 1; };

/** A view of `ctx` whose lineWidth and dash lengths are multiplied by `k`. k = 1 returns `ctx` itself. */
export function constantSizeContext<T extends object>(ctx: T, k: number): T {
  if (!(Number.isFinite(k) && k > 0) || k === 1) return ctx;
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'setLineDash') {
        return (segments: number[]) => (target as unknown as CanvasRenderingContext2D).setLineDash(segments.map((v) => v * k));
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, prop, value) {
      Reflect.set(target, prop, prop === 'lineWidth' && typeof value === 'number' ? value * k : prop === 'lineDashOffset' && typeof value === 'number' ? value * k : value, target);
      return true;
    },
  });
}
