# AngleMotion — Architect Handoff Brief

**Audience:** the incoming senior developer / technical architect who will own architecture,
maintain V1 discipline, write the Claude Code prompts, pick model/effort, and review output.
**Purpose:** everything needed to make correct decisions and understand 100% of the work done so far.
**Repo root:** `coach-lab/` (Next.js app). **Prod:** https://anglemotion.com
**Phase:** V1 **stabilization** (bug fixes only — see §6). Last updated 2026‑07‑19.

---

## 1. Product in one paragraph

AngleMotion (internal codename CoachLab) is a **browser-based tennis/sports video-analysis
platform** for coaches. A coach loads a video (file, YouTube, or embed), and the app overlays a
**live pose skeleton**, **biomechanical measurements** (joint angles, hip–shoulder differential,
foot direction), a **Precision AI Track** (a frame-exact baked skeleton that plays perfectly at any
speed), **StroMotion** (Dartfish-style stroboscopic multi-exposure with AI background removal), a
full **drawing/annotation** toolset, **A/B split-screen**, **screen recording with webcam PiP**, and
**export** to MP4 / Google Drive / YouTube. Billing is Stripe (3 tiers + a free 1-hour trial).
Everything is **AI-first but 100% manually editable** — the coach can always override the AI.

---

## 2. Tech stack, infra, deploy

- **Framework:** Next.js 15.5 (App Router) + React 18 + TypeScript. Tailwind. Deployed on **Vercel**.
- **Auth/DB:** Supabase (`@supabase/ssr`), Postgres + RLS. **Billing:** Stripe.
- **Pose/vision (all in-browser):**
  - MoveNet (Thunder/Lightning) via TensorFlow.js in a **Web Worker** (`lib/poseWorker.ts`) — the live skeleton.
  - MediaPipe Pose Landmarker FULL/HEAVY (`lib/mediapipePose.ts`) — the offline Precision Track + AI-Detect feet (33 landmarks incl. real toe/heel).
  - MediaPipe Interactive Segmenter "MagicTouch" (`lib/mediapipeSegmenter.ts`) — StroMotion pose-anchored background removal.
  - COCO-SSD (`lib/racketCocoDetect.ts`) — racket/implement detection. MediaPipe SelfieSegmentation (`lib/webcamSegmentation.ts`) — webcam cutout.
- **Video/record:** `MediaRecorder` + `captureStream`, `requestVideoFrameCallback`, ffmpeg.wasm (`lib/ffmpegWebmToMp4.ts`) for retime/convert.
- **Self-hosted model assets** under `public/` (`models/`, `tfjs-wasm/`, `mediapipe-wasm/`) — no third-party CDN a network policy could block.
- **No test runner configured** (`scripts`: dev/build/start/lint only). "Verification" = `npx tsc --noEmit` (0 errors) + `npm run build` (0 errors) + **user runtime check** (the app is auth-gated, so an assistant cannot reach `/analysis`).

**Deploy workflow (critical — see `docs/project…`/memory):**
`git commit` → `git push origin snapshot-v1` → `git checkout main && git merge --ff-only snapshot-v1 && git push origin main` → Vercel auto-builds `main`.
- **`snapshot-v1`** = working branch. **`main`** = production (Vercel).
- **ALWAYS `git status` clean before deploy.** A local build passes on the *working tree*; Vercel builds the *commit*. An uncommitted file once passed locally and broke Vercel (commit `45fb07c` → fixed by `797a55d`).
- Vercel poll: `GET /v6/deployments` (TEAM `team_kxyFmQpjcaw08gqg0Z3BOqMx`, PRJ `prj_AdLwIrHDS8HGG7JUG8VtjSUv8Ve2`). Parse JSON with `strict=False` (commit messages contain raw newlines).
- **Tokens live in `coach-lab/.env.local` (gitignored):** `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`. Never commit them.
- **Supabase migrations:** `scripts/db-apply-sql.sh supabase/migrations/<file>.sql` (Management API, no CLI needed). Project ref `kgifsczgikzgeayueede`.
- **Second Vercel project** `anglemotionverification.vercel.app` on a pinned `google-verification` branch exposes Drive/YouTube behind env-gated flags (`lib/featureFlags.ts`, `NEXT_PUBLIC_GOOGLE_VERIFICATION_DEMO=1`) for Google OAuth verification — prod is byte-identical with the flag off. See `GOOGLE_VERIFICATION_DEMO.md`.

---

## 3. Project structure (annotated — the parts that matter)

```
coach-lab/
├─ app/
│  ├─ analysis/page.tsx        ★ 7,599 lines — the analysis surface orchestrator (HOT/high-risk)
│  ├─ analysis/layout.tsx        mounts <TrialBanner/>
│  ├─ page.tsx                   marketing landing vs dashboard (server getUser gate)
│  ├─ layout.tsx                 RootLayout: RecordingProvider, PersistentWebcamOverlay, favicon/icons
│  ├─ auth/callback/route.ts     OAuth callback (session-cookie fix lives here)
│  ├─ login/, pricing/, coaches/, privacy/, terms/, billing/, players/, academy/, dashboard/
│  └─ api/                       stripe/*, trial/status, players/*, google/*, youtube/*, video/*, gemini/*, health
├─ components/
│  ├─ Canvas.tsx               ★ 7,853 lines — render loop, pose overlay, drawing, webcam PiP, recording capture (HOT/high-risk)
│  ├─ ToolPalette.tsx            the toolbar (Draw/Skeleton/StroMotion/Metrics/Recording screens)
│  ├─ StroMotionPanel.tsx        StroMotion config + frame thumbnails
│  ├─ stroMotion/FrameMaskEditor.tsx   per-frame mask editor
│  ├─ PreciseTimeline.tsx        timeline + trim handles + playhead
│  ├─ RecordingHub.tsx           recording UI (wires to RecordingContext)
│  ├─ PersistentWebcamOverlay.tsx  movable/resizable webcam PiP (DOM); currently gated off (returns null)
│  ├─ ScreenRecorder.tsx         ⚠ NOT mounted on /analysis (dead code there)
│  ├─ PrecisionTrackDialog.tsx   AI-Track speed popup (0.1×–0.5×)
│  ├─ TrialBanner.tsx            floating 1-hour-trial countdown
│  ├─ PostRecordingCropModal.tsx, PlaybackControls.tsx, LandingPage.tsx, …
├─ contexts/RecordingContext.tsx  ★ the ACTIVE recorder (getDisplayMedia engine, global, mounted in layout)
├─ hooks/
│  ├─ useStroMotion.ts           StroMotion draft state machine (atomic autoProcessFrames lives here)
│  ├─ useSessionDraft.ts, useVideoPlayer.ts, useAuth.ts
├─ lib/
│  ├─ poseWorker.ts              ★ MoveNet worker + backend-loss recovery state machine
│  ├─ poseWorkerBridge.ts        single-in-flight bridge (main ↔ worker)
│  ├─ mediapipePose.ts           Precision Track FULL/HEAVY + TTA + quality tiers
│  ├─ mediapipeSegmenter.ts      MagicTouch pose-anchored segmentation
│  ├─ trackSmoothing.ts          offline zero-lag smoothing for baked tracks
│  ├─ biomechanics/measurements.ts  ★ canonical estimateFootVector + all measurements
│  ├─ stroMotionDraft/           proposeFrameMask, exportDraft, compositeFromDraft, frameMask, maskUtils, backgroundPlate, initDraft
│  ├─ webcamSegmentation.ts      ⚠ MediaPipe selfie seg on MAIN THREAD (recording-lag contributor)
│  ├─ racketCocoDetect.ts, sharedPoseDetector.ts, keypointSmooth.ts (OneEuro), plans.ts, admin.ts, featureFlags.ts
│  ├─ sessions/*                 save/load coaching sessions (Supabase)
│  ├─ ffmpegWebmToMp4.ts, cropExport.ts, google/*, gemini/*
├─ middleware.ts                 auth + subscription gate + 1-hour-trial gate for /analysis, /academy
├─ supabase/migrations/*.sql     players, sessions, academy, subscriptions(+tier), trials
├─ scripts/db-apply-sql.sh       Supabase Management-API migration runner
└─ docs/                         see §9
```
`app/analysis/page.tsx` and `components/Canvas.tsx` are **~7.5k-line hot files** — treat every change to them surgically.

---

## 4. Subsystem architecture (the ones that matter for V1)

**Pose / Skeleton.** Live path = MoveNet in `poseWorker` via `poseWorkerBridge` (single-in-flight). Canvas
render loop (rAF) picks the displayed pose: baked track (`lookupBakedPose(currentTime)`) if a Precision
Track covers the time, else live keypoints, with a wall-clock display interpolation blend. Visibility is
gated by many flags (see the Skeleton RCA in §7 — this is the next architectural target).

**Precision AI Track ("bake").** `page.tsx runPrecisionPass` frame-steps the video, runs MediaPipe FULL/HEAVY
per frame (`mediapipePose.detectPosePrecise`, with test-time augmentation at higher quality), smooths offline
(`trackSmoothing`), stores a video-time-indexed track in `Canvas.bakedTracksRef`. One scope-smart button →
`PrecisionTrackDialog` (speed 0.1×–0.5×, default 0.25×). **This is loved by the user — do not restyle it.**

**StroMotion (FROZEN architecture).** `useStroMotion` owns a `StroMotionDraft` (frames each with
`{selectionBox, sourceFrame, aiSnapshot, working, readyMask, status}`). Auto-Detect: `page.tsx` builds a per-frame
spec set (box + pose scribble), then `useStroMotion.autoProcessFrames` builds every proposal in memory and
commits the **complete set in ONE `setDraft`** (atomic). Masks via `proposeFrameMask` (MagicTouch segmenter →
motion-diff → matte → box-fill fallback). Generate reads the same committed draft (`exportDraft` +
`compositeFromDraft`). Manual path (`selectAreaForFrame` / `finishStroRegionSelect`) unchanged.

**Recording (ACTIVE = `RecordingContext`).** Global getDisplayMedia recorder mounted in `app/layout.tsx`.
`RecordingHub` is the UI. **This is the current bug target — see the Recording RCA in §7.**

**Metrics.** Snapshots + measurement column; AI-Detect angles use `biomechanics/measurements`. Foot line
and the AI number share the one `estimateFootVector` (frozen).

**Auth / Trial / Billing.** Supabase SSR; `middleware.ts` gates `/analysis`+`/academy` by active Stripe sub OR
an unexpired `trials` row (Google sign-in → 1 free hour, one per account, `start_trial()` SECURITY DEFINER).
Prices in `lib/plans.ts` (Light $5/$50, Pro $20/$200, Academy $40/$400).

---

## 5. Everything done in this collaboration (chronological, with commits)

| Commit | What shipped |
|---|---|
| `181ba7f` | Launch fixes: 3-tier pricing, skeleton HiDPI + jitter, metrics/StroMotion video, foot direction |
| `d9ca69c` `d66d264` `62aaaa5` | QA rounds 2–4: global recording, slow-master metrics video, racket detection; Precision AI Track, real MediaPipe foot line, motion-diff auto-mask; section-scoped AI Track + endpoint editing |
| `7e71771` `5a83868` | Google OAuth verification: env-gated Drive/YouTube flags + separate Vercel project + docs |
| `ae7a07f` `8b92f63` `6978d2c` | Precision Track v2 (frame-stepped MediaPipe + offline smoothing); foot line tracked-only; track-backed metrics recording |
| `f817090` `312c5f1` | Live skeleton auto-focus crop; StroMotion object pipeline (median plate, soft matte, batch boxes) |
| `45fb07c` → `797a55d` | ADR-013 UI spec (open-only panels, official logo, StroMotion flow); **fixed the uncommitted-file Vercel break** |
| `db80ecc` | **Launch pass v2:** auth first-attempt-bounce fix; Google 1-hour trial (DB + middleware + banner); demo→trial CTA; **single AI-Track button + precision popup + HEAVY model + TTA + rVFC** |
| `53c1408` | **Phase D:** pose-anchored StroMotion Auto-Detect (MagicTouch segmentation) |
| `6f60e4b` `369f82f` | Testing-round fixes: Style→top of Draw; foot-line live estimate + direction; undo no longer clears skeleton; timeline handle z-index; webcam touch-drag; StroMotion resilience + error surfacing |
| `9cff403` | **3 V1-frozen subsystems shipped:** worker recovery state machine; foot-line dedup to canonical `estimateFootVector`; **atomic StroMotion Auto-Detect commit** |
| `5a3c1ef` | V1 freeze log (`docs/V1_FREEZE.md`) |

**Deep, verified diagnoses produced (read-only, multi-agent):** the Skeleton subsystem RCA and the
Recording/Playback RCA (both summarized in §7). Research docs for segmentation + pose precision are in
`docs/RESEARCH_*.md`.

---

## 6. V1 Freeze contract (the discipline to enforce)

Full text in **`docs/V1_FREEZE.md`**. Frozen subsystems (no refactor / no API change / no "cleanup" without
explicit approval): **Worker Recovery, Pose Worker Architecture, Foot Line, shared `estimateFootVector`,
Skeleton↔AI-measurement consistency, StroMotion Auto-Detect architecture, Atomic Auto-Detect commit, Manual
StroMotion workflow, Auto-Detect editor workflow, Generate pipeline architecture, Recording PiP subsystem
(`RecordingContext.tsx`, `lib/pipRecorderSurface.ts`, Canvas.tsx webcam-PiP block — Document PiP camera+controls,
Source A/B dedup, camera re-enable/reopen mid-recording), Skeleton persistent on/off gate — Family B
(`app/analysis/page.tsx` — `skeletonEnabled` formula, StroMotion checkbox mirror, `resetMetrics()`,
`handleMarkupClear()`; see §7b and `docs/V1_FREEZE.md` for the confirmed/not-yet-tested split).**

**Rules (binding):** (1) don't refactor frozen subsystems unless asked; (2) no unrequested quality/architecture
improvements — fix only the reported bug; (3) preserve every existing API unless absolutely required; (4)
smallest possible surface area; (5) never rewrite a working subsystem; (6) **if a fix would touch a frozen
subsystem, STOP and explain before writing code;** (7) preserve backward compatibility with all V1 behavior.
Also protected (CLAUDE.md §6): the analysis-mode ownership model and pose-provenance gating.

---

## 7. Open stabilization backlog + the two live RCAs

**Remaining (from `docs/V1_FREEZE.md`):** Skeleton Stability — Family A (the on/off gate, Family B, is now
**done**, see §6 and `docs/V1_FREEZE.md`) · Recording Hub (post-record crop/trim,
permission-prompt latency — the movable/resizable webcam overlay item is now **done**, see the Recording PiP
subsystem entry in §6 and `docs/V1_FREEZE.md`) · Phone UI · Timeline Handles · Generate Panel · Text tool ·
Final QA.

### 7a. Recording & Playback RCA (superseded in part — see update below)
The active recorder is `RecordingContext` (getDisplayMedia); `ScreenRecorder.tsx` is dead code on `/analysis`.
- **Unresponsive playback:** `RecordingContext.startRecording` runs a **second full-res 2-D compositor on the
  main thread**, driven by **both** a `requestAnimationFrame` loop **and** a `setInterval(paintOnce, 66)` —
  ~75 full-frame `drawImage`/sec for a 30 fps sink (`RecordingContext.tsx:242-276`). The Canvas loop isn't
  de-escalated during recording (`isRecordingRef` is write-only). Transport handlers contend on the main thread.
  **Still open — unaffected by the PiP work below.**
- **Secondary:** `WebcamSegmenter` runs MediaPipe selfie segmentation **synchronously on the main thread** +
  blur double-draw per frame when cutout is on (`webcamSegmentation.ts:92-128`). **Still open.**
- ~~**Two webcam layers:** the getDisplayMedia capture already contains the on-screen canvas PiP...;
  `RecordingContext.paintOnce` then unconditionally stamps a second raw PiP.~~ **RESOLVED, confirmed 2026-07-19**
  (live instrumentation + manual test): Source A (on-canvas webcam) is now suppressed while recording, and the
  Source B stamp is skipped when `getVideoTracks()[0].getSettings().displaySurface === 'monitor'` — Entire-Screen
  recordings contain exactly one webcam (the floating Document PiP window). See the Recording PiP subsystem entry
  in §6 and the confirmed-behavior list in `docs/V1_FREEZE.md`. This-Tab/This-Window share modes are **not yet
  verified** for the same dedup — see the NOT-yet-tested list in `docs/V1_FREEZE.md`.
- **Smallest fix (still applies to the two items above):** delete the recorder's `recCanvas` compositor and
  **record the getDisplayMedia video track directly** (+ the already-assembled audio tracks) — this would remove
  both the second main-thread paint pipeline and (as a side effect) the two-webcam-layers duplication that
  `isMonitor` gating fixes today more narrowly. Fallback if a compositor must stay: rAF-only, ≤30 fps, downscale,
  OffscreenCanvas worker. Second-order (only if cutout still lags): move `WebcamSegmenter` to a Worker.
  **Clear of all frozen subsystems** — do NOT route through `recordReplayToMp4` / `exportStroMotionVideo` (frozen).
  Note: `RecordingContext.tsx` is now itself a frozen subsystem (§6) — this fix would need explicit approval
  before touching it.

### 7b. Skeleton subsystem RCA — split into two independent bug families

The original RCA found visibility gated by the AND of ~6 flags split across page + Canvas (`skeletonOn`,
`stroShowSkeleton`, derived `skeletonEnabled`, `skeletonEnabledRef`/`skeletonDrawEnabledRef`, internal
`skeletonSuppressedRef`, `hiddenByTrackScope`, data-availability), producing two distinct failure modes:

- **Family B — disappearance (skeleton ABSENT when it shouldn't be): DONE, frozen (§6).** Root cause:
  `skeletonEnabled = skeletonOn || (stroMotionActive && stroShowSkeleton)` let StroMotion's own checkbox drive
  visibility through a shadow flag that collapsed the moment `stroMotionActive` went false on exit (B1), and
  Clear-All silently flipped the canonical `skeletonOn`/`skeletonOverlayPaused` flags off without the coach
  pressing the actual toggle (B2). Fixed by collapsing the gate to `skeletonEnabled = skeletonOn` and making
  every activation path (toolbar toggle + StroMotion checkbox) write through the one persistent flag; Clear-All
  no longer touches it. B1 and B2 are **confirmed fixed live**; the StroMotion-checkbox wiring itself is
  implemented but **not yet exercised live** (gated behind "Upload video first," no test video available this
  session) — see the confirmed/not-yet-tested split in `docs/V1_FREEZE.md`.
- **Family A — presence-but-wrong (freeze/jump/impossible-positions): NOT started, separate work.** The display
  interpolation blends `posePrev→poseLatest` and those samples are never reset on seek → it slides through
  impossible intermediate poses; `redo` still sets `skeletonSuppressedRef=true` (`Canvas.tsx:2602` — same class
  as the fixed undo bug); `hiddenByTrackScope` hides the live skeleton outside baked ranges. This touches the
  **Pose Worker / render-loop interpolation path, which is frozen (§6)** — any fix here needs its own
  stop-and-justify (Rule 6) before writing code, independent of the Family B work above. **Isolated fixes (not
  yet applied):** remove `redo` suppression; reset interp samples on seek. **Architectural fix (not yet
  applied):** one owned visibility intent; render hides only for (a) intent off, (b) no pose. The
  `hiddenByTrackScope` policy borders AI-Track — get sign-off before changing it.

*(Text tool, phone Generate panel, timeline handle grab, phone toolbar expand remain scoped but un-diagnosed.)*

---

## 8. How to drive Claude Code on this repo (for the architect)

- **Diagnosis-first (CLAUDE.md §4).** For any bug, have Claude **read + trace the real path and present the
  root cause before writing code.** The best results here came from "map the architecture, cite file:line,
  rank root causes, propose the smallest fix — no code yet," then approve, then implement.
- **Model / effort:**
  - **Opus + high/max effort** for the 7.5k-line hot files, cross-file architecture, and any pose/render/recording
    work. These files punish shallow reasoning.
  - **Multi-agent workflows ("ultracode")** for read-only *investigations* across many files (the Skeleton and
    Recording RCAs were done this way: parallel tracers → adversarial verify → synthesize). Token-heavy; use for
    genuine architecture questions, not small edits.
  - **Sonnet / lower effort** for isolated, well-scoped edits (copy changes, single-function fixes, config).
- **Always demand:** `tsc` + `npm run build` clean, and `git status` clean before any deploy. Claude self-verifies these.
- **Enforce the freeze:** every prompt should name the target subsystem and say "V1 freeze applies; if a fix needs
  a frozen subsystem, stop and explain first." Claude honors this.
- **Prompt shape that works:** (1) name the subsystem + the exact user-visible bug; (2) list frozen subsystems;
  (3) "read the whole pipeline, map ownership, answer these specific questions, cite file:line"; (4) "smallest
  fix, no redesign"; (5) "no code until I approve the plan." Then a separate "implement ONLY X" prompt.
- **Verification reality:** Claude cannot reach `/analysis` (auth-gated) — runtime behavior is confirmed by the
  coach. So Claude's job is: correct diagnosis + type/build-clean change + a precise manual repro to test.

---

## 9. Existing docs to read (in the repo)

- `docs/V1_FREEZE.md` — the freeze contract (frozen list + rules). **Start here.**
- `CLAUDE.md` — the working agreement (git policy, diagnosis protocol, protected invariants).
- `DECISIONS.md` — ADRs (e.g. ADR-013 toolbar/logo/StroMotion flow, ADR-014 testing-round freezes).
- `ARCHITECTURE.md`, `ROADMAP.md` — system design + roadmap.
- `docs/COACHLAB_V1_SPEC.md`, `docs/COACHLAB_V1_PRODUCT_FREEZE.md` — product spec + product freeze.
- `docs/RESEARCH_pose_precision.md`, `docs/RESEARCH_stromotion_segmentation.md` — the research behind the AI work.
- `GOOGLE_VERIFICATION_DEMO.md` — the OAuth-verification deployment.

**Recommended reading order for the architect:** this file → `docs/V1_FREEZE.md` → `CLAUDE.md` →
`DECISIONS.md` → skim `app/analysis/page.tsx` + `components/Canvas.tsx` headers → the two RCAs in §7.
