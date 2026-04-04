/**
 * Skeleton overlay module for Coach Lab.
 *
 * Joints are stored in normalized coordinates (0–1 relative to canvas width/height).
 * Rendering is done on a plain 2D canvas, independent of the Fabric.js drawing layer.
 *
 * Usage:
 *   const state = createSkeletonState();
 *   enableSkeleton(state);
 *   // on click (when video paused):
 *   addJoint(state, nx, ny);
 *   // in rAF loop:
 *   drawSkeleton(ctx, state, canvasWidth, canvasHeight, optionalPreviewPos);
 */

export const JOINT_NAMES = [
  'head',
  'shoulderL',
  'shoulderR',
  'elbowL',
  'elbowR',
  'wristL',
  'wristR',
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
  'ankleL',
  'ankleR',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];

/**
 * Pairs of joint indices (into JOINT_NAMES) that should be connected by a line.
 */
export const SKELETON_CONNECTIONS: [number, number][] = [
  // Head → shoulders
  [0, 1],
  [0, 2],
  // Shoulder bar
  [1, 2],
  // Upper arms
  [1, 3],
  [2, 4],
  // Lower arms
  [3, 5],
  [4, 6],
  // Torso sides
  [1, 7],
  [2, 8],
  // Hip bar
  [7, 8],
  // Upper legs
  [7, 9],
  [8, 10],
  // Lower legs
  [9, 11],
  [10, 12],
];

export interface Joint {
  /** Normalized x position (0 = left edge, 1 = right edge) */
  nx: number;
  /** Normalized y position (0 = top edge, 1 = bottom edge) */
  ny: number;
}

export interface SkeletonState {
  joints: (Joint | null)[];
  nextJointIndex: number;
  enabled: boolean;
}

const SKELETON_COLOR = '#00E5FF';
const LINE_WIDTH = 3;
const JOINT_RADIUS = 5;
const PREVIEW_ALPHA = 0.45;

export function createSkeletonState(): SkeletonState {
  return {
    joints: Array(JOINT_NAMES.length).fill(null) as (Joint | null)[],
    nextJointIndex: 0,
    enabled: false,
  };
}

export function enableSkeleton(state: SkeletonState): void {
  state.enabled = true;
}

export function disableSkeleton(state: SkeletonState): void {
  state.enabled = false;
}

/** Clear all placed joints but keep the skeleton enabled. */
export function resetSkeleton(state: SkeletonState): void {
  state.joints = Array(JOINT_NAMES.length).fill(null) as (Joint | null)[];
  state.nextJointIndex = 0;
}

/**
 * Place the next joint in sequence at normalized position (nx, ny).
 * Silently ignores calls when all joints have been placed.
 */
export function addJoint(state: SkeletonState, nx: number, ny: number): void {
  if (state.nextJointIndex >= JOINT_NAMES.length) return;
  state.joints[state.nextJointIndex] = { nx, ny };
  state.nextJointIndex += 1;
}

/**
 * Draw the skeleton onto a 2D canvas context.
 *
 * @param ctx        The 2D rendering context of the overlay canvas.
 * @param state      Current skeleton state.
 * @param width      Pixel width of the canvas.
 * @param height     Pixel height of the canvas.
 * @param previewPos Optional canvas-pixel position to show a ghost joint at.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  state: SkeletonState,
  width: number,
  height: number,
  previewPos?: { x: number; y: number } | null,
): void {
  if (!state.enabled) return;

  ctx.save();

  // ── Draw bone connections ───────────────────────────────────────────────
  ctx.strokeStyle = SKELETON_COLOR;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = SKELETON_COLOR;
  ctx.shadowBlur = 5;

  for (const [a, b] of SKELETON_CONNECTIONS) {
    const jA = state.joints[a];
    const jB = state.joints[b];
    if (!jA || !jB) continue;
    ctx.beginPath();
    ctx.moveTo(jA.nx * width, jA.ny * height);
    ctx.lineTo(jB.nx * width, jB.ny * height);
    ctx.stroke();
  }

  // ── Draw placed joints ──────────────────────────────────────────────────
  ctx.fillStyle = SKELETON_COLOR;
  ctx.shadowBlur = 7;
  for (const joint of state.joints) {
    if (!joint) continue;
    ctx.beginPath();
    ctx.arc(joint.nx * width, joint.ny * height, JOINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;

  // ── Ghost preview of the next joint at mouse position ──────────────────
  if (previewPos && state.nextJointIndex < JOINT_NAMES.length) {
    ctx.globalAlpha = PREVIEW_ALPHA;
    ctx.fillStyle = SKELETON_COLOR;
    ctx.beginPath();
    ctx.arc(previewPos.x, previewPos.y, JOINT_RADIUS + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ── HUD: next joint label ───────────────────────────────────────────────
  if (state.nextJointIndex < JOINT_NAMES.length) {
    const nextName = JOINT_NAMES[state.nextJointIndex];
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillStyle = SKELETON_COLOR;
    // Background pill for readability
    const label = `Click to place: ${nextName}`;
    const metrics = ctx.measureText(label);
    const pad = 6;
    const boxH = 20;
    const boxW = metrics.width + pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(8, height - boxH - 8, boxW, boxH, 4);
    ctx.fill();
    ctx.fillStyle = SKELETON_COLOR;
    ctx.fillText(label, 8 + pad, height - 8 - 4);
  }

  ctx.restore();
}
