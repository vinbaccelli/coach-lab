import type { Point2D } from './types';

/** Gaussian elimination with partial pivoting. Solves Ax = b. */
function gaussElim(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;

    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

/**
 * Compute 3×3 homography from src (display pixels) → dst (real-world meters).
 * Requires exactly 4 point pairs. Returns 9-element row-major array or null.
 */
export function computeHomography(src: Point2D[], dst: Point2D[]): number[] | null {
  if (src.length < 4) return null;
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([-x, -y, -1, 0, 0, 0, x * u, y * u]);
    b.push(-u);
    A.push([0, 0, 0, -x, -y, -1, x * v, y * v]);
    b.push(-v);
  }

  const h = gaussElim(A, b);
  if (!h) return null;
  return [...h, 1];
}

/** Apply 3×3 homography (9-element, row-major) to a point. */
export function applyHomography(h: number[], p: Point2D): Point2D {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export function dist2D(a: Point2D, b: Point2D): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** Measure real-world distance between two display-pixel points using homography. */
export function measureWithHomography(h: number[], p1: Point2D, p2: Point2D): number {
  return dist2D(applyHomography(h, p1), applyHomography(h, p2));
}

/** Measure with simple scale (pixels per meter). */
export function measureWithScale(scale: number, p1: Point2D, p2: Point2D): number {
  return dist2D(p1, p2) / scale;
}

/** Compute pixels-per-meter from two pixel points and a known real-world distance. */
export function computeScale(p1: Point2D, p2: Point2D, realMeters: number): number {
  return dist2D(p1, p2) / realMeters;
}

export function formatDistance(meters: number): string {
  if (meters < 1) return `${(meters * 100).toFixed(1)} cm`;
  return `${meters.toFixed(2)} m`;
}
