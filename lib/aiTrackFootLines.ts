/**
 * AI Track Foot Lines (baked tracks only).
 *
 * The page's `skeletonShowFootLine` flag ALSO selects the live pose model (Canvas `useMediaPipeLive`,
 * the MediaPipe live landmarker preload), so it must never be switched by AI Track. AI Track keeps its
 * own draw-only flag (`aiTrackFootLines`); these helpers decide when it is switched on and what the
 * checkbox shows. Pure, no DOM.
 */

type Kp = { name?: string; score: number } | null | undefined;

/** Same bar the Canvas arrow draw uses for a real toe (`namedToe`, score >= 0.3). */
export const FOOT_MIN_SCORE = 0.3;

/** `n` evenly spaced times over [start, end], both ends included (n >= 2). */
export function sampleTimes(start: number, end: number, n = 15): number[] {
  const k = Math.max(2, Math.floor(n));
  return Array.from({ length: k }, (_, i) => start + ((end - start) * i) / (k - 1));
}

/** True when any pose carries a real toe landmark (MediaPipe passes do; the MoveNet fallback bake never does). */
export function posesHaveFeet(poses: ReadonlyArray<ReadonlyArray<Kp> | null | undefined>): boolean {
  return poses.some((p) => !!p && p.some((k) => !!k && (k.name === 'left_foot_index' || k.name === 'right_foot_index') && k.score >= FOOT_MIN_SCORE));
}

/** What the "Foot line" checkbox shows: with a baked track it reflects the draw flag of either system. */
export function footLineChecked(args: { liveFlag: boolean; aiTrackFlag: boolean; bakedReady: boolean }): boolean {
  return args.bakedReady ? args.liveFlag || args.aiTrackFlag : args.liveFlag;
}
