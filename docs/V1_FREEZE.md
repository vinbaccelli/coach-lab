# AngleMotion V1 Freeze

This document is the contract for the V1 stabilization phase. It lists the
subsystems that are **frozen** (working, verified, and off-limits to refactor)
and the work that **remains**. Every subsystem finished during stabilization is
added here.

Last updated: 2026-11-03

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
8. **Rule 8: A failing test is a finding, never something to fix quietly.**
   - When any test or check fails (a unit test, a Playwright or end-to-end check, `tsc`, the build, or a manual check), you must NOT edit the test, its expected values, its fixtures, its snapshots or the check so that it passes. You must NOT skip, delete, loosen, `.skip` or `.only` it, and you must NOT change the code only to satisfy the test without saying so.
   - Stop and report to the architect: the test name and file, expected versus actual, the change that most likely caused it, and your own assessment (a bug in the new change, or the feature was changed on purpose).
   - The architect decides. If it is a bug, the code is fixed and the test stays as it is. If the behaviour was changed on purpose, the architect approves the new expectation in writing, and only then is the test updated, in a separate commit whose message says "test updated: <reason>, approved".
   - A new test written for new code follows the same rule if it fails.
   - This applies equally to tests of frozen systems, and to every reply that reports verification: a reply must list every failing test it saw, even ones it believes are unrelated.

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
| ✅ Recording PiP subsystem | `contexts/RecordingContext.tsx`, `lib/pipRecorderSurface.ts`, `components/Canvas.tsx` webcam-PiP block (Source A suppression) | `2026-07-19`¹ |
| ✅ Skeleton persistent on/off gate (Family B) | `app/analysis/page.tsx` (`skeletonEnabled` formula, StroMotion checkbox → `setSkeletonOn` mirror, `resetMetrics()`, `handleMarkupClear()`) | `2026-07-19`² |

**Frozen means:** no refactor, no API change, no "cleanup". Bug fixes touching
these require explicit approval (Rule 6).

¹ No git repo is present in this working tree (`git rev-parse` fails), so this
row cites the confirmation date instead of a commit hash, unlike the rows above.

² Cites the confirmation date, not a commit hash — as of writing this fix is
**uncommitted** in the working tree (verify with `git status` before assuming
it has landed anywhere beyond the local checkout).

### Recording PiP subsystem — confirmed behavior

Verified end-to-end via live instrumentation + manual test on a real localhost
session (no stale build, no service-worker contamination):

- Meet-style floating camera + Pause/Resume/Stop + live timer, Document PiP,
  survives tab/app switching (PiP window's own rAF drives the paint loop, not
  throttled while the opener tab is hidden).
- Entire-Screen share mode produces exactly ONE webcam in the output: the
  on-canvas webcam (Source A) is suppressed while recording, and the composited
  stamp (Source B) is skipped when `displaySurface === 'monitor'` — the floating
  PiP window itself is the only camera the screen grab picks up.
- Camera re-enable after closing the PiP mid-recording: the Recording Hub's
  webcam toggle button syncs to "off" the moment the PiP closes
  (`onWebcamClosedByPip`), and toggling it back on both feeds the live stream
  into the active recording (`updateWebcamStream`) and re-opens a fresh PiP
  window from that click's gesture (`reopenPipWindow`) — verified through a full
  close → toggle-on → reopen cycle with no freeze and no recording gap.
- Recording continuity is sacred throughout all of the above: `captureStream`,
  `MediaRecorder`, and audio-track assembly are untouched by any of this — PiP
  open/close/reopen only changes what the Source B region draws from.

### Recording PiP subsystem — NOT yet tested

Do not assume these are covered by the verification above:

- **This-Tab / This-Window share modes** — only Entire-Screen has been verified.
  The Source A/B suppression logic is `displaySurface`-gated, so behavior in
  these modes is unconfirmed, not merely unverified-but-assumed-fine.
- **An isolated 60+ second hidden-tab throttle test with the PiP left closed the
  whole time** — the accepted-degradation fallback path (opener `setInterval`
  throttling in a hidden tab) has not been exercised in isolation for a sustained
  duration.
- **PiP window drag/resize as a standalone check** — not verified separately
  from the rest of the recording flow.

### Skeleton persistent on/off gate (Family B) — confirmed behavior

Verified live against running code (not just diff review):

- **B1 (skeleton blanking on StroMotion exit):** turned the skeleton on via the
  canonical toolbar toggle, entered StroMotion, exited fully back to top level,
  re-checked state via the button's `data-active` attribute — held `true`
  throughout. **CONFIRMED FIXED.**
- **B2 (Clear-All silently disabling the skeleton):** with the skeleton on,
  pressed Clear All (`handleMarkupClear`) — state held `true` after, no
  confirmation dialog interfered. **CONFIRMED FIXED.**
- **Canonical toolbar toggle:** confirmed still functions correctly, unchanged
  code path, exercised repeatedly during testing.

Scope of the fix (4 hunks, `app/analysis/page.tsx` only):
- `skeletonEnabled` simplified from `skeletonOn || (stroMotionActive && stroShowSkeleton)`
  to `skeletonOn` — one persistent flag, no longer collapses when StroMotion exits.
- StroMotion-internal checkbox's `onShowSkeletonChange` now also calls
  `setSkeletonOn`, in addition to the existing `setStroShowSkeleton` (which still
  independently gates the StroMotion ghost-pose composite render in
  `Canvas.tsx` — untouched, kept as its own concern per explicit decision).
- `resetMetrics()` no longer calls `setSkeletonOn(false)`.
- `handleMarkupClear()` (Clear-All) no longer calls `setSkeletonOverlayPaused(true)`.

### Skeleton persistent on/off gate (Family B) — NOT yet tested

- **StroMotion-internal checkbox's symmetric wiring** — the two-line change
  where checking/unchecking the checkbox inside StroMotion's frame-review step
  also flips `setSkeletonOn` has not been exercised live. That step is gated
  behind "Upload video first," and no test video was available this session.
  Lower risk than B1/B2 (it rides on already-verified gate logic), but unwatched.

---

## Remaining ⬜

| Area | Notes |
|------|-------|
| ⬜ Skeleton Stability — Family A | Live-path jitter/jump on slow devices (interpolation clamp, backpressure) — distinct from the (frozen) worker-recovery freeze and now also distinct from the frozen Family B on/off gate above |
| ⬜ Recording Hub | Post-record crop/trim; permission-prompt latency (movable/resizable webcam overlay is now the frozen Recording PiP subsystem above) |
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
