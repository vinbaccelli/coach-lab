/**
 * Simulation of the LIVE skeleton path (AI Track OFF): what is on screen at each
 * render time versus where the player actually is in the frame being shown.
 *
 * Models, at 1× playback (video time = wall time):
 *   capture at t_c → inference takes `latencyMs` → result arrives at t_a = t_c + L
 *   → smoothing (One Euro, timed by ARRIVAL like poseWorkerBridge does)
 *   → render loop shows a pose at 60 Hz.
 * Detection runs back-to-back (the next capture starts when a result lands), the
 * pace a worker that is always busy settles at.
 *
 * `legacy` reproduces the current code (Canvas.tsx prev→latest interpolation +
 * SPORT_ONE_EURO). Other modes are the candidate fixes. This is a MODEL: it
 * says which design is closer to the truth, not what a given phone measures.
 */
import { OneEuroKeypointSmoother, type OneEuroParams } from '../keypointSmooth';
import type { Pose, Seq } from './metrics';
import { gauss, mulberry32 } from './synthetic';
import { continuePose } from '../liveDisplay';

export type LiveMode =
  | { kind: 'legacy' }                                  // previous: One Euro SPORT + interpolate prev→latest
  | { kind: 'continue' }                                // shipped: lib/liveDisplay.continuePose over the same One Euro samples
  | { kind: 'hold'; oneEuro: OneEuroParams }            // latest sample held, no interpolation
  | { kind: 'predict'; oneEuro: OneEuroParams; capMs: number; latencyShare?: number }; // latest + bounded velocity extrapolation over (age + share × latency); share 0 = pure continuation, 1 = full compensation

export interface LiveSimOpts {
  /** Ground truth sampled finely (e.g. 240 Hz). */
  truth: Seq;
  truthFps: number;
  latencyMs: number;
  /** Extra per-detection overhead (bitmap capture, postMessage), ms. */
  overheadMs?: number;
  noisePx?: number;
  seed?: number;
  renderHz?: number;
  mode: LiveMode;
}

const names = (p: Pose) => Object.keys(p);
const at = (truth: Seq, fps: number, tMs: number): Pose => truth[Math.max(0, Math.min(truth.length - 1, Math.round((tMs / 1000) * fps)))] as Pose;

/** Returns the displayed pose sequence at render times (and their times in ms). */
export function simulateLive(o: LiveSimOpts): { shown: Pose[]; times: number[] } {
  const rng = mulberry32(o.seed ?? 1);
  const dur = (o.truth.length / o.truthFps) * 1000;
  const L = o.latencyMs, ovh = o.overheadMs ?? 5, noise = o.noisePx ?? 3;
  const smoother = new OneEuroKeypointSmoother(o.mode.kind === 'legacy' || o.mode.kind === 'continue' ? undefined : o.mode.oneEuro);

  type Sample = { ts: number; capture: number; kps: Array<{ name: string; x: number; y: number; score: number }> };
  const samples: Sample[] = [];
  for (let tc = 0; tc + L < dur; tc += L + ovh) {
    const tr = at(o.truth, o.truthFps, tc);
    const raw = names(tr).map((n) => ({ name: n, x: tr[n].x + gauss(rng) * noise, y: tr[n].y + gauss(rng) * noise, score: 0.9 }));
    const ta = tc + L;
    const sm = smoother.apply(raw, ta) as Sample['kps'];
    samples.push({ ts: ta, capture: tc, kps: sm });
  }

  const shown: Pose[] = [], times: number[] = [];
  const step = 1000 / (o.renderHz ?? 60);
  for (let r = 0; r < dur; r += step) {
    // newest sample that has arrived by r
    let k = -1;
    for (let i = 0; i < samples.length; i++) if (samples[i].ts <= r) k = i; else break;
    if (k < 0) continue;
    const latest = samples[k], prev = samples[k - 1];
    const toPose = (arr: Sample['kps']): Pose => Object.fromEntries(arr.map((p) => [p.name, { x: p.x, y: p.y, vis: p.score }]));
    let kps = latest.kps;
    if (o.mode.kind === 'legacy' && prev) {
      // Canvas.tsx: a = clamp(age / interval), interval = clamp(latest.ts - prev.ts, 20..300)
      const interval = Math.min(300, Math.max(20, latest.ts - prev.ts));
      const a = Math.min(1, Math.max(0, (r - latest.ts) / interval));
      kps = latest.kps.map((q, i) => ({ ...q, x: prev.kps[i].x + (q.x - prev.kps[i].x) * a, y: prev.kps[i].y + (q.y - prev.kps[i].y) * a }));
    } else if (o.mode.kind === 'continue' && prev) {
      kps = continuePose(latest, prev, r) as Sample['kps'];
    } else if (o.mode.kind === 'predict' && prev) {
      // velocity (px/ms) from the two newest samples, projected over how old the latest is + the measured latency.
      const dt = Math.max(1, latest.ts - prev.ts);
      const horizon = Math.min(o.mode.capMs, (r - latest.ts) + (o.mode.latencyShare ?? 1) * L);
      kps = latest.kps.map((q, i) => ({ ...q, x: q.x + ((q.x - prev.kps[i].x) / dt) * horizon, y: q.y + ((q.y - prev.kps[i].y) / dt) * horizon }));
    }
    shown.push(toPose(kps));
    times.push(r);
  }
  return { shown, times };
}

/** Error of what is shown vs the truth AT THE SAME RENDER TIME (the frame on screen), plus best-fit lag in ms. */
export function liveScore(truth: Seq, truthFps: number, shown: Pose[], times: number[], joint = 'right_wrist', bodyPx = 480) {
  const err: number[] = [];
  for (let i = 0; i < shown.length; i++) {
    const t = at(truth, truthFps, times[i]);
    err.push(Math.hypot(shown[i][joint].x - t[joint].x, shown[i][joint].y - t[joint].y) / bodyPx);
  }
  // best lag: shift truth earlier by s ms, find s with the lowest error (positive = display behind the player)
  let best = 0, bestE = Infinity;
  for (let s = -60; s <= 400; s += 5) {
    let e = 0, c = 0;
    for (let i = 0; i < shown.length; i++) {
      const t = at(truth, truthFps, times[i] - s);
      e += (shown[i][joint].x - t[joint].x) ** 2 + (shown[i][joint].y - t[joint].y) ** 2; c++;
    }
    if (c && e / c < bestE) { bestE = e / c; best = s; }
  }
  const sorted = [...err].sort((a, b) => a - b);
  // peak 3-frame wrist displacement at the render rate, shown ÷ truth
  const pk = (pts: Array<{ x: number; y: number }>) => { let m = 0; for (let i = 3; i < pts.length; i++) m = Math.max(m, Math.hypot(pts[i].x - pts[i - 3].x, pts[i].y - pts[i - 3].y)); return m; };
  // stair-stepping: share of render frames where the wrist is frozen while the player is clearly moving
  let frozen = 0, moving = 0;
  for (let i = 1; i < shown.length; i++) {
    const tm = Math.hypot(at(truth, truthFps, times[i])[joint].x - at(truth, truthFps, times[i - 1])[joint].x, at(truth, truthFps, times[i])[joint].y - at(truth, truthFps, times[i - 1])[joint].y);
    if (tm > 2) { moving++; if (Math.hypot(shown[i][joint].x - shown[i - 1][joint].x, shown[i][joint].y - shown[i - 1][joint].y) < 0.2) frozen++; }
  }
  const tp = pk(times.map((t) => at(truth, truthFps, t)[joint]));
  return {
    meanErr: err.reduce((a, b) => a + b, 0) / err.length,
    p95Err: sorted[Math.floor(sorted.length * 0.95)],
    maxErr: sorted[sorted.length - 1],
    lagMs: best,
    frozenFrac: moving ? frozen / moving : 0,
    peakRatio: tp > 0 ? pk(shown.map((p) => p[joint])) / tp : NaN,
  };
}

/**
 * LOOK-AHEAD live path: detection runs on a second video kept `lead` ahead of the
 * displayed one; each result is stored under the VIDEO time of the frame it describes
 * and displayed when the playhead reaches that time (interpolated between neighbours,
 * exactly like a baked track). `rate` = playback speed (1 = real time).
 * Returns the shown pose at each render time, with `times` in VIDEO milliseconds
 * (so liveScore compares against the truth of the frame actually on screen).
 */
export function simulateLookAhead(o: {
  truth: Seq; truthFps: number; latencyMs: number; rate: number;
  overheadMs?: number; marginMs?: number; noisePx?: number; seed?: number; renderHz?: number; cubic?: boolean; smoothing?: 'sport' | 'none';
}): { shown: Pose[]; times: number[]; samplesPerVideoSec: number } {
  const rng = mulberry32(o.seed ?? 1);
  const dur = (o.truth.length / o.truthFps) * 1000;            // video ms
  const L = o.latencyMs, ovh = o.overheadMs ?? 5, margin = o.marginMs ?? 30;
  const lead = (L + margin) * o.rate;                          // video ms the second decoder runs ahead
  const smoother = new OneEuroKeypointSmoother(o.smoothing === 'none' ? { minCutoff: 1000, beta: 0, dCutoff: 1000 } : undefined);
  type S = { t: number; kps: Array<{ name: string; x: number; y: number; score: number }> };
  const buf: S[] = [];
  const wallEnd = dur / o.rate;
  for (let tcw = 0; tcw + L < wallEnd; tcw += L + ovh) {
    const tv = Math.min(dur - 1, tcw * o.rate + lead);          // video time of the captured (ahead) frame
    const tr = at(o.truth, o.truthFps, tv);
    const raw = names(tr).map((n) => ({ name: n, x: tr[n].x + gauss(rng) * (o.noisePx ?? 3), y: tr[n].y + gauss(rng) * (o.noisePx ?? 3), score: 0.9 }));
    buf.push({ t: tv, kps: smoother.apply(raw, tcw + L) as S['kps'] });
  }
  const shown: Pose[] = [], times: number[] = [];
  const step = 1000 / (o.renderHz ?? 60);
  for (let rw = 0; rw < wallEnd; rw += step) {
    const p = rw * o.rate;                                      // playhead, video ms
    // only results that have ARRIVED by wall time rw are usable: capture wall time + L ≤ rw
    const usable = buf.filter((_, i) => i * (L + ovh) + L <= rw);
    if (!usable.length) continue;
    let ia = 0, ib = usable.length - 1;
    for (let i = 0; i < usable.length; i++) { if (usable[i].t <= p) ia = i; if (usable[i].t >= p) { ib = i; break; } }
    const a = usable[ia], b = usable[ib];
    const f = b.t === a.t ? 1 : Math.min(1, Math.max(0, (p - a.t) / (b.t - a.t)));
    const pose: Pose = {};
    a.kps.forEach((q, i) => {
      const w = b.kps[i];
      if (!o.cubic || ib === ia) { pose[q.name] = { x: q.x + (w.x - q.x) * f, y: q.y + (w.y - q.y) * f, vis: q.score }; return; }
      const z = usable[Math.max(0, ia - 1)].kps[i], y3 = usable[Math.min(usable.length - 1, ib + 1)].kps[i];
      const t0 = usable[Math.max(0, ia - 1)].t, t3 = usable[Math.min(usable.length - 1, ib + 1)].t, dt = b.t - a.t;
      const herm = (p0: number, p1: number, p2: number, p3: number) => {
        const m1 = ((p2 - p0) / Math.max(1, b.t - t0)) * dt, m2 = ((p3 - p1) / Math.max(1, t3 - a.t)) * dt;
        const f2 = f * f, f3 = f2 * f;
        return (2 * f3 - 3 * f2 + 1) * p1 + (f3 - 2 * f2 + f) * m1 + (-2 * f3 + 3 * f2) * p2 + (f3 - f2) * m2;
      };
      pose[q.name] = { x: herm(z.x, q.x, w.x, y3.x), y: herm(z.y, q.y, w.y, y3.y), vis: q.score };
    });
    shown.push(pose); times.push(p);
  }
  return { shown, times, samplesPerVideoSec: (buf.length / dur) * 1000 };
}
