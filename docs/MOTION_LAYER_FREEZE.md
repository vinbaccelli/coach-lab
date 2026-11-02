# Motion Layer freezes the page on iPhone: investigation (P16)

Status: **investigation only. No code changed.** Nothing in Supabase, Vercel or Drive was touched.
Written from `main` at `9db01dd9`. Every code claim carries a `file:line` from a file read for this
document. "Measured" means I measured it in this sandbox (desktop Chromium, 390×844 touch viewport,
no GPU, `next dev`), **not** on an iPhone.

Update 2026-11-02: Vin also tested the app's own demo video on the same iPhone and it freezes the same way, so the clip's length and size are **not** the trigger; section 9 answers the follow-up questions.

Report (Vin): iPhone 14 Pro, iOS 18.5, Chrome for iOS (CriOS 156), anglemotion.com, a 15 s 720×1280
local file (`src=blob`). The page freezes the moment Motion Layer is tapped, every time, also when
the video is already playing (`readyState=4`). Reloading afterwards is extremely slow. `?vdebug=1`
logs no error; before the first tap it shows the known first-frame fallback (`readyState=1`,
`play()` rejected with `NotAllowedError`).

## 0. Answer in five lines

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
