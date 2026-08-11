'use client';

/**
 * AUTO-RACKET — a TWO-PHASE add-on, structured so no two heavy models are ever
 * resident at the same time.
 *
 * ── WHY IT EXISTS OUTSIDE proposeFrameMask (the Phase-1 lesson) ────────────
 * The first attempt put this logic INSIDE proposeFrameMask as an extra rung.
 * That put the racket and the person-mask engine in one file, and "did the
 * racket change my cutout?" became a question that needed investigating instead
 * of one the structure answers. The racket now lives entirely outside that
 * engine: it takes a FINISHED mask and returns a FINISHED mask.
 * `proposeFrameMask.ts` is byte-identical to the good-cutout commit and must
 * stay that way — if a racket change seems to need an edit there, extend THIS
 * file instead.
 *
 * ── WHY IT IS SPLIT INTO TWO PHASES (the memory lesson) ───────────────────
 * Auto-racket needs two big ONNX models: D-FINE to find the implement and SAM-2
 * to segment it. The person cutout needs a third (the MediaPipe selfie
 * segmenter). Run per-frame and interleaved — detect, segment, SAM, next frame —
 * all three cycle and coexist, and on a wasm / low-VRAM machine that is real
 * memory and GPU pressure during the exact work whose quality matters most.
 *
 * So the batch orchestrator drives these two exports as SEPARATE PHASES with the
 * person segmentation sandwiched between them:
 *
 *   Phase A  detectRacketBoxesForBatch()   D-FINE resident, alone
 *            ...disposes D-FINE...
 *   Phase B  (the orchestrator's own loop)  selfie segmenter alone — the person
 *                                           cutout runs with NEITHER racket
 *                                           model in memory
 *   Phase C  segmentRacketIntoMask()        SAM-2 resident, alone
 *
 * Each model therefore loads exactly ONCE per batch (no per-frame reload
 * thrash), and the person cutout — the thing being protected — runs in the
 * cleanest memory state of the whole pass. Slower by both models' load times,
 * which is the accepted trade: quality over speed.
 *
 * ── WHY IT CANNOT DAMAGE THE CUTOUT ───────────────────────────────────────
 * `unionRacketIntoMask` only ever RAISES a pixel. Measured: 320,000 random
 * pixel trials, zero lowered; and on real SAM output on real footage,
 * `lowered=0 raised=1231`. A wrong racket can add background the brush clears —
 * it cannot cut the athlete.
 */

import { autoRacketEnabled } from '@/lib/stroMotionDraft/autoRacketFlags';
import type { SamPromptBox } from '@/lib/stroMotionDraft/samRacket';
import type { AlphaMask } from '@/lib/stroMotionDraft/types';

interface NormKp { x: number; y: number; score: number; name?: string }

/** One frame's input to the detect phase. */
export interface RacketDetectInput {
  frameIndex: number;
  frame: ImageBitmap | HTMLCanvasElement;
  keypoints: NormKp[] | null | undefined;
  /** For the log line only. */
  label: string;
}

/** What the detect phase found for a frame, carried to the SAM phase. */
export interface RacketBoxForFrame {
  box: SamPromptBox;
  cls: string;
  score: number;
  wristDistPx: number;
}

/**
 * Is auto-racket switched on? Exported so the orchestrator can skip Phase A
 * entirely — and therefore never even dynamic-import the detector — rather than
 * loading a model only to discover the feature is off.
 *
 * DEFAULT ON in the implement modes ('racket' / 'custom'), OFF elsewhere — see
 * autoRacketFlags.ts. Turning it off is explicit (`localStorage['autoRacket']='0'`);
 * REMOVING the key falls back to the mode default, which is on in Racket mode.
 */
export function autoRacketActive(objectType: string): boolean {
  return autoRacketEnabled(objectType);
}

/**
 * PHASE A — detect the implement on EVERY frame, then FREE THE DETECTOR.
 *
 * D-FINE is the only heavy model resident while this runs. It is disposed before
 * returning, in a `finally`, so the caller cannot accidentally proceed to SAM
 * with the detector still holding memory — including when a frame throws.
 *
 * Returns a map of frameIndex → box for the frames that had a wrist-gated
 * implement. Frames with no detection are simply absent, and the SAM phase skips
 * them (no encode paid for a frame with no racket).
 */
export async function detectRacketBoxesForBatch(
  inputs: RacketDetectInput[],
  opts: { vw: number; vh: number; unitFloorNorm?: number | null } = { vw: 0, vh: 0 },
): Promise<Map<number, RacketBoxForFrame>> {
  const found = new Map<number, RacketBoxForFrame>();
  if (!inputs.length) return found;

  let disposeDetector: (() => Promise<void>) | null = null;
  try {
    const mod = await import('@/lib/stroMotionDraft/racketDetect');
    disposeDetector = mod.disposeRacketDetector;

    for (const input of inputs) {
      // A single frame's detection failure must not abort the phase — the other
      // frames' boxes are still worth having.
      try {
        const hit = await mod.detectRacketBox({
          frame: input.frame,
          keypoints: input.keypoints,
          vw: opts.vw,
          vh: opts.vh,
          unitFloorNorm: opts.unitFloorNorm ?? null,
          label: input.label,
        });
        if (hit) {
          found.set(input.frameIndex, {
            box: hit.box,
            cls: hit.cls,
            score: hit.score,
            wristDistPx: hit.wristDistPx,
          });
        }
      } catch (e) {
        console.warn('[autoRacket] detect failed on frame', input.frameIndex, e);
      }
    }
  } catch (e) {
    console.warn('[autoRacket] detector unavailable — no boxes this batch:', e);
  } finally {
    // ALWAYS, even on a throw. The whole point of the phase split is that SAM
    // never loads while D-FINE is still holding its session.
    if (disposeDetector) {
      try { await disposeDetector(); } catch { /* dispose is best-effort */ }
    }
  }

  console.log(
    `[autoRacket] PHASE A complete — ${found.size}/${inputs.length} frame(s) have a wrist-gated ` +
    `implement; D-FINE released before SAM loads`,
  );
  return found;
}

export interface RacketSegmentResult {
  /** The input mask when nothing was applied — never a partially-built one. */
  mask: AlphaMask;
  applied: boolean;
  reason: string;
}

/**
 * PHASE C — segment ONE frame's already-detected box with SAM-2 and union it in.
 *
 * Called only for frames Phase A found a box on, and only after the detector has
 * been disposed and every person mask is already built. SAM is the only heavy
 * model resident.
 *
 * Fail-closed on every path: no key, SAM unavailable, nothing plausible decoded,
 * or a throw all return the INPUT mask untouched.
 */
export async function segmentRacketIntoMask(args: {
  mask: AlphaMask;
  frame: ImageBitmap | HTMLCanvasElement;
  /** `racketFrameKey(frameIndex, timeSec)` — SHARED with the manual Object tool. */
  samKey: string | null;
  hit: RacketBoxForFrame;
}): Promise<RacketSegmentResult> {
  const { mask, frame, samKey, hit } = args;
  const nothing = (reason: string): RacketSegmentResult => ({ mask, applied: false, reason });
  if (!samKey) return nothing('no SAM frame key');

  try {
    const { encodeFrameForRacket, decodeRacketMaskFromBox, unionRacketIntoMask } =
      await import('@/lib/stroMotionDraft/samRacket');

    const enc = await encodeFrameForRacket(samKey, frame);
    if (!enc) return nothing('SAM unavailable on this machine');

    const seg = await decodeRacketMaskFromBox(samKey, hit.box);
    if (!seg) return nothing('SAM returned nothing plausible for the detected box');

    return {
      mask: unionRacketIntoMask(mask, seg.mask),
      applied: true,
      reason:
        `${hit.cls} det=${hit.score.toFixed(3)} wrist=${hit.wristDistPx.toFixed(0)}px ` +
        `SAM#${seg.chosen} ${seg.candidates[seg.chosen].areaPct.toFixed(2)}% of frame`,
    };
  } catch (e) {
    console.warn('[autoRacket] SAM phase failed — mask left unchanged:', e);
    return nothing('threw');
  }
}
