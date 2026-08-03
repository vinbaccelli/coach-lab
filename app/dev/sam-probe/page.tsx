'use client';

/**
 * TEMP-DEBUG-SAMPROBE — THROWAWAY MEASUREMENT HARNESS. DELETE WITH THE TAG.
 * =========================================================================
 *
 * Nothing in the app imports this. It writes nothing, saves nothing, and
 * touches no production module except two READ-ONLY helpers it deliberately
 * reuses so the numbers describe the real pipeline and not a lookalike:
 *
 *   - lib/mediapipePose.detectFullPoseOnFrame  → the SAME COCO-17 skeleton
 *     Motion Layer uses, in video pixels. The wrist/elbow this harness anchors
 *     to are therefore exactly the wrist/elbow production would anchor to.
 *
 * Route lives under /dev/, which middleware.ts leaves ungated in development.
 *
 * WHY THIS EXISTS
 * ---------------
 * The SAM feasibility pass established that in-browser promptable segmentation
 * is viable (size/licence/runtime all clear) but that SAM has NO client-side
 * video propagation and no cross-image identity. That left two questions
 * unanswered, and they are the two that decide the whole workflow:
 *
 *   (A) QUALITY — on Vin's REAL footage, does a click on the racket return the
 *       RACKET? Not the whole person, not a fragment. Including on the blurred,
 *       edge-on frames that killed every previous approach.
 *
 *   (B) THE ONE-CLICK DREAM — the racket is always at the hand, and we have the
 *       wrist on every frame. So: record ONE click as an offset relative to that
 *       frame's forearm (elbow→wrist), then re-place it on every other frame's
 *       forearm. If that lands the racket, the coach clicks ONCE for the whole
 *       batch instead of once per frame.
 *
 * Both are measured, not argued. Synthetic images are worthless here — they pass
 * by construction. Load Vin's real clip.
 *
 * WHAT "PROBE-ONLY" MEANS IN THIS FILE
 * ------------------------------------
 * Weights load from the HuggingFace CDN and transformers.js loads from jsDelivr.
 * That is deliberate and MUST NOT ship: production self-hosts every model under
 * /public/models (see multiclassSegmenter.ts — "SELF-HOSTED, NOT CDN"). Loading
 * remotely here avoids adding ~33MB of weights and an npm dependency to the repo
 * to answer a question that may come back "no". If the answer comes back "yes",
 * the weights get vendored properly at that point.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectFullPoseOnFrame, type PoseKeypoint } from '@/lib/mediapipePose';

// PROBE-ONLY sources — see the file header. Never copy these into production.
const TJS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
const SAM_REPO = 'onnx-community/sam2.1-hiera-tiny-ONNX';

/** Motion Layer's real sampling shape, so the frames match production. */
const DEFAULT_SPACING = 0.75;
const DEFAULT_COUNT = 5;

type Verdict = 'unrated' | 'racket' | 'person' | 'fragment' | 'miss';
type PointSource = 'manual' | 'transfer' | 'wrist-raw' | 'wrist-offset';
type Side = 'left' | 'right';

/** One click prompt. label 1 = "this IS the object", 0 = "this is NOT". */
interface Prompt {
  x: number;
  y: number;
  label: 0 | 1;
}

/** Per-frame display state. Heavy objects live in `heavyRef`, never in state. */
interface ProbeFrame {
  idx: number;
  t: number;
  w: number;
  h: number;
  poseOk: boolean;
  /** Wrist/elbow in VIDEO PIXELS, per side, for the anchor maths. */
  joints: Partial<Record<Side, { wrist: XY; elbow: XY; wScore: number; eScore: number }>>;
  encodeMs: number | null;
  prompts: Prompt[];
  pointSource: PointSource | null;
  decodeMs: number | null;
  /** SAM emits 3 candidates; all three scores are recorded, not just the winner. */
  scores: number[] | null;
  chosen: number | null;
  /** Mask area as % of frame — the cheap tell for "it returned the whole person". */
  areaPct: number | null;
  verdict: Verdict;
}

interface XY {
  x: number;
  y: number;
}

interface HeavyFrame {
  canvas: HTMLCanvasElement;
  /** processor() output: pixel_values + original_sizes + reshaped_input_sizes. */
  proc: any;
  /** get_image_embeddings() output — the expensive part, computed once. */
  emb: Record<string, any> | null;
  /** Last decoded masks, raw float logits at full frame size, one per candidate. */
  masks: Float32Array[] | null;
}

const VERDICTS: Verdict[] = ['unrated', 'racket', 'person', 'fragment', 'miss'];

const kp = (list: PoseKeypoint[] | null, name: string): PoseKeypoint | null =>
  list?.find((k) => k.name === name) ?? null;

export default function SamProbePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const heavyRef = useRef<HeavyFrame[]>([]);
  const samRef = useRef<{ model: any; processor: any; Tensor: any; RawImage: any } | null>(null);

  const [status, setStatus] = useState('idle');
  const [log, setLog] = useState<string[]>([]);
  const [frames, setFrames] = useState<ProbeFrame[]>([]);
  const [videoName, setVideoName] = useState<string | null>(null);

  const [startSec, setStartSec] = useState(0);
  const [spacing, setSpacing] = useState(DEFAULT_SPACING);
  const [count, setCount] = useState(DEFAULT_COUNT);

  const [device, setDevice] = useState<'webgpu' | 'wasm'>('webgpu');
  const [modelLoadMs, setModelLoadMs] = useState<number | null>(null);

  const [sideMode, setSideMode] = useState<'auto' | Side>('auto');
  const [anchor, setAnchor] = useState<{ from: number; side: Side; dNorm: number; phi: number } | null>(null);
  /** Fully-automatic seed: how far past the wrist, in forearm lengths. */
  const [outward, setOutward] = useState(0.8);
  const [negMode, setNegMode] = useState(false);

  const say = useCallback((m: string) => {
    console.log('[samprobe]', m);
    setLog((l) => [...l.slice(-260), m]);
  }, []);

  // ── Frame extraction ─────────────────────────────────────────────────────
  // Seek → draw → detect pose, exactly the order Motion Layer uses, so the
  // image and the skeleton are provably the same frame rather than two seeks
  // that ought to agree.

  /**
   * Seek and wait for the frame to be readable.
   *
   * Deliberately does NOT gate on requestAnimationFrame. rAF is throttled to
   * zero in a backgrounded or zero-sized tab, so an rAF-gated seek hangs the
   * whole batch silently — no error, no progress, which is the worst possible
   * failure for a measurement tool. requestVideoFrameCallback is used when
   * present (it is the correct signal for "a frame is decoded and presentable")
   * but is always raced against a timer, and the whole wait is bounded so a
   * missed 'seeked' costs one frame rather than the run.
   */
  const seekTo = (v: HTMLVideoElement, t: number) =>
    new Promise<void>((res) => {
      if (Math.abs(v.currentTime - t) < 0.001) return res();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        v.removeEventListener('seeked', on);
        res();
      };
      const on = () => {
        const rvfc = (v as unknown as { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback;
        if (typeof rvfc === 'function') rvfc.call(v, finish);
        setTimeout(finish, 120);
      };
      v.addEventListener('seeked', on);
      setTimeout(finish, 3000); // hard bound — never hang the batch
      v.currentTime = t;
    });

  const extractFrames = useCallback(async () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) {
      say('no video loaded');
      return;
    }
    heavyRef.current.forEach((h) => h.canvas.remove());
    heavyRef.current = [];
    setAnchor(null);

    const out: ProbeFrame[] = [];
    const w = v.videoWidth;
    const h = v.videoHeight;
    setStatus('extracting frames…');

    for (let i = 0; i < count; i++) {
      const t = startSec + i * spacing;
      if (t > v.duration) {
        say(`frame ${i}: t=${t.toFixed(2)}s past duration ${v.duration.toFixed(2)}s — stopping`);
        break;
      }
      await seekTo(v, t);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(v, 0, 0, w, h);

      const pose = await detectFullPoseOnFrame(v);
      const joints: ProbeFrame['joints'] = {};
      for (const side of ['left', 'right'] as Side[]) {
        const wr = kp(pose, `${side}_wrist`);
        const el = kp(pose, `${side}_elbow`);
        if (wr && el) {
          joints[side] = {
            wrist: { x: wr.x, y: wr.y },
            elbow: { x: el.x, y: el.y },
            wScore: wr.score,
            eScore: el.score,
          };
        }
      }

      heavyRef.current.push({ canvas, proc: null, emb: null, masks: null });
      out.push({
        idx: i,
        t,
        w,
        h,
        poseOk: !!pose,
        joints,
        encodeMs: null,
        prompts: [],
        pointSource: null,
        decodeMs: null,
        scores: null,
        chosen: null,
        areaPct: null,
        verdict: 'unrated',
      });
      say(
        `frame ${i} @ ${t.toFixed(2)}s — pose=${pose ? 'ok' : 'NONE'} ` +
          `L.wrist=${joints.left ? `${joints.left.wrist.x | 0},${joints.left.wrist.y | 0} (${joints.left.wScore.toFixed(2)})` : '—'} ` +
          `R.wrist=${joints.right ? `${joints.right.wrist.x | 0},${joints.right.wrist.y | 0} (${joints.right.wScore.toFixed(2)})` : '—'}`,
      );
    }

    setFrames(out);
    setStatus(`extracted ${out.length} frames @ ${w}×${h}`);
  }, [count, spacing, startSec, say]);

  // ── SAM load + encode ────────────────────────────────────────────────────

  const loadSam = useCallback(async () => {
    if (samRef.current) return samRef.current;
    setStatus(`loading SAM2.1-hiera-tiny (q4f16) on ${device}…`);
    const t0 = performance.now();

    // webpackIgnore keeps Next from trying to bundle a remote URL. PROBE-ONLY.
    const tjs: any = await import(/* webpackIgnore: true */ TJS_CDN as string);
    const { Sam2Model, AutoProcessor, RawImage, Tensor, env } = tjs;
    env.allowLocalModels = false;

    const model = await Sam2Model.from_pretrained(SAM_REPO, { dtype: 'q4f16', device });
    const processor = await AutoProcessor.from_pretrained(SAM_REPO);

    const ms = performance.now() - t0;
    setModelLoadMs(ms);
    samRef.current = { model, processor, Tensor, RawImage };
    say(`SAM loaded in ${ms.toFixed(0)}ms (${device}, q4f16 — ~33MB encoder+decoder)`);
    setStatus('SAM ready');
    return samRef.current;
  }, [device, say]);

  /**
   * Encode EVERY frame up front. This is the whole UX argument: the encoder is
   * the expensive part and it is batched into work the app already does, so the
   * coach's clicks afterwards are decoder-only and effectively instant.
   */
  const encodeAll = useCallback(async () => {
    const sam = await loadSam();
    const { model, processor, RawImage } = sam;
    const next = [...frames];

    for (let i = 0; i < next.length; i++) {
      setStatus(`encoding frame ${i + 1}/${next.length}…`);
      const heavy = heavyRef.current[i];
      const image = RawImage.fromCanvas(heavy.canvas).rgb();
      const proc = await processor(image);

      const t0 = performance.now();
      const emb = await model.get_image_embeddings({ pixel_values: proc.pixel_values });
      const ms = performance.now() - t0;

      heavy.proc = proc;
      heavy.emb = emb;
      next[i] = { ...next[i], encodeMs: ms };
      say(`frame ${i}: ENCODER ${ms.toFixed(0)}ms`);
      setFrames([...next]);
    }

    const times = next.map((f) => f.encodeMs!).filter(Boolean);
    const total = times.reduce((a, b) => a + b, 0);
    say(
      `ENCODE DONE — ${times.length} frames, total ${(total / 1000).toFixed(2)}s, ` +
        `mean ${(total / times.length).toFixed(0)}ms/frame`,
    );
    setStatus('encoded — click a racket');
  }, [frames, loadSam, say]);

  // ── Decode one frame at a set of prompt points ───────────────────────────

  const decode = useCallback(
    async (i: number, prompts: Prompt[], source: PointSource, framesIn: ProbeFrame[]) => {
      const sam = samRef.current;
      const heavy = heavyRef.current[i];
      if (!sam || !heavy?.emb) {
        say(`frame ${i}: not encoded yet`);
        return framesIn;
      }
      const { model, processor } = sam;
      const f = framesIn[i];

      // Points arrive in ORIGINAL video pixels; reshape_input_points rescales
      // them into the 1024-letterboxed space the decoder expects.
      const pts = [[prompts.map((p) => [p.x, p.y])]];
      const input_points = processor.reshape_input_points(pts, heavy.proc.original_sizes, heavy.proc.reshaped_input_sizes);
      const labels = [[prompts.map((p) => p.label)]];
      const input_labels = processor.image_processor.add_input_labels(labels, input_points);

      const t0 = performance.now();
      const out = await model({ ...heavy.emb, input_points, input_labels });
      const ms = performance.now() - t0;

      // binarize:false keeps SAM's RAW LOGITS. That matters beyond the probe:
      // the logit field is continuous, so the racket edge can carry genuine soft
      // alpha instead of a feather faked onto a binary edge.
      const upscaled = await processor.post_process_masks(out.pred_masks, heavy.proc.original_sizes, heavy.proc.reshaped_input_sizes, {
        binarize: false,
      });
      const m = upscaled[0];
      const [, nCand, mh, mw] = m.dims;
      const data = m.data as Float32Array;

      const scores = Array.from(out.iou_scores.data as Float32Array).slice(0, nCand);
      const per = mh * mw;
      const masks: Float32Array[] = [];
      const areas: number[] = [];
      for (let c = 0; c < nCand; c++) {
        const slice = data.slice(c * per, (c + 1) * per);
        masks.push(slice);
        let on = 0;
        for (let p = 0; p < per; p++) if (slice[p] > 0) on++;
        areas.push((on / per) * 100);
      }
      heavy.masks = masks;

      const chosen = scores.indexOf(Math.max(...scores));
      const next = [...framesIn];
      next[i] = {
        ...f,
        prompts,
        pointSource: source,
        decodeMs: ms,
        scores,
        chosen,
        areaPct: areas[chosen],
        verdict: 'unrated',
      };
      say(
        `frame ${i}: DECODER ${ms.toFixed(1)}ms — scores [${scores.map((s) => s.toFixed(3)).join(', ')}] ` +
          `areas [${areas.map((a) => a.toFixed(2) + '%').join(', ')}] → picked #${chosen} (${areas[chosen].toFixed(2)}% of frame)`,
      );
      return next;
    },
    [say],
  );

  // ── (B) Wrist-anchored transfer ──────────────────────────────────────────
  //
  // The click is stored in the FOREARM's own frame of reference, not in image
  // space: distance from the wrist expressed in forearm lengths, and angle
  // measured off the elbow→wrist axis. That makes the anchor invariant to where
  // the player is, how big they are on screen, and which way the arm points —
  // which is exactly what has to hold if one click is to serve 15 frames.

  const pickSide = useCallback(
    (f: ProbeFrame, near?: XY): Side | null => {
      if (sideMode !== 'auto') return f.joints[sideMode] ? sideMode : null;
      const l = f.joints.left;
      const r = f.joints.right;
      if (l && r) {
        if (near) {
          const dl = Math.hypot(l.wrist.x - near.x, l.wrist.y - near.y);
          const dr = Math.hypot(r.wrist.x - near.x, r.wrist.y - near.y);
          return dl <= dr ? 'left' : 'right';
        }
        // No hint — trust the better-scored wrist.
        return l.wScore >= r.wScore ? 'left' : 'right';
      }
      return l ? 'left' : r ? 'right' : null;
    },
    [sideMode],
  );

  const setAnchorFrom = useCallback(
    (i: number, click: XY, framesIn: ProbeFrame[]) => {
      const f = framesIn[i];
      const side = pickSide(f, click);
      const j = side ? f.joints[side] : null;
      if (!j) {
        say(`frame ${i}: no wrist/elbow — cannot build an anchor`);
        return;
      }
      const fx = j.wrist.x - j.elbow.x;
      const fy = j.wrist.y - j.elbow.y;
      const L = Math.hypot(fx, fy);
      if (L < 4) {
        say(`frame ${i}: forearm too short (${L.toFixed(1)}px) — degenerate anchor`);
        return;
      }
      const theta = Math.atan2(fy, fx);
      const vx = click.x - j.wrist.x;
      const vy = click.y - j.wrist.y;
      const d = Math.hypot(vx, vy);
      const alpha = Math.atan2(vy, vx);
      const a = { from: i, side: side!, dNorm: d / L, phi: alpha - theta };
      setAnchor(a);
      say(
        `ANCHOR from frame ${i} (${side}): forearm=${L.toFixed(1)}px, click is ${d.toFixed(1)}px ` +
          `= ${a.dNorm.toFixed(2)} forearm-lengths from the wrist, at ${((a.phi * 180) / Math.PI).toFixed(1)}° off the forearm axis`,
      );
    },
    [pickSide, say],
  );

  const pointFromAnchor = useCallback(
    (f: ProbeFrame, a: NonNullable<typeof anchor>): XY | null => {
      const j = f.joints[a.side] ?? f.joints[a.side === 'left' ? 'right' : 'left'];
      if (!j) return null;
      const fx = j.wrist.x - j.elbow.x;
      const fy = j.wrist.y - j.elbow.y;
      const L = Math.hypot(fx, fy);
      if (L < 4) return null;
      const theta = Math.atan2(fy, fx);
      const ang = theta + a.phi;
      const d = a.dNorm * L;
      return { x: j.wrist.x + d * Math.cos(ang), y: j.wrist.y + d * Math.sin(ang) };
    },
    [],
  );

  const runTransfer = useCallback(async () => {
    if (!anchor) {
      say('no anchor yet — click the racket on one frame first');
      return;
    }
    let next = frames;
    for (let i = 0; i < next.length; i++) {
      if (i === anchor.from) continue;
      const p = pointFromAnchor(next[i], anchor);
      if (!p) {
        say(`frame ${i}: no usable forearm — transfer skipped`);
        continue;
      }
      if (p.x < 0 || p.y < 0 || p.x >= next[i].w || p.y >= next[i].h) {
        say(`frame ${i}: transferred point (${p.x | 0},${p.y | 0}) is OFF-FRAME — skipped`);
        continue;
      }
      say(`frame ${i}: transferred click → (${p.x | 0},${p.y | 0})`);
      next = await decode(i, [{ x: p.x, y: p.y, label: 1 }], 'transfer', next);
      setFrames(next);
    }
    setStatus('transfer complete — rate each frame');
  }, [anchor, frames, pointFromAnchor, decode, say]);

  /** Fully-automatic seeds: no human click anywhere in the batch. */
  const runAutoSeed = useCallback(
    async (mode: 'wrist-raw' | 'wrist-offset') => {
      let next = frames;
      for (let i = 0; i < next.length; i++) {
        const f = next[i];
        const side = pickSide(f);
        const j = side ? f.joints[side] : null;
        if (!j) {
          say(`frame ${i}: no wrist — auto seed skipped`);
          continue;
        }
        let p: XY = { x: j.wrist.x, y: j.wrist.y };
        if (mode === 'wrist-offset') {
          const fx = j.wrist.x - j.elbow.x;
          const fy = j.wrist.y - j.elbow.y;
          const L = Math.hypot(fx, fy) || 1;
          p = { x: j.wrist.x + (fx / L) * outward * L, y: j.wrist.y + (fy / L) * outward * L };
        }
        if (p.x < 0 || p.y < 0 || p.x >= f.w || p.y >= f.h) {
          say(`frame ${i}: auto seed (${p.x | 0},${p.y | 0}) OFF-FRAME — skipped`);
          continue;
        }
        say(`frame ${i}: auto seed [${mode}] → (${p.x | 0},${p.y | 0})`);
        next = await decode(i, [{ x: p.x, y: p.y, label: 1 }], mode, next);
        setFrames(next);
      }
      setStatus(`auto seed (${mode}) complete — rate each frame`);
    },
    [frames, pickSide, outward, decode, say],
  );

  // ── Interaction ──────────────────────────────────────────────────────────

  const onFrameClick = useCallback(
    async (i: number, e: React.MouseEvent<HTMLCanvasElement>) => {
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * frames[i].w;
      const y = ((e.clientY - rect.top) / rect.height) * frames[i].h;
      const label: 0 | 1 = negMode || e.altKey ? 0 : 1;

      // Shift-click accumulates a refinement point on the same frame; a plain
      // click starts fresh. This is SAM's native positive/negative prompting —
      // the same mental model as the editor's existing add/remove brush.
      const prompts: Prompt[] = e.shiftKey ? [...frames[i].prompts, { x, y, label }] : [{ x, y, label }];
      say(`frame ${i}: manual click (${x | 0},${y | 0}) label=${label}${e.shiftKey ? ' [refine]' : ''}`);

      const next = await decode(i, prompts, 'manual', frames);
      setFrames(next);
      if (label === 1 && !e.shiftKey) setAnchorFrom(i, { x, y }, next);
    },
    [frames, negMode, decode, setAnchorFrom, say],
  );

  const setVerdict = (i: number, v: Verdict) =>
    setFrames((fs) => fs.map((f, k) => (k === i ? { ...f, verdict: v } : f)));

  const chooseCandidate = (i: number, c: number) =>
    setFrames((fs) =>
      fs.map((f, k) => {
        if (k !== i) return f;
        const per = f.w * f.h;
        const m = heavyRef.current[k]?.masks?.[c];
        let on = 0;
        if (m) for (let p = 0; p < per; p++) if (m[p] > 0) on++;
        return { ...f, chosen: c, areaPct: m ? (on / per) * 100 : f.areaPct };
      }),
    );

  /**
   * TEMP-DEBUG-SAMPROBE — exercise the PRODUCTION module (lib/stroMotionDraft/
   * samRacket.ts) rather than the probe's own CDN path. This is the only thing
   * that proves the SELF-HOSTED weights under /models/sam2 and the ORT runtime
   * under /ort actually load in a browser — the probe's CDN loading cannot.
   */
  const selfTestProduction = useCallback(async () => {
    if (!frames.length) {
      say('SELFTEST: extract frames first');
      return;
    }
    setStatus('self-testing production samRacket…');
    try {
      const mod = await import('@/lib/stroMotionDraft/samRacket');
      (window as unknown as Record<string, unknown>).__samRacket = true; // force the flag on
      say(`SELFTEST: flag=${mod.samRacketEnabled()}`);

      const f = frames[0];
      const key = mod.racketFrameKey(f.idx, f.t);
      const t0 = performance.now();
      const enc = await mod.encodeFrameForRacket(key, heavyRef.current[0].canvas);
      if (!enc) {
        say('SELFTEST: FAILED — encodeFrameForRacket returned null (model did not load)');
        setStatus('SELFTEST FAILED');
        return;
      }
      say(
        `SELFTEST: encode ok in ${enc.ms.toFixed(0)}ms, embedding ${(enc.bytes / 1e6).toFixed(1)}MB ` +
          `(total load+encode ${(performance.now() - t0).toFixed(0)}ms) device=${mod.samRacketDevice()}`,
      );

      // Accumulate two positive points, exactly as the editor does, and confirm
      // the second decode is run with BOTH (the mask should not be identical).
      const j = f.joints.right ?? f.joints.left;
      if (!j) {
        say('SELFTEST: no wrist on frame 0 — skipping decode');
        return;
      }
      const p1 = { x: j.wrist.x, y: j.wrist.y, label: 1 as const };
      const r1 = await mod.decodeRacketMask(key, [p1]);
      say(
        r1
          ? `SELFTEST: decode(1pt) ${r1.decodeMs.toFixed(0)}ms chosen=#${r1.chosen} ` +
            `cands=[${r1.candidates.map((c) => `${c.areaPct.toFixed(2)}%${c.vetoed ? '/VETO' : ''}`).join(', ')}]`
          : 'SELFTEST: decode(1pt) returned null (all candidates vetoed — the gate is working)',
      );
      const p2 = { x: j.wrist.x + 18, y: j.wrist.y + 18, label: 1 as const };
      const r2 = await mod.decodeRacketMask(key, [p1, p2]);
      if (r1 && r2) {
        let diff = 0;
        for (let i = 0; i < r1.mask.data.length; i++) if (r1.mask.data[i] !== r2.mask.data[i]) diff++;
        say(
          `SELFTEST: decode(2pts) ${r2.decodeMs.toFixed(0)}ms — mask differs from 1pt in ${diff} px ` +
            `(${diff > 0 ? 'ACCUMULATION CONFIRMED' : 'NO CHANGE — accumulation suspect'})`,
        );
      }
      const stats = mod.racketCacheStats();
      say(`SELFTEST: cache ${stats.frames} frames / ${(stats.bytes / 1e6).toFixed(1)}MB`);
      setStatus('SELFTEST PASSED — production module works self-hosted');
    } catch (e) {
      say(`SELFTEST: THREW — ${String(e)}`);
      setStatus('SELFTEST FAILED');
    }
  }, [frames, say]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !videoRef.current) return;
    videoRef.current.src = URL.createObjectURL(file);
    setVideoName(file.name);
    setFrames([]);
    setAnchor(null);
    say(`loaded ${file.name}`);
  };

  const useDemo = () => {
    if (!videoRef.current) return;
    videoRef.current.src = '/demo.mp4';
    setVideoName('demo.mp4 (SMOKE TEST ONLY — not real footage)');
    setFrames([]);
    setAnchor(null);
  };

  // ── Report ───────────────────────────────────────────────────────────────

  const report = useMemo(() => {
    const enc = frames.map((f) => f.encodeMs).filter((x): x is number => x != null);
    const dec = frames.map((f) => f.decodeMs).filter((x): x is number => x != null);
    const rated = frames.filter((f) => f.verdict !== 'unrated');
    const hit = rated.filter((f) => f.verdict === 'racket');
    const transferred = frames.filter((f) => f.pointSource === 'transfer' && f.verdict !== 'unrated');
    const transferHit = transferred.filter((f) => f.verdict === 'racket');

    const lines = [
      '## SAM probe — ' + (videoName ?? 'no video'),
      '',
      `Model: ${SAM_REPO} q4f16 (~33MB) · device=${device} · load=${modelLoadMs?.toFixed(0) ?? '—'}ms`,
      `Batch: ${frames.length} frames, start ${startSec}s, spacing ${spacing}s`,
      enc.length
        ? `Encoder: mean ${(enc.reduce((a, b) => a + b, 0) / enc.length).toFixed(0)}ms/frame, total ${(enc.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s`
        : 'Encoder: not run',
      dec.length
        ? `Decoder: mean ${(dec.reduce((a, b) => a + b, 0) / dec.length).toFixed(1)}ms/click`
        : 'Decoder: not run',
      anchor
        ? `Anchor: frame ${anchor.from} (${anchor.side}) — ${anchor.dNorm.toFixed(2)} forearm-lengths, ${((anchor.phi * 180) / Math.PI).toFixed(1)}° off axis`
        : 'Anchor: none',
      '',
      `(A) QUALITY: ${hit.length}/${rated.length} rated frames returned the RACKET`,
      `(B) TRANSFER: ${transferHit.length}/${transferred.length} transferred clicks landed the RACKET`,
      '',
      '| # | t(s) | pose | src | enc ms | dec ms | scores | area% | verdict |',
      '|---|------|------|-----|--------|--------|--------|-------|---------|',
      ...frames.map(
        (f) =>
          `| ${f.idx} | ${f.t.toFixed(2)} | ${f.poseOk ? 'ok' : 'NONE'} | ${f.pointSource ?? '—'} | ` +
          `${f.encodeMs?.toFixed(0) ?? '—'} | ${f.decodeMs?.toFixed(1) ?? '—'} | ` +
          `${f.scores?.map((s) => s.toFixed(3)).join(' / ') ?? '—'} | ${f.areaPct?.toFixed(2) ?? '—'} | ${f.verdict} |`,
      ),
    ];
    return lines.join('\n');
  }, [frames, videoName, device, modelLoadMs, startSec, spacing, anchor]);

  return (
    <div style={{ padding: 16, fontFamily: 'ui-monospace, monospace', fontSize: 12, background: '#0b0b0d', color: '#e6e6e6', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>TEMP-DEBUG-SAMPROBE — SAM2 racket probe</h1>
      <p style={{ opacity: 0.6, marginBottom: 12, maxWidth: 900 }}>
        Throwaway harness. Weights + transformers.js load from CDN (PROBE-ONLY — production self-hosts).
        Load Vin&apos;s real clip, extract a Motion Layer-shaped batch, encode once, then click the racket.
        <b> Click</b> = new prompt + set anchor · <b>Shift-click</b> = refine · <b>Alt-click</b> = negative point.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input type="file" accept="video/*" onChange={onFile} />
        <button onClick={useDemo}>use /demo.mp4 (smoke test)</button>
        <label>start <input type="number" step="0.1" value={startSec} onChange={(e) => setStartSec(+e.target.value)} style={{ width: 60 }} /></label>
        <label>spacing <input type="number" step="0.05" value={spacing} onChange={(e) => setSpacing(+e.target.value)} style={{ width: 60 }} /></label>
        <label>count <input type="number" min={1} max={15} value={count} onChange={(e) => setCount(+e.target.value)} style={{ width: 50 }} /></label>
        <button onClick={extractFrames}>1. extract frames</button>
        <label>device
          <select value={device} onChange={(e) => setDevice(e.target.value as 'webgpu' | 'wasm')}>
            <option value="webgpu">webgpu</option>
            <option value="wasm">wasm</option>
          </select>
        </label>
        <button onClick={() => void encodeAll()} disabled={!frames.length}>2. load SAM + encode all</button>
        <button onClick={() => void selfTestProduction()} disabled={!frames.length} style={{ fontWeight: 700 }}>
          SELF-TEST production module (self-hosted)
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <b>(B) transfer:</b>
        <label>side
          <select value={sideMode} onChange={(e) => setSideMode(e.target.value as 'auto' | Side)}>
            <option value="auto">auto</option>
            <option value="left">left</option>
            <option value="right">right</option>
          </select>
        </label>
        <button onClick={() => void runTransfer()} disabled={!anchor}>3. transfer one click → all frames</button>
        <span style={{ opacity: 0.5 }}>|</span>
        <button onClick={() => void runAutoSeed('wrist-raw')} disabled={!frames.length}>auto: wrist itself</button>
        <button onClick={() => void runAutoSeed('wrist-offset')} disabled={!frames.length}>auto: wrist + offset</button>
        <label>outward <input type="number" step="0.1" value={outward} onChange={(e) => setOutward(+e.target.value)} style={{ width: 55 }} /> forearms</label>
        <label style={{ marginLeft: 8 }}>
          <input type="checkbox" checked={negMode} onChange={(e) => setNegMode(e.target.checked)} /> negative-click mode
        </label>
      </div>

      <div style={{ marginBottom: 10, opacity: 0.85 }}>
        status: <b>{status}</b>
        {anchor && <> · anchor: frame {anchor.from} ({anchor.side}) {anchor.dNorm.toFixed(2)} forearms @ {((anchor.phi * 180) / Math.PI).toFixed(0)}°</>}
      </div>

      <video ref={videoRef} style={{ display: 'none' }} muted playsInline preload="auto" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {frames.map((f) => (
          <FrameCard
            key={f.idx}
            f={f}
            heavy={heavyRef.current[f.idx]}
            anchorPoint={anchor && f.idx !== anchor.from ? pointFromAnchor(f, anchor) : null}
            onClick={(e) => void onFrameClick(f.idx, e)}
            onVerdict={(v) => setVerdict(f.idx, v)}
            onCandidate={(c) => chooseCandidate(f.idx, c)}
          />
        ))}
      </div>

      <h2 style={{ fontSize: 14, marginTop: 18 }}>Report</h2>
      <button onClick={() => void navigator.clipboard.writeText(report)}>copy report</button>
      <pre style={{ background: '#141418', padding: 10, overflowX: 'auto', whiteSpace: 'pre' }}>{report}</pre>

      <h2 style={{ fontSize: 14 }}>Log</h2>
      <pre style={{ background: '#141418', padding: 10, maxHeight: 260, overflow: 'auto' }}>{log.join('\n')}</pre>
    </div>
  );
}

/**
 * One frame: source image, chosen mask overlaid as SOFT alpha from the raw
 * logits, the pose wrist/elbow it would anchor to, the prompt points, and the
 * transferred point the anchor predicts (drawn even before it is run, so a bad
 * transfer is visible without decoding).
 */
function FrameCard({
  f,
  heavy,
  anchorPoint,
  onClick,
  onVerdict,
  onCandidate,
}: {
  f: ProbeFrame;
  heavy: HeavyFrame | undefined;
  anchorPoint: XY | null;
  onClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onVerdict: (v: Verdict) => void;
  onCandidate: (c: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  // Repaint whenever anything visible changes.
  const paint = useCallback(() => {
    const c = ref.current;
    if (!c || !heavy) return;
    c.width = f.w;
    c.height = f.h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(heavy.canvas, 0, 0);

    const mask = f.chosen != null ? heavy.masks?.[f.chosen] : null;
    if (mask) {
      const img = ctx.getImageData(0, 0, f.w, f.h);
      const d = img.data;
      for (let p = 0; p < f.w * f.h; p++) {
        // smoothstep over the logit → genuine soft alpha at the edge, the same
        // shape as the motion-diff soft alpha already in proposeFrameMask.
        //
        // The band starts AT the decision boundary (logit 0), not below it. An
        // earlier version ramped from -2, which painted every slightly-negative
        // pixel at ~0.4 alpha and flooded the frame — a mask logged at 0.12%
        // area rendered as the whole court. For a harness whose only job is to
        // let a human judge "did it return the racket", a visualisation that
        // overstates the mask is worse than no visualisation at all.
        const t = Math.max(0, Math.min(1, mask[p] / 2));
        const a = t * t * (3 - 2 * t);
        if (a > 0.01) {
          const o = p * 4;
          d[o] = d[o] * (1 - a) + 255 * a;
          d[o + 1] = d[o + 1] * (1 - a) + 40 * a;
          d[o + 2] = d[o + 2] * (1 - a) + 200 * a;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    const r = Math.max(3, f.w / 200);
    // Forearm the anchor is built on.
    for (const side of ['left', 'right'] as Side[]) {
      const j = f.joints[side];
      if (!j) continue;
      ctx.strokeStyle = side === 'left' ? '#4ade80' : '#60a5fa';
      ctx.lineWidth = r * 0.6;
      ctx.beginPath();
      ctx.moveTo(j.elbow.x, j.elbow.y);
      ctx.lineTo(j.wrist.x, j.wrist.y);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(j.wrist.x, j.wrist.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Predicted transfer point (hollow amber) — visible before it is decoded.
    if (anchorPoint) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = r * 0.5;
      ctx.beginPath();
      ctx.arc(anchorPoint.x, anchorPoint.y, r * 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Prompts actually used.
    for (const p of f.prompts) {
      ctx.fillStyle = p.label === 1 ? '#ffffff' : '#ef4444';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = r * 0.35;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [f, heavy, anchorPoint]);

  // Paint synchronously after commit. Not via rAF — see seekTo: rAF never fires
  // in a backgrounded tab, and a mask that silently fails to draw would read as
  // "SAM returned nothing", which is exactly the wrong conclusion to hand back.
  useEffect(() => {
    paint();
  }, [paint]);

  const bad = f.areaPct != null && f.areaPct > 12;

  return (
    <div style={{ border: '1px solid #2a2a30', padding: 6, width: 430 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span>#{f.idx} · {f.t.toFixed(2)}s · {f.poseOk ? 'pose ok' : <b style={{ color: '#ef4444' }}>NO POSE</b>}</span>
        <span style={{ opacity: 0.7 }}>{f.pointSource ?? '—'}</span>
      </div>
      <canvas
        ref={ref}
        onClick={onClick}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair', background: '#000' }}
      />
      <div style={{ marginTop: 4, opacity: 0.85 }}>
        enc {f.encodeMs?.toFixed(0) ?? '—'}ms · dec {f.decodeMs?.toFixed(1) ?? '—'}ms ·{' '}
        <span style={{ color: bad ? '#fbbf24' : undefined }}>area {f.areaPct?.toFixed(2) ?? '—'}%{bad ? ' ← likely the whole person' : ''}</span>
      </div>
      {f.scores && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          {f.scores.map((s, c) => (
            <button
              key={c}
              onClick={() => onCandidate(c)}
              style={{
                flex: 1,
                background: f.chosen === c ? '#3b82f6' : '#1f1f26',
                color: '#fff',
                border: '1px solid #333',
                padding: '2px 0',
              }}
            >
              #{c} {s.toFixed(3)}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: 4 }}>
        verdict:{' '}
        <select value={f.verdict} onChange={(e) => onVerdict(e.target.value as Verdict)}>
          {VERDICTS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
