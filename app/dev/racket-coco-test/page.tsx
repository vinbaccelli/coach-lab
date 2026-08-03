'use client';

/**
 * TEMP-DEBUG-RACKETCOCO — THROWAWAY MEASUREMENT HARNESS. DELETE WITH THIS TAG.
 *
 * Not a feature. Not wired to anything. It exists to answer one deferred
 * question with numbers instead of opinion:
 *
 *   Does COCO-SSD ('tennis racket') fire RELIABLY on the frames of a real swing
 *   where the racket is clearly visible — reliably enough to ANCHOR a temporal
 *   trajectory model that interpolates across the blurred frames?
 *
 * It is under /dev/ deliberately: middleware.ts excludes `/dev/*` from the
 * Supabase auth gate when NODE_ENV !== 'production', so this page is readable
 * from an unauthenticated browser on the dev server. In a production build the
 * route is auth-gated like any other AND the component renders nothing.
 *
 * WHAT IT MEASURES, per frame, over an evenly-spaced batch (default 15 — the
 * Motion Layer batch size):
 *   - EVERY COCO prediction (class + score + box), not just the racket ones, so
 *     false positives and competing detections are visible rather than filtered
 *     away before they can be counted.
 *   - The same detection run TWICE: once on the normalized ImageBitmap the mask
 *     pipeline actually consumes, and once on the <video> ELEMENT, which is what
 *     the production `detectTennisRacketNorm` consumes. If those two disagree in
 *     box coordinates, the rotation-normalization question is answered visually
 *     and numerically in the same run.
 *   - A BLUR SCORE (variance of Laplacian) for the whole frame and for the
 *     skeleton-derived racket zone specifically. This is the discriminator for
 *     "does it fire on the CLEAR frames": hit-rate alone cannot distinguish
 *     "fires randomly" from "fires whenever the racket is sharp".
 *   - The frame-exact pose, so wrist positions come out of the SAME run — that
 *     is the trajectory input the temporal design needs, measured on the same
 *     frames as the detections it would be anchored to.
 *
 * Everything lands on `window.__racketCocoResults` as plain JSON for reading
 * over an eval, and is drawn as annotated thumbnails for the eyeball check.
 *
 * Capture uses `createCaptureSource`'s private element — the real pipeline's
 * element — but seeks and grabs it HERE rather than via `CaptureSource.capture()`.
 * Two reasons, one practical and one that is the whole point of the probe:
 *
 *   1. `capture()` routes into `captureFrameFromElement`, which awaits a bare
 *      requestAnimationFrame (captureFrame.ts:147) with no timeout fallback. rAF
 *      does not fire in a hidden or backgrounded tab, so that await never settles
 *      and the capture hangs forever with no error. Already documented as a latent
 *      defect in committed code by the mask-surface Phase 1 harness; not fixed
 *      here, since the capture primitive is out of scope. PRACTICAL CONSEQUENCE:
 *      this page is immune, but keep the tab visible anyway when running the real
 *      Motion Layer flow.
 *
 *   2. Grabbing here lets the probe capture BOTH representations of every frame —
 *      the RAW `createImageBitmap(video)` decode and the canvas re-grab that
 *      `normalizedFrameBitmap` performs — and compare them. That is a direct,
 *      empirical answer to "does the re-grab genuinely re-orient the frame, or
 *      does it squash a landscape decode into a portrait canvas", which no amount
 *      of reading the capture code can settle. `orientationProbe` in the summary,
 *      and the RAW-vs-NORMALIZED thumbnail pair at the top, report it.
 *
 * The normalized canvas is built with the exact same two statements the shipped
 * `normalizedFrameBitmap` uses, so what is measured is what the pipeline gets.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createCaptureSource, type CaptureSource } from '@/lib/stroMotionDraft';
import { estimateTennisRacketZones, type StroMotionPoseKeypoint } from '@/lib/stroMotionPose';
import { fitRacketTrajectory, type RacketFrameSweep } from '@/lib/stroMotionDraft/racketTrajectory';

const DEV = process.env.NODE_ENV !== 'production';

/** Elongated sport implements COCO can localize — mirrors racketCocoDetect.ts. */
const IMPLEMENT_CLASSES = new Set(['tennis racket', 'baseball bat']);

/** Deliberately BELOW the production 0.32/0.22 floors: we want to see the weak
 *  detections production discards, because "fires at 0.2 on every clear frame"
 *  and "never fires" are completely different answers for a trajectory anchor. */
const PROBE_MIN_SCORE = 0.1;
const PROBE_MAX_DETECTIONS = 30;

interface Pred {
  class: string;
  score: number;
  /** [x, y, w, h] in the coordinate space of whatever was handed to detect(). */
  bbox: [number, number, number, number];
}

interface Kp { x: number; y: number; score: number; name: string }

interface FrameRow {
  i: number;
  t: number;
  /** Dimensions of the normalized frame (equals videoWidth/Height by construction). */
  frameW: number;
  frameH: number;
  /** Dimensions the ELEMENT reports — the space production normalizes bboxes by. */
  elW: number;
  elH: number;
  /** What `createImageBitmap(video)` ACTUALLY returned before normalization. */
  rawW: number;
  rawH: number;
  /** True when raw ≠ element, i.e. the shipped normalizer would log its warning. */
  neededRegrab: boolean;
  /** Variance-of-Laplacian. Higher = sharper. */
  blurFrame: number;
  blurZone: number | null;
  /** All predictions on the normalized bitmap (via canvas). */
  preds: Pred[];
  /** All predictions on the <video> element — the production input type. */
  elPreds: Pred[];
  /** Implement-class subset of `preds`, best-first. */
  rackets: Pred[];
  /** What production's nearest-to-subject rule would pick, normalized 0..1. */
  productionPick: { x: number; y: number; w: number; h: number; score: number } | null;
  wristL: Kp | null;
  wristR: Kp | null;
  elbowL: Kp | null;
  elbowR: Kp | null;
  zone: { x0: number; y0: number; x1: number; y1: number } | null;
  poseOk: boolean;
  /** Distance from the best racket box centre to the nearer wrist, in px. */
  boxToWristPx: number | null;
  ms: number;
}

let modelPromise: Promise<import('@tensorflow-models/coco-ssd').ObjectDetection> | null = null;

/** Same loader shape as racketCocoDetect.ts — one instance, reused per run. */
async function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      try { await tf.setBackend('webgl'); } catch { await tf.setBackend('cpu'); }
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      return cocoSsd.load({ base: 'mobilenet_v2' });
    })();
  }
  return modelPromise;
}

/**
 * Variance of the Laplacian over a region — the standard cheap sharpness proxy.
 * Motion blur suppresses high-frequency content, so a blurred racket zone scores
 * low. Computed on luminance at native resolution inside the region only.
 */
function laplacianVariance(
  data: Uint8ClampedArray, w: number, h: number,
  x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1,
): number | null {
  const ax0 = Math.max(1, Math.floor(x0));
  const ay0 = Math.max(1, Math.floor(y0));
  const ax1 = Math.min(w - 2, Math.ceil(x1));
  const ay1 = Math.min(h - 2, Math.ceil(y1));
  if (ax1 <= ax0 || ay1 <= ay0) return null;

  const lum = (i: number) =>
    0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];

  let sum = 0, sumSq = 0, n = 0;
  for (let y = ay0; y <= ay1; y++) {
    for (let x = ax0; x <= ax1; x++) {
      const i = y * w + x;
      const lap = 4 * lum(i) - lum(i - 1) - lum(i + 1) - lum(i - w) - lum(i + w);
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (n < 16) return null;
  const mean = sum / n;
  return Math.round((sumSq / n - mean * mean) * 100) / 100;
}

/**
 * Event-driven seek, NO requestAnimationFrame anywhere — see the header note.
 * Mirrors the mask-surface harnesses' `grabFrame`.
 */
async function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const target = Math.max(
    0,
    Math.min(timeSec, Number.isFinite(video.duration) ? Math.max(0, video.duration - 1e-6) : timeSec),
  );
  video.pause();
  if (Math.abs(video.currentTime - target) < 0.001) return;
  await new Promise<void>((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = target;
    window.setTimeout(done, 3000);
  });
}

/**
 * The NORMALIZER, replicated statement-for-statement from `normalizedFrameBitmap`
 * (captureFrame.ts) — re-draw from the ELEMENT at videoWidth×videoHeight. Returns
 * the raw decode alongside it so the two can be compared rather than assumed
 * equivalent.
 */
async function grabBoth(video: HTMLVideoElement, into: HTMLCanvasElement): Promise<{
  rawW: number; rawH: number; normW: number; normH: number; neededRegrab: boolean;
}> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const raw = await createImageBitmap(video);
  const rawW = raw.width, rawH = raw.height;
  const neededRegrab = !(rawW === w && rawH === h);
  const ctx = into.getContext('2d', { willReadFrequently: true });
  if (!ctx) { raw.close(); throw new Error('no 2d context'); }

  into.width = w;
  into.height = h;
  // Exactly what the shipped normalizer does on disagreement: draw from the
  // ELEMENT (not from the mismatched bitmap), which is where the claimed display
  // correction would be applied if the engine applies one at all.
  ctx.drawImage(video, 0, 0, w, h);
  raw.close();
  return { rawW, rawH, normW: w, normH: h, neededRegrab };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * STAGE-2 FIT SELF-TEST — exercises the SHIPPED `fitRacketTrajectory`.
 *
 * SCOPE, STATED PLAINLY: this checks the fitter's ALGEBRA only — unwrapping,
 * RANSAC outlier rejection, hand selection, and rectification of frames that
 * measured nothing. It says NOTHING about whether the Stage-1 sweep finds real
 * rackets in real pixels; only Vin's footage can answer that, and no synthetic
 * image would (it would pass by construction, which is exactly the trap the
 * match-decoder work already paid for).
 *
 * It is here because a sign error in the quadratic or a bad unwrap would put the
 * axis somewhere plausible-looking but wrong, and finding that out through a
 * round-trip on real footage would be slow and ambiguous. Deterministic: the
 * "noise" is a fixed function of the frame index, never Math.random.
 */
function runFitSelfTest(): string[] {
  const out: string[] = [];
  const DEGR = Math.PI / 180;
  const N = 15;
  // Ground truth: a swing arc, quadratic in t, wrapping through 0° on purpose so
  // the unwrap is genuinely exercised rather than incidentally avoided.
  const truth = (t: number) => -0.5 + 2.6 * t - 0.9 * t * t;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  /**
   * Deterministic non-polynomial scramble. It must NOT be `(i*k) % 360` or any
   * polynomial in i: those are exactly linear/quadratic ramps modulo a turn, so a
   * quadratic fitter fits them PERFECTLY and "incoherent" test data turns out to
   * be the most coherent input possible. (First version of this test did that and
   * reported a hand-selection bug that did not exist.)
   */
  const scramble = (i: number) => {
    const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return (v - Math.floor(v)) * 2 * Math.PI;
  };

  const mk = (i: number): RacketFrameSweep => {
    const t = (i / (N - 1)) * 1.4;
    // Deterministic ±2° wobble.
    const jitter = ((i * 37) % 5 - 2) * DEGR;
    const OUTLIER = i === 3 || i === 9;      // confident but wrong → RANSAC must drop
    const BLIND = i === 5 || i === 6 || i === 11; // no peak → must be rectified
    const right = BLIND
      ? null
      : {
          theta: wrap(OUTLIER ? truth(t) + 100 * DEGR : truth(t) + jitter),
          confidence: 3.4,
          peakEnergy: 120,
          reachPx: 180,
        };
    return {
      frameIndex: i,
      timeSec: t,
      // The wrong hand carries a confident but incoherent direction, so hand
      // selection has to be decided by COHERENCE, not by confidence.
      left: { theta: wrap(scramble(i)), confidence: 3.9, peakEnergy: 200, reachPx: 200 },
      right,
      profileLeft: null,
      profileRight: null,
      wristLeft: { x: 100, y: 100 },
      wristRight: { x: 500, y: 400 },
      forearmLeftPx: 90,
      forearmRightPx: 90,
      reason: 'synthetic',
    };
  };

  const sweeps = Array.from({ length: N }, (_, i) => mk(i));
  const traj = fitRacketTrajectory(sweeps);

  const ok = (label: string, cond: boolean, detail = '') =>
    out.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

  ok('batch accepted', traj.accepted, traj.reason);
  if (!traj.accepted) return out;

  ok('picked the RIGHT hand (coherence beats confidence)', traj.hand === 'right', `got ${traj.hand}`);
  ok('emitted an axis for every frame', traj.axes.length === N, `${traj.axes.length}/${N}`);

  // Rectification: every frame within a few degrees of truth, INCLUDING the three
  // that measured nothing and the two that measured something wrong.
  let worst = 0, worstAt = -1;
  for (const a of traj.axes) {
    const d = Math.abs(wrap(a.theta - truth(a.timeSec))) / DEGR;
    if (d > worst) { worst = d; worstAt = a.frameIndex; }
  }
  ok('every frame within 6° of truth', worst < 6, `worst ${worst.toFixed(1)}° at frame ${worstAt}`);

  const blind = traj.axes.filter((a) => [5, 6, 11].includes(a.frameIndex));
  ok('blurred frames marked "fitted"', blind.every((a) => a.source === 'fitted'),
    blind.map((a) => `${a.frameIndex}:${a.source}`).join(' '));

  const outl = traj.axes.filter((a) => [3, 9].includes(a.frameIndex));
  ok('confident-but-wrong frames marked "rejected"', outl.every((a) => a.source === 'rejected'),
    outl.map((a) => `${a.frameIndex}:${a.source}`).join(' '));

  ok('knots exclude the outliers', traj.knots === N - 5, `knots=${traj.knots} expected ${N - 5}`);
  ok('residual is small', traj.residualRmsDeg < 5, `${traj.residualRmsDeg.toFixed(2)}°`);

  // NEGATIVE TEST — incoherent input must be REFUSED, not fitted. This is the
  // doctrine gate: no racket beats a wrong racket.
  const noise = Array.from({ length: N }, (_, i) => {
    const s = mk(i);
    return {
      ...s,
      right: { theta: wrap(scramble(i + 500)), confidence: 3.5, peakEnergy: 150, reachPx: 150 },
    };
  });
  const bad = fitRacketTrajectory(noise);
  ok(
    'incoherent batch REFUSED',
    !bad.accepted,
    bad.accepted
      ? `ACCEPTED GARBAGE: hand=${bad.hand} knots=${bad.knots} rms=${bad.residualRmsDeg.toFixed(2)}°`
      : bad.reason,
  );

  return out;
}

export default function RacketCocoTestPage() {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcLabel, setSrcLabel] = useState<string>('(none)');
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(2);
  const [frameCount, setFrameCount] = useState(15);
  const [runElementPath, setRunElementPath] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [rows, setRows] = useState<FrameRow[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  const ownedUrlRef = useRef<string | null>(null);
  const thumbsRef = useRef<HTMLDivElement | null>(null);

  const say = useCallback((m: string) => {
    // eslint-disable-next-line no-console
    console.log('[racket-coco]', m);
    setLog((l) => [...l, m]);
  }, []);

  useEffect(() => () => {
    if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
  }, []);

  const pickFile = useCallback((f: File | null) => {
    if (!f) return;
    if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
    const url = URL.createObjectURL(f);
    ownedUrlRef.current = url;
    setSrcUrl(url);
    setSrcLabel(`${f.name} (${(f.size / 1e6).toFixed(1)} MB)`);
  }, []);

  const useDemo = useCallback(() => {
    if (ownedUrlRef.current) { URL.revokeObjectURL(ownedUrlRef.current); ownedUrlRef.current = null; }
    setSrcUrl('/demo.mp4');
    setSrcLabel('/demo.mp4');
  }, []);

  const run = useCallback(async () => {
    if (!srcUrl || busy) return;
    setBusy(true);
    setRows([]);
    setSummary(null);
    setLog([]);
    if (thumbsRef.current) thumbsRef.current.innerHTML = '';

    let source: CaptureSource | null = null;
    const out: FrameRow[] = [];

    try {
      say(`loading COCO-SSD (mobilenet_v2)…`);
      const model = await getModel();
      say(`model ready`);

      source = createCaptureSource(srcUrl);
      await source.ready(20000);
      const el = source.element;
      say(`source ready: element ${el.videoWidth}x${el.videoHeight}, duration ${el.duration.toFixed(2)}s`);

      const { acquirePoseDetector } = await import('@/lib/sharedPoseDetector');
      const det = await acquirePoseDetector();
      say(`pose detector ready`);

      const a = Math.max(0, Math.min(startSec, endSec));
      const b = Math.max(a + 0.001, Math.max(startSec, endSec));
      const N = Math.max(1, Math.min(60, Math.round(frameCount)));

      const cnv = document.createElement('canvas');
      const ctx = cnv.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');

      // ── PART A visual: RAW decode vs NORMALIZED re-grab, same instant ──────
      // The numbers can only say the sizes differ. Only the pictures can say
      // whether the re-grab ROTATED the frame (upright person) or SQUASHED it
      // (person compressed along one axis). Rendered once, at the first sample.
      {
        await seekTo(el, a);
        const rawBmp = await createImageBitmap(el);
        // Read the dimensions BEFORE close() — a closed bitmap reports 0x0.
        const rW = rawBmp.width, rH = rawBmp.height;
        const mk = (label: string, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, aw: number, ah: number) => {
          const c = document.createElement('canvas');
          const TW = 220;
          c.width = TW; c.height = Math.round((TW / aw) * ah);
          const cc = c.getContext('2d');
          if (cc) draw(cc, c.width, c.height);
          const cell = document.createElement('div');
          cell.style.cssText = 'display:inline-block;margin:4px 12px 4px 0;vertical-align:top;font:11px monospace;color:#0f6';
          const cap = document.createElement('div');
          cap.textContent = label;
          cell.appendChild(c); cell.appendChild(cap);
          thumbsRef.current?.appendChild(cell);
        };
        mk(`RAW createImageBitmap ${rW}x${rH}`,
          (c, w2, h2) => c.drawImage(rawBmp, 0, 0, w2, h2), rW, rH);
        mk(`NORMALIZED re-grab ${el.videoWidth}x${el.videoHeight}`,
          (c, w2, h2) => c.drawImage(el, 0, 0, w2, h2), el.videoWidth, el.videoHeight);
        rawBmp.close();
        say(`orientation probe: raw=${rW}x${rH} element=${el.videoWidth}x${el.videoHeight}`);
      }

      for (let i = 0; i < N; i++) {
        const t = N === 1 ? a : a + ((b - a) * i) / (N - 1);
        const t0 = performance.now();

        // Seek the pipeline's own private element, then materialize BOTH the raw
        // decode and the normalizer's output. `cnv` ends up holding exactly what
        // `normalizedFrameBitmap` would have returned.
        await seekTo(el, t);
        const dims = await grabBoth(el, cnv);
        const img = ctx.getImageData(0, 0, cnv.width, cnv.height);

        // 1. COCO on the normalized bitmap (what Motion Layer would consume).
        const preds = (await model.detect(cnv, PROBE_MAX_DETECTIONS, PROBE_MIN_SCORE)) as unknown as Pred[];

        // 2. COCO on the ELEMENT (what production detectTennisRacketNorm consumes).
        //    Element is still parked at `t` from the capture above.
        let elPreds: Pred[] = [];
        if (runElementPath) {
          elPreds = (await model.detect(el, PROBE_MAX_DETECTIONS, PROBE_MIN_SCORE)) as unknown as Pred[];
        }

        // 3. Frame-exact pose on the SAME bitmap.
        let kps: Kp[] = [];
        try {
          const poses = await det.estimatePoses(cnv as unknown as HTMLCanvasElement, { flipHorizontal: false });
          const raw = poses?.[0]?.keypoints as Array<{ x: number; y: number; score?: number; name?: string }> | undefined;
          kps = (raw ?? []).map((k) => ({ x: k.x, y: k.y, score: k.score ?? 0, name: k.name ?? '' }));
        } catch { /* pose failure is data, not a crash */ }

        const wristL = kps[9] ?? null;
        const wristR = kps[10] ?? null;
        const elbowL = kps[7] ?? null;
        const elbowR = kps[8] ?? null;

        // 4. Skeleton racket zone, in the bitmap's own pixel space.
        let zone: FrameRow['zone'] = null;
        if (kps.length >= 17) {
          const px: StroMotionPoseKeypoint[] = kps.map((k) => ({ x: k.x, y: k.y, score: k.score, name: k.name }));
          const combined = estimateTennisRacketZones(px, cnv.width, cnv.height).combined;
          if (combined) zone = { x0: combined.x0, y0: combined.y0, x1: combined.x1, y1: combined.y1 };
        }

        // 5. Sharpness — whole frame, and the racket zone specifically.
        const blurFrame = laplacianVariance(img.data, cnv.width, cnv.height) ?? 0;
        const blurZone = zone
          ? laplacianVariance(img.data, cnv.width, cnv.height, zone.x0, zone.y0, zone.x1, zone.y1)
          : null;

        const rackets = preds
          .filter((p) => IMPLEMENT_CLASSES.has(p.class))
          .sort((x, y) => y.score - x.score);

        // Production's rule, replicated: nearest implement to the subject hint
        // (here: the pose's wrist midpoint), padded 8%, normalized by ELEMENT dims.
        let productionPick: FrameRow['productionPick'] = null;
        let boxToWristPx: number | null = null;
        if (rackets.length) {
          const wr = wristR && wristR.score >= (wristL?.score ?? 0) ? wristR : wristL;
          let best = rackets[0];
          if (wr) {
            let bestD = Infinity;
            for (const c of rackets) {
              const cx = c.bbox[0] + c.bbox[2] / 2;
              const cy = c.bbox[1] + c.bbox[3] / 2;
              const d = Math.hypot(cx - wr.x, cy - wr.y);
              if (d < bestD) { bestD = d; best = c; }
            }
            boxToWristPx = Math.round(bestD);
          }
          const pad = 0.08;
          const bw = Math.max(4, best.bbox[2]) * (1 + pad);
          const bh = Math.max(4, best.bbox[3]) * (1 + pad);
          const bx = best.bbox[0] - Math.max(4, best.bbox[2]) * pad * 0.5;
          const by = best.bbox[1] - Math.max(4, best.bbox[3]) * pad * 0.5;
          productionPick = {
            x: Math.max(0, Math.min(1, bx / cnv.width)),
            y: Math.max(0, Math.min(1, by / cnv.height)),
            w: bw / cnv.width,
            h: bh / cnv.height,
            score: best.score,
          };
        }

        out.push({
          i, t: Math.round(t * 1000) / 1000,
          frameW: cnv.width, frameH: cnv.height,
          elW: el.videoWidth, elH: el.videoHeight,
          rawW: dims.rawW, rawH: dims.rawH, neededRegrab: dims.neededRegrab,
          blurFrame, blurZone,
          preds, elPreds, rackets, productionPick,
          wristL, wristR, elbowL, elbowR, zone,
          poseOk: kps.length >= 17,
          boxToWristPx,
          ms: Math.round(performance.now() - t0),
        });

        // Annotated thumbnail — the eyeball check for "is the box the racket".
        if (thumbsRef.current) {
          const th = document.createElement('canvas');
          const TW = 300;
          th.width = TW;
          th.height = Math.round((TW / cnv.width) * cnv.height);
          const tc = th.getContext('2d');
          if (tc) {
            const k = TW / cnv.width;
            tc.drawImage(cnv, 0, 0, th.width, th.height);
            if (zone) {
              tc.strokeStyle = 'rgba(0,255,255,0.85)'; tc.lineWidth = 1;
              tc.strokeRect(zone.x0 * k, zone.y0 * k, (zone.x1 - zone.x0) * k, (zone.y1 - zone.y0) * k);
            }
            for (const p of preds) {
              const isImp = IMPLEMENT_CLASSES.has(p.class);
              tc.strokeStyle = isImp ? '#c04cff' : 'rgba(255,180,0,0.55)';
              tc.lineWidth = isImp ? 2 : 1;
              tc.strokeRect(p.bbox[0] * k, p.bbox[1] * k, p.bbox[2] * k, p.bbox[3] * k);
              if (isImp) {
                tc.fillStyle = '#c04cff'; tc.font = '11px monospace';
                tc.fillText(`${p.score.toFixed(2)}`, p.bbox[0] * k + 2, p.bbox[1] * k - 2);
              }
            }
            for (const wr of [wristL, wristR]) {
              if (!wr || wr.score < 0.2) continue;
              tc.fillStyle = '#00ff66';
              tc.beginPath(); tc.arc(wr.x * k, wr.y * k, 3, 0, Math.PI * 2); tc.fill();
            }
          }
          const cell = document.createElement('div');
          cell.style.cssText = 'display:inline-block;margin:4px;vertical-align:top;font:11px monospace;color:#ccc';
          const cap = document.createElement('div');
          cap.textContent =
            `#${i} t=${t.toFixed(3)} racket=${rackets.length ? rackets[0].score.toFixed(2) : '—'} ` +
            `zoneSharp=${blurZone === null ? '—' : blurZone.toFixed(0)}`;
          cell.appendChild(th);
          cell.appendChild(cap);
          thumbsRef.current.appendChild(cell);
        }

        say(`#${i} t=${t.toFixed(3)} rackets=${rackets.length} best=${rackets[0]?.score.toFixed(3) ?? '—'} zoneSharp=${blurZone?.toFixed(1) ?? '—'} (${Math.round(performance.now() - t0)}ms)`);
      }

      // ── Summary ────────────────────────────────────────────────────────────
      const hits = out.filter((r) => r.rackets.length > 0);
      const scores = hits.map((r) => r.rackets[0].score);
      const sharpVals = out.map((r) => r.blurZone ?? 0).filter((v) => v > 0);
      const sharpMedian = median(sharpVals);
      const sharpFrames = out.filter((r) => (r.blurZone ?? 0) >= sharpMedian);
      const blurFrames = out.filter((r) => (r.blurZone ?? 0) < sharpMedian);
      const hitRateSharp = sharpFrames.length
        ? sharpFrames.filter((r) => r.rackets.length > 0).length / sharpFrames.length : 0;
      const hitRateBlur = blurFrames.length
        ? blurFrames.filter((r) => r.rackets.length > 0).length / blurFrames.length : 0;

      // Box-centre jitter between CONSECUTIVE frames that both fired.
      const jumps: number[] = [];
      for (let i = 1; i < out.length; i++) {
        const p = out[i - 1].productionPick, c = out[i].productionPick;
        if (!p || !c) continue;
        jumps.push(Math.hypot((c.x + c.w / 2) - (p.x + p.w / 2), (c.y + c.h / 2) - (p.y + p.h / 2)));
      }

      // ── ORIENTATION PROBE (PART A) ────────────────────────────────────────
      // Three spaces have to agree for motion-diff to subtract aligned pixels:
      // the raw decode, the normalizer's output, and the element's own report.
      // If `rawDiffersFromElement` is true on every frame, the shipped warning is
      // firing every frame — which is expected and fine PROVIDED the normalized
      // output is the one everything downstream consumes (it is: plate samples
      // and per-frame captures both come out of normalizedFrameBitmap).
      const orientationProbe = {
        raw: out.length ? `${out[0].rawW}x${out[0].rawH}` : null,
        normalized: out.length ? `${out[0].frameW}x${out[0].frameH}` : null,
        element: out.length ? `${out[0].elW}x${out[0].elH}` : null,
        rawDiffersFromElementOnAllFrames: out.every((r) => r.neededRegrab),
        rawDiffersFromElementOnSomeFrames: out.some((r) => r.neededRegrab),
        /** The frame the pipeline consumes is the normalized one, always. */
        normalizedMatchesElementOnAllFrames: out.every((r) => r.frameW === r.elW && r.frameH === r.elH),
        /** Was the raw decode merely TRANSPOSED (rotation) rather than a different picture? */
        rawIsTransposeOfElement: out.length
          ? out[0].rawW === out[0].elH && out[0].rawH === out[0].elW
          : null,
        note:
          'If rawIsTransposeOfElement is true, the decode carries rotation metadata the ' +
          'element applies and createImageBitmap does not. The visual RAW vs NORMALIZED ' +
          'thumbnails above are the verdict on whether the re-grab rotates or squashes.',
      };

      // Per-frame box cross-check between the two detection inputs.
      const orientation = out.map((r) => ({
        i: r.i,
        raw: `${r.rawW}x${r.rawH}`,
        normalized: `${r.frameW}x${r.frameH}`,
        element: `${r.elW}x${r.elH}`,
        normalizedRacket: r.rackets[0]?.bbox ?? null,
        elementRacket: r.elPreds.filter((p) => IMPLEMENT_CLASSES.has(p.class))[0]?.bbox ?? null,
      }));

      const sum = {
        source: srcLabel,
        frames: out.length,
        range: [startSec, endSec],
        hitRate: out.length ? hits.length / out.length : 0,
        scoreMin: scores.length ? Math.min(...scores) : null,
        scoreMedian: scores.length ? median(scores) : null,
        scoreMax: scores.length ? Math.max(...scores) : null,
        scoresAboveProd032: scores.filter((s) => s >= 0.32).length,
        multiRacketFrames: out.filter((r) => r.rackets.length > 1).length,
        poseOkFrames: out.filter((r) => r.poseOk).length,
        zoneSharpnessMedian: sharpMedian,
        hitRateOnSharperHalf: hitRateSharp,
        hitRateOnBlurrierHalf: hitRateBlur,
        boxCentreJumpMedianNorm: jumps.length ? median(jumps) : null,
        boxToWristPxMedian: median(out.map((r) => r.boxToWristPx ?? 0).filter((v) => v > 0)),
        otherClassesSeen: Array.from(new Set(out.flatMap((r) => r.preds.map((p) => p.class)))),
        orientationProbe,
        orientation,
      };

      setRows(out);
      setSummary(sum);
      (window as unknown as Record<string, unknown>).__racketCocoResults = { summary: sum, rows: out };
      // eslint-disable-next-line no-console
      console.log('[racket-coco] SUMMARY', sum);
      // eslint-disable-next-line no-console
      console.log('[racket-coco] window.__racketCocoResults is set');
      say(`DONE — hitRate=${(sum.hitRate * 100).toFixed(0)}% sharpHalf=${(hitRateSharp * 100).toFixed(0)}% blurHalf=${(hitRateBlur * 100).toFixed(0)}%`);
    } catch (e) {
      say(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
      // eslint-disable-next-line no-console
      console.error('[racket-coco]', e);
    } finally {
      source?.dispose();
      setBusy(false);
    }
  }, [srcUrl, srcLabel, startSec, endSec, frameCount, runElementPath, busy, say]);

  if (!DEV) return null;

  const box: React.CSSProperties = {
    background: '#111', color: '#ddd', padding: 16, font: '13px/1.5 monospace', minHeight: '100vh',
  };
  const inp: React.CSSProperties = {
    background: '#000', color: '#0f6', border: '1px solid #333', padding: '4px 6px', width: 90, marginRight: 12,
  };

  return (
    <div style={box}>
      <h1 style={{ font: 'bold 16px monospace', marginBottom: 4 }}>
        TEMP-DEBUG-RACKETCOCO — COCO-SSD racket reliability probe
      </h1>
      <p style={{ color: '#888', maxWidth: 900 }}>
        Throwaway. Measures whether COCO-SSD can ANCHOR a temporal racket trajectory:
        hit rate, score distribution, sharp-vs-blurred split, box stability, false
        positives. Frames come through the real <code>createCaptureSource</code> path,
        so these are the frames Motion Layer sees.
      </p>

      <div style={{ margin: '12px 0' }}>
        <button
          onClick={() => {
            const lines = runFitSelfTest();
            lines.forEach((l) => console.log('[fit-selftest]', l));
            (window as unknown as Record<string, unknown>).__fitSelfTest = lines;
            setLog(lines);
          }}
          style={{ ...inp, width: 'auto', cursor: 'pointer', color: '#ff0' }}
        >
          SELF-TEST STAGE-2 FIT
        </button>
      </div>

      <div style={{ margin: '12px 0' }}>
        <button onClick={useDemo} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>use /demo.mp4</button>
        <input type="file" accept="video/*" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        <span style={{ color: '#0f6', marginLeft: 8 }}>{srcLabel}</span>
      </div>

      <div style={{ margin: '12px 0' }}>
        start <input style={inp} type="number" step="0.1" value={startSec} onChange={(e) => setStartSec(+e.target.value)} />
        end <input style={inp} type="number" step="0.1" value={endSec} onChange={(e) => setEndSec(+e.target.value)} />
        frames <input style={inp} type="number" value={frameCount} onChange={(e) => setFrameCount(+e.target.value)} />
        <label style={{ marginRight: 12 }}>
          <input type="checkbox" checked={runElementPath} onChange={(e) => setRunElementPath(e.target.checked)} />
          {' '}also detect on &lt;video&gt; element (production input type)
        </label>
        <button
          onClick={run}
          disabled={!srcUrl || busy}
          style={{ ...inp, width: 'auto', cursor: busy ? 'wait' : 'pointer', color: busy ? '#888' : '#0f6' }}
        >
          {busy ? 'running…' : 'RUN'}
        </button>
      </div>

      {summary && (
        <pre style={{ background: '#000', border: '1px solid #333', padding: 10, overflowX: 'auto', maxWidth: '100%' }}>
          {JSON.stringify(summary, null, 2)}
        </pre>
      )}

      <div ref={thumbsRef} style={{ margin: '12px 0' }} />

      {rows.length > 0 && (
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#0f6' }}>
              {['#', 't', 'rackets', 'bestScore', 'zoneSharp', 'frameSharp', 'boxToWrist', 'pose', 'ms'].map((h) => (
                <th key={h} style={{ border: '1px solid #333', padding: '2px 8px', textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i} style={{ color: r.rackets.length ? '#ddd' : '#666' }}>
                <td style={{ border: '1px solid #333', padding: '2px 8px' }}>{r.i}</td>
                <td style={{ border: '1px solid #333', padding: '2px 8px' }}>{r.t.toFixed(3)}</td>
                <td style={{ border: '1px solid #333', padding: '2px 8px' }}>{r.rackets.length}</td>
                <td style={{ border: '1px solid #333', padding: '2px 8px' }}>{r.rackets[0]?.score.toFixed(3) ?? '—'}</td>
                <td style={{ border: '1px solid #333', padding: '2px 8px' }}>{r.blurZone?.toFixed(1) ?? '—'}</td>
                <td style={{ border: '1px solid #333', padding: '2px 8px' }}>{r.blurFrame.toFixed(1)}</td>
                <td style={{ border: '1px solid #333', padding: '2px 8px' }}>{r.boxToWristPx ?? '—'}</td>
                <td style={{ border: '1px solid #333', padding: '2px 8px' }}>{r.poseOk ? 'ok' : '—'}</td>
                <td style={{ border: '1px solid #333', padding: '2px 8px' }}>{r.ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <pre style={{ color: '#888', marginTop: 12 }}>{log.join('\n')}</pre>
    </div>
  );
}
