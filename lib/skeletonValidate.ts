/**
 * Per-joint validation of a baked pose track, BEFORE smoothing.
 *
 * Why: the detector is confident about wrong joints (limb swaps, a wrist
 * snapping to the background), and smoothing a wrong joint just makes it drift
 * ("drunk" skeleton). So we judge every joint on evidence, never on the box:
 *
 *  0. LIMB ASSIGNMENT   — inside each frame, a knee/ankle/elbow/wrist whose bone to its own
 *     hip/knee/shoulder/elbow is longer than any real limb of the clip (and shorter the other way
 *     round) belongs to the other side: swapped back. Needs no history, so a swap that lasts the
 *     whole clip (shin lines in an X) is repaired too.
 *  1. L/R SWAP REPAIR   — a left/right pair whose labels jumped to the other
 *     side's previous position is swapped back (compared with the previous
 *     OUTPUT frame, so a swap that persists is repaired consistently).
 *  2. CONFIDENCE        — joint score < MIN_SCORE is invalid.
 *  3. TEMPORAL OUTLIER  — a joint far from the midpoint of its valid neighbours
 *     (velocity-independent, so genuine fast swings pass).
 *  4. BONE LENGTH       — a bone much longer than its local median length
 *     implicates the endpoint that deviates more from its neighbours.
 *
 * Invalid joints are NOT deleted or invented: their score is capped to
 * INVALID_SCORE so every consumer (overlay, angles → "–", smoother weight,
 * playback lerp which takes min(score)) treats them as unknown. No extra
 * smoothing is applied here, so real high-speed movement is untouched.
 */
import type { TrackSample, TrackKeypoint } from './trackSmoothing';

export const MIN_SCORE = 0.2;
export const INVALID_SCORE = 0.05;
const LIMB_PLAUSIBLE = 1.35;     // step 0: labelled bones longer than this × the clip's best-assignment length are impossible
const LIMB_VS_PARENT = 1.4;      // step 0, ankle/wrist: labelled shins/forearms longer than this × the thighs/upper arms of the same frame are impossible
const LIMB_SWAP_RATIO = 0.7;    // …and the other assignment must be this much shorter
const LIMB_MIN_GAIN_BH = 0.08;   // …saving at least this many body heights
const LIMB_REF_HALF = 15;        // samples each side for the rolling reference length
const SWAP_RATIO = 0.6;          // swapped assignment must be this much cheaper
const SWAP_MIN_SEP = 0.08;       // L/R must be ≥ this many body heights apart (else crossing, not a swap)
const SWAP_MIN_MOVE = 0.04;      // …and the unswapped step must be a real move
const OUTLIER_BH = 0.25;         // distance from neighbour midpoint, in body heights
const BONE_LONG = 1.5;           // × local median length
const BONE_BLAME_BH = 0.08;      // blamed endpoint must also be off its neighbours by this much
const NEIGHBOUR_MAX_DT = 0.12;   // neighbours further apart than this (s) aren't a usable reference
const LOCAL_HALF = 10;           // samples each side for local bone median
const ARM_OVER_LEG = 1.25;        // frame gate: mean arm-bone length above mean leg-bone length ⇒ limbs on the wrong parts
const INVERTED_ARM_OVER_LEG = 0.75; // …or vertical order inverted and arms not clearly shorter than legs
const ORDER_MARGIN_BH = 0.1;     // shoulders above hips above ankles, by at least this many body heights

const SWAP_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['left_shoulder', 'right_shoulder'], ['left_elbow', 'right_elbow'], ['left_wrist', 'right_wrist'],
  ['left_hip', 'right_hip'], ['left_knee', 'right_knee'], ['left_ankle', 'right_ankle'],
];
const BONES: ReadonlyArray<readonly [string, string]> = [
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
];
const HEIGHT_JOINTS = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];

export interface ValidationReport {
  samples: number;
  /** Frames whose whole limb layout is implausible (e.g. legs where arms should be): dropped like a missed detection. */
  droppedFrames: number;
  swapsFixed: number;
  invalidLowScore: number;
  invalidOutlier: number;
  invalidBone: number;
}

const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Index = Map<string, TrackKeypoint>;

export function validateTrack(samples: TrackSample[]): { samples: TrackSample[]; report: ValidationReport; dropped: boolean[] } {
  const report: ValidationReport = { samples: samples.length, droppedFrames: 0, swapsFixed: 0, invalidLowScore: 0, invalidOutlier: 0, invalidBone: 0 };
  const noDrops = () => new Array<boolean>(samples.length).fill(false);
  if (samples.length < 4) return { samples, report, dropped: noDrops() };

  const out: TrackSample[] = samples.map((s) => ({ t: s.t, kps: s.kps.map((k) => ({ ...k })) }));
  const idx: Index[] = out.map((s) => new Map(s.kps.filter((k) => k.name).map((k) => [k.name, k])));

  // Body height: median shoulder→ankle extent over frames where all eight joints are confident.
  const hs: number[] = [];
  for (const m of idx) {
    const ks = HEIGHT_JOINTS.map((n) => m.get(n));
    if (ks.every((k) => k && k.score >= 0.3)) { const ys = ks.map((k) => k!.y); hs.push(Math.max(...ys) - Math.min(...ys)); }
  }
  if (hs.length < 4) return { samples, report, dropped: noDrops() };
  const BH = median(hs);
  if (!(BH > 20)) return { samples, report, dropped: noDrops() };

  // ── 0. LIMB ASSIGNMENT INSIDE THE FRAME (knee, ankle, elbow, wrist) ─────
  // Step 1 below compares a frame with the previous one, so a swap that is already there at the
  // first frame, or that lasts the whole clip, never "jumps" and was kept: the skeleton showed
  // each knee joined to the OPPOSITE ankle (shin lines in an X), each elbow to the opposite
  // wrist. The bone-length check (step 4) cannot see it either: the neighbours carry the same swap.
  // So every joint is also judged by anatomy alone, no history needed. For a chain (hip→knee,
  // knee→ankle, shoulder→elbow, elbow→wrist) there are two ways to hand the left/right joints to
  // the left/right parents. The labelled way is rejected only when it is physically impossible AND
  // the other way is clearly shorter; a genuine crossover step or folded arms keep real bone
  // lengths and are never touched. "Impossible" needs a ruler that a swap cannot bias:
  //  · ankle and wrist: the bone just above it IN THE SAME FRAME (thigh, upper arm). A real shin or
  //    forearm is about as long as that; a swapped one runs across the body at about twice it.
  //    (A clip-wide reference would be biased low whenever the limbs are crossed on every frame.)
  //  · knee and elbow (next to the root, rarely crossed): 1.35 × a rolling median of the clip's
  //    best-assignment length, so zoom and approach are tolerated.
  // Parents are settled first (hips/shoulders are the roots), then knee → ankle, elbow → wrist.
  const SIDES = (n: string) => [`left_${n}`, `right_${n}`] as const;
  type Chain = { j: readonly [string, string]; p: readonly [string, string]; ruler?: readonly [string, string] };
  const CHAINS: ReadonlyArray<Chain> = [
    { j: SIDES('knee'), p: SIDES('hip') },
    { j: SIDES('ankle'), p: SIDES('knee'), ruler: SIDES('hip') },
    { j: SIDES('elbow'), p: SIDES('shoulder') },
    { j: SIDES('wrist'), p: SIDES('elbow'), ruler: SIDES('shoulder') },
  ];
  for (const { j: [jl, jr], p: [pl, pr], ruler } of CHAINS) {
    const keepT: Array<number | null> = new Array(out.length).fill(null);
    const swapT: Array<number | null> = new Array(out.length).fill(null);
    const rulerT: Array<number | null> = new Array(out.length).fill(null);
    for (let i = 0; i < out.length; i++) {
      const a = idx[i].get(pl), b = idx[i].get(pr), c = idx[i].get(jl), e = idx[i].get(jr);
      if (!a || !b || !c || !e || a.score < 0.3 || b.score < 0.3 || c.score < 0.3 || e.score < 0.3) continue;
      keepT[i] = d(a, c) + d(b, e);
      swapT[i] = d(a, e) + d(b, c);
      if (ruler) {
        const ga = idx[i].get(ruler[0]), gb = idx[i].get(ruler[1]);
        if (ga && gb && ga.score >= 0.3 && gb.score >= 0.3) rulerT[i] = d(ga, a) + d(gb, b);
      }
    }
    const best: number[] = [];
    keepT.forEach((k, i) => { if (k != null) best.push(Math.min(k, swapT[i]!)); });
    if (best.length < 4) continue;
    const globalRef = median(best);
    for (let i = 0; i < out.length; i++) {
      const keep = keepT[i], swp = swapT[i];
      if (keep == null || swp == null || swp >= keep) continue;
      let limit: number;
      if (ruler) {
        if (rulerT[i] == null) continue;
        limit = rulerT[i]! * LIMB_VS_PARENT;
      } else {
        const win: number[] = [];
        for (let j = Math.max(0, i - LIMB_REF_HALF); j <= Math.min(out.length - 1, i + LIMB_REF_HALF); j++) if (keepT[j] != null) win.push(Math.min(keepT[j]!, swapT[j]!));
        limit = (win.length >= 4 ? median(win) : globalRef) * LIMB_PLAUSIBLE;
      }
      if (keep <= limit) continue;                           // a real limb could be this long: leave it
      if (!(swp < keep * LIMB_SWAP_RATIO && (keep - swp) / BH > LIMB_MIN_GAIN_BH)) continue;
      const cj = idx[i].get(jl)!, rj = idx[i].get(jr)!;
      const t = { x: cj.x, y: cj.y, score: cj.score };
      cj.x = rj.x; cj.y = rj.y; cj.score = rj.score;
      rj.x = t.x; rj.y = t.y; rj.score = t.score;
      report.swapsFixed++;
    }
  }

  // ── 1. L/R swaps, greedy against the previous output frame ──────────────
  for (let i = 1; i < out.length; i++) {
    const prev = idx[i - 1], cur = idx[i];
    for (const [L, R] of SWAP_PAIRS) {
      const pL = prev.get(L), pR = prev.get(R), cL = cur.get(L), cR = cur.get(R);
      if (!pL || !pR || !cL || !cR) continue;
      if (pL.score < 0.3 || pR.score < 0.3 || cL.score < 0.3 || cR.score < 0.3) continue;
      if (d(pL, pR) / BH < SWAP_MIN_SEP) continue;
      const keep = d(cL, pL) + d(cR, pR);
      const swp = d(cL, pR) + d(cR, pL);
      if (keep / BH > SWAP_MIN_MOVE && swp < keep * SWAP_RATIO) {
        const t = { x: cL.x, y: cL.y, score: cL.score };
        cL.x = cR.x; cL.y = cR.y; cL.score = cR.score;
        cR.x = t.x; cR.y = t.y; cR.score = t.score;
        report.swapsFixed++;
      }
    }
  }

  // Neighbour-midpoint prediction for a joint at sample i (needs valid samples either side, close in time).
  const valid = (i: number, n: string) => { const k = idx[i]?.get(n); return k && k.score >= MIN_SCORE ? k : null; };
  const deviation = (i: number, n: string): number | null => {
    const k = idx[i].get(n);
    if (!k) return null;
    let a = -1, b = -1;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) if (valid(j, n)) { a = j; break; }
    for (let j = i + 1; j <= Math.min(out.length - 1, i + 3); j++) if (valid(j, n)) { b = j; break; }
    if (a < 0 || b < 0) return null;
    if (out[b].t - out[a].t > NEIGHBOUR_MAX_DT * 2) return null;
    const ka = idx[a].get(n)!, kb = idx[b].get(n)!;
    const f = out[b].t === out[a].t ? 0.5 : (out[i].t - out[a].t) / (out[b].t - out[a].t);
    return d(k, { x: ka.x + (kb.x - ka.x) * f, y: ka.y + (kb.y - ka.y) * f }) / BH;
  };

  const bad = new Set<string>(); // `${i}|${name}` decided on the ORIGINAL scores, applied after all checks
  const mark = (i: number, n: string, why: 'invalidLowScore' | 'invalidOutlier' | 'invalidBone') => {
    const key = `${i}|${n}`;
    if (!bad.has(key)) { bad.add(key); report[why]++; }
  };

  // ── 2 + 3. confidence and temporal outliers ─────────────────────────────
  for (let i = 0; i < out.length; i++) {
    for (const [n, k] of idx[i]) {
      if (k.score < MIN_SCORE) { if (k.score > INVALID_SCORE) mark(i, n, 'invalidLowScore'); continue; }
      const dev = deviation(i, n);
      if (dev != null && dev > OUTLIER_BH) mark(i, n, 'invalidOutlier');
    }
  }

  // ── 4. bone lengths against a LOCAL median (tolerates zoom / approach) ──
  for (const [A, B] of BONES) {
    const len: Array<number | null> = idx.map((m, i) => (valid(i, A) && valid(i, B) ? d(m.get(A)!, m.get(B)!) : null));
    for (let i = 0; i < out.length; i++) {
      const l = len[i];
      if (l == null) continue;
      const win: number[] = [];
      for (let j = Math.max(0, i - LOCAL_HALF); j <= Math.min(out.length - 1, i + LOCAL_HALF); j++) if (len[j] != null && j !== i) win.push(len[j]!);
      if (win.length < 4) continue;
      if (l <= median(win) * BONE_LONG) continue;
      const dA = deviation(i, A) ?? 0, dB = deviation(i, B) ?? 0;
      const blame = dA >= dB ? A : B;
      if (Math.max(dA, dB) > BONE_BLAME_BH) mark(i, blame, 'invalidBone');
    }
  }

  // ── 5. FRAME LAYOUT GATE: a sustained wrong layout (legs where arms belong, a
  // hallucinated body on a small player) passes every per-joint test above because
  // its neighbours are wrong too. Judge the frame by a limb-CLASS invariant that
  // foreshortening does not break: arm bones (shoulder–elbow, elbow–wrist) are
  // shorter than leg bones (hip–knee, knee–ankle) — about 0.20 vs 0.31 of body
  // height. A frame whose arms are longer than its legs, or whose shoulders / hips /
  // ankles are vertically inverted while arms are not clearly shorter than legs,
  // has the limbs assigned to the wrong body parts. It is dropped = treated exactly
  // like a missed detection (playback interpolates across short holes, snaps across
  // long ones). (A first version compared each bone with its own local median;
  // that marginally caught arm↔leg swaps and also fired on serve foreshortening.)
  const dropped = noDrops();
  const meanLen = (i: number, bones: ReadonlyArray<readonly [string, string]>) => {
    const v: number[] = [];
    for (const [A, B] of bones) if (valid(i, A) && valid(i, B)) v.push(d(idx[i].get(A)!, idx[i].get(B)!));
    return v.length >= 2 ? v.reduce((x, y) => x + y, 0) / v.length : null;
  };
  const ARM_BONES = BONES.slice(0, 4), LEG_BONES = BONES.slice(4, 8);
  const mean = (ks: Array<{ y: number } | null | undefined>) => { const v = ks.filter((k): k is { y: number } => !!k); return v.length ? v.reduce((a, k) => a + k.y, 0) / v.length : null; };
  const rows = out.map((_, i) => {
    const arm = meanLen(i, ARM_BONES), leg = meanLen(i, LEG_BONES);
    if (arm == null || leg == null) return null;
    const sh = mean([valid(i, 'left_shoulder'), valid(i, 'right_shoulder')]);
    const hip = mean([valid(i, 'left_hip'), valid(i, 'right_hip')]);
    const an = mean([valid(i, 'left_ankle'), valid(i, 'right_ankle')]);
    const inverted = sh != null && hip != null && an != null && !(sh < hip - ORDER_MARGIN_BH * BH && hip < an - ORDER_MARGIN_BH * BH);
    return { arm, leg, inverted };
  });
  // Orientation guard: the vertical-order rule only makes sense for an UPRIGHT clip. If most
  // frames are "inverted" the video is rotated / sideways, so that rule is switched off for the track.
  const measured = rows.filter((r) => r != null).length;
  const invertedShare = measured ? rows.filter((r) => r?.inverted).length / measured : 0;
  const useOrder = invertedShare <= 0.5;
  rows.forEach((r, i) => {
    if (!r) return;
    if (r.arm > r.leg * ARM_OVER_LEG || (useOrder && r.inverted && r.arm > r.leg * INVERTED_ARM_OVER_LEG)) { dropped[i] = true; report.droppedFrames++; }
  });

  for (const key of bad) {
    const [si, n] = key.split('|');
    const k = idx[+si].get(n);
    if (k) k.score = Math.min(k.score, INVALID_SCORE);
  }
  return { samples: out, report, dropped };
}
