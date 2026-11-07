# Phase 1 — technical audit and baseline: Skeleton and Motion Layer

Investigation only. **No source was changed.** Branch `audit/phase1-baseline`, from `main` at `caf593e5` (the production code at the time of writing).
Evidence labels: **code** (read at `file:line` on that commit), **measured** (this session, desktop Chromium headless, software GL, CPU MediaPipe delegate; **not a phone**), **not measured** (with the reason). Estimates are mine and say so. Nothing here relies on the earlier research docs; where they were wrong, §0 says so.

## 0. Summary and corrections
1. **Correction to my earlier reading of your screenshots.** I wrote that they were probably raw per-frame detections shown while the AI Track pass runs. That was wrong. The green "Following locked player" tag is drawn in two places (`components/Canvas.tsx:7028-7047`): with a dashed box during the pass, and **without a box on playback of a finished locked track**. Your screenshots show no dashed box, so they are the **final baked track**, after the cleanup. The distorted poses are therefore what the pipeline keeps, not transient frames.
2. **The "0°" angles are produced by our own code, not by the model.** `app/analysis/page.tsx:3828` fills every angle that was not emitted with `?? 0`, so a joint trio that is missing or below the confidence bar shows as **0°**. A true 0° (two segments on the same ray) can also occur from a degenerate pose. Missing is shown as a valid measurement.
3. **Skeleton:** the MediaPipe passes (AI Track, locked player, live foot-line) run on the **whole frame, never a crop**, in **IMAGE mode (no tracking between frames)**, on the **main thread**, with the model's `visibility` used as "confidence" at a low bar (0.2). There is no limb-length, left/right or bone-continuity check anywhere. A synthetic test shows the failure that follows when the player is small in the frame (§3).
4. **Motion Layer, the biggest measured memory fault:** the export path re-captures **every frame plus the background plate from the video** each time and never closes the old bitmaps. One Generate (1080p, 5 frames) measured **+142 MiB of live bitmaps and +681 MB of renderer memory in ~3 s**; the cost scales with pixels × frames (4K = 4×).
5. **Motion Layer, per-frame data:** each frame holds a full-size bitmap plus three full-size masks (**14.5 MB per frame at 1080p, 58 MB at 4K**), and the composite does a full-frame pixel readback per layer on every redraw. The UI allows **1–15 frames** (`lib/stroMotionDraft/types.ts:84`); your test plan lists 20, 30 and 50, which the product does not offer today.
6. **Racket pass:** about 1 GB of WebAssembly memory that the page cannot return; already switched off by default on phones (PR #148). Not part of Phase 3 unless you want it revisited.

## 1. Architecture overview

### A. Skeleton: four engines
| Engine | Where | Mode | Thread | Used for |
|---|---|---|---|---|
| MoveNet Thunder/Lightning (TF.js) | `lib/poseWorker.ts`, `lib/poseWorkerBridge.ts` | per-frame detection with a crop around the last centre (`poseWorker.ts:462-479`) | **worker** | live skeleton during playback; chooses Thunder or Lightning by measured speed (`:73-100`, 80 ms budget) |
| MediaPipe Pose Landmarker, IMAGE, 1 pose | `lib/mediapipePose.ts:83-110` | stateless, whole frame | **main** | AI Track (no lock), AI Detect, foot probe |
| MediaPipe IMAGE, up to 4 poses | `mediapipePose.ts:389-420`, `detectLockedPose :455` | stateless, whole frame | **main** | AI Track with a **locked player** |
| MediaPipe VIDEO (live) | `mediapipePose.ts:513-600` | VIDEO mode, 15 Hz, `Canvas.tsx:4647` | **main** | live foot lines, falls back to MoveNet if > 70 ms |

Other pieces: `lib/aiTrackLock.ts` (box-level follower: `matchAtLock`, `followStep`, `passPlan`), `lib/trackSmoothing.ts` (`smoothBakedTrack`), `lib/keypointSmooth.ts` (One Euro, live), baked-track store and lookup in `Canvas.tsx` (`finishBakeCapture :3840`, `lookupBakedPose :2341`), the pass itself `app/analysis/page.tsx:1531` (`runPrecisionPass`).

**AI Track flow (code):** pause the visible video, seek to each sample time (`seekTo`: `seeked`, then `requestVideoFrameCallback`, with a 300 ms safety timer), run `lm.detect(video)` synchronously, store `{t, keypoints}`. Tiers (`mediapipePose.ts:304-308`): fast = full @30 fps, balanced = heavy @45, max = heavy + mirrored test @60. With a lock the pass starts at the lock frame, walks forward then backward (`passPlan`), follows the player by **box continuity only** (`followStep`: search radius, size ratio ≤ 1.45, "detection confidence is never consulted"), and a gap > 0.25 s splits the track (`TRACK_GAP_SPLIT_SEC`). `finishBakeCapture` runs `smoothBakedTrack` per segment. Playback interpolates linearly between samples by video time and snaps across gaps > 0.5 s.

**Lifecycle:** the IMAGE, multi-person and live landmarkers are cached module-level promises. **Only the live one is ever closed** (`disposeLiveLandmarker`, `mediapipePose.ts:563`); full, heavy, multi-full and multi-heavy stay resident for the session (each with its model and, with the GPU delegate, its own GL context).

### B. Motion Layer
State and pass: `hooks/useStroMotion.ts` (draft state, `autoProcessFramesInner`); page orchestration in `app/analysis/page.tsx` (`handleStroAutoSelectAll`, `handleStroGenerate :3256`, `buildStroVideoPreview :3185`, `refreshStroPreviewFromDraft :2022`). `lib/stroMotionDraft/`: `captureFrame.ts`/`captureSource.ts` (frame capture via a dedicated mirror `<video>`), `proposeFrameMask.ts` + `selfieSegmenter.ts`/`multiclassSegmenter.ts` (person mask), `racketDetect.ts` (D-FINE), `samRacket.ts`/`autoRacketPass.ts` (SAM-2), `compositeFromDraft.ts` (render), `exportDraft.ts` (PNG), `initDraft.ts`, `frameMask.ts`, `maskUtils.ts`. Editor: `components/stroMotion/FrameMaskEditor.tsx`, `MaskSurface.tsx`; preview: `StroMotionPreviewModal.tsx`; legacy video export `lib/stroMotion.ts` (`exportStroMotionVideo`, MediaRecorder on a canvas, `:1256`).

**Per frame the draft holds** (`types.ts:25-31`): `sourceFrame` ImageBitmap (4·W·H bytes), `aiSnapshot`, `working`, `readyMask` (W·H each, `readyMask` is a clone). Plus `backgroundPlate` (4·W·H) and an optional end plate. Draft memory ≈ N × 7·W·H (+ plates):

| Clip | one frame | 5 frames | 15 frames (UI max) |
|---|---|---|---|
| 1080p | 14.5 MB | 73 MB | 218 MB |
| 4K | 58 MB | 291 MB | 871 MB |

Workers: **none** in the Motion Layer path (models run on the main thread / ORT wasm; the pose worker is MoveNet only). OffscreenCanvas: not used by the composite or export.

## 2. Root-cause analysis

### Skeleton (code unless marked)
- **S1. No crop, no tracking between frames.** IMAGE mode is stateless and `numPoses` is 1 or 4 on the whole frame (`mediapipePose.ts:93-97, 399`). `grep -i crop lib/mediapipePose.ts` has no match. Only the live MoveNet worker crops. A small or fast-moving player gets little of the detector's fixed input. *Measured (synthetic):* §3.
- **S2. Confidence is `visibility`, and it is a low bar.** MediaPipe always returns all 33 landmarks with positions, even for guessed joints; `landmarksToKeypoints` keeps them all and sets `score = visibility` (`:130-172`, the long comment at `:143-165` explains why feet are always kept). Drawing and angles accept `score ≥ 0.2` (`Canvas.tsx:743, 6302`). So guessed joints are drawn and used. The model's `presence` output is not read. No `minPoseDetectionConfidence` / `minPosePresenceConfidence` / `minTrackingConfidence` is passed (`grep` finds none), so MediaPipe's defaults apply.
- **S3. The acceptance gate only checks the torso.** A pose is accepted when ≥ 2 of the four torso joints score ≥ 0.3 (`:171-173`). Arms and legs are not validated.
- **S4. The locked-player follower checks the box, not the pose.** `followStep` uses `poseBox` (keypoints ≥ 0.3, at least 4) and size/distance gating. A wrong arm or folded legs inside a plausible box passes. The 4-person full-frame detector in the locked path also sees spectators (your clip has a crowd); not tested.
- **S5. No left/right, limb-length or anatomical check anywhere** (`grep` for swap/bone/anatomy finds only the mirror un-flip). The test-time mirror averaging merges two estimates only when they agree within 8% of frame width (`mediapipePose.ts:362, 480`) and otherwise keeps the base.
- **S6. The cleanup works per axis, per joint.** `smoothBakedTrack` repairs x and y **independently** with a median over 5 samples, then a Gaussian (±3) weighted by score (`trackSmoothing.ts:36-80`); it never sets or lowers scores and never drops a joint. At 60 fps a 5-sample window is 83 ms: it repairs 1-2 frame spikes, not a stretch. A joint that is wrong for a stretch stays wrong and keeps its score.
- **S7. Angles show missing as 0°.** `Canvas.tsx:6302-6318` skips a joint trio below 0.2 or with `mag < 1`; `page.tsx:3828` then renders the skipped ones as `?? 0`. The same formula (acos of the angle between the two segments) returns 0° for two segments on the same ray, which collapsed or folded poses produce. The column is throttled to 500 ms (`:3865-3871`), baked playback emits every 6th tick.
- **S8. Gaps.** A gap > 0.25 s splits the track; playback snaps across gaps up to 0.5 s and shows nothing (hint "outside tracked range") beyond. The follower's search area grows 1.5 body heights per second unseen (cap 4), so re-acquisition after a loss is permissive.
- **S9. Main-thread blocking.** `lm.detect()` is synchronous: each pass iteration blocks the page for the detection time (*measured below*); between iterations only the seek wait yields. The live MediaPipe path blocks per detection at 15 Hz.
- **S10. Memory.** Up to four MediaPipe landmarkers stay resident (full, heavy, multi-full, multi-heavy) plus the MoveNet worker's TF.js graph; none is released when AI Track ends. The mirror test allocates a full-frame scratch canvas (`mediapipePose.ts:316-328`).
- **S11. Synchronisation.** Samples are stamped with `v.currentTime` after the seek settles; playback looks up by `video.currentTime` and interpolates linearly. The seek wait is `seeked` + a video-frame callback with a 300 ms safety timer (`page.tsx:1565-1576`): if the callback never fires (my headless harness hit the 300 ms cap on every seek), a pass costs up to 300 ms per sample. Not verified on iOS.

Mapping to your questions: *distorted skeleton / wrong arms and legs* = S1, S2, S4, S5, S6; *joints disappear* = S2 threshold, S8; *jumps between frames* = S1 (stateless), S6; *exactly 0°* = S7; *mobile instability* = S9, S10, plus S1's cost of whole-frame heavy inference.

### Motion Layer
- **M1. Export re-captures everything, repeatedly, and leaks.** `hydrateDraftBitmapsForExport` captures the plate and **every frame** from the video (`exportDraft.ts:15-43`) and deliberately does not close the old bitmaps ("let GC handle", `:36-38`). It runs: once per **editor close** (`refreshStroPreviewFromDraft` → `exportStroMotionDraftPng`, `page.tsx:2032`); **three times per Generate** (`handleStroGenerate` `:3275`, then inside `exportStroMotionDraftPng` `:56`, then `buildStroVideoPreview` `:3189`); and on PNG download (`:3285`). *Measured:* §3.
- **M2. No composite cache; a full-frame readback per layer per draw.** `renderMaskedFrame` does drawImage + `getImageData` + a per-pixel loop + `putImageData` for each layer (`compositeFromDraft.ts:62-85`); `Canvas.tsx:5834, 5973` repeats it on every dirty render. The video export reads two full frames per output frame (`stroMotion.ts:1335, 1338`).
- **M3. Whole-resolution everything.** Frames, masks, plates and the composite scratch canvas are native size; a 4K clip makes each of them 4× the 1080p cost. Only Auto-detect has a phone cap (PR #145), and it re-captures native frames before the commit.
- **M4. Models resident on the main thread:** SAM-2 / D-FINE ORT wasm (~1 GB, not returnable; racket pass now off on phones), the MediaPipe selfie solution and the COCO-SSD TF.js model with ~262 WebGL programs (`docs/MOTION_LAYER_COLD_CLICK.md`).
- **M5. React/main-thread:** progress and status updates are cheap; the cost is the synchronous canvas work above (the 4×-throttled first composite is 2.6 s at 1080p, 8.5 s at 4K, `docs/POST_AUTODETECT_FREEZE.md`). The toolbar resize re-composite was fixed in #148 (phones only).
- **M6. Cleanup:** the draft closes its bitmaps on clear (`clearDraft.ts`), the commit replaces `sourceFrame`s and closes the old ones (`useStroMotion.ts:1070-1092`), but hydrate/export paths leak (M1); mirror `<video>` elements are cached per source (`captureSource.ts`).

## 3. Baseline (measured, desktop Chromium headless, software GL, CPU delegate)
**Skeleton** (1920×1080 VP9 demo clip, one player; the harness ran the same `@mediapipe/tasks-vision` assets the app serves, in the page's main thread):
| Metric | Result |
|---|---|
| Whole-frame detect, heavy, large player (653 px body) | 239 ms/frame; **blocks the main thread for that time** |
| Detect on a crop, heavy / full (210 px player) | 193–206 ms / 66 ms |
| Seek to `seeked`, 1080p VP9, no detection | median 117–119 ms, p95 ≈ 182 ms |
| Failures, whole frame, **large player**, 250 frames at 30 fps | 0 collapsed, 0 jumps, 0 left/right swaps (whole frame and crop alike) |
| Failures, whole frame, **synthetically shrunk player** (same footage drawn at 50/35/25% size) | ~300 px tall: pose lost in **21/90 frames**, **12%** of joint steps jump (max ≈ 1 body height); ≤ 212 px: **no pose in any frame**. Crop around the player: 0 missing, 0 jumps at every size |
| Crop + `full` vs crop + `heavy` | median 0.9% of body height apart (~2 px at 210 px), p95 2.8%, max 5% |
Phone figures from the code's own comments (earlier team measurements, not re-run): MoveNet Thunder on an iPhone 14 ≈ 40-53 ms steady, 37 s first shader compile (`poseWorker.ts:55-65`).

**Motion Layer** (1080p, 5 frames, `demo_1080.webm`):
| Metric | Result |
|---|---|
| Frame capture | `createImageBitmap` 35-70 ms (1080p), 140-900 ms (4K); plus seek ~120 ms |
| Auto-detect, racket on: foot pose / D-FINE / SAM encode | 1.7 s per frame / 0.4-1.1 s per frame + 2.6 s load / 9.5-12 s per frame + 1.6 s load; total ≈ 92 s |
| Renderer memory after Auto-detect: racket on / off | peak 2.13-2.25 GB / ≈ 1.0-1.1 GB (GPU process ≈ 0.8 GB) |
| Live bitmaps after Auto-detect | 18 (99 MiB) |
| **Editor close** | **+6 bitmaps, +48 MiB live**, 5 pixel readbacks, one block ≥ 100 ms (347 ms) |
| **Generate** (hydrate ×3, PNG, video preview) | **+33 bitmaps created, live bitmaps 147 → 289 MiB, renderer +681 MB in ~3 s**, 55 full-frame readbacks, longest blocks 289/159/148/145 ms, PNG preview visible in 2.76 s |
| First composite draw (4× CPU throttle) | 2.6 s at 1080p, 8.5 s at 4K (from the earlier freeze diagnosis) |
**Not measured, and why:** every phone number (no device in this session); Android; GPU-delegate MediaPipe timings (headless has no GPU); real 4K footage (a 4K clip upscaled from 1080p was used only for composite timing); a serve test clip (not available); the video-preview build time on its own (it overlaps Generate; the 33-bitmap count is attributed to three hydrate passes by code and to the video build only partly: ~15 bitmaps unattributed); long-video behaviour; memory recovery across repeated analyses (needs the Phase 4 suite).

## 4. Proposed solutions
### Skeleton (Phase 2), in order
1. **Crop that follows the player** (box from the last good pose + margin sized for the racket arm; whole-frame re-acquire when lost). Replaces the 4-person full-frame detector in the locked path; the lock click still seeds it. Removes S1 and most of S4.
2. **Validate each pose before accepting it:** limb-length ratios against the lock frame, joint-inside-crop, per-joint confidence (use `presence` as well as `visibility`, raise the bar from 0.2 for drawing and angles; tune on real clips), reject a pose that collapses (body extent far below the previous), mark rejected joints missing.
3. **Missing means null:** angles return `null` (not 0), the column shows "–"; stop `?? 0` (`page.tsx:3828`) and the 0° it creates.
4. **Left/right consistency:** match each side's joints to the previous frame's before accepting (continuity), swap when the crossed assignment is clearly closer.
5. **Forward + backward fusion and a gap filler** that bridges short misses, flags long ones, and replaces split-on-0.25 s.
6. **Temporal correction without over-smoothing:** repair x and y jointly (a point, not two axes), speed-adaptive (keep the racket wrist fast), no smoothing across a flagged gap.
7. **`full` model + crop as the phone tier, `heavy` + crop on desktop** (2.9× faster, ~2 px difference in the test).
8. **Release landmarkers** after AI Track (close the IMAGE and multi instances like the live one).
9. **Yield between samples** and keep the seek safety timer from dominating (measure iOS).
### Motion Layer (Phase 3), in order
1. **Stop the leak:** hydrate once per export (reuse the draft's frames when their bitmaps are still alive), close replaced bitmaps once the new draft is committed, and remove the two redundant hydrates in Generate.
2. **Stop re-compositing:** cache the composited result per draft + options (the phone first-composite builder from #147 is the starting point), and bound the video export's readbacks.
3. **Reduce per-frame footprint without changing the output:** store `readyMask` only when it differs from `working` (or derive it on demand); keep `aiSnapshot` only where Reset needs it; evaluate storing frames as a decoded-on-demand blob for large N.
4. **Reuse canvases** (one scratch canvas per composite, one per size).
5. **Investigate** OffscreenCanvas/worker for the composite and the export (spike first; Safari support to be verified).
6. Racket memory (worker that is terminated, or a lighter model) only if you want it in this phase.

## 5. Roadmap, estimates, risks
Estimates are mine, one developer, working days including tests, excluding device availability.
| Stage | Content | Days |
|---|---|---|
| 0 | Test set and harness in the repo (serve/forehand/backhand clips, per-joint jump, collapse, swap, angle-null counters; Motion Layer memory/bitmap counters) | 2 |
| 2a | Skeleton 1-3 (crop, validation, null angles) | 5 |
| 2b | Skeleton 4-6 (side consistency, fusion, gap filler, correction) | 4 |
| 2c | Skeleton 7-9 (phone tier, release, yielding) + regression run | 2 |
| 3a | Motion Layer 1-2 (leak, composite cache) | 4 |
| 3b | Motion Layer 3-5 (footprint, canvases, offscreen spike) | 5 |
| 4 | Combined stress suite, devices, documentation, approval | 4-5 |
About **26-28 days**. Each stage is its own branch commit with its own before/after numbers.
**Risks:** (1) all quality claims need your real clips, in particular serves; (2) phone numbers need real iPhone Safari and Android Chrome runs, which the sandbox cannot do; (3) the crop tracker changes the AI Track output, so it needs side-by-side review and a switch back to the old behaviour during testing; (4) caching the composite can hide stale draws (key by draft + options, test on edits); (5) your Phase 4 list asks for 20-50 Motion Layer frames; the UI stops at 15, so either the test set stops at 15 or raising the cap is a product change (and 50 frames at 4K is 2.9 GB of draft data); (6) iOS WebGPU/OffscreenCanvas support must be verified before any worker plan.

## 6. What I need before Phase 2
1. Your approval of this audit (or changes to it).
2. Test clips: at least one serve (the one in your screenshots), a forehand, a backhand, a far-court player. Short phone recordings are enough.
3. A decision on the 20/30/50-frame tests (stay at 15, or approve a cap change).
4. When it is time: someone with an iPhone and an Android phone for the device runs.
