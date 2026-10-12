/**
 * The Draw list's Eraser: its size, and which marks one press of it cuts.
 *
 * Pure (no React, no canvas) so tests/eraser.test.ts can cover it. The size is
 * the eraser ring's RADIUS in logical canvas px: components/Canvas.tsx draws the
 * cursor ring with it and stamps every eraser dot with it, so what the coach
 * sees is exactly what gets erased, on mouse and touch alike.
 */

export const ERASER_SIZE_MIN = 5;
export const ERASER_SIZE_MAX = 50;
/** The size the Eraser has always had; new sessions start here. */
export const ERASER_SIZE_DEFAULT = 15;

export type EraserPresetId = 'small' | 'medium' | 'large';
export const ERASER_PRESETS: ReadonlyArray<{ id: EraserPresetId; label: string; size: number }> = [
  { id: 'small', label: 'Small', size: 8 },
  { id: 'medium', label: 'Medium', size: ERASER_SIZE_DEFAULT },
  { id: 'large', label: 'Large', size: 30 },
];

/** A slider / preset value made safe: a whole number in [MIN, MAX]; garbage → the default. */
export function clampEraserSize(value: number): number {
  if (!Number.isFinite(value)) return ERASER_SIZE_DEFAULT;
  return Math.min(ERASER_SIZE_MAX, Math.max(ERASER_SIZE_MIN, Math.round(value)));
}

/** The preset the current size is exactly on, or null (a slider value in between). */
export function eraserPresetFor(size: number): EraserPresetId | null {
  return ERASER_PRESETS.find((p) => p.size === size)?.id ?? null;
}

export interface EraserDot { x: number; y: number; radius: number }
interface Pt { x: number; y: number }
type Erasable = { tool: string; lw?: number; eraserStrokes?: EraserDot[] };

/**
 * One press (or one move of a drag) of the Eraser at `pos` with ring radius
 * `radius`: every eligible mark whose outline is within the ring (radius plus
 * half the mark's line width) gets one dot of that radius.
 *
 * Returns NEW arrays and NEW objects for the cut marks only; the input array
 * and every mark object in it are left untouched. That is what keeps Undo to
 * one step per drag: the history entry pushed before the drag still holds the
 * uncut objects, and the drag's single push on lift records the result.
 */
export function eraseUnderRing<S extends Erasable>(
  strokes: readonly S[],
  pos: Pt,
  radius: number,
  test: { eligible: (s: S) => boolean; distance: (s: S, pos: Pt) => number },
): { strokes: S[]; cut: number[] } {
  if (!(radius > 0)) return { strokes: [...strokes], cut: [] };
  const cut: number[] = [];
  const out = strokes.map((s, i) => {
    if (!test.eligible(s)) return s;
    const lw = s.lw ?? 2;
    if (!(test.distance(s, pos) <= radius + lw / 2)) return s;
    cut.push(i);
    return { ...s, eraserStrokes: [...(s.eraserStrokes ?? []), { x: pos.x, y: pos.y, radius }] };
  });
  return { strokes: out, cut };
}
