'use client';

import { renderStroMotionDraftComposite } from '@/lib/stroMotionDraft/compositeFromDraft';
import { exportStroMotionDraftPng } from '@/lib/stroMotionDraft/exportDraft';
import { clearStroMotionDraft } from '@/lib/stroMotionDraft/clearDraft';
import { cloneAlphaMask, fillBoxMask } from '@/lib/stroMotionDraft/maskUtils';
import { countExportReadyFrames, countMaskPixels, maskHasContent, statusAfterMaskEdit } from '@/lib/stroMotionDraft/frameMask';
import { hydrateDraftBitmapsForExport } from '@/lib/stroMotionDraft/exportDraft';
import { ensureStroMotionDraft } from '@/lib/stroMotionDraft/initDraft';
import { proposeFrameMask } from '@/lib/stroMotionDraft/proposeFrameMask';
// The SAM embedding-cache key, for the auto-racket add-on below. Imported from
// samRacketKey (no imports, no state) rather than samRacket, so this hook carries
// none of the SAM session, encoder or decoder code — those stay behind the
// dynamic import inside autoRacketPass and load only when a racket is found.
import { racketFrameKey } from '@/lib/stroMotionDraft/samRacketKey';
// One switch for every Motion Layer diagnostic; OFF by default (see debugFlags.ts).
import { stroDebugEnabled } from '@/lib/stroMotionDraft/debugFlags';
import { buildMedianBackgroundPlate, type BackgroundPlate } from '@/lib/stroMotionDraft/backgroundPlate';
import type {
  AlphaMask,
  StroMotionBackground,
  StroMotionDraft,
  StroMotionFrameStatus,
  StroMotionObjectType,
  StroMotionVideoOrder,
} from '@/lib/stroMotionDraft/types';
import type { StroMotionSubjectBox } from '@/lib/stroMotion';
import { useCallback, useRef, useState } from 'react';

export type StroMotionHookStatus = 'idle' | 'configuring' | 'proposing' | 'generating' | 'ready';

export interface StroMotionProgress {
  current: number;
  total: number;
}

/** One frame's Auto-Detect input (box + optional pose scribble) for the atomic batch. */
export interface StroAutoFrameSpec {
  frameIndex: number;
  selectionBox: StroMotionSubjectBox;
  scribble?: Array<{ x: number; y: number }> | null;
  /**
   * The app's EXISTING skeleton for this frame — COCO-17, FULL-FRAME normalized.
   * Read by page.tsx from the same source the angle/metric features use.
   */
  keypoints?: Array<{ x: number; y: number; score: number; name?: string }> | null;
}

/**
 * How much of the coach's selection box a re-proposed mask must cover before it is
 * allowed to REPLACE an existing mask. Expressed as a fraction of the box because
 * that is scale-invariant: it reads the same for a whole athlete and for a racket
 * in OBJECT mode. A real subject fills a large share of the box drawn around it;
 * a collapsed segmenter∩zone intersection lands orders of magnitude below this.
 * The absolute floor covers tiny boxes, where a percentage means almost nothing.
 */
const MIN_PROPOSAL_BOX_FRACTION = 0.005;
const MIN_PROPOSAL_ABS_PX = 64;

/** Consecutive no-op syncs before we say a caller is still churning. */
const NOOP_SYNC_WARN_AT = 25;

/**
 * Would committing `b` actually CHANGE anything the app can observe in `a`?
 *
 * `syncDraft` rebuilds the draft object from scratch on every call, so its
 * `setDraft` used to hand React a new object reference every single time — even
 * when every field was identical. A new reference is a state change, a state
 * change is a render, and any caller whose effect re-fires on render then calls
 * syncDraft again: that is a self-sustaining loop, and it is what
 * "Maximum update depth exceeded" was reporting.
 *
 * Returning the EXISTING object when nothing changed makes React skip the update
 * entirely and breaks that loop at its source, whatever re-triggered the caller.
 * It cannot regress the frame-preservation merge below, because it only ever
 * declines to write a value that is field-for-field what is already there.
 *
 * Masks/bitmaps are compared by REFERENCE on purpose: the merge either carries
 * the previous object across untouched or installs a genuinely new one, so a
 * changed reference is exactly the signal that real work landed. `backgroundPlate`
 * is included so a re-captured plate is never dropped on the floor (it would leak
 * the ImageBitmap, and the draft would keep pointing at the stale plate).
 */
function draftsEquivalent(a: StroMotionDraft, b: StroMotionDraft): boolean {
  if (a === b) return true;
  if (a.objectType !== b.objectType) return false;
  if (Math.abs(a.backgroundTimeSec - b.backgroundTimeSec) > 0.001) return false;
  if (a.videoWidth !== b.videoWidth || a.videoHeight !== b.videoHeight) return false;
  if (a.backgroundPlate !== b.backgroundPlate) return false;
  if (a.sampleTimes.length !== b.sampleTimes.length) return false;
  for (let i = 0; i < a.sampleTimes.length; i++) {
    if (Math.abs(a.sampleTimes[i] - b.sampleTimes[i]) > 1e-6) return false;
  }
  if (a.frames.length !== b.frames.length) return false;
  for (let i = 0; i < a.frames.length; i++) {
    const x = a.frames[i];
    const y = b.frames[i];
    if (x === y) continue;
    if (
      x.index !== y.index ||
      Math.abs(x.timeSec - y.timeSec) > 1e-6 ||
      x.label !== y.label ||
      x.status !== y.status ||
      x.selectionBox !== y.selectionBox ||
      x.sourceFrame !== y.sourceFrame ||
      x.aiSnapshot !== y.aiSnapshot ||
      x.working !== y.working ||
      x.readyMask !== y.readyMask
    ) return false;
  }
  return true;
}

export interface SyncDraftParams {
  objectType: StroMotionObjectType;
  backgroundTimeSec: number;
  sampleTimes: number[];
}

export function useStroMotion(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [draft, setDraft] = useState<StroMotionDraft | null>(null);
  const [status, setStatus] = useState<StroMotionHookStatus>('idle');
  const [objectType, setObjectType] = useState<StroMotionObjectType>('racket');
  const [activeFrameIndex, setActiveFrameIndex] = useState<number | null>(null);
  const [proposingFrameIndex, setProposingFrameIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<StroMotionProgress>({ current: 0, total: 0 });
  const draftRef = useRef<StroMotionDraft | null>(null);
  draftRef.current = draft;
  /** Consecutive syncDraft calls that changed nothing — see the no-op guard. */
  const noopSyncCountRef = useRef(0);

  // Temporal-median background plate, cached per section (keyed by the sample
  // span). The plate makes the motion-diff matte robust even where the object
  // overlaps its position in any single reference frame.
  const plateRef = useRef<{ key: string; promise: Promise<BackgroundPlate | null> } | null>(null);

  const disposePlate = useCallback(() => {
    const held = plateRef.current;
    plateRef.current = null;
    if (held) void held.promise.then((p) => { try { p?.bitmap.close(); } catch { /* closed */ } });
  }, []);

  const getBackgroundPlate = useCallback((video: HTMLVideoElement, current: StroMotionDraft): Promise<BackgroundPlate | null> => {
    const times = current.frames.map((f) => f.timeSec);
    if (!times.length) return Promise.resolve(null);
    const start = Math.max(0, Math.min(...times) - 0.2);
    const end = Math.max(...times) + 0.2;
    const key = `${start.toFixed(2)}|${end.toFixed(2)}|${video.videoWidth}x${video.videoHeight}`;
    if (plateRef.current?.key !== key) {
      disposePlate();
      plateRef.current = { key, promise: buildMedianBackgroundPlate(video, start, end).catch(() => null) };
    }
    return plateRef.current.promise;
  }, [disposePlate]);

  const clearDraftState = useCallback(() => {
    // TEMP-DEBUG-RESETTRACE — the single place the draft (and therefore every
    // frame button and layer) is destroyed. Remove with the grep tag.
    console.warn('[RESETTRACE] clearDraftState() — draft destroyed');
    console.trace('[RESETTRACE] clearDraftState call site');
    disposePlate();
    setDraft((prev) => {
      if (prev) clearStroMotionDraft(prev);
      return null;
    });
    setActiveFrameIndex(null);
    setProposingFrameIndex(null);
    setProgress({ current: 0, total: 0 });
  }, [disposePlate]);

  const clearAll = useCallback(() => {
    clearDraftState();
    setStatus('idle');
    setObjectType('racket');
  }, [clearDraftState]);

  const invalidatePreview = useCallback(() => {
    setStatus((prev) => (prev === 'ready' ? 'configuring' : prev));
  }, []);

  const syncDraft = useCallback(async (params: SyncDraftParams): Promise<StroMotionDraft | null> => {
    const video = videoRef.current;
    if (!video) return null;

    const next = await ensureStroMotionDraft(video, {
      objectType: params.objectType,
      backgroundTimeSec: params.backgroundTimeSec,
      sampleTimes: params.sampleTimes,
      previous: draftRef.current,
    });

    if (!next) return null;

    setDraft((current) => {
      if (!current) return next;
      if (Math.abs(current.backgroundTimeSec - next.backgroundTimeSec) > 0.001) return next;
      if (current.objectType !== next.objectType) return next;

      // Preserve completed work when the frame set changes (adding/removing a
      // frame, or re-spacing): match each NEW frame to the nearest OLD frame by
      // time — but use GLOBAL nearest-first assignment so an exact time match
      // (an untouched frame) always wins over a merely-close one. In-order
      // matching let a newly-inserted midpoint sitting within 150ms of an
      // existing frame steal that frame's mask, leaving the real frame empty.
      // Each old frame is reused at most once.
      const THRESHOLD = 0.15; // within 150ms counts as "the same" frame
      const pairs: Array<{ ni: number; oi: number; d: number }> = [];
      next.frames.forEach((f, ni) => {
        current.frames.forEach((cf, oi) => {
          if (
            !cf.sourceFrame ||
            !cf.selectionBox ||
            !(maskHasContent(cf.working) || maskHasContent(cf.readyMask) || maskHasContent(cf.aiSnapshot))
          ) return;
          const d = Math.abs(cf.timeSec - f.timeSec);
          if (d < THRESHOLD) pairs.push({ ni, oi, d });
        });
      });
      pairs.sort((a, b) => a.d - b.d);
      const newClaimed = new Set<number>();
      const oldClaimed = new Set<number>();
      const matchOf = new Map<number, number>(); // new index → old index
      for (const p of pairs) {
        if (newClaimed.has(p.ni) || oldClaimed.has(p.oi)) continue;
        newClaimed.add(p.ni);
        oldClaimed.add(p.oi);
        matchOf.set(p.ni, p.oi);
      }
      const mergedFrames = next.frames.map((f, ni) => {
        const oi = matchOf.get(ni);
        if (oi === undefined) return f;
        const cur = current.frames[oi];
        return {
          ...f,
          selectionBox: cur.selectionBox,
          sourceFrame: cur.sourceFrame,
          aiSnapshot: cur.aiSnapshot,
          working: cur.working,
          readyMask: cur.readyMask,
          status: cur.status,
          label: cur.label || f.label,
        };
      });
      const merged = { ...next, frames: mergedFrames };
      // NO-OP GUARD — see draftsEquivalent. Keeping the existing reference when
      // nothing changed stops a re-firing caller from turning every sync into a
      // render into another sync ("Maximum update depth exceeded").
      if (draftsEquivalent(current, merged)) {
        noopSyncCountRef.current += 1;
        if (noopSyncCountRef.current === NOOP_SYNC_WARN_AT) {
          console.warn(
            `[useStroMotion] syncDraft has produced ${NOOP_SYNC_WARN_AT} consecutive no-op syncs. ` +
              'The state loop is guarded, but a caller is still re-firing every render — ' +
              'check the effect deps that feed syncDraft (an array/object recreated per render).',
          );
        }
        return current;
      }
      noopSyncCountRef.current = 0;
      return merged;
    });
    setStatus('configuring');
    return next;
  }, [videoRef]);

  const invalidateFrameAt = useCallback((frameIndex: number, timeSec?: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) => {
        if (f.index !== frameIndex) return f;
        if (f.sourceFrame) {
          try { f.sourceFrame.close(); } catch { /* closed */ }
        }
        return {
          ...f,
          timeSec: timeSec ?? f.timeSec,
          status: 'pending' as StroMotionFrameStatus,
          selectionBox: null,
          sourceFrame: null,
          aiSnapshot: null,
          working: null,
          readyMask: null,
        };
      });
      const sampleTimes = [...prev.sampleTimes];
      if (timeSec !== undefined && frameIndex >= 0 && frameIndex < sampleTimes.length) {
        sampleTimes[frameIndex] = timeSec;
      }
      return { ...prev, frames, sampleTimes };
    });
    invalidatePreview();
  }, [invalidatePreview]);

  const updateFrameTime = useCallback((frameIndex: number, timeSec: number) => {
    invalidateFrameAt(frameIndex, timeSec);
  }, [invalidateFrameAt]);

  /**
   * Clear every frame's SELECTION so the next Auto Detect re-runs the whole batch
   * from scratch — fresh pose, fresh segmentation, fresh batch-unit floor.
   *
   * WHY THIS IS NEEDED. Auto Detect only processes frames with no `selectionBox`
   * (`pending` in handleStroAutoSelectAll), so on an already-detected clip it
   * reports "All frames already have a selection" and does nothing. That makes the
   * BATCH path — the only one with the stabilized unit — impossible to re-test
   * without rebuilding the draft, which forced testing through "Redo mask" instead.
   *
   * Keeps the frames, their times and their labels; drops only the derived work
   * (selection, captured bitmap, masks, ready state), exactly like `invalidateFrameAt`
   * does for one frame when its time changes. `batchUnitFloorNorm` is cleared too,
   * so the next batch recomputes it rather than reusing a reference measured from
   * poses that are about to be re-detected.
   */
  const clearAllSelections = useCallback((): number => {
    let cleared = 0;
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) => {
        if (!f.selectionBox && !f.sourceFrame && !f.aiSnapshot) return f;
        cleared++;
        if (f.sourceFrame) {
          try { f.sourceFrame.close(); } catch { /* already released */ }
        }
        return {
          ...f,
          status: 'pending' as StroMotionFrameStatus,
          selectionBox: null,
          sourceFrame: null,
          aiSnapshot: null,
          working: null,
          readyMask: null,
        };
      });
      return { ...prev, frames, batchUnitFloorNorm: null };
    });
    invalidatePreview();
    console.log(`[StroMotion] cleared selections on ${cleared} frame(s) — Auto Detect will re-run the full batch`);
    return cleared;
  }, [invalidatePreview]);

  const updateFrameLabel = useCallback((frameIndex: number, label: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex ? { ...f, label } : f,
      );
      return { ...prev, frames };
    });
  }, []);

  const selectAreaForFrame = useCallback(async (
    frameIndex: number,
    selectionBox: StroMotionSubjectBox,
    opts?: {
      /** Mark the frame export-READY in the same state update (AI batch flow) —
       *  avoids the stale-draftRef race of a separate markFrameReady call. */
      markReady?: boolean;
      /** Pose-derived scribble (normalized) → pose-anchored segmentation. */
      scribble?: Array<{ x: number; y: number }> | null;
      /**
       * Open the editor on a SOLID fill of the selection box (blue = keep)
       * instead of the AI proposal.
       *
       * Set by the coach's manual "Select Area" path: the AI ladder can return a
       * sparse matte, and a sparse mask gives the add/remove brush nothing
       * meaningful to cut into — the coach then has to hit Auto BG (which mattes
       * the WHOLE frame) just to get a workable starting mask. Seeding the drawn
       * box solid makes Remove immediately meaningful and Add immediately
       * extendable, with no Auto BG round-trip.
       *
       * Deliberately OFF for `reproposeFrameMask`, whose entire purpose is
       * "re-run the AI proposal from scratch".
       */
      seedFromSelectionBox?: boolean;
      /**
       * Run the SAME skeleton-guided AI pipeline auto-detect uses. Set by the
       * editor's Auto-BG / Re-propose so the two produce identical results.
       */
      useSkeletonGuidance?: boolean;
      /** The app's existing skeleton for this frame (COCO-17, full-frame normalized). */
      keypoints?: Array<{ x: number; y: number; score: number; name?: string }> | null;
      /**
       * The frame the caller already captured for this time — the SAME bitmap the
       * skeleton above was detected on. Passing it makes the skeleton and the
       * segmentation provably one frame. Ownership transfers: the draft closes it.
       */
      frame?: ImageBitmap | null;
    },
  ): Promise<boolean> => {
    const video = videoRef.current;
    const current = draftRef.current;
    if (!video || !current) return false;

    const frame = current.frames[frameIndex];
    if (!frame) return false;

    setProposingFrameIndex(frameIndex);
    setProgress({ current: 0, total: 1 });
    setStatus('proposing');

    try {
      // Median plate is built once per section and shared by every frame.
      const plate = await getBackgroundPlate(video, current).catch(() => null);
      const proposal = await proposeFrameMask(
        video,
        frame.timeSec,
        selectionBox,
        current.backgroundTimeSec,
        current.objectType,
        plate,
        opts?.scribble ?? null,
        !!opts?.useSkeletonGuidance,
        opts?.keypoints ?? null,
        opts?.frame ?? null,
        // racketAxis — genuinely batch-only diagnostic data a single frame cannot
        // resolve, and nothing in the mask ladder reads it.
        null,
        // unitFloorNorm — THE FIX. This argument used to be omitted entirely, and
        // that omission is the "terrible super thin selection": with no floor,
        // `poseScaleUnit` re-derives `unit` from THIS frame alone and collapses
        // (batch 46px vs re-run 5px, measured on the same frame), shrinking the
        // zone, the segmenter crop and the head oval by ~10x. Reusing the batch's
        // stored median makes Redo mask agree with a fresh batch detect.
        current.batchUnitFloorNorm ?? null,
      );

      if (!proposal) return false;

      const hasProposal = maskHasContent(proposal.aiSnapshot);

      // The mask the editor OPENS on. `padding: 0` so the blue region lands on
      // exactly the box the coach drew — the same box the editor outlines in
      // yellow — rather than fillBoxMask's default 4% bleed.
      const working = opts?.seedFromSelectionBox
        ? fillBoxMask(
            proposal.sourceFrame.width,
            proposal.sourceFrame.height,
            selectionBox,
            0,
          )
        : proposal.working;

      // ── DEGENERATE-RESULT GUARD ──────────────────────────────────────────
      // `maskHasContent` is true for a SINGLE lit pixel. That is the right test
      // for "did the pipeline produce anything at all", and the wrong one for
      // "is this worth showing the coach": when the segmenter has a bad frame,
      // the strict AND with the skeleton zone can survive with a few dozen
      // pixels — enough to pass every emptiness check on the way here, including
      // proposeFrameMask's own fill-the-box rescue, and then replace a perfectly
      // good mask with something invisible. That is exactly what "Redo mask
      // cleared my mask" is: not a display failure, a near-empty commit.
      //
      // So the bar for REPLACING existing work is coverage, not existence. A real
      // subject fills a decent share of the box the coach drew around it; a failed
      // intersection does not come close. When the new mask is below that bar and
      // there is already a mask worth keeping, we keep the coach's and report the
      // refusal — the pipeline may fail, but it may not destroy work on the way.
      //
      // Only the re-propose paths can trip this: `seedFromSelectionBox` (manual
      // Select Area) hands over a solid box, which is never degenerate.
      const fw = proposal.sourceFrame.width;
      const fh = proposal.sourceFrame.height;
      const boxW = Math.max(0, Math.min(1, selectionBox.width)) * fw;
      const boxH = Math.max(0, Math.min(1, selectionBox.height)) * fh;
      const boxPx = Math.max(1, Math.round(boxW * boxH));
      const newPx = countMaskPixels(working);
      const existing = frame.working ?? frame.readyMask ?? frame.aiSnapshot ?? null;
      const existingPx = existing ? countMaskPixels(existing) : 0;
      const floor = Math.max(MIN_PROPOSAL_ABS_PX, Math.round(boxPx * MIN_PROPOSAL_BOX_FRACTION));
      if (newPx < floor && existingPx >= floor) {
        console.warn(
          `[StroMotion] proposal covered ${newPx}px of a ${boxPx}px selection (floor ${floor}px) — ` +
          `keeping the existing ${existingPx}px mask instead of replacing it with an empty one.`,
        );
        try { proposal.sourceFrame.close(); } catch { /* closed */ }
        return false;
      }

      setDraft((prev) => {
        if (!prev) {
          proposal.sourceFrame.close();
          return prev;
        }
        const markReady = !!opts?.markReady && hasProposal;
        const frames = prev.frames.map((f) => {
          if (f.index !== frameIndex) return f;
          if (f.sourceFrame) {
            try { f.sourceFrame.close(); } catch { /* closed */ }
          }
          return {
            ...f,
            selectionBox,
            sourceFrame: proposal.sourceFrame,
            aiSnapshot: proposal.aiSnapshot,
            working,
            readyMask: markReady ? cloneAlphaMask(working) : null,
            status: (markReady ? 'ready' : 'edited') as StroMotionFrameStatus,
          };
        });
        return { ...prev, frames };
      });
      invalidatePreview();
      return true;
    } catch (err) {
      console.error('[StroMotion] Mask proposal failed:', err);
      return false;
    } finally {
      setProposingFrameIndex(null);
      setProgress({ current: 0, total: 0 });
      setStatus('configuring');
    }
  }, [invalidatePreview, videoRef, getBackgroundPlate]);

  /**
   * Auto Detect commit — ATOMIC. Builds every frame's proposal in memory (no
   * draft writes), then commits the COMPLETE set in a single setDraft. Each
   * committed frame carries sourceFrame + selectionBox + aiSnapshot + working +
   * readyMask and status 'ready', so the FrameMaskEditor and Generate read the
   * exact same committed state. This replaces the old N sequential per-frame
   * commits, which interleaved with video seeks / re-syncs and could leave
   * frames half-committed (no sourceFrame, or not export-ready).
   */
  const autoProcessFrames = useCallback(async (
    specs: StroAutoFrameSpec[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> => {
    const video = videoRef.current;
    const current = draftRef.current;
    if (!video || !current || specs.length === 0) return 0;

    setStatus('proposing');

    // NOTE: no SAM work happens in this pass, deliberately.
    //
    // An earlier version pre-encoded every frame for the racket tool here, on
    // the theory that hiding the encoder inside an existing progress bar was
    // free. It was not: it loaded the model (~14s) and encoded every frame
    // (~4–9s each) on EVERY auto-process, whether or not the coach ever touched
    // the racket — roughly 35–60s added to a first run, and ~250MB of
    // embeddings held for a 15-frame batch. It also made the first run look
    // broken while the second (fully cached) looked fine.
    //
    // SAM is now paid for strictly on use: the editor encodes a frame the first
    // time the coach selects the Racket tool on it. Auto-process is back to
    // exactly the work it did before the racket feature existed.
    setProgress({ current: 0, total: specs.length });
    const plate = await getBackgroundPlate(video, current).catch(() => null);

    // ── PHASE 0 — RACKET TRAJECTORY (mode 'arc' ONLY) ────────────────────────
    //
    // The racket axis can only be resolved with the WHOLE batch in hand: a single
    // frame cannot tell a racket from the arm it is attached to, but fifteen
    // frames constrain the racket to a smooth arc that the arm does not follow.
    // This is the one place in the pipeline that already holds every frame's
    // time, box and skeleton at once, so the pass belongs here and nowhere else.
    //
    // It captures each frame ONCE and hands the bitmap on to Phase 1 as
    // `preCapturedFrame`, so the pass SAVES a capture per frame rather than
    // costing one — and image, skeleton and sweep are provably the same pixels.
    //
    // SCOPED HARD TO 'arc'. In 'off' (default) and 'blob' this block does not
    // run, nothing is captured here, and Phase 1 below is byte-for-byte the code
    // that shipped. All of the new risk lives behind the opt-in switch.
    const axisByFrame = new Map<number, import('@/lib/stroMotionDraft/racketTrajectory').RacketAxis>();
    const preCaptured = new Map<number, ImageBitmap>();
    try {
      const { racketMode, buildRacketTrajectory } = await import('@/lib/stroMotionDraft/racketTrajectory');
      if (racketMode() === 'arc') {
        const { captureVideoFrameAtTime } = await import('@/lib/stroMotionDraft/captureSource');
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const sweepInput: Array<{
          frameIndex: number;
          timeSec: number;
          sourceFrame: ImageBitmap;
          keypoints: Array<{ x: number; y: number; score: number; name?: string }> | null;
        }> = [];
        for (const spec of specs) {
          const frame = current.frames[spec.frameIndex];
          if (!frame) continue;
          try {
            const bmp = await captureVideoFrameAtTime(video, frame.timeSec);
            preCaptured.set(spec.frameIndex, bmp);
            sweepInput.push({
              frameIndex: spec.frameIndex,
              timeSec: frame.timeSec,
              sourceFrame: bmp,
              keypoints: spec.keypoints ?? null,
            });
          } catch (err) {
            console.warn('[racketArc] capture failed on frame', spec.frameIndex, err);
          }
        }
        const traj = await buildRacketTrajectory(sweepInput, plate, vw, vh);
        if (traj.accepted) {
          for (const a of traj.axes) axisByFrame.set(a.frameIndex, a);
        }
      }
    } catch (e) {
      // The trajectory is a diagnostic overlay. It may never break a mask run.
      console.warn('[racketArc] trajectory pass failed:', e);
    }

    // ── PHASE 0a2 — FOOT-CAPABLE POSE ON EVERY FRAME ────────────────────────
    //
    // The zone has been able to read REAL feet for a while: it stamps an
    // ankle→toe capsule whenever the pose carries MediaPipe's named foot
    // landmarks, and falls back to an orientation-agnostic disc when it does not
    // (skeletonMaskFilter, "Real MediaPipe toes, when present"). The catch was
    // that only AI Track / AI Detect ever produced those landmarks, so a plain
    // first auto-detect ran on MoveNet's COCO-17 — which HAS NO FEET — and every
    // frame took the disc fallback. Shoes fell outside the zone.
    //
    // MoveNet is there for LATENCY, and this pass has none of that pressure: it
    // is 1–15 frames, already seeking and already running a segmenter per frame.
    // So the batch now runs the foot-capable model itself and the feet are real
    // on the FIRST auto-detect, with no AI Track prerequisite.
    //
    // WHY THE WHOLE POSE, NOT JUST THE FEET GRAFTED ON. The zone builds the foot
    // capsule from ankle(COCO-17) → toe(named). Taking the ankle from MoveNet and
    // the toe from MediaPipe would join two models' idea of the same leg, and any
    // disagreement between them skews the capsule off the shoe. mediapipePose's
    // output is explicitly "MoveNet-compatible COCO-17 ... + the four real foot
    // keypoints APPENDED at 17+", i.e. a documented drop-in for exactly these
    // consumers — the same array shape AI Track already feeds them. One model,
    // one leg, consistent geometry.
    //
    // Falls back to the caller's existing pose per frame, so a model that will not
    // load degrades to precisely the old behaviour rather than losing the zone.
    const feetPose = new Map<number, Array<{ x: number; y: number; score: number; name?: string }>>();
    let feetMs = 0;
    let feetOk = 0;
    try {
      const [{ detectFullPoseOnBitmap }, { captureVideoFrameAtTime }] = await Promise.all([
        import('@/lib/mediapipePose'),
        import('@/lib/stroMotionDraft/captureSource'),
      ]);
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      /** Does this pose already carry MediaPipe's named foot landmarks? */
      const hasFeet = (kps: StroAutoFrameSpec['keypoints']) =>
        !!kps?.some((k) => k.name === 'left_foot_index' || k.name === 'right_foot_index');
      for (const spec of specs) {
        const frame = current.frames[spec.frameIndex];
        if (!frame) continue;
        // The caller's resolver is foot-capable now, so on the normal path the
        // pose ARRIVES with feet and this pass has nothing to add. Skipping then
        // is what keeps the ~190ms/frame from being paid twice for one answer;
        // this remains a genuine fallback for any spec built without them.
        if (hasFeet(spec.keypoints)) { feetOk++; continue; }
        try {
          // Reuse Phase 0's bitmap when it ran ('arc'); otherwise capture ONCE
          // here and hand it to Phase 1 as `preCapturedFrame`. Either way the
          // pose and the segmentation see identical pixels, and the capture is
          // shared rather than paid for twice.
          let bmp = preCaptured.get(spec.frameIndex) ?? null;
          if (!bmp) {
            bmp = await captureVideoFrameAtTime(video, frame.timeSec);
            preCaptured.set(spec.frameIndex, bmp);
          }
          const t0 = performance.now();
          const pose = await detectFullPoseOnBitmap(bmp, vw, vh);
          feetMs += performance.now() - t0;
          // Normalize to full-frame [0,1] — the space `spec.keypoints` is in and
          // the space proposeFrameMask documents for `skeletonKeypoints`.
          if (pose?.length) {
            feetPose.set(
              spec.frameIndex,
              pose.map((k) => ({ x: k.x / vw, y: k.y / vh, score: k.score ?? 0, name: k.name })),
            );
            feetOk++;
          }
        } catch (err) {
          console.warn('[skelZone] foot pose failed on frame', spec.frameIndex, err);
        }
      }
      if (specs.length) {
        const ran = feetPose.size;
        console.log(
          `[skelZone] foot-capable pose: ${feetOk}/${specs.length} frames have feet ` +
          `(${specs.length - ran} already carried them, ${ran} detected here in ` +
          `${feetMs.toFixed(0)}ms${ran ? `, ${(feetMs / ran).toFixed(0)}ms/frame` : ''})`,
        );
      }
    } catch (e) {
      // No feet ⇒ the zone's existing disc fallback, i.e. the previous behaviour.
      console.warn('[skelZone] foot-capable pose pass unavailable:', e);
    }

    /** The pose the zone should use for a frame: foot-capable when we got one. */
    const poseFor = (spec: StroAutoFrameSpec) =>
      feetPose.get(spec.frameIndex) ?? spec.keypoints ?? null;

    // ── PHASE 0b — BATCH BODY SCALE ─────────────────────────────────────────
    //
    // Like the racket axis above, this can only be answered with the whole batch
    // in hand — and for a sharper reason. `poseScaleUnit` already cross-checks a
    // suspicious shoulder line against hip width and the pose bbox, but those
    // checks live INSIDE one frame, so they only survive a single collapse. When
    // the whole pose degrades the three measures shrink together, agree with each
    // other, and a 12px shoulder width is accepted on a frame where the athlete
    // is the same size as everywhere else (measured: 66, 64, 56, 12, 45 px).
    //
    // The athlete does not shrink to a fifth of their size and back inside 0.75s,
    // and only the other frames know that. This is upstream of the head oval, the
    // zone and the segmenter crop — all three scale from `unit` — so stabilising
    // it here stabilises all three at once.
    //
    // Unscoped by racketMode: a mask-quality correction for every auto-process
    // run, not a diagnostic. Costs a little arithmetic over poses already in
    // hand — no capture, no model, no seek.
    let unitFloorNorm: number | null = null;
    try {
      const { batchScaleUnitNorm } = await import('@/lib/stroMotionDraft/skeletonMaskFilter');
      unitFloorNorm = batchScaleUnitNorm(
        // Same pose the zone will be built from, so the batch reference and the
        // per-frame unit are measured off one skeleton rather than two.
        specs.map((s) => ({ keypoints: poseFor(s) })),
        video.videoWidth,
        video.videoHeight,
      );
    } catch (e) {
      // A missing reference just means every frame behaves as it did before.
      console.warn('[skelZone] batch body-scale pass failed:', e);
    }

    // PERSIST IT ON THE DRAFT — this is what lets "Redo mask" match the batch.
    //
    // Written HERE, before Phase 1, so it is stored on every exit path including
    // the "nothing built" early return. Without it the single-frame re-run derives
    // a raw per-frame unit that can collapse ~10x (measured: batch 46px vs re-run
    // 5px on the same frame), which is the thin-selection bug. See
    // `batchUnitFloorNorm` in types.ts.
    //
    // Safe to write at this point: Phase 1's "no draft writes" rule exists so
    // per-frame commits cannot interleave with seeks mid-loop, and this lands
    // before that loop starts. The Phase 2 commit spreads `prev`, so it survives.
    if (unitFloorNorm != null) {
      console.log(
        `[skelZone] batch body-scale reference: unit/width=${unitFloorNorm.toFixed(5)} ` +
        `(~${(unitFloorNorm * video.videoWidth).toFixed(0)}px here) — stored for single-frame re-runs`,
      );
      setDraft((prev) => (prev ? { ...prev, batchUnitFloorNorm: unitFloorNorm } : prev));
    }

    // ── PHASE A — AUTO-RACKET DETECTION, ALL FRAMES, THEN FREE THE DETECTOR ──
    //
    // WHY THIS IS ITS OWN PHASE INSTEAD OF PER-FRAME. Auto-racket needs D-FINE
    // (detect) and SAM-2 (segment); the person cutout needs the MediaPipe selfie
    // segmenter. Interleaved per frame, all three cycle and coexist, and on a
    // wasm / low-VRAM machine that is real memory and GPU pressure during the
    // work whose quality matters most. Phased, each model loads ONCE and is alone
    // while it runs:
    //
    //   PHASE A (here)      D-FINE only        → boxes, then D-FINE disposed
    //   PHASE 1 (below)     selfie segmenter   → the person cutout, alone
    //   PHASE C (after)     SAM-2 only         → racket segmented + unioned
    //
    // Slower by both models' load times. That is the accepted trade: the cutout
    // is what the coach judges, so it gets the cleanest memory state in the pass.
    //
    // Skipped entirely when the flag is off — the detector is never even imported.
    const racketBoxes = new Map<number, import('@/lib/stroMotionDraft/autoRacketPass').RacketBoxForFrame>();
    let racketPassActive = false;
    try {
      const { autoRacketActive, detectRacketBoxesForBatch } =
        await import('@/lib/stroMotionDraft/autoRacketPass');
      racketPassActive = autoRacketActive(current.objectType);
      if (racketPassActive) {
        console.log('[autoRacket] PHASE A — detecting on all frames (D-FINE alone)…');
        const { captureVideoFrameAtTime } = await import('@/lib/stroMotionDraft/captureSource');
        const inputs: import('@/lib/stroMotionDraft/autoRacketPass').RacketDetectInput[] = [];
        for (const spec of specs) {
          const frame = current.frames[spec.frameIndex];
          if (!frame) continue;
          // Reuse the bitmap Phase 0a2 already captured; capture here only when
          // it did not (a pose that already carried feet skips that capture).
          // Anything captured here goes into `preCaptured`, so Phase 1 hands it
          // to proposeFrameMask and the existing ownership sweep still applies.
          let bmp = preCaptured.get(spec.frameIndex) ?? null;
          if (!bmp) {
            try {
              bmp = await captureVideoFrameAtTime(video, frame.timeSec);
              preCaptured.set(spec.frameIndex, bmp);
            } catch (err) {
              console.warn('[autoRacket] capture failed for detection on frame', spec.frameIndex, err);
              continue;
            }
          }
          inputs.push({
            frameIndex: spec.frameIndex,
            frame: bmp,
            keypoints: poseFor(spec),
            label: racketFrameKey(spec.frameIndex, frame.timeSec),
          });
        }
        const found = await detectRacketBoxesForBatch(inputs, {
          vw: video.videoWidth,
          vh: video.videoHeight,
          unitFloorNorm,
        });
        found.forEach((v, k) => racketBoxes.set(k, v));
      }
    } catch (e) {
      // Detection is optional; a failure here must never stop the cutout pass.
      console.warn('[autoRacket] PHASE A failed — continuing with the person cutout only:', e);
    }

    // Phase 1 — build ALL proposals in memory. No draft writes here, so nothing
    // can interleave, re-sync, or leave a frame partially committed.
    /** Phase-0 bitmaps that proposeFrameMask accepted ownership of. */
    const handedOff = new Set<number>();
    const built: Array<{
      frameIndex: number;
      selectionBox: StroMotionSubjectBox;
      sourceFrame: ImageBitmap;
      aiSnapshot: AlphaMask;
      working: AlphaMask;
    }> = [];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const frame = current.frames[spec.frameIndex];
      if (frame) {
        try {
          const proposal = await proposeFrameMask(
            video,
            frame.timeSec,
            spec.selectionBox,
            current.backgroundTimeSec,
            current.objectType,
            plate,
            spec.scribble ?? null,
            true,                       // skeleton guidance on
            // Foot-capable pose from Phase 0a2 when it succeeded, else the app's
            // existing skeleton — COCO-17 indices either way, feet named at 17+.
            poseFor(spec),
            // Phase 0a2 captures a bitmap per frame, so this is now populated on
            // every run rather than only under racketMode 'arc'. Ownership is
            // unchanged: proposeFrameMask claims it, and the sweep after Phase 1
            // releases anything it declined.
            preCaptured.get(spec.frameIndex) ?? null,
            axisByFrame.get(spec.frameIndex) ?? null,
            unitFloorNorm,
          );
          // A non-null proposal has TAKEN the bitmap: it comes back as
          // `proposal.sourceFrame` and is closed by the commit below or by the
          // empty-mask branch. Anything still unclaimed after the loop is ours to
          // release — see the sweep after Phase 1.
          if (proposal) handedOff.add(spec.frameIndex);
          if (proposal && maskHasContent(proposal.aiSnapshot)) {
            // NO racket work here — see the PHASE A / PHASE C blocks around this
            // loop. This loop is the person cutout and nothing else, so it runs
            // with neither D-FINE nor SAM-2 resident.
            built.push({
              frameIndex: spec.frameIndex,
              selectionBox: spec.selectionBox,
              sourceFrame: proposal.sourceFrame,
              aiSnapshot: proposal.aiSnapshot,
              working: proposal.working,
            });
          } else if (proposal) {
            try { proposal.sourceFrame.close(); } catch { /* closed */ }
          }
        } catch (err) {
          console.error('[StroMotion] proposal build failed on frame', spec.frameIndex, err);
        }
      }
      setProgress({ current: i + 1, total: specs.length });
      onProgress?.(i + 1, specs.length);
      // Yield so the paint loop keeps running (skeleton doesn't freeze mid-pass).
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }

    // Release any Phase-0 bitmap that proposeFrameMask never took ownership of —
    // it returned null, or threw before claiming it. Empty in every non-'arc'
    // run, because Phase 0 captured nothing.
    for (const [idx, bmp] of preCaptured) {
      if (handedOff.has(idx)) continue;
      try { bmp.close(); } catch { /* already released */ }
    }

    if (built.length === 0) {
      setStatus('configuring');
      setProgress({ current: 0, total: 0 });
      return 0;
    }

    // ── PHASE C — SEGMENT THE DETECTED RACKETS WITH SAM-2, ALONE ────────────
    //
    // Every person mask above is already finished, and D-FINE was disposed at the
    // end of Phase A, so SAM-2 is the only heavy model that loads here. Only the
    // frames Phase A actually found a box on are touched — a frame with no racket
    // pays no encode at all.
    //
    // The union is max()-only (measured: 320k random trials and real SAM output,
    // zero person pixels lowered), so this can add the racket and nothing else.
    // Every failure path leaves that frame's mask exactly as the cutout built it.
    if (racketPassActive && racketBoxes.size > 0) {
      console.log(`[autoRacket] PHASE C — segmenting ${racketBoxes.size} racket(s) with SAM (alone)…`);
      const { segmentRacketIntoMask } = await import('@/lib/stroMotionDraft/autoRacketPass');
      for (const b of built) {
        const hit = racketBoxes.get(b.frameIndex);
        if (!hit) continue;
        const frame = current.frames[b.frameIndex];
        if (!frame) continue;
        try {
          const r = await segmentRacketIntoMask({
            mask: b.aiSnapshot,
            frame: b.sourceFrame,
            // The manual Object tool's own cache key, so a frame segmented here
            // makes that tool instant on it and neither path encodes twice.
            samKey: racketFrameKey(b.frameIndex, frame.timeSec),
            hit,
          });
          if (r.applied) {
            b.aiSnapshot = r.mask;
            // The editor opens on `working`, so the coach sees the racket already
            // in the mask and can brush or re-click from there.
            b.working = cloneAlphaMask(r.mask);
            console.log(`[autoRacket] frame ${b.frameIndex}: ${r.reason}`);
          } else {
            console.log(`[autoRacket] frame ${b.frameIndex}: not segmented — ${r.reason}`);
          }
        } catch (e) {
          console.warn('[autoRacket] PHASE C failed on frame', b.frameIndex, e);
        }
        // Yield so the paint loop keeps running through the SAM encodes.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
    }

    // Phase 2 — commit the COMPLETE set in ONE update. Every built frame becomes
    // fully editable AND export-ready in the same commit.
    setDraft((prev) => {
      if (!prev) {
        built.forEach((b) => { try { b.sourceFrame.close(); } catch { /* closed */ } });
        return prev;
      }
      const byIndex = new Map(built.map((b) => [b.frameIndex, b]));
      const frames = prev.frames.map((f) => {
        const b = byIndex.get(f.index);
        if (!b) return f;
        if (f.sourceFrame) { try { f.sourceFrame.close(); } catch { /* closed */ } }
        return {
          ...f,
          selectionBox: b.selectionBox,
          sourceFrame: b.sourceFrame,
          aiSnapshot: b.aiSnapshot,
          working: b.working,
          readyMask: cloneAlphaMask(b.working),
          status: 'ready' as StroMotionFrameStatus,
        };
      });
      return { ...prev, frames };
    });
    invalidatePreview();
    setStatus('configuring');
    setProgress({ current: 0, total: 0 });
    return built.length;
  }, [invalidatePreview, videoRef, getBackgroundPlate]);

  const updateFrameMask = useCallback((frameIndex: number, mask: AlphaMask) => {
    // TEMP-DEBUG-PAINT — the far end of the paint chain. If applyAtPoint logs but
    // this does not, the break is in the onMaskChange wiring, not the brush.
    // Gated pre-launch: this fires on every brush commit, so it filled a real
    // coach's console. `window.__stroSkelDebug = true` brings it back.
    if (stroDebugEnabled()) {
      console.log(`[TEMP-DEBUG-PAINT] updateFrameMask frame=${frameIndex} maskLen=${mask.data.length}`);
    }
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex
          ? { ...f, working: mask, readyMask: null, status: statusAfterMaskEdit(f.status) }
          : f,
      );
      return { ...prev, frames };
    });
    invalidatePreview();
  }, [invalidatePreview]);

  const resetFrameMask = useCallback((frameIndex: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex && f.aiSnapshot
          ? {
              ...f,
              working: cloneAlphaMask(f.aiSnapshot),
              readyMask: null,
              status: 'edited' as StroMotionFrameStatus,
            }
          : f,
      );
      return { ...prev, frames };
    });
    invalidatePreview();
  }, [invalidatePreview]);

  const reproposeFrameMask = useCallback(async (
    frameIndex: number,
    opts?: {
      keypoints?: Array<{ x: number; y: number; score: number; name?: string }> | null;
      /**
       * The bitmap the caller already captured for this frame — the same one the
       * skeleton above was detected on. Ownership transfers to the draft.
       */
      frame?: ImageBitmap | null;
    },
  ): Promise<boolean> => {
    const current = draftRef.current;
    const frame = current?.frames[frameIndex];
    if (!frame?.selectionBox) return false;
    // Auto-BG / Re-propose IS auto-detect for one frame — same code path, same
    // result. The caller supplies the existing skeleton via `opts.keypoints`, and
    // optionally the very frame it was read from via `opts.frame`.
    return selectAreaForFrame(frameIndex, frame.selectionBox, {
      useSkeletonGuidance: true,
      keypoints: opts?.keypoints ?? null,
      frame: opts?.frame ?? null,
    });
  }, [selectAreaForFrame]);

  const markFrameReady = useCallback((frameIndex: number): boolean => {
    const current = draftRef.current;
    const frame = current?.frames[frameIndex];
    const mask = frame?.working ?? frame?.readyMask ?? frame?.aiSnapshot;
    if (!mask || !maskHasContent(mask)) return false;

    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) => {
        if (f.index !== frameIndex) return f;
        return {
          ...f,
          readyMask: cloneAlphaMask(mask),
          status: 'ready' as StroMotionFrameStatus,
        };
      });
      return { ...prev, frames };
    });
    invalidatePreview();
    return true;
  }, [invalidatePreview]);

  const generatePreview = useCallback(async (
    options?: {
      background?: StroMotionBackground;
      videoOrder?: StroMotionVideoOrder;
      endTimeSec?: number;
      draftOverride?: StroMotionDraft;
      /** Uniform ghost transparency (0–1); undefined keeps temporal fade. */
      opacity?: number;
      /** Restrict the render to these frame indices (Generate "included renders"). */
      includedIndices?: number[];
    },
  ): Promise<string | null> => {
    const video = videoRef.current;
    const current = options?.draftOverride ?? draftRef.current;
    if (!video || !current || current.frames.length === 0) return null;
    const consideredFrames = options?.includedIndices
      ? current.frames.filter((f) => options.includedIndices!.includes(f.index))
      : current.frames;
    if (consideredFrames.length === 0) return null;
    if (countExportReadyFrames(consideredFrames) !== consideredFrames.length) return null;

    setStatus('generating');
    setProgress({ current: 0, total: 1 });
    try {
      const pngUrl = await exportStroMotionDraftPng(video, current, {
        background: options?.background,
        videoOrder: options?.videoOrder,
        endTimeSec: options?.endTimeSec,
        opacity: options?.opacity,
        includedIndices: options?.includedIndices,
      });
      setStatus('ready');
      return pngUrl;
    } catch (err) {
      console.error('[StroMotion] Generate PNG failed:', err);
      setStatus('configuring');
      return null;
    } finally {
      setProgress({ current: 0, total: 0 });
    }
  }, [videoRef]);

  const hydrateDraftForExport = useCallback(async (): Promise<StroMotionDraft | null> => {
    const video = videoRef.current;
    const current = draftRef.current;
    if (!video || !current) return null;
    const hydrated = await hydrateDraftBitmapsForExport(video, current);
    setDraft(hydrated);
    return hydrated;
  }, [videoRef]);

  const setConfiguring = useCallback((configuring: boolean) => {
    setStatus((prev) => {
      if (configuring && (prev === 'idle' || prev === 'configuring')) return 'configuring';
      if (!configuring && prev === 'configuring') return draftRef.current ? 'configuring' : 'idle';
      return prev;
    });
  }, []);

  return {
    draft,
    status,
    objectType,
    setObjectType,
    activeFrameIndex,
    setActiveFrameIndex,
    proposingFrameIndex,
    isProposingFrame: proposingFrameIndex !== null,
    isGenerating: status === 'generating',
    isProcessing: status === 'proposing' || status === 'generating',
    progress,
    syncDraft,
    updateFrameTime,
    updateFrameLabel,
    clearAllSelections,
    selectAreaForFrame,
    autoProcessFrames,
    updateFrameMask,
    resetFrameMask,
    reproposeFrameMask,
    markFrameReady,
    generatePreview,
    hydrateDraftForExport,
    invalidatePreview,
    clearAll,
    setConfiguring,
    renderStroMotionDraftComposite,
  };
}
