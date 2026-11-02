# Motion Layer freezes the page on iPhone: investigation (P16)

Status: **investigation only. No code changed.** Nothing in Supabase, Vercel or Drive was touched.
Written from `main` at `9db01dd9`. Every code claim carries a `file:line` from a file read for this
document. "Measured" means I measured it in this sandbox (desktop Chromium, 390×844 touch viewport,
no GPU, `next dev`), **not** on an iPhone.

Update 4 (2026-11-02, newest): Vin's **Safari Private tab on the live site did not freeze**. That points to what the normal browser has stored for the origin (service-worker caches, local data), not to the models loading on open. **Section 12 supersedes the rankings in sections 0, 6, 7, 10.5 and 11.6**: the model load on open is now a *secondary risk*, and the service worker is the first thing to look at. Section 12 also covers the page reload after Auto-detect.

Update 3 (2026-11-02, earlier): Vin's production-versus-preview results change the ranking again. **Section 11 supersedes sections 0, 6, 7 and 10.5 where they differ**: the detector warm-up is real but is **not sufficient** to freeze an iPhone (the preview ran the same warm-up and worked).

Update 2 (2026-11-02, later): Vin's newest results (video loaded, network on: the page freezes 2-3 s after he presses play; Safari on the same iPhone behaves the same) are analysed in **section 10, which supersedes the ranking in sections 0, 6 and 7 where they differ**.

Update 2026-11-02: Vin also tested the app's own demo video on the same iPhone and it freezes the same way, so the clip's length and size are **not** the trigger; section 9 answers the follow-up questions.

Report (Vin): iPhone 14 Pro, iOS 18.5, Chrome for iOS (CriOS 156), anglemotion.com, a 15 s 720×1280
local file (`src=blob`). The page freezes the moment Motion Layer is tapped, every time, also when
the video is already playing (`readyState=4`). Reloading afterwards is extremely slow. `?vdebug=1`
logs no error; before the first tap it shows the known first-frame fallback (`readyState=1`,
`play()` rejected with `NotAllowedError`).

## 0. Answer in five lines (see section 10 for the current version)

1. The tap does **not** capture or render frames and does not touch the clip's length. Memory by frame
   count (the 1.7 GB hypothesis) is **ruled out** by the code: at most 15 frames, none captured on open.
2. Opening Motion Layer **downloads and initialises a 68 MB object-detection model nobody asked for**:
   `preloadRacketDetector()` (`app/analysis/page.tsx:3413-3417` → `lib/racketCocoDetect.ts:16-36`) pulls
   the full `@tensorflow/tfjs`, switches TensorFlow to WebGL and loads `ssd_mobilenet_v2` (17 shards,
   67.8 MB measured) from `storage.googleapis.com`. Measured on desktop: one **4.7-5.0 s main-thread
   task** about 4-5 s after the tap; it disappears when that download is blocked.
3. In the same tick, a second MediaPipe model (5.7 MB wasm) is warmed and a **second hidden `<video>`**
   on the same blob is created for frame capture. On iOS that element never plays, so it can wait up to
   15 s per capture (two captures queue).
4. It is in `main`; no open PR touches Motion Layer code. Likely "works but janks" on desktop (measured
   4.7 s stall, no crash), but an iPhone adds the memory limit.
5. Not proven on a phone. The fix is small (stop warming heavy models on open, at least on phones); see section 7.

## 1. Path from tap to saved clip (what runs, in order)

**On the tap (nothing is captured yet):**

| Step | Where | What it does |
| --- | --- | --- |
| Tap "Motion Layer" | `components/ToolPalette.tsx:1825`, `:2049` → `push('stromotion')` | Opens the panel. |
| Switch mode on | `app/analysis/page.tsx:6875-6878` (`onNavigate('stromotion')`) | `setStroMotionActive(true)`. Does not capture; only imports phase markers as frame times if phases exist (`:6879-6890`, capped at 15). |
| Warm the person segmenter | `app/analysis/page.tsx:2105-2110` → `lib/stroMotionDraft/selfieSegmenter.ts:194-204`, `:127-165` | Loads `/mediapipe-selfie/selfie_segmentation.js`, creates the MediaPipe solution, `initialize()` fetches a 5.7 MB wasm + 0.25 MB model (`public/mediapipe-selfie`). Main thread. |
| Warm the racket detector | `app/analysis/page.tsx:3413-3417` → `lib/racketCocoDetect.ts:16-36` | `import('@tensorflow/tfjs')`, `tf.ready()`, `tf.setBackend('webgl')`, `cocoSsd.load({ base: 'mobilenet_v2' })` (model URL is in coco-ssd: `storage.googleapis.com/tfjs-models/savedmodel/ssd_mobilenet_v2/model.json`). Nothing has asked for a detection yet. |
| Capture the end plate | `app/analysis/page.tsx:2113-2126` → `captureVideoFrameAtTime` (`lib/stroMotionDraft/captureSource.ts:238`) | One `ImageBitmap` at the section end. |
| Build the draft | `app/analysis/page.tsx:2128-2145` → `hooks/useStroMotion.ts:217` → `lib/stroMotionDraft/initDraft.ts:33` | One more `ImageBitmap` (background plate at the section start). The 5 frames are created **empty** (`sourceFrame: null`, no masks, `initDraft.ts:20-31`). |
| Status | `app/analysis/page.tsx:3193-3198` | `setStroMotionConfiguring(true)`. |

Both captures go through one **hidden mirror `<video>`** created on the same blob URL
(`captureSource.ts:174-200`, appended to `document.body`, `preload='auto'`, never `play()`ed).
Measured: the page goes from 3 to 4 `<video>` elements on the tap.

**Later, only on explicit presses:** "Auto-detect" / per-frame detection (`proposeFrameMask`,
`selfieSegmenter`, racket passes) captures one source frame per sample time; "Generate" builds the composite
(`lib/stroMotionDraft/compositeFromDraft.ts`); the video is recorded by `exportStroMotionVideo`
(`lib/stroMotion.ts:1236-1300`: `canvas.captureStream(30)` + `MediaRecorder`, `frameCount × 150 ms + 2 s` hold,
`STRO_MOTION_ANIM_INTERVAL_MS`/`STRO_MOTION_VIDEO_FINAL_HOLD_MS` at `:129-130`). Saved only through the session
save (`lib/sessions/adapters/stroMotionAdapter.ts`: a PNG and a webm blob as artifacts). **No Motion Layer state
is written anywhere at tap time.**

No Web Worker is involved at tap time (the pose worker is not used by these steps).

## 2. Memory hypothesis: ruled out for the tap

One 720×1280 RGBA frame is 720 × 1280 × 4 = **3,686,400 B (3.5 MiB)**. A mask is one byte per pixel
(`Uint8ClampedArray(w*h)`, `lib/stroMotionDraft/maskUtils.ts:21`, `AlphaMask` in `types.ts`) = 921,600 B (0.88 MiB).

- The number of frames is **not** the clip length times fps. It is the coach's frame count: `STRO_MOTION_FRAME_COUNTS`
  is 1-15, default 5 (`lib/stroMotionDraft/types.ts:81-86`). A 15 s clip and a 5 s clip hold the same number.
- Held per frame: one `ImageBitmap` (`sourceFrame`) and up to three masks (`aiSnapshot`, `working`, `readyMask`).
  No `ImageData`, no canvases, no blobs per frame.
- No cap or downscale on the stored frames (the background-plate helper downsamples to 640 px, `backgroundPlate.ts:25`,
  but the draft frames are full size).

| Case | Held in memory |
| --- | --- |
| **At the tap** (this clip, 720×1280): 2 plates | 2 × 3.5 = **7.0 MiB** |
| 5 frames, all analysed (default) | 7.0 + 5 × (3.5 + 3 × 0.88) = **≈ 38 MiB** |
| 15 frames, all analysed (maximum) | 7.0 + 15 × 6.14 = **≈ 99 MiB** |
| **5-second clip** | **the same numbers**: nothing depends on the clip length |

The 1.7 GB figure applies only to an "every frame at 30 fps" design that does not exist here.
Main-thread work: the captures (`createImageBitmap`) and the model warm-ups above; the mask passes run
later, on press.

The part that **is** large is not frames but the two warmed models: the detector alone is 67.8 MB of weights
(measured, 17 shards), uploaded to WebGL as textures by TensorFlow.js. That is the memory worth worrying about on an iPhone tab.

## 3. Loop / seek-wait hypothesis: ruled out, one slow wait found

- `lib/seekWait.ts` is **not used by Motion Layer**. It is used by `app/analysis/page.tsx:58`
  (stuck-playback watcher) and `components/PreciseTimeline.tsx:5`. Motion Layer has its own waits.
- Every wait in the capture path is bounded: the seek resolves after at most 2.5 s
  (`captureFrame.ts:144`, never cleared, harmless); `waitForDecodableFrame` times out at 5 s
  (`:3`) and the mirror's first load at **15 s** (`captureSource.ts:143`). On failure the mirror is dropped and
  the error propagates (`:222-231`); the page ignores it for the end plate (`page.tsx:2126`) and does
  `void syncStroDraft(...)` for the draft (`:2131`). No retry loop: the effects re-run only when their inputs change.
- `useStroMotion.ts:96-125, 300-330` already guards the earlier "Maximum update depth" loop (no-op sync guard).
- **Slow wait on iOS (not a main-thread block):** `waitForDecodableFrame` needs `readyState >= 2`
  (`captureFrame.ts:46-48`). KNOWN_ISSUES 055 records that iOS does not decode a frame of a paused, never-played
  video and stops at `HAVE_METADATA`; Vin's `?vdebug=1` line (`readyState=1` before the first tap) shows the same
  platform behaviour for the main element. The mirror is exactly such an element, so on iPhone each capture can wait the
  full 15 s, and the two captures are queued (`captureSource.ts:226-243`): up to ~30 s with no plate. This would look
  "dead" but should not by itself block the thread. **Unverified.**
- No worker is awaited at tap time, so "a worker that never answers" does not apply here.

## 4. Why reload is slow afterwards

What a reload does with a half-created Motion Layer: **nothing**. The draft lives only in React state
(`hooks/useStroMotion.ts`, `ImageBitmap`s and masks); there is no `localStorage`, `sessionStorage` or IndexedDB write for it.
`localStorage` in the Motion Layer files only reads feature flags (`autoRacket`, `samRacket`; `lib/stroMotionDraft/autoRacketFlags.ts:32-47`).
A saved session stores only the finished PNG/webm as artifacts and shows them as images/videos
(`components/sessions/SessionTimelineCard.tsx:9`); no code re-opens them into the Motion Layer editor. The page-load reset latch is
`app/analysis/page.tsx:225-243`. So there is **no stored Motion Layer that a reload could choke on**, and no restore loop.

Likely causes, all outside our state (not verifiable without the phone):
1. The tab's content process was busy or killed (memory) and the browser is restarting it with the GPU/WebGL contexts and model memory still being released.
2. `public/sw.js` has a catch-all that caches every successful GET, including cross-origin ones (`:160-190`), so the 67.8 MB detector download is also
   written to Cache Storage; on iOS that is more storage and memory pressure.
3. The phone is simply re-fetching and re-initialising the app after the kill.

Ask Vin to time a reload with the same file **without ever tapping Motion Layer**, as the baseline.

## 5. Main or an open PR? Desktop?

- **In `main`.** `git log` on `hooks/useStroMotion.ts`, `lib/stroMotionDraft/*`, `components/StroMotionPanel.tsx` shows the last Motion Layer
  rounds on 2026-09-12 to 09-16 (`01c2f23e` "round 4": section defaults to the whole clip). The two warm-up effects and the mirror element are older than the
  current history graft, so the introducing commit cannot be named from `git log`.
- **Open PRs** (changed files compared with `main`): #116 only rewrites the timeline-extras condition (`metricsSectionShown`), the `stroMotionActive`
  branch is unchanged; #117, #118, #119, #130, #132, #133 change **no** Motion Layer file (`hooks/useStroMotion.ts`, `lib/stroMotion*`,
  `components/stroMotion/*`, `StroMotionPanel.tsx`, `racketCocoDetect`, `selfieSegmenter`, `captureSource`, `captureFrame`, `initDraft`).
  #118/#119 touch `Canvas.tsx`, `ToolPalette.tsx`, `PreciseTimeline.tsx` in unrelated places.
- **Desktop:** measured here (Chromium, 390×844 touch, no GPU): the tap works, the panel opens, but the main thread is blocked
  ~4.7-5.0 s once (table below). With a real GPU and more memory it is probably a short stall; an iPhone adds the tab memory limit and
  a real WebGL upload of the weights. So desktop "works, janks" is expected; a hard freeze on a phone is consistent.

## 6. Ranked causes with evidence

Measurement (this sandbox, `next dev`, 15 s 720×1280 VP9 clip, long tasks after the tap, start offset in ms and duration in ms):

| Variant | Long tasks after the tap |
| --- | --- |
| A. normal | …, 1541/288, 3863/64, **4008/4990** |
| B. MediaPipe selfie files blocked | …, 1963/372, 4464/69, **4620/4656** (still there) |
| C. `storage.googleapis.com` blocked (no detector model) | 14/51, 467/57, 666/124, 1690/269 (**the 4.7 s task is gone**) |
| D. C + tfjs chunk blocked | 566/105 |
| E. all three blocked | 12/50 |

Downloads on the tap (measured): detector model **67.8 MB** (17 shards), tfjs chunk 37.6 MB (this is the **dev** build; the production
bundle is much smaller and was **not** measured), selfie wasm 5.7 MB. Dev server only; production numbers not measured.

1. **The racket-detector warm-up on open (most likely).** `page.tsx:3413-3417` + `racketCocoDetect.ts:16-36`. The 4.7-5.0 s task follows the model
   download and disappears when the download is blocked (C). On a phone: the same CPU work plus WebGL weight upload for ~68 MB and cellular download time, in a
   tab with a hard memory ceiling, which also fits "reload very slow" (tab killed/restarted). It is a *warm-up*, not needed until Auto-detect is pressed
   (`detectTennisRacketNorm` loads it lazily anyway, `racketCocoDetect.ts:53`).
2. **Everything starting in the same tick, plus the second decoder.** Selfie model init (`page.tsx:2105-2110`; its own code comment, `:2094-2100`, records ~3.3 s of model init and GPU shader compilation that the warm-up moves off the first frame; in this sandbox it showed as ~0.3 s tasks, B vs A), end plate +
   background plate via a second `<video>` (`captureSource.ts:174-200`, measured 3 → 4 video elements), while the main video plays. On iOS the mirror
   likely waits 15 s per capture (section 3). Contributes to jank and to concurrent decoder/memory use; not the biggest block.
3. **Page re-render churn while Motion Layer is on.** `page.tsx:3157-3180` calls `setStroVideoTime` on every `timeupdate` and `PreciseTimeline` feeds
   `onCurrentTime: setStroVideoTime` (`page.tsx:6646`, throttled to ~10/s while playing, `PreciseTimeline.tsx:431-436`). `stroVideoTime` is declared (`:849`)
   and read **nowhere**, so each update re-renders the very large analysis page for nothing. Small compared with 1-2 and it is also true before the tap
   (the `:3157` listener is not gated on Motion Layer), so it cannot explain "freezes at the tap".
4. **Ruled out by the code:** frame-count memory (section 2), unbounded loops or a wait with no timeout (section 3), restored broken state (section 4), a worker that never answers.

## 7. Smallest safe fix for cause 1 (not implemented)

**Do not warm the heavy models on open; load them when "Auto-detect" is first pressed**, with a time limit and a plain message.

- Files: `app/analysis/page.tsx` only. The two effects at `:2105-2110` (selfie) and `:3413-3417` (detector). Smallest version: skip both when the page is
  in phone mode (the page already knows `isMobile`), keep them on desktop. A stricter version: remove the detector warm-up everywhere, keep the selfie warm-up.
- Rule to add where the model loads (`racketCocoDetect.ts getRacketDetectorModel`, `selfieSegmenter.ts getSelfieSolution`): if the load does not finish in N seconds, give up,
  show "Auto-detect is too heavy for this device. Mark the racket by hand.", and continue; never leave the UI waiting. Optionally, on phones cap the frame count
  offered (frames cost ~6 MiB each at this size, so 15 is ~99 MiB), and capture at a lower resolution.
- What could break: **first Auto-detect press pays the load.** The selfie warm-up comment (`page.tsx:2094-2100`) records a measured 3850 ms first frame
  without warming against 432-741 ms with it, so removing the selfie warm-up on desktop would regress that. That is why the minimum fix is phone-only. `docs`
  and `tests/` that read the effect source (if any) would need to follow.
- **Needs approval before coding (CLAUDE.md §6):** this changes *when* a network round trip fires (the 67.8 MB model download).
- Cause 2 (mirror video waiting 15 s on iOS) can be handled separately: prime the mirror with a muted `play()` then `pause()` (as the main video's first-frame fallback does)
  or lower `MIRROR_READY_TIMEOUT_MS` on phones, so a failed capture gives up in ~3 s with a message. Touches `captureSource.ts`/`captureFrame.ts`; larger blast radius.

**Recovery for a coach whose page is already stuck:** nothing is stored, so a reload clears the Motion Layer draft; the rest of the session
is not affected (sessions are only saved on Save). Proposed (not implemented): a kill-switch flag, for example
`localStorage['anglemotion-no-warmup']='1'` or `?warmup=0`, that makes both warm-ups no-ops, so a coach on a device that struggles can open Motion Layer and decide;
and, if saved Motion Layer artifacts ever get re-opened into the editor, load them inside a `try/catch` with a "Discard this Motion Layer" action that keeps the
rest of the session.

## 8. Not verified (needs a real phone)

- That the 4.7-5.0 s block is the same on an iPhone, and whether it is a block or a tab kill (jetsam). No iPhone, no Safari Web Inspector here.
- Production numbers: the tfjs bundle size in production, the cost of WebGL weight upload on a real GPU, whether iOS Chrome reuses cached model shards.
- Whether the mirror `<video>` really waits the full 15 s on iOS 18.5 (inferred from KNOWN_ISSUES 055 and Vin's `readyState=1`).
- Why reload is slow (section 4 lists candidates only).

**What Vin can send to confirm (no code needed):**
1. Load the clip, then switch the phone to **airplane mode**, then tap Motion Layer. The detector model cannot download: if the freeze goes away, cause 1 is confirmed.
2. Same tap with **no clip loaded** and with a **3-second clip**: if it still freezes, the clip is not involved.
3. The `?vdebug=1` lines right after the tap (any `[selfieSegmenter]`/`[captureFrame]` lines).
4. Reload time with the clip but **without** tapping Motion Layer (baseline for the slow-reload report).
5. Sentry will not show it: the inits add no performance tracing (`lib/sentryConfig.ts`), so a long task is not an event. A crash-and-restart of the tab would not be reported either.

## 9. Follow-up: regression, iPhone-only dependencies, other entry points

### 9a. Did it work before, and which commit changed it?

- **No Motion Layer code changed in the last 30 days.** `git log --since=2026-10-03` on `hooks/useStroMotion.ts`, `lib/stroMotion.ts`,
  `lib/stroMotionDraft/*`, `components/stroMotion/*`, `components/StroMotionPanel.tsx`, `lib/racketCocoDetect.ts` returns **no commits**. Last commit that
  touched Motion Layer code: `7f5acba4` (2026-10-14, playhead-ball drag, `app/analysis/page.tsx`/timeline only). From `7f5acba4` to now
  `git diff` of those Motion Layer libraries, `public/sw.js` and `lib/racketCocoDetect.ts` is **empty**.
- **The tap-time code is older still and unchanged.** The racket-detector warm-up was added in `3183f581` (2026-06-15), the mirror `<video>`
  capture source in `0c8d8cc1` (2026-07-26), the selfie warm-up in `b7c1f8d3` (2026-07-27). All four things that run on the tap (section 1) are
  present, identical, at `7f5acba4`, `01c2f23e` and `dd141b67` (the 2026-09-02 import commit, 551 files).
- **It worked on a real phone recently.** KNOWN_ISSUES 038 (commit `7f5acba4`, 2026-10-14) is the owner testing Motion Layer on a real phone
  ("a freshly opened Motion Layer", frame stops, playhead drag). That says it opened and was usable then. It does not say which phone, iOS or browser
  version: **ask Vin**.
- **What did change since 2026-10-14 in `main`** (page-level, not Motion Layer): `8541078d` first frame after upload on iPhone (#94, 10-19);
  `7ccc7d55`/`857b918a`/`913bd52f`/`36233c47` Metrics export work (#92, #93, #96, #97; run on export, not on the tap); `adb0fc16`/`9fbd242f` export sound
  (#99, #112); `03ee28f5` **Sentry** (#101, 10-25: the only new runtime dependency, `@sentry/nextjs`, `package.json`); `9de55c46`/`57c4d362` AI Track (#107, #100);
  `929d29cb` in-app reports (#111); `727fb300` stuck-video watcher (#113, 10-30). Only `727fb300` and `03ee28f5` run on every page load; the rest are idle during the tap.
- **Verdict.** This is **not a regression in Motion Layer's own code**, and I **cannot name a commit that caused it**. If it is a regression, the candidates are outside Motion Layer:
  1. `03ee28f5` Sentry (#101). The browser SDK wraps `addEventListener`, timers, `requestAnimationFrame`, `fetch` and `console` for breadcrumbs (`instrumentation-client.ts`,
     `lib/sentryConfig.ts`; every breadcrumb goes through `scrubBreadcrumb`). It is **live only where `NEXT_PUBLIC_SENTRY_DSN` is set**, and Vin confirmed it is set for Production.
     That would explain "anglemotion.com freezes" while a local or preview build does not, but I found no mechanism that makes it freeze at this tap. **Weak.**
  2. `727fb300` stuck-video recovery (#113): it may `load()` the main video, but it is gated off only while `stroMotionProcessing` (`app/analysis/page.tsx`, `stuckRecoveryAllowedRef`),
     and opening Motion Layer is not "processing". **Weak.**
  3. An iOS 18.5 / CriOS 156 update, or the page simply holding more memory than in mid-October (Sentry, reports, export code). **Not checkable from the repo.**
- **How to settle it without code** (needs your approval, it creates deployments): push a branch at `7f5acba4` (known to open Motion Layer on Vin's phone) and at `main`, and let Vin tap Motion Layer on both preview URLs.
  If `7f5acba4` also freezes on this phone, it is the device/browser, not a commit. Cheaper first check: tap Motion Layer on the **preview** deployment of this PR (same code as `main`). If the DSN is
  set for Production only, Sentry is off there: freeze gone on the preview means Sentry/production environment; freeze still there means not Sentry.

### 9b. What Motion Layer depends on that differs on iPhone Chrome (CriOS = WebKit)

Checked in the Motion Layer files; only the first three run **on the tap**:

| Dependency | Where | On the tap? | iPhone note |
| --- | --- | --- | --- |
| Second hidden `<video>` on the same blob, never played | `captureSource.ts:174-200`, style at `:56-64` | yes | iOS stops at `HAVE_METADATA` for a never-played element (KNOWN_ISSUES 055), so `waitForDecodableFrame` (`captureFrame.ts:46-48`) can wait up to 15 s; two decoders on one blob |
| WebGL contexts: TensorFlow.js `setBackend('webgl')` | `racketCocoDetect.ts:26-30` | yes | one context; weights uploaded as GPU textures (68 MB model) |
| WebGL + wasm: MediaPipe selfie solution (`simd_wasm_bin.wasm`, 5.7 MB) | `selfieSegmenter.ts:127-145` | yes | a second WebGL context; the pose landmarker may hold a third (GPU delegate, `lib/mediapipePose.ts:92-94`) when the skeleton is on; WebKit limits concurrent contexts and GPU memory |
| `createImageBitmap(video)` | `captureFrame.ts` (`normalizedFrameBitmap`) | yes (2 plates) | needs a decoded frame; has a size-mismatch re-grab for portrait phone clips |
| `OffscreenCanvas` | `lib/stroMotion.ts:157-163` (falls back to a canvas when missing) | no (Generate) | supported on iOS 16.4+ |
| `canvas.captureStream(30)` + `MediaRecorder` | `lib/stroMotion.ts:1232-1263` | no (preview video only) | webm/vp9 is not supported on iOS, the code falls back to `video/mp4` |
| Web Audio / `AudioContext` | none in Motion Layer files | no | only the Generate sound path (#112) uses it |
| Web Worker | none at tap | no | the pose worker is not used by these steps |
| SharedArrayBuffer (ORT threaded wasm, SAM racket) | `samRacket.ts:177` | no (on press) | needs cross-origin isolation; not on the tap |

So the iPhone-specific risks at the tap are the never-played mirror `<video>`, **two WebGL runtimes starting at once**, ~74 MB of model download, and the tab memory ceiling. `captureStream`, `MediaRecorder`, `OffscreenCanvas` and Web Audio are **not** involved in the tap.

### 9c. Does it work if Motion Layer is opened from another entry point?

There is only **one** way in. Both toolbar rows (`components/ToolPalette.tsx:1825` in the Tools list, `:2049` on the home list) call `push('stromotion')`, which reaches
`onNavigate('stromotion')` (`app/analysis/page.tsx:6877`) and `setStroMotionActive(true)` (`:6878`); `grep` finds no other place that turns it on, and the tours do not open it.
So the code path is identical from either row, and I **cannot test another entry point because there is none**. What can differ is the state at the moment of the tap:

- **No clip loaded.** The selfie warm-up runs whenever Motion Layer is on (`page.tsx:2105-2110`, not gated on a video); the detector warm-up needs a loaded HTML5 video (`:3413-3417`, `stroMotionHtml5Only`).
  So "tap Motion Layer with **no video loaded**" isolates the selfie/MediaPipe path: freeze there means MediaPipe/WebGL init; no freeze means the freeze needs the detector warm-up or the capture (clip-dependent) path.
- Video paused vs playing (Vin already confirmed playing makes no difference), phases present or not (`:6879-6890`, only changes the section).

### 9d. Updated tests for Vin (replace the "3-second clip" test, the demo video already ruled out clip size)

1. Tap Motion Layer with **no video loaded** (see 9c).
2. Load the demo video, switch to **airplane mode**, then tap Motion Layer (detector model cannot download; the tfjs chunk cannot load either).
3. Tap Motion Layer on the **preview** deployment of this PR, then on `main` production (9a).
4. Say which iOS and Chrome versions the October 14 phone test used, and whether this is the same phone.
5. `?vdebug=1` lines right after the tap; time a reload without ever tapping Motion Layer.

## 10. Update 2: what runs while the video plays with Motion Layer open (Vin's newest results)

### 10.0 What Vin saw, and what it tells us

| Vin's test (iPhone 14 Pro, iOS 18.5) | Reading |
| --- | --- |
| No video loaded: "video needed" | Correct and handled. |
| Airplane mode, video loaded: "Motion Layer couldn't open... Retry" | `components/shared/LazyPanelBoundary.tsx:81` (the panel is `React.lazy`, `app/analysis/page.tsx:51`, wrapped at `:3344-3396`). The panel's JavaScript chunk could not be downloaded; the failure is handled. It also shows the panel chunk is **not cached before its first use**. |
| Network on, video loaded: opens, then the page freezes **2-3 s after he presses play** | See 10.1: the freeze is not caused by playing; the play press is a coincidence of timing. |
| Same in Safari | Not Chrome-specific. On iOS every browser is WebKit, so Chrome and Safari run the same engine. |

### 10.1 (a) What runs per frame during playback, and how often the detector runs

Reproduced on desktop (Chromium 390x844, 4 cores, no GPU, `next dev`, 15 s 720x1280 clip). Motion Layer opened, play pressed 1.5 s later,
long tasks and frame gaps measured for 14 s:

| Run | Result |
| --- | --- |
| A, normal | One **6.1-6.2 s main-thread task starting 2.3-3.9 s after play**; the biggest gap between two painted frames was **6.1-6.2 s** (the canvas stops completely); plus ~25 tasks of 50-110 ms |
| C, `storage.googleapis.com` blocked (detector model cannot download) | No big task; largest frame gap **283 ms** |
| E, detector, selfie model and tfjs chunk all blocked | Largest frame gap 83 ms; only small tasks |

That is Vin's timeline: he opens Motion Layer, presses play within a couple of seconds, and the stall lands 2-3 s later. Earlier measurements without pressing play show the same
block 4-5 s after opening (section 6). **The block belongs to opening Motion Layer, not to playing.**

What actually runs, per frame and per event (code read, `file:line`):

| Work | How often | Thread | Guard against falling behind |
| --- | --- | --- | --- |
| Canvas draw loop, `requestAnimationFrame(render)` (`components/Canvas.tsx:5674`, `:7213`) | every frame while playing | main | normal drawing, dirty-flag based; nothing Motion Layer specific on a fresh open |
| Motion Layer composite on the canvas (`renderStroMotionDraftComposite`, `Canvas.tsx:5830-5846`, `:5959-5985`) | every frame **only when** `stroDraftPreviewActive` is true: at least one frame has a preview mask (`page.tsx:7229-7232`). **Not on a fresh open.** | main | **none**: per ghost, per frame, it does `drawImage` + `getImageData` of the full frame and a JS loop over every pixel (`lib/stroMotionDraft/compositeFromDraft.ts`, `renderMaskedFrame`; 921,600 pixels per ghost at 720x1280) and creates a scratch canvas each call. This is a **later** risk for a phone once frames are detected, not the cause now |
| `timeupdate` listener that calls `setStroVideoTime` (`page.tsx:3157-3180`) and the timeline's `onCurrentTime: setStroVideoTime` (`:6646`; throttled to ~10/s while playing, `components/PreciseTimeline.tsx:431-436`) | several times a second | main | the value is read nowhere (declared `:849`), so every update re-renders the whole analysis page for nothing |
| **The racket detector (COCO-SSD)** | **never per frame.** `detectTennisRacketNorm` runs only when the coach presses something: the racket-multiplier tool (`Canvas.tsx:3294-3311`), the auto-detect passes (`page.tsx:2317`, `:7074`) and object tracking (`lib/stroMotionObjectTrack.ts`) | **main thread** (TensorFlow.js is imported by the page, `lib/racketCocoDetect.ts:21-36`; no worker) | **none**: no busy flag, no time limit, no frame skip in `racketCocoDetect.ts` |
| **What runs on open is the detector's LOAD** (`page.tsx:3413-3417`): tfjs, `tf.setBackend('webgl')`, `cocoSsd.load({ base: 'mobilenet_v2' })` | once per open | main thread | **none**: nothing times it out, cancels it or limits it. This is the 6 s block |
| Person segmenter (MediaPipe selfie solution; `page.tsx:2105-2110`, `selfieSegmenter.ts:127-204`) | load once per open; `send` once per frame only during an auto-detect pass | main thread | calls are serialized (`sendQueue`, `selfieSegmenter.ts:172-184`), so no overlap, but no time limit |
| Live skeleton (pose) | only when the coach switched the skeleton on (default **off**, `page.tsx:1039`) | MediaPipe live landmarker on the main thread (`lib/mediapipePose.ts:504-545`) and/or the pose worker (`lib/poseWorker.ts:4-8`) | **yes**: 15 Hz scheduled from completion (`Canvas.tsx:4644`, `:4764`), a busy flag (`:4708`), and a median over budget twice in a row reverts it (`:4653-4700`) |

So the project rule ("if something must drop frames, it drops frames and the UI never freezes") **is implemented for the live pose and is not implemented for the Motion Layer warm-ups**.

**WebGL contention (described only, nothing changed).** When Motion Layer opens, up to four GPU users can start at once: the detector's TensorFlow.js `webgl` backend (its own context,
`racketCocoDetect.ts:26-30`), the MediaPipe selfie solution (its own context), and, if the skeleton is on, the MediaPipe live landmarker (GPU delegate) and the pose worker's OffscreenCanvas WebGL context
(`poseWorker.ts:4-8`, with its own recovery for lost contexts), all while the 2D canvas and the video decoder are compositing. WebKit on iOS runs all of them through one GPU process with limits on concurrent
contexts and GPU memory. Also note that `@tensorflow/tfjs` is a **module singleton on the main thread**: `tf.setBackend('webgl')` in the detector's load is global for that instance, and the pose code's
main-thread fallback shares the same detector library and "a TFJS detector is not re-entrant" (`Canvas.tsx` comment, `lib/sharedPoseDetector.ts:49`). I could not test that interaction here. **Ask Vin whether the skeleton was on.**

### 10.2 (b) Are the models cached between visits? What does a reload re-download?

- **Nothing is fetched on a plain page reload.** All three loads are gated on Motion Layer being open (`page.tsx:2105`, `:3413`); the page itself does not touch them.
- **Detector model** (`storage.googleapis.com/tfjs-models/savedmodel/ssd_mobilenet_v2/`): 17 weight shards of 4,194,304 bytes plus `model.json` (measured 67.8 MB). Google's response headers (measured with `curl`): `cache-control: public, max-age=3600`, `etag`, `access-control-allow-origin: *`.
  So the browser's own HTTP cache **may** keep it for one hour and revalidate afterwards; the app does **not** store it itself (the load is `cocoSsd.load({ base })`, a plain URL: no IndexedDB or Cache Storage save in `racketCocoDetect.ts`). Whether iOS keeps 68 MB in its HTTP cache is not something I can verify.
- **Selfie runtime** (`/mediapipe-selfie/*`, 5.7 MB wasm + 0.25 MB model) and the **tfjs chunk**: same origin. The service worker (`public/sw.js`) caches `/_next/static/` chunks cache-first after first use, and everything else same-origin or cross-origin with a catch-all that is **network-first and also copies every successful response into Cache Storage** (`sw.js:176-190`), so the 68 MB detector download is written to Cache Storage as well. `next.config.js` sets no `Cache-Control` for `public/` files (only COOP/COEP, `:49-66`); Next's own default for those files is revalidate-every-time (not verified here).
- **What every open repeats regardless of any cache:** parsing tfjs, `tf.ready()`, WebGL backend start and shader compilation, parsing the 17 shards, and uploading the weights to the GPU. That is CPU/GPU work on the main thread, and it is the multi-second block; a warm network cache would shorten the download, not this work.
- The panel's own chunk (`StroMotionPanel`) was not cached before first use (Vin's airplane-mode result); after a first successful open the service worker has it.

### 10.3 (c) Smallest fix to evaluate (not implemented)

Order by size, smallest first; each needs approval before coding because it changes when a download and an initialisation happen (CLAUDE.md section 6):

1. **Do not warm the detector on open.** Remove the effect at `app/analysis/page.tsx:3413-3417`. It is a warm-up only: the first real use (an Auto-detect press) already loads the model lazily (`racketCocoDetect.ts:53`). Cost: the first Auto-detect press waits for the load (the page already has a processing status for that). One file, ~4 lines.
2. **On phones, also skip the selfie warm-up** (`page.tsx:2105-2110`) and keep it on desktop, where the code comment records it saves ~3.3 s off the first frame. Same file.
3. **Or warm only while paused and idle, never while playing, and never on phones** (`requestIdleCallback` after a pause), so a coach who presses play is never behind a load.
4. **Smaller model** (`lite_mobilenet_v2`, coco-ssd's own default, a few MB instead of 68): changes detection quality, so it needs a measurement on racket footage first.
5. **"Throttle to every Nth frame and skip when behind"** does not apply to the detector today (it is never per frame); if a future feature runs it per frame, copy the pose pattern: schedule from completion (`Canvas.tsx:4764`) plus a busy flag. **"Detect only while paused or scrubbing"** is already how the detector behaves.

What could break: the first Auto-detect press on desktop is 4-6 s slower; tests that read `page.tsx` source (none found for these two effects, to be confirmed when coding).

### 10.4 (d) The guard that stops it and says so

Honest limit first: JavaScript cannot interrupt a synchronous block that is already running, so **a guard cannot cut a 6 s task short**; it can only (1) stop the next one from starting and (2) tell the coach.
Two facts shape it: the Long Tasks API (`PerformanceObserver('longtask')`) **is not available in WebKit**, so on every iPhone browser it would never fire; and a frame-gap check does work everywhere.

The one-line guard to evaluate (runs only while Motion Layer is open, stops the warm-ups and shows the message on the first stall over 1.5 s):

```ts
const tick = (t: number) => { if (t - last > 1500) stopMotionLayerWarmups('Auto-detect is too heavy for this device. You can still mark frames by hand.'); last = t; requestAnimationFrame(tick); };
```

with `stopMotionLayerWarmups` disposing the detector and segmenter, setting `localStorage['anglemotion-no-warmup']='1'` (so the next open skips them) and showing the message through the existing `setProcessingStatus`. The preventive version is change 1/2 above (never start the load on a phone); the guard is the safety net for whatever still locks.

### 10.5 Updated ranked causes

1. **The detector's load on open (top, now reproduced).** One uncapped main-thread job: tfjs + WebGL backend + 68 MB model, started when Motion Layer opens (`page.tsx:3413-3417`). Measured on desktop: **6.1-6.2 s with the canvas fully stalled, starting 2.3-3.9 s after play**, gone when only that download is blocked (run C). Timeline matches Vin's; Safari = Chrome on iOS explains "same in Safari". A phone adds the tab memory limit, so the same job can end in a killed tab (reload very slow). No guard, no timeout, no worker.
2. **The same moment's other work:** selfie model load (main thread, ~3.3 s per the code comment), the second hidden capture `<video>` (waits up to 15 s on iOS, section 3), and page re-renders from `setStroVideoTime`. Adds to the stall; alone it is the 100-300 ms level in run C.
3. **Per-frame composite once frames have masks (a separate, later risk):** unguarded full-frame `getImageData` + per-pixel loop per ghost per frame (`compositeFromDraft.ts`). Not the cause on a fresh open.
4. **Skeleton contention** if the coach had the skeleton on (four GPU users at once). Unknown for Vin's runs.
5. Not a regression in Motion Layer's code (section 9a): unchanged since June to September; the Sentry candidate stays weak.

### 10.6 Recovery for a coach whose page is already frozen

- Nothing is stored (section 4), so there is no broken Motion Layer to repair: the page recovers when the job ends or after a reload; a killed tab simply reloads.
- Today's workaround: reload, load the clip, and **do not open Motion Layer** on that phone until the fix lands.
- Proposed (not implemented): the watchdog in 10.4 sets `anglemotion-no-warmup`, after which Motion Layer opens without any warm-up; a "Reset Motion Layer" action calls the existing `clearStroMotionAll` (`page.tsx:1020`) and `disposeCaptureSources()` (`lib/stroMotionDraft/captureSource.ts`) and drops the detector, without touching the rest of the session. The existing "couldn't open ... Retry" boundary stays as it is.

### 10.7 What Vin can send next

1. Open Motion Layer and **do not press play**; wait 15 s. Prediction: the freeze happens anyway, about 4-6 s after opening.
2. Press play first, **then** open Motion Layer. Prediction: the freeze still follows the opening, not the play.
3. Was the skeleton on? (Default off.)
4. Airplane mode **after** Motion Layer has opened once on Wi-Fi (panel chunk cached), then reopen it: if there is no freeze, the freeze is the detector download/initialisation.
5. Not verified here, still needs the phone: the block length on an iPhone, whether the tab is killed, and the HTTP-cache behaviour for the 68 MB model.

## 11. Update 3: production freezes, the preview works, Auto-detect reloads the page

### 11.0 What the new results change

| Vin's result (iPhone 14 Pro, iOS 18.5) | Reading |
| --- | --- |
| anglemotion.com freezes with a video loaded, Safari and Chrome | Same engine (WebKit), so one cause, not two |
| Preview of #135 (same code as `main`, no Sentry variable, fresh origin): Motion Layer opens and **plays fine** | The preview runs the **same** warm-ups (`page.tsx:2105`, `:3413`) and does not freeze. So the detector warm-up (section 10) is **not sufficient** on an iPhone. **It is demoted**; its 6 s desktop block is real and still worth removing, but it is not why production freezes |
| Preview: Auto-detect shows "AI detecting the athlete: frame 6/6", then the app reloads and everything is gone | A second problem, reproducible on the preview: see 11.3 |

So something that exists **only on production** is needed to make the freeze happen. The rest of this section lists what that could be.

### 11.1 (a) What differs between production and preview

| Difference | Production | Preview | Could it affect Motion Layer? |
| --- | --- | --- | --- |
| **Origin / domain** | `anglemotion.com` (www) | `*.vercel.app` | Yes, indirectly: localStorage, sessionStorage, Cache Storage, the service worker and cookies are per origin. Production holds Vin's history; the preview starts empty |
| **Signed-in state** | signed in (Supabase cookie on the production origin) | almost certainly signed out (a different origin has no cookie, and Google sign-in redirects are tied to the production domain; not verified) | Yes: plan, entitlement and sign-in code paths run only when signed in (`lib/useEntitlement`, `AuthButton`, player context) |
| `NEXT_PUBLIC_SENTRY_DSN` | set (Vin confirmed) | not set | **Yes, see below** |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` / `_RELEASE` | `production` / commit SHA (`next.config.js:14-15`) | `preview` / commit SHA | No behaviour, labels only |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | build only: source-map upload (`next.config.js:77-86`) | unknown | Not at runtime |
| Other client variables the code reads: `NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY`, `NEXT_PUBLIC_YT_RESOLVER_URL` (`page.tsx:5726`), `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` (`lib/tempDebugPose.ts:53`), Stripe and Google client ids (`.env.example`) | set | probably the same set | Not for Motion Layer; I cannot read the dashboards, so this is **unverified** |
| Vercel preview toolbar and comments script | no | injected by Vercel (the "Vercel Preview Comments" check) | Extra script on the preview only; not a cause of a *missing* freeze |
| `next.config.js` headers (`:49-66`) | COOP `same-origin`, COEP `credentialless` on every page | identical | No difference (same file). No `Cache-Control` is set there for any file |
| Cache headers for the model files | Vercel edge. Same-origin `public/` files (models, `/ort`, `/mediapipe-*`) carry no app-set header, so Vercel/Next defaults apply (revalidate each time); hashed `/_next/static/*` is immutable. **Not measured:** the sandbox cannot reach anglemotion.com (403 from the proxy) | same | No difference between the two unless the domain or a CDN rule differs; the detector model is on `storage.googleapis.com` (`cache-control: public, max-age=3600`, measured) for both |
| **Service worker** (`public/sw.js`, registered 3 s after load in **any** production build, `app/ServiceWorkerRegistration.tsx`) | installed since launch, caches accumulated (11.2) | installed at first visit, **empty caches** (and it takes control mid-session: `skipWaiting` + `clients.claim`, `sw.js:60-74`) | **Yes**, see 11.2 |

**What runs only when the DSN is set (verified in the installed SDK, `@sentry/core` 11.10.0).** `Client.init()` sets integrations up only when the client is enabled
(`node_modules/@sentry/core/build/cjs/client.js:307-316`); our config passes `enabled: false` and no DSN when the variable is empty (`lib/sentryConfig.ts`, `sentryBaseOptions`). So on the preview **none of the following exists**, and on production all of it does:

- `BrowserApiErrors` **wraps `setTimeout`, `setInterval`, `requestAnimationFrame`, `XMLHttpRequest.send` and `addEventListener` on every event target** (`@sentry/browser/.../integrations/browserapierrors.js`): every animation frame, timer and event handler the analysis page and the canvas loop use goes through a Sentry wrapper;
- `Breadcrumbs`: every `console.*` call, every `fetch`/XHR and every click is recorded as a breadcrumb and passed through our `beforeBreadcrumb: scrubBreadcrumb` (`lib/sentryConfig.ts`), which deep-walks every logged argument up to six levels (`scrubDeep`). The Motion Layer code paths alone contain 102 `console.*` calls; the page and canvas have many more. A log that passes a large object or a typed array (a mask is a 921,600-byte `Uint8ClampedArray`) would be walked entry by entry. I found no such call on the tap path, so this is a **mechanism, not a proven cause**;
- `GlobalHandlers` (every unhandled error and rejection becomes an event, scrubbed by `scrubEvent`, depth 8) and the feedback widget.

### 11.2 (b) What is persisted per origin, how much it can grow, and what page load does with it

| Store | What the code writes | Size / growth |
| --- | --- | --- |
| localStorage | small flags: tour progress JSON (`anglemotion-tours-v1`), timeline fps (`anglemotion.timeline.*`), sound (`anglemotion.sound.v1`), install-prompt dismissals, toolbar collapsed, foot-line notice, precision-draw instructions; and the **developer toggles** `stroSegmenter`, `stroRacket`, `autoRacket`, `samRacket` | a few KB |
| sessionStorage | reload latch (`anglemotion:reload-reset-evaluated-at`), tour state, debug flags | per tab, gone on close |
| IndexedDB | **nothing written by the app** (no `indexedDB` use in `app/`, `components/`, `lib/`, `hooks/`) | none |
| Cookies | Supabase sign-in (production only, in practice) | small |
| **Cache Storage `angle-motion-v3`** (the service worker) | precache of 6 small files; then **cache-first** for every `/_next/static/*` chunk, images and fonts; **network-first plus `cache.put` for everything else**, including cross-origin GETs (`sw.js:84-190`) | **grows without a limit.** The name has not changed since 2026-09-09; `activate` only deletes caches with a *different* name |

What can land in Cache Storage for a user who tests daily: every hashed `/_next/static/` chunk of every deploy visited (the production build of the analysis route alone is several MB; **I could not measure production sizes**), plus every model and runtime
file that was ever fetched through the catch-all: `public/models` 115 MB (pose heavy 30.7, SAM-2 33, selfie multiclass 16.4, MoveNet 17.7, full pose 9.4, D-FINE 5.8, magic_touch 6.2), `public/ort` 49 MB, `public/mediapipe-wasm` 33 MB, `public/mediapipe-selfie` 12 MB, plus the detector's **67.8 MB** from `storage.googleapis.com`.
That is up to **~280 MB of models** plus the accumulated chunks, i.e. plausibly hundreds of MB, possibly more than 1 GB, on a long-lived production origin, against an empty cache on the preview. Entries are replaced per URL, so this is a ceiling, not a typical day.

What a page load does with it: the service worker starts, `install` precaches 6 files, `activate` deletes other cache names, then **every** same-origin request passes through the worker; `/_next/static/` requests call `caches.match`, which has to search the cache. Nothing reads or parses the stored models at load. The localStorage flags are read **when Motion Layer opens**: `selectedSegmenter()` reads `stroSegmenter` (`lib/stroMotionDraft/segmenterCommon.ts:55`, `selfieSegmenter.ts:194-204`); if it was ever set to `multiclass`, the open-time warm-up loads the **16.4 MB multiclass model and MediaPipe's wasm** instead of the 5.7 MB selfie runtime; `autoRacket` and `samRacket` change what Auto-detect runs
(`lib/stroMotionDraft/autoRacketFlags.ts:25-54`, `page.tsx:128-137`). A developer-tester's production origin is exactly where those could have been set. Whether any of this slows a real iPhone is **not measurable here**.

### 11.3 (c) Why Auto-detect ends with the page reloading (described only; Auto-detect is not changed)

What "frame 6/6" is: the end of the **cheap** phase (one pose per frame, `page.tsx:2759` for the racket mode, `:2938` for the player mode). Directly after it the heavy batch starts (`autoProcessFrames`, `hooks/useStroMotion.ts:588-1000`):

1. optional racket-arc sweep: capture every frame into memory (`preCaptured`);
2. foot-pose pass: MediaPipe full pose per frame (`detectFullPoseOnBitmap`, loads `pose_landmarker_full.task` 9.4 MB);
3. racket phase A: the D-FINE detector on every frame through ONNX Runtime wasm (`public/ort` 13-24 MB wasm, `public/models/dfine-n`); **on by default**, because the default object type is `racket` (`hooks/useStroMotion.ts:157`) and auto-racket is on in implement modes (`autoRacketFlags.ts:25-54`);
4. the mask pass: `proposeFrameMask` per frame with the person segmenter;
5. racket phase C: **SAM-2** on every frame with a detection (`samRacket.ts`, vision encoder 28.5 MB + decoder 4.6 MB, ONNX Runtime). iOS 18.5 has no WebGPU in the browser, so this is the wasm execution provider. Its embedding cache has a **420 MiB budget** ("tens of MB per frame ... rather than letting the tab OOM", `samRacket.ts:115-122`).

**Memory per frame and how many are held at once.** The mask pass itself is small: the motion-diff works at a capped 420 px (`proposeFrameMask.ts:67-80`). What a frame retains is its source `ImageBitmap` (720x1280x4 = 3.5 MiB) plus two full-frame masks (0.88 MiB each), plus a third copy at commit: **~6.1 MiB per frame**. **All frames are held at once on purpose** (the commit is atomic: "builds every frame's proposal in memory ... then commits the COMPLETE set", `useStroMotion.ts:578-587`), so 6 frames are ~37 MiB and 15 frames ~92 MiB, plus the background plate. **That is not what runs a phone out of memory.** The large part is the **models**: MediaPipe pose, the ONNX Runtime wasm heap with D-FINE, the segmenter, and SAM-2's encoder plus its cache (up to 420 MiB of embeddings), loaded one after another during one pass. I cannot give a megabyte figure for the whole stack without a device.

**Would iOS terminate the tab? Most consistent with yes.** Reasons: (i) the page came back as the **empty Upload screen**, not as the app's own error page (`app/analysis/error.tsx` would show "Something went wrong" and wait for a click); (ii) nothing in the Motion Layer or Auto-detect code calls `location.reload` or navigates (only that error page's button does); (iii) a browser that kills a tab reloads it when the user returns, and the page then *deliberately* resets a reloaded session (`page.tsx:4375-4410`: `nav.type === 'reload'` runs `resetSession()`); (iv) a local `blob:` video dies with the process. iOS does not publish its per-tab limit. **No proof:** only a device log can show it (see 11.7).

**Recoverable after the reload?** **No.** The Auto-detect result, the draft, the snapshots and the loaded clip live only in the tab (React state, `ImageBitmap`s and a `blob:` URL of the local file). Nothing was ever written to storage, so there is nothing to restore.

### 11.4 (d) What autosave exists, and why nothing was restored

- The only "auto-save" in the analysis page is `page.tsx:3710`: the measurement column is copied into the active snapshot **in memory**. It writes nothing to storage.
- Persistence exists only on an explicit **Save** to the player's session (Supabase, `components/sessions/SaveSessionModal.tsx`, `lib/sessions/saveSession`), and the Motion Layer image/video only exist once Generate has produced them (`lib/sessions/adapters/stroMotionAdapter.ts`).
- On a reload the page resets itself on purpose ("Full page reload should not inherit URL field or stale session state", `page.tsx:4336`), and a local file cannot be re-opened by the browser without the coach choosing it again.
- So it did not restore because **nothing was written and the design does not restore**, not because a restore failed.

### 11.5 Private-tab test: separating stored data from production settings

On a private tab, anglemotion.com has the **same code, the same domain, the same Vercel environment variables (including the Sentry DSN)**, but **empty localStorage, sessionStorage, Cache Storage, cookies, and a signed-out state**. (In Safari private windows the service worker may not be available at all, which also removes it from the picture; note that, it is not a flaw.)

| Result in a private tab on anglemotion.com | Meaning |
| --- | --- |
| Motion Layer works, plays, no freeze | The cause is **stored data or sign-in state** on Vin's normal profile: the developer flags, the accumulated Cache Storage, or the signed-in code path. **Not** the production settings |
| Still freezes | A **production setting**: the Sentry DSN (wrapping, breadcrumbs, scrub) or another environment variable |

To split the first row further: (1) private tab, signed out; (2) private tab, **signed in** (freeze back = a sign-in-dependent path); (3) normal tab after removing the site's data (Safari: Settings > Safari > Advanced > Website Data > remove anglemotion.com; Chrome: delete "Cookies and site data" for the site), then signed in (freeze gone = stored data, which the cleanup also proves).

### 11.6 Updated ranked causes

1. **A production-only factor, not yet identified** (the preview works). Ordered by what the code supports; the private-tab test above splits (A)+(C) from (B):
   - **(A) Stored data on the production origin.** The developer toggles in localStorage that change the open-time warm-up (`stroSegmenter=multiclass` loads 16.4 MB + wasm instead of 5.7 MB) and the Auto-detect stack (`autoRacket`, `samRacket`), and an unbounded service-worker Cache Storage (up to hundreds of MB, chunks of every visited deploy, every model fetched). Evidence: the code paths exist and read these keys; the preview has none of them. No measurement.
   - **(B) Sentry with the DSN.** Verified: the integrations exist only on production (11.1), wrapping every `requestAnimationFrame`, timer and event listener and scrubbing every console argument. No mechanism proven for the freeze at this tap.
   - **(C) Signed-in state** on production versus signed-out on the preview.
2. **The detector warm-up** (section 10): real (6 s on desktop), **not sufficient** on the iPhone; may still amplify one of the above. Cheap hygiene to remove, not the cure.
3. **Auto-detect runs the heaviest model stack on the phone** (separate problem, reproduced on the preview): D-FINE + SAM-2 on wasm with a 420 MiB cache and the other models in one pass; the tab is most likely killed by iOS, and nothing is recoverable.
4. Not a regression in Motion Layer's own code (section 9a); unchanged.

### 11.7 Updated smallest-fix proposals (none implemented; each needs approval)

1. **Do nothing until the private-tab result is in.** It decides between "stored data" and "production settings", and the right fix differs.
2. If **stored data**: (a) make the service worker stop caching the large model and runtime files (skip `/models/`, `/ort/`, `/mediapipe-*` and every cross-origin response in the catch-all `cache.put`, `public/sw.js:176-190`) and bump `CACHE_NAME` so `activate` evicts the accumulated cache; (b) a "Reset local data" action (unregister the worker, delete caches, clear the four developer keys). One file for (a).
3. If **Sentry**: keep the DSN but make the browser init lighter: skip the `BrowserApiErrors` wrapper of `requestAnimationFrame`/timers/`addEventListener` and the console breadcrumbs (`instrumentation-client.ts`, `integrations` option). One file.
4. **Auto-detect crash loop breaker (does not touch Auto-detect itself).** Around the call at `page.tsx:2938-2985`: write a marker in localStorage when a pass starts and clear it when it ends; on the next load, if the marker is still there, tell the coach "the last Auto-detect did not finish; this device ran out of memory" and set `autoRacket='0'` and `samRacket='0'`, the existing switches that turn off D-FINE and SAM-2. Before starting on a phone, offer "Save session first". It cannot make the pass lighter; it stops the loop and the surprise. A default of "phones start with those two switches off" is the next step and changes Auto-detect's behaviour, so it needs a decision.
5. Keep from section 10: remove the detector warm-up and the one-line frame-gap guard. They are hygiene now.

### 11.8 What Vin can do next (no code)

1. The **private tab** test above, with the three steps.
2. **Confirm the tab kill:** iPhone Settings > Privacy & Security > Analytics & Improvements > Analytics Data, look for a `JetsamEvent` entry at the time of the reload (needs "Share iPhone Analytics" on); the entry names the process and its memory. Send the file.
3. Auto-detect with the two switches off cannot be tested without a console on iOS; the preview can instead be tested with the same flow while Auto-detect runs on **a 3-frame** selection (fewer frames: less cache), to see whether the crash depends on the frame count.
4. Not verified here: cache headers on anglemotion.com, production chunk sizes, anything on a real device.

## 12. Update 4: a Private tab works; the service worker and stored data first; the Auto-detect reload

### 12.0 What the new result changes

A Safari Private tab on anglemotion.com has the **same code, the same domain, the same Vercel variables including the Sentry DSN**, and empty stored data. It opened Motion Layer and reached Auto-detect. Therefore:

- The freeze on Vin's normal browser is tied to **what that browser has stored for anglemotion.com** (Cache Storage, the service worker, localStorage) **or to being signed in** (a Private tab is signed out; that is not yet separated).
- It is **not** a production setting. That all but rules out the Sentry DSN as the cause (the DSN was on in the Private tab), and it rules out the models loading on open as the cause (they load in the Private tab too, same code, same network).
- **The model load on open (sections 10 and 11) is now a secondary risk**: it costs ~6 s of main thread on desktop and keeps ~68 MB of weights resident, but it is not why the normal profile freezes.
- Caveat for the next test: Safari may not run a service worker at all in a Private window, so the Private result does not by itself say *which* stored item matters (service worker caches, localStorage flags, or sign-in). 12.5 gives the splitting steps.

### 12.1 The service worker: what it caches, how it versions, how it could hurt

**Version and update logic** (`public/sw.js`, `app/ServiceWorkerRegistration.tsx`):

- The only version is the string `CACHE_NAME = 'angle-motion-v3'` (`sw.js:20`), **unchanged since 2026-09-09**. There is no build-tied version, no size limit, no age limit, no cleanup other than `activate`, which deletes every cache whose name differs (`sw.js:69-75`). Nothing evicts entries inside `v3`.
- `install` precaches 6 small files, then `skipWaiting()`; `activate` ends with `clients.claim()` (`sw.js:60-76`): a new worker takes over open pages immediately. No code listens for `controllerchange` and nothing reloads on update.
- Registration is production-only (`NODE_ENV === 'production'`, which includes every Vercel preview), 3 s after load, with no `update()` call. The browser re-checks `sw.js` on navigations (at most about once a day by spec); an edited `sw.js` is the only way a new version reaches users.

**What it caches** (rules in order, `sw.js:78-190`):

| Rule | Strategy | Checks | Notes |
| --- | --- | --- | --- |
| `/api/*` | network only; on failure answers `{"error":"Offline"}` with **status 200** | n/a | not cached |
| `cdn.jsdelivr.net` (ffmpeg core wasm ~31 MB, `lib/ffmpegWebmToMp4.ts:11`; webcam segmentation) | **cache-first** | **none**: any status, incl. errors | held forever |
| images, fonts, `/icons/*` (includes **Next optimizer URLs**, marketing images and **report screenshots from Google Drive**, which are cross-origin `<img>` requests, i.e. opaque responses) | **cache-first** | **none** | an error or empty response is stored and served forever; Chromium pads each opaque entry to ~7 MB of quota (WebKit's accounting not verified) |
| documents and RSC payloads | network, offline page on failure | n/a | not cached |
| video, audio, Range | not handled | n/a | |
| `/_next/static/*` | **cache-first** | only `ok` | hashed names, one set per deploy visited, **never removed** |
| everything else, same-origin **and cross-origin** (models, wasm, `.tflite`, `.task`, `.onnx`, JSON, **the 68 MB detector shards**) | **network-first, then `cache.put`**; cache used only when offline | `ok` and not 206 | every successful download is **copied into Cache Storage** |

What that can add up to on a long-lived origin: `public/models` 115 MB, `public/ort` 49 MB, `public/mediapipe-wasm` 33 MB, `public/mediapipe-selfie` 12 MB, the detector 67.8 MB, ffmpeg ~31 MB = **~310 MB of model and runtime files**, plus **every hashed chunk of every deploy the user opened since September** (this repo ships ~110 commits a month; production chunk sizes not measured), plus images (opaque Drive screenshots padded). A tester who opens the app daily on a phone can plausibly hold several hundred MB, possibly over a gigabyte. A Private tab and every preview origin start at zero.

**How a stale, bloated or corrupted cache could give "freeze on open, slow reload"** (mechanisms, ranked by how well the code supports them; **none is verified on a device**):

1. **Size and lookup cost.** Every `/_next/static/*`, image and font request goes through `caches.match`, which searches the origin's caches; the analysis page loads dozens of chunks. With thousands of entries and hundreds of MB, opening the cache and the lookups slow the load ("slow reload"), and the service-worker process competes for memory with the tab.
2. **Memory pressure from the worker itself.** Each model download is `fetch` + `response.clone()` + `cache.put` (`sw.js:176-190`): the clone buffers body data until both readers finish; the 68 MB detector and the 30 MB pose model pass through the worker's memory at the moment Motion Layer opens. On a phone, the browser's process budget is shared.
3. **Storage eviction mid-state.** WebKit removes script-writable storage for sites after a period without use, and can purge under storage pressure. A partly purged origin (registration present, caches or localStorage missing, or the reverse) is a combination the code never tests.
4. **Poisoned entries.** The image and jsdelivr rules store whatever came back and serve it forever (no `ok` check, no expiry): a one-time error stays. This produces broken images and a broken ffmpeg load, not a freeze, but it shows the cache has no way to heal itself.
5. **A stale chunk set cannot mismatch the page:** documents are network-first and chunk names are hashed, so a stale-chunk crash is **not** supported by the code.

A related finding outside the freeze: **report screenshots from Drive are cached cache-first and opaque with no revalidation** (`DriveImage.tsx` images match the image rule). A one-time Drive error is therefore remembered. Worth a KNOWN_ISSUES entry; not part of this investigation.

**A safe way to reset it, without losing saved work.** Saved work (players, reports, entries, sessions) lives in Supabase and is untouched by anything below. Unsaved analysis lives only in the tab and is lost by any reload anyway. The sign-in cookie is not in Cache Storage and is not touched by these options.

| Option | What it does | Files | Risk |
| --- | --- | --- | --- |
| **A. Version bump plus limits** | `CACHE_NAME` to `v4`: every user's `activate` deletes `v3` once. In the same change: stop caching what is large or cross-origin or opaque (`/models/`, `/ort/`, `/mediapipe-*`, `.wasm/.tflite/.onnx/.task`, every cross-origin response), add the missing `ok` check to the image and jsdelivr rules, and trim `/_next/static` to a fixed number of entries | `public/sw.js` (one file), optionally `ServiceWorkerRegistration.tsx` to call `update()` so it does not wait a day | Offline use of previously visited pages is reduced until the next visit (the offline page stays precached); first use after the change re-downloads what it needs (the HTTP cache still helps). Must be tested with a real update (old worker to new) |
| **B. "Reset cached data" action, plus an escape-hatch page** | unregisters the service worker, deletes every cache, removes the four developer keys (`stroSegmenter`, `stroRacket`, `autoRacket`, `samRacket`), shows `navigator.storage.estimate()` before and after, then reloads. A tiny standalone route (for example `/reset`) with no analysis code, so a coach whose analysis page freezes can still run it | one new small page and a link in the Help area | warn "unsaved analysis in this tab will be lost" and disable it while a video is loaded |
| **C. Manual (today, no code)** | Safari: Settings > Safari > Advanced > Website Data > anglemotion.com > delete (this also signs the coach out; saved work is on the server). Chrome for iOS: Settings > Privacy > Delete Browsing Data > Cookies and Site Data | none | signs out |

A (once, automatic, for everyone) plus B (a self-service way out) is the combination I would evaluate; C is the diagnostic Vin can run now.

### 12.2 (2) The reload after Auto-detect: is any code reloading the page?

Searched `app/`, `components/`, `lib/`, `hooks/`, `public/sw.js`, `middleware.ts`, `instrumentation*.ts` for every reload and navigation mechanism, then Next.js 15.5.24's own client code:

| Mechanism | Found | Can it fire when Auto-detect ends or the editor opens? |
| --- | --- | --- |
| `location.reload()` | only `app/analysis/error.tsx:70`, the "Reload page" button of the error screen | No: it needs a click, and that screen would show "Something went wrong", not the empty Upload screen |
| `location.href = ...` | billing, pricing and payment-banner buttons (`app/billing/page.tsx:57`, `:287`, `PricingClient.tsx:98`, `PaymentFailedBanner.tsx:33`) | No: only on a click on those pages |
| `router.refresh()` | `components/WorkspaceChrome.tsx:41` (sign out), used on catalog and admin pages, not on `/analysis` | No |
| `router.push/replace` | `app/analysis/page.tsx:7487`, `:9703` (go to the player page / after save) | No: tied to buttons |
| `controllerchange`, service-worker message reload | none in the code; the worker only `skipWaiting` and `clients.claim` (no reload) | No |
| Chunk-load-error recovery | none besides `LazyPanelBoundary` (a "Retry" button that re-renders the panel) | No |
| `app/error.tsx`, `app/global-error.tsx` | do not exist; `app/analysis/error.tsx` shows a message and waits | No |
| Next.js internal hard navigations (`page-bootstrap.js`, `app-router.js:346` on a back/forward to a non-Next history entry, `doMpaNavigation` when a navigation gets a non-RSC reply) | present in the framework | No: they need a navigation or history event; nothing at the end of Auto-detect navigates |
| Autosave or restore | none | n/a |

What the end of Auto-detect does (`app/analysis/page.tsx:3004-3012` onward): `refreshStroPreviewFromDraft()`, a log line, and a status message. It does **not** open the editor by itself (`setStroEditingFrameIndex` is only called from buttons and from "mark ready and next", `page.tsx:3061`). Run on desktop with the synthetic clip (5 frames), the whole pass completed in 45 s ("auto-detect committed 5 of 5 frames", "AI auto-selected 5/5 frames") **with no reload**.

**Conclusion: no deliberate reload fires.** The page returns to the empty Upload screen because **the browser reloaded it after the tab's process died**: iOS kills a tab that uses too much memory and reloads it when the coach returns, and the page then deliberately resets a reloaded session (`page.tsx:4375-4410`) and a local `blob:` video cannot come back. A cheap confirmation: **after a kill Safari shows a notice "This webpage was reloaded because a problem occurred"** (and "A problem repeatedly occurred" on a second one). Ask Vin whether he saw it.

### 12.3 Is the tab being killed by memory? What is held at the end of the pass

At 720x1280: one frame is 3,686,400 bytes (**3.52 MiB**), one mask 921,600 bytes (**0.88 MiB**).

| What is held when the pass ends | 6 frames | 15 frames |
| --- | --- | --- |
| Draft frames after the atomic commit: `sourceFrame` + `aiSnapshot` + `working` + `readyMask` = 6.15 MiB each (all held at once on purpose, `hooks/useStroMotion.ts:578-587`) | 36.9 MiB | 92.3 MiB |
| Background plate + end plate | 7.0 MiB | 7.0 MiB |
| **Right after the commit, `refreshStroPreviewFromDraft` (`page.tsx:2021-2042`)** re-captures a **new background plate and a new source frame for every frame** (`hydrateDraftBitmapsForExport`, `lib/stroMotionDraft/exportDraft.ts:19-48`) through the capture video, draws the composite on a 3.5 MiB canvas and builds a PNG data URL. `closeBitmap` is **defined in that file (`:8`) and never called**, so these (N+1) bitmaps are not closed | +24.6 MiB (7 bitmaps) | +56.3 MiB (16 bitmaps) |
| Transient per ghost while compositing: `getImageData` 3.5 MiB (up to ~11 MiB if a mask has to be rescaled) | ~3.5-11 MiB | same |

So **the frames and masks are ~45-120 MiB**: small. They do not explain a kill by themselves. What is large is everything else resident during and after the pass:

- the **MediaPipe pose** model (foot-capable pass) and the person segmenter;
- **D-FINE** (ONNX wasm): the code releases it before SAM loads (log: "D-FINE disposed — ONNX session released before SAM loads"), which is a deliberate memory measure;
- **SAM-2** (when a racket box is found): wasm execution (no WebGPU on iOS 18.5), vision encoder 28.5 MB of weights, and an embedding cache of up to **420 MiB**, kept in a module-level cache after the pass so "Redo mask" is fast (`lib/stroMotionDraft/samRacket.ts:115-122`, `:280-304`);
- the **detector model from the open-time warm-up**: ~68 MB of weights loaded and **never used by Auto-detect**, which uses D-FINE. This is where the model-load finding is a **contributing, secondary** risk: dead weight resident during the heaviest phase;
- the page, canvases and the video decoder.

Measured on desktop (synthetic clip with no person or racket, so SAM-2 was **not** exercised): JavaScript heap 65 MB at open, 100 MB peak, 90 MB at the end; the pass took 45 s, including a 10.98 s foot-pose pass and a 5.7 s D-FINE load. That is the JS heap only, not WebAssembly or GPU memory, and on a clip with a real racket SAM-2 adds its encoder and embeddings. **A peak for an iPhone cannot be measured here**, and iOS does not publish its per-tab limit, so I will not quote one. What can be said: the models are the big term, frames are the small term, and the detector warm-up adds ~68 MB to the big one at the worst moment.

Consistent with a kill: the empty Upload screen, no reload code (12.2), the pass reaches its heaviest phase right after "frame 6/6", and the same device completes the cheap phase fine. **Still unproven.** The two device checks are the Safari notice above and the `JetsamEvent` log (11.8).

### 12.4 What autosave or restore exists for a session in progress

None that survives a reload: the only "auto-save" is the in-memory copy of the measurement column into the active snapshot (`page.tsx:3710`); a reload deliberately resets the session (`page.tsx:4336`, `:4375-4410`); the loaded clip is a `blob:` URL of a local file; sessions are saved only by an explicit Save to the player's profile. Nothing is written to localStorage, sessionStorage or IndexedDB for a session in progress, so nothing could be restored.

**Smallest protections that do not touch Auto-detect or the atomic commit** (each needs approval):

1. **Crash marker and notice (smallest).** Write a flag in localStorage just before the pass starts (`page.tsx` around the call at `:2938-2985`, outside the pass) and clear it when it ends. On the next load, if the flag is still there: "The last Auto-detect did not finish; this phone ran out of memory. Auto-detect's racket detection is switched off here; mark the racket by hand." and set the existing `autoRacket='0'` and `samRacket='0'` switches. It stops a crash loop and the surprise; it saves nothing.
2. **"Save your session first" nudge on phones** before Auto-detect starts, using the existing Save session dialog (needs a player). The coach keeps the annotations, snapshots and Motion Layer stills already produced.
3. **Light recovery file:** on `visibilitychange: hidden` (fires before iOS suspends a tab; there is no event at the moment of a kill) write a small JSON of the annotations, snapshots, measurement column and frame times to localStorage; after a reload and re-picking the file, offer "Restore your last session". It restores the work, not the video. A feature of its own.
4. **Bigger (not proposed now):** keep the video `File` and masks in IndexedDB for a full restore.

### 12.5 Updated ranked causes and tests

1. **Stored data on Vin's normal profile** (new first cause; the Private tab works). Within it, by how well the code supports each:
   - **(a) The service worker's Cache Storage** (12.1): unbounded, never trimmed since September, holds hundreds of MB of models, runtimes, chunks and opaque images; mechanisms 1-3 above.
   - **(b) The developer toggles in localStorage** (`stroSegmenter`, `autoRacket`, `samRacket`, `stroRacket`): a tester's origin may carry `stroSegmenter=multiclass`, which changes the open-time warm-up to the 16.4 MB multiclass model plus MediaPipe wasm.
   - **(c) Signed-in state** is still not separated (the Private tab was signed out).
2. **Auto-detect exhausting the tab's memory** (a separate problem; reproduces on the preview and the live site; most likely an iOS kill, 12.2-12.3).
3. **The model load on open: a secondary risk, not the cause.** Real (6 s on desktop, ~68 MB resident, unused by Auto-detect) and a contributor to the memory in 2, but it runs identically in the Private tab, which works.
4. **Sentry with the DSN:** effectively **ruled out** as the freeze cause (the DSN is on in the Private tab on the live site); it remains a small overhead.
5. Not a regression in Motion Layer's own code (section 9a).

**Smallest fixes to evaluate, in order** (none implemented): (i) service-worker version bump plus limits (option A in 12.1), automatically for everyone; (ii) a "Reset cached data" action and an escape-hatch page (option B); (iii) the crash marker (12.4 point 1); (iv) the earlier hygiene change of not warming the detector on open (section 10.3), now a memory saving rather than a freeze fix.

**Tests for Vin (no code), in this order**
1. **Safari > Settings > Safari > Advanced > Website Data**: send the size shown for anglemotion.com (hundreds of MB would point at (a)).
2. A **Private tab, signed in** (separates sign-in from stored data).
3. **Delete anglemotion.com's website data**, sign in again, repeat: if the freeze is gone, stored data is confirmed.
4. After a reload following Auto-detect, did Safari show **"This webpage was reloaded because a problem occurred"**?
5. Auto-detect on **3 frames** instead of 5.

**Not verified:** anything on a device; Safari's service-worker behaviour in Private windows; WebKit's Cache Storage accounting for opaque entries and its purge rules; production chunk sizes.
