/**
 * AI Track follows the player the coach LOCKED, never "whoever the model likes
 * best on this frame".
 *
 * Without a lock, the Precision AI Track pass (app/analysis/page.tsx,
 * runPrecisionPass) asks MediaPipe for ONE person per frame on the full frame,
 * which is the most salient person — with two players on court that can be the
 * wrong one, and it can switch mid-pass. With a lock, the pass asks for up to
 * MAX_TRACK_POSES people per frame and this module picks the locked one:
 *
 *   1. at the LOCK FRAME: the person under the coach's click (and/or matching
 *      the locked skeleton's box) — matchAtLock; not found → the pass stops;
 *   2. on every other frame: the person continuing from the previous frame's
 *      box (followStep), walking forward and backward from the lock frame
 *      (passPlan). When nobody qualifies the frame is a GAP; the player is only
 *      re-acquired near where they were last seen, with a search radius that
 *      grows with the time since then, and with a matching body size.
 *
 * Confidence never decides. Pure (no DOM, no MediaPipe) so tests/aiTrackLock.test.ts
 * covers it. Coordinates are VIDEO PIXELS unless named "normalized".
 */

/** Master switch. false → AI Track ignores the lock and behaves exactly as before. */
export const AI_TRACK_USE_LOCK = true;
/** People the lock path asks MediaPipe for per frame. */
export const MAX_TRACK_POSES = 4;
/** A detection gap longer than this (s) splits the baked track: gaps stay gaps. */
export const TRACK_GAP_SPLIT_SEC = 0.25;

export type TrackKp = { x: number; y: number; score: number; name?: string };
export interface Box { x0: number; y0: number; x1: number; y1: number }

/** What the coach locked, captured at the moment of locking. */
export interface LockTarget {
  /** Video time of the lock frame (s). */
  t: number;
  /** The click, normalized to the video frame (0–1); null for "Yes ✓" (no click). */
  point: { x: number; y: number } | null;
  /** Box of the locked skeleton on that frame (video px), when one was shown. */
  box: Box | null;
  /** The locked skeleton's keypoints (video px), when one was shown. */
  kps: TrackKp[] | null;
}

/** Keypoints confident enough to outline a body. */
const BOX_MIN_SCORE = 0.3;
const BOX_MIN_POINTS = 4;

/** Bounding box of a pose's confident keypoints, or null if too few. */
export function poseBox(kps: readonly TrackKp[] | null | undefined, minScore = BOX_MIN_SCORE): Box | null {
  if (!kps) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (const k of kps) {
    if (!k || !(k.score >= minScore) || !Number.isFinite(k.x) || !Number.isFinite(k.y)) continue;
    n++;
    if (k.x < x0) x0 = k.x; if (k.x > x1) x1 = k.x;
    if (k.y < y0) y0 = k.y; if (k.y > y1) y1 = k.y;
  }
  return n >= BOX_MIN_POINTS ? { x0, y0, x1, y1 } : null;
}

export const boxCentre = (b: Box) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
const boxH = (b: Box) => Math.max(1, b.y1 - b.y0);
const boxW = (b: Box) => Math.max(1, b.x1 - b.x0);

export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const union = boxW(a) * boxH(a) + boxW(b) * boxH(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * The lock to use for this pass, or null for today's behaviour: the switch is
 * on, the coach has locked a player, and the lock says where that player is.
 */
export function lockForPass(useLock: boolean, locked: boolean, target: LockTarget | null | undefined): LockTarget | null {
  if (!useLock || !locked || !target) return null;
  if (!target.point && !target.box) return null;
  return target;
}

/** A click counts as "on" a body when it is inside its box grown by this share of its size. */
const CLICK_MARGIN = 0.15;
/** Without a click, the locked skeleton's box must overlap a candidate this much. */
const LOCK_MIN_IOU = 0.3;

/**
 * Which candidate is the locked player on the lock frame, or -1.
 * With a click: a candidate whose body contains the click (several → the one
 * best matching the locked box, else nearest to the click). Without one: the
 * candidate best overlapping the locked skeleton's box (IoU ≥ 0.3).
 */
export function matchAtLock(
  candidates: ReadonlyArray<readonly TrackKp[]>,
  lock: LockTarget,
  frame: { w: number; h: number },
): number {
  const boxes = candidates.map((c) => poseBox(c));
  if (lock.point) {
    const px = lock.point.x * frame.w, py = lock.point.y * frame.h;
    let best = -1, bestKey = -Infinity;
    boxes.forEach((b, i) => {
      if (!b) return;
      const mx = boxW(b) * CLICK_MARGIN, my = boxH(b) * CLICK_MARGIN;
      if (px < b.x0 - mx || px > b.x1 + mx || py < b.y0 - my || py > b.y1 + my) return;
      const c = boxCentre(b);
      // Prefer overlap with the locked skeleton; tie-break (or no box): closest to the click.
      const key = (lock.box ? iou(b, lock.box) * 1e6 : 0) - Math.hypot(c.x - px, c.y - py);
      if (key > bestKey) { bestKey = key; best = i; }
    });
    return best;
  }
  if (lock.box) {
    let best = -1, bestIou = LOCK_MIN_IOU;
    boxes.forEach((b, i) => {
      if (!b) return;
      const v = iou(b, lock.box!);
      if (v >= bestIou) { bestIou = v; best = i; }
    });
    return best;
  }
  return -1;
}

/** A person being followed: where they were last seen, and when. */
export interface Sighting { box: Box; lastSeenT: number }
/**
 * The followed player, plus the OTHER people on court. Others are followed too,
 * so a person who stays visible while the locked player is out of view is
 * known to be someone else and can never be adopted when the search area
 * grows (measured on a two-player clip: without this, the pass switched to
 * the other player after the locked one left the frame).
 */
export interface FollowState extends Sighting { others: Sighting[] }

export const startFollow = (box: Box, t: number, others: Box[] = []): FollowState => ({
  box, lastSeenT: t, others: others.map((o) => ({ box: o, lastSeenT: t })),
});

/** Search radius, in body heights: BASE right after a sighting, growing per second unseen, capped. */
const GATE_BASE = 0.6;
const GATE_GROW_PER_SEC = 1.5;
const GATE_MAX = 4;
/** Body size (box height) may change by at most this factor from the last sighting. */
const SIZE_RATIO_MAX = 1.45;
/** An "other" not seen for longer than this is forgotten. */
const OTHER_KEEP_SEC = 1;

/** The search radius (video px) at time `t` for a person last seen in `s`. */
export function gateRadius(s: Sighting, t: number): number {
  const unseen = Math.abs(t - s.lastSeenT);
  return boxH(s.box) * Math.min(GATE_MAX, GATE_BASE + GATE_GROW_PER_SEC * unseen);
}

/** How well a candidate box continues a sighting: distance / radius (≤ 1 to qualify), or Infinity. */
function continuity(s: Sighting, b: Box, t: number): number {
  const ratio = boxH(b) / boxH(s.box);
  if (ratio > SIZE_RATIO_MAX || ratio < 1 / SIZE_RATIO_MAX) return Infinity;
  const c0 = boxCentre(s.box), c = boxCentre(b);
  const q = Math.hypot(c.x - c0.x, c.y - c0.y) / gateRadius(s, t);
  return q <= 1 ? q : Infinity;
}

/**
 * One frame of following. Every candidate is assigned to at most one tracked
 * person (the followed player or a known other), best continuation first; the
 * followed player gets the candidate assigned to them, if any. A candidate
 * that continues an OTHER person is therefore never taken, however far the
 * followed player's search area has grown. None → index -1 and the followed
 * player's last sighting is kept (a gap; the next frame searches wider).
 * Detection confidence is never consulted.
 */
export function followStep(
  s: FollowState,
  candidates: ReadonlyArray<readonly TrackKp[]>,
  t: number,
): { index: number; state: FollowState } {
  const boxes = candidates.map((k) => poseBox(k));
  const trackers: Sighting[] = [s, ...s.others];
  const pairs: Array<{ q: number; tr: number; c: number }> = [];
  trackers.forEach((tr, ti) => boxes.forEach((b, ci) => {
    if (!b) return;
    const q = continuity(tr, b, t);
    if (q !== Infinity) pairs.push({ q, tr: ti, c: ci });
  }));
  pairs.sort((x, y) => x.q - y.q);
  const trUsed = new Set<number>(), cUsed = new Set<number>();
  const assigned = new Map<number, number>(); // tracker → candidate
  for (const pr of pairs) {
    if (trUsed.has(pr.tr) || cUsed.has(pr.c)) continue;
    trUsed.add(pr.tr); cUsed.add(pr.c); assigned.set(pr.tr, pr.c);
  }
  const mine = assigned.get(0);
  const others: Sighting[] = [];
  s.others.forEach((o, i) => {
    const c = assigned.get(i + 1);
    if (c !== undefined) others.push({ box: boxes[c]!, lastSeenT: t });
    else if (Math.abs(t - o.lastSeenT) <= OTHER_KEEP_SEC) others.push(o);
  });
  // While the followed player is in view, everyone else present is an "other".
  // During a gap a new appearance is NOT made an other: it may be them coming back.
  if (mine !== undefined) {
    boxes.forEach((b, ci) => { if (b && !cUsed.has(ci)) others.push({ box: b, lastSeenT: t }); });
    return { index: mine, state: { box: boxes[mine]!, lastSeenT: t, others } };
  }
  return { index: -1, state: { box: s.box, lastSeenT: s.lastSeenT, others } };
}

/**
 * Frame times to visit, starting AT the lock frame: forward to `end`, then
 * backward to `start`. A lock outside [start, end] still seeds the walk (the
 * frames between it and the section are tracked but not recorded — see
 * inSection). Each direction restarts from the lock.
 */
export function passPlan(start: number, end: number, lockT: number, step: number): { forward: number[]; backward: number[] } {
  const eps = 1e-6;
  const forward: number[] = [];
  const backward: number[] = [];
  if (!(step > 0)) return { forward, backward };
  for (let k = 1; ; k++) {
    const t = lockT + k * step;
    if (t > end + eps) break;
    forward.push(Math.min(end, t));
  }
  for (let k = 1; ; k++) {
    const t = lockT - k * step;
    if (t < start - eps) break;
    backward.push(Math.max(start, t));
  }
  return { forward, backward };
}

export const inSection = (t: number, start: number, end: number) => t >= start - 1e-6 && t <= end + 1e-6;

/**
 * Split time-sorted samples wherever consecutive samples are more than `maxGap`
 * apart, so a stretch where the player was out of view is NOT bridged (the
 * baked-track lookup snaps across holes; separate segments leave them empty).
 */
export function splitAtGaps<S extends { t: number }>(samples: readonly S[], maxGap: number): S[][] {
  const out: S[][] = [];
  let cur: S[] = [];
  for (const s of samples) {
    if (cur.length && s.t - cur[cur.length - 1].t > maxGap) { out.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) out.push(cur);
  return out;
}
