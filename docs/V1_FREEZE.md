# AngleMotion V1 Freeze

This document is the contract for the V1 stabilization phase. It lists the
subsystems that are **frozen** (working, verified, and off-limits to refactor)
and the work that **remains**. Every subsystem finished during stabilization is
added here.

Last updated: 2026-07-17

---

## Rules (binding for every change until V1 ships)

1. **Do not refactor any frozen subsystem** unless explicitly asked.
2. **Do not improve code quality or architecture outside the requested bug.**
3. **Preserve every existing API** unless absolutely required.
4. **Smallest possible surface area** for every change.
5. **Never rewrite a subsystem that already works.**
6. **If a requested fix would require changing a frozen subsystem, STOP and
   explain why before writing code.**
7. **Every fix must preserve backward compatibility** with all existing V1
   behavior.

The goal is stabilization only, not redesign.

---

## Frozen ✅

| Subsystem | Where it lives | Frozen at |
|-----------|----------------|-----------|
| ✅ Worker Recovery | `lib/poseWorker.ts` (per-inference timeout, context-loss detection, bounded backoff + WASM fallback) | `9cff403` |
| ✅ Pose Worker Architecture | `lib/poseWorker.ts`, `lib/poseWorkerBridge.ts` (single-in-flight bridge, result routing) | `9cff403` |
| ✅ Foot Line | `components/Canvas.tsx` foot-line render (real toe → ankle→toe, else `estimateFootVector`) | `9cff403` |
| ✅ Shared `estimateFootVector` | `lib/biomechanics/measurements.ts` (single canonical algorithm) | `9cff403` |
| ✅ Skeleton ↔ AI Measurement consistency | Canvas foot line + `computeFootDirection` share geometry + data source | `9cff403` |
| ✅ StroMotion Auto Detect architecture | `app/analysis/page.tsx` (`autoSelectAllObjectFrames`, `buildPlayerFrameSpec`) | `9cff403` |
| ✅ Atomic Auto Detect commit | `hooks/useStroMotion.ts` `autoProcessFrames` (build-all → single `setDraft`) | `9cff403` |
| ✅ Manual StroMotion workflow | `hooks/useStroMotion.ts` `selectAreaForFrame`, `finishStroRegionSelect` | `9cff403` |
| ✅ Auto Detect editor workflow | `FrameMaskEditor` gate + committed frame `{sourceFrame, selectionBox, aiSnapshot, working, readyMask, status:'ready'}` | `9cff403` |
| ✅ Generate pipeline architecture | `lib/stroMotionDraft/exportDraft.ts`, `compositeFromDraft.ts`, `frameMask.ts` (reads the committed draft) | `9cff403` |

**Frozen means:** no refactor, no API change, no "cleanup". Bug fixes touching
these require explicit approval (Rule 6).

---

## Remaining ⬜

| Area | Notes |
|------|-------|
| ⬜ Skeleton Stability | Live-path jitter/jump on slow devices (interpolation clamp, backpressure) — distinct from the (frozen) worker-recovery freeze |
| ⬜ Recording Hub | Movable/resizable webcam overlay; post-record crop/trim; permission-prompt latency |
| ⬜ Phone UI | Extended toolbar on phone; general mobile layout |
| ⬜ Timeline Handles | Grab reliability after scrubbing (esp. right handle) |
| ⬜ Generate Panel | Layout overlap on phone |
| ⬜ Text tool | Placement/commit interaction (does not open / commits empty) |
| ⬜ Undo/Skeleton | (fix shipped — re-confirm in QA) |
| ⬜ Final QA | End-to-end pass across desktop + phone before V1 ship |

---

## Change protocol

For any requested fix:
1. Identify whether it touches a frozen subsystem.
2. If **yes** → stop, explain the conflict, get approval (Rule 6).
3. If **no** → apply the smallest change that fixes the reported bug (Rules 2, 4).
4. `tsc` + build clean; verify; then this log is updated when a subsystem is
   completed/frozen.
