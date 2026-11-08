# AngleMotion V1 Freeze

This document is the contract for the V1 stabilization phase. It lists the
subsystems that are **frozen** (working, verified, and off-limits to refactor)
and the work that **remains**. Every subsystem finished during stabilization is
added here.

Last updated: 2026-11-08 (V1 final priorities consolidated; V2 frozen)

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

### V1 stage rules (architect, 2026-11-08 — apply to all remaining V1 work)

S1. Work on one stage at a time.
S2. Audit before changing code.
S3. Preserve existing working functionality.
S4. Avoid unnecessary rewrites.
S5. Keep changes modular and maintainable.
S6. Run TypeScript checks and the relevant automated tests.
S7. Provide before/after benchmarks whenever performance is involved.
S8. Document architectural decisions.
S9. Separate commits and PRs for logically distinct changes.
S10. Provide clear manual testing instructions.
S11. State what has and has not been tested on physical devices.
S12. Never claim a mobile performance improvement from a desktop benchmark alone.
S13. Do not start the next stage until the architect has tested and approved the current one.
S14. Never merge into `main` or deploy to production without the architect's explicit approval.
S15. Problems found outside the agreed scope are documented with a priority, never silently fixed or expanded into.

---

## How this document is organised

1. **Completed — preserve** (the "Frozen ✅" table and the skeleton block below): working functionality that must not be rewritten without cause.
2. **V1 remaining**: the work required to finish the product (Live Skeleton hand-over + Stages 1–3 + carried-over items).
3. **V2 — FROZEN**: the proprietary pose engine. Documented here so it is not lost; **no time is allocated to it until V1 is finished and explicitly approved.**

Product architecture lives in `docs/COACHLAB_V1_PRODUCT_FREEZE.md` (coach-override principle, player-first topology); this file is the process/boundary contract. They do not compete: if they disagree on product behaviour the product freeze wins, on process this file wins.

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

## Completed — skeleton work to preserve (built, NOT merged: open draft PRs)

All of the following live in a **stack of open draft PRs, not on `main`** (state checked 2026-11-08). Nothing here is deployed.

| Piece | Where | PR (base → head order) |
|-------|-------|------------------------|
| Architecture contract (Steps 1–3): one analysis mode owns the canvas/column (`live` \| `snapshot` \| `frame`); pose display writes are provenance-gated; no cross-mode column merging | `CLAUDE.md` "Project reality" | landed earlier |
| Stage 0 benchmark harness | `lib/skeletonBench/*`, `scripts/skeleton-bench/`, `docs/SKELETON_BENCH.md` | #151 |
| Stage 2a: null angles (never 0°), per-joint validation, crop tracking, frame gate, live display continuation | `docs/SKELETON_ANGLES_NULL.md`, `SKELETON_VALIDATION.md`, `SKELETON_CROP_TRACKING.md`, `SKELETON_ON_OFF_AUDIT.md` | #152 |
| Stage 2c: model-download progress, real-device lag trace (`?debug=1`, COPY TRACE) | `lib/modelPrefetch.ts`, `lib/tempDebugPose.ts` | #154 |
| RTMPose evaluation lab (isolated) | `app/rtmpose-lab/`, `lib/rtmpose/*`, `docs/RTMPOSE_SPIKE.md` | #156 (not for merge as is: ~109 MB of lab weights) |
| **RTMPose-t default Live Skeleton** (`?live=off` → MoveNet, `?live=rtmpose-s`, auto-fallback to MoveNet) | `lib/skeletonSwitches.ts`, `components/Canvas.tsx` `runRtmposeLive` | #157 (draft; **licence-gated**, see "Live Skeleton" under V1 remaining) |
| **AI Track** (whole-video bake, selected player, completed track, scrub/playback) | `app/analysis/page.tsx` bake pipeline | already works well ("mode B very good"); **do not redesign or rebuild** |

Measured on the architect's iPhone (Chrome/WebKit), same serve clip, build 017c9fb: RTMPose-t pose age 38–39 ms steady, round trip about 30 ms, about 30 detections/s; MoveNet default measured earlier 39–40 ms and 20–25 det/s; RTMPose-s 55–73 ms (worse). One clip only; crowds / two players / fast swings / 0.25× still to be tested.

### Parked experiments (kept in code, OFF by default, not in normal playback)

| Item | Why parked |
|------|-----------|
| Second-video look-ahead (`?lookahead=…`, `lib/lookAheadPose.ts`, #153/#155) | On the iPhone the second decoder did not help and made pose age worse; the architect decided to stop. Do not spend further time on buffer depths or decoder configs. |
| Measured-lag prediction (`scripts/skeleton-bench/predict-sweep.ts`) | Did not pay off in the simulator. |

---

## V1 — remaining work (priority order, one stage at a time)

> V1 order (architect, 2026-11-08, supersedes the earlier plan): **1.** Live Skeleton stays on RTMPose-t. **2.** AI Track stays on its existing MediaPipe implementation, with Foot Lines on by default and an off option. **3.** Motion Layer fixes. **4.** Player Database. **5.** Proprietary pose model: documented and frozen for V2.

### Live Skeleton (built; RTMPose-t stays; waiting on licence + merge approval)
RTMPose-t is the Live Skeleton engine, **subject to the licensing approach agreed with the architect's lawyer**. **Live Skeleton does not use Foot Lines and must not gain them**: Foot Lines on keeps switching the live model to MediaPipe Live, and the RTMPose gate (`useRtmposeLive`) already turns RTMPose off while they are on. Still open: crowd / two-player / fast-swing / 0.25× testing; the Human-Art person detector used by the live engine (`public/models/rtmpose/yolox-tiny.onnx`) must be replaced or removed before any production deploy; third-party notices (`docs/RTMPOSE_LICENCE.md`).

### Stage 1 — AI Track: keep MediaPipe, Foot Lines on by default (REVISED 2026-11-08)
**Decision:** AI Track is **not** changed to RTMPose-t and gets no hybrid engine and no redesign of the tracking pipeline. The earlier "RTMPose-t inside AI Track" investigation is closed. Its audit findings are kept so nobody repeats it: RTMPose-t body7 has COCO-17 only (no heel/toe, which Foot Line and `computeFootDirection` use), the locked-player pass needs up to 4 candidates per frame (`MAX_TRACK_POSES`, `matchAtLock`, `followStep`), and RTMPose scores are not on MediaPipe's `visibility` scale (downstream thresholds would need re-calibration).
**Work:** make the existing MediaPipe Foot Lines a standard, optional part of AI Track output: on by default whenever AI Track runs, with a simple on/off control (the existing "Foot line" checkbox in `components/ToolPalette.tsx` is that control). With them off, the rest of AI Track works exactly as before. Audit result and proposed change: see the PR for this stage; a small change in `app/analysis/page.tsx` only.
Gate: architect tests and approves before Stage 2.

### Stage 2 — Motion Layer complete optimisation (next after Stage 1)
A. Memory and storage: redundant frame captures, bitmap duplication, unreleased `ImageBitmap`, accumulation across Generate / editor open-close / project or video switches, background-plate duplication, high-resolution consumption, temp storage cleanup, frame caching. Baseline from `docs/PHASE1_AUDIT.md` (M1–M6; +142 MiB live bitmaps and +681 MB renderer memory per Generate at 1080p, 5 frames, desktop).
B. Persistence: survive refresh, editor close/reopen, navigation away and back, loss of focus, switching videos, interrupted Generate, unexpected reload; autosave and recovery on the existing storage architecture; **no new storage cost or service without justification first**.
C. Performance: extraction, bitmap lifecycle, rendering, compositing, background processing, export, resolution handling, high frame counts. **No arbitrary 15-frame cap**: user chooses frames, sees a clear memory/processing warning and may continue; adaptive memory management and graceful errors; test 5, 10, 15, 20, 30, 50 frames where possible.
D. AI Detect object detection: accuracy, frame-to-frame consistency, moving objects, false positives, mobile performance and memory. Person/pose detection is a separate requirement.
E. Manual background removal object tool: selection, accuracy, segmentation quality, edge consistency, movement between frames, editing performance, memory, behaviour on selection change. Preserve the manual workflow.
Acceptance (architect tests): 1080p and 4K; more than 15 frames; repeated Generate; refresh/reopen; AI Detect; manual background removal; long sessions; Mobile Safari on the iPhone. Before/after benchmarks with desktop and real-device results labelled separately. Gate: approval before Stage 3 (Player Database).
Constraint: the Generate pipeline, Auto Detect and manual StroMotion workflow are in the Frozen table above — touching them needs explicit approval (Rule 6).

### Stage 3 — Player Database
Audit existing DB / Supabase / auth / storage first; reuse existing infrastructure; no unnecessary tables, duplicate systems or paid services without justification.
- Profiles (name, DOB, height/weight, measurements, UTR, level, dominant hand, style, coaching info; updatable over time).
- Development timeline (video analyses, screenshots, skeleton/Motion Layer analyses, coach notes, match/technical/tactical observations, physical tests, sessions, results, progress comparisons).
- Training and development plans (technical, tactical, physical, exercises, weekly schedule, sessions, logs, progress).
- Physical testing (test types, results, dates, comparisons).
- Nutrition and mental development: modular structure only, not all at once.
- Integration: coach opens a profile → uploads/selects a video → analysis is associated with the player → screenshots, videos, notes, results land in the timeline → previous analyses are revisitable and comparable.
- Architecture: relationships, Row Level Security, coach/player permissions, storage costs, data ownership, scalability, mobile usability; follows the existing visual identity (clean, minimal, professional); built incrementally with a PR and test instructions per increment.
Product principles from `docs/COACHLAB_V1_PRODUCT_FREEZE.md` (player-first, coach override) apply.

### Carried over / found along the way (documented, not in scope unless the architect says so)

| Item | Priority note |
|------|---------------|
| Stuck video after touching the UI during load (video ends up stuck at the end); `seek: frame not ready (rs=4), retrying` lines in the debug panel | Diagnosis not done; separate from Stage 1–3 |
| Worker failures on a cold / low-power phone | Open |
| Weak reference at fast swings; only one or two clips tested | Test gap for every skeleton claim |
| Remaining items in the table at the end of this file | As listed |

---

## V2 — Proprietary AngleMotion pose estimation engine (FROZEN — NOT PART OF CURRENT WORK)

**Status: frozen.** No time is allocated to training, dataset collection, annotation or model building. Do not begin until V1 is finished and the architect explicitly approves.

**Objective:** our own pose estimation engine, initially specialised for tennis, that eventually outperforms general-purpose models (RTMPose-t is the V1 baseline) on tennis movements.

**Scope of the future project**
1. Research into suitable pose-estimation architectures.
2. Our own training pipeline.
3. Commercially licensed training datasets (the Body7 licensing problem in `docs/RTMPOSE_LICENCE.md` is a reason this project exists).
4. Tennis-specific footage collection and annotation, with documented participant permissions.
5. Better racket-arm and lower-body tracking.
6. Better anatomical accuracy during fast movements.
7. Temporal consistency without excessive smoothing.
8. Real-time mobile inference.
9. ONNX export and browser compatibility.
10. Smaller models and lower memory use.
11. Benchmarks against RTMPose-t.

**Assets that already exist and should be reused for V2 benchmarking (do not delete):** `lib/skeletonBench/*` (metrics, synthetic tracks), `lib/rtmpose/labMetrics.ts`, `app/rtmpose-lab/` (same-frame comparison and 1× real-time test), the iPhone trace format (COPY TRACE) and `docs/RTMPOSE_SPIKE.md` (method and baseline numbers). Keep the engine seam in `Canvas.tsx` (`runRtmposeLive`) engine-agnostic so a V2 engine can be swapped in.

**Entry conditions:** V1 stages 1–3 approved; architect's explicit go; licensing and consent plan for data collection reviewed with the lawyer.

---

## Other V1 items (carried over from earlier freeze) ⬜

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
