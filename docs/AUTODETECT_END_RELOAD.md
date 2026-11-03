# Auto-detect ends, the page reloads, everything is lost (iPhone, Chrome)

Diagnosis only. No source, test or config changed. Branch `diag/autodetect-end-reload`, from main at `d5d13f8d` (includes #140, #141, #142).
Written 2026-11-03. Every code claim has `file:line` from main; every number is marked **measured** (desktop Chromium, this session) or **estimated**.

## 0. Answer

**Ranked causes**
1. **Most likely: the tab runs out of memory in the racket pass at the end of Auto-detect, and iOS kills it.** Measured on desktop with a 1080p clip: the racket pass (D-FINE then SAM-2, both ONNX Runtime wasm) adds about **+1.15 GB** to the renderer's peak memory (2.19 GB with it, 1.03 GB with `autoRacket=0`), and about +1 GB is still held after the pass ends (§3).
2. **Plausible, makes 1 worse: frames are held at native resolution.** `createImageBitmap(video)` has no downscale (`lib/stroMotionDraft/captureFrame.ts:184`); masks are full-frame (`proposeFrameMask.ts:415-418`). A 4K phone clip costs 4x a 1080p one (§3.1).
3. **Plausible, small: leaks.** 10 library-made square bitmaps (43 MiB at 1080p, 5 frames) are never closed, and nothing ever calls `clearRacketEncodings` or releases the SAM session (§2).
4. **Unlikely: a deliberate reload.** No code reloads the page at the end of Auto-detect, and #141's worker does not either (§4).
5. **Unlikely: the editor opening.** Measured +85 MB renderer, no new bitmaps (§2).

**Recommended fix (3 lines):** run the racket pass (D-FINE, then SAM-2) in a short-lived Web Worker that is terminated when Phase C ends, so the wasm heap is returned to the OS; racket detection and the segmenter stay on. Pair it with a crash marker plus a "save your session" nudge, so a kill is explained and the work is not lost silently (recovery, §6).
**Frozen files touched:** the worker option touches Auto-detect internals (`hooks/useStroMotion.ts`, `lib/stroMotionDraft/autoRacketPass.ts`, `racketDetect.ts`, `samRacket.ts`); the recovery option touches none of them (§6). Pose Worker, `public/sw.js` and the atomic commit logic are not touched by either.

**What is not proven:** that iOS killed the tab. No iPhone or device log was available. §3.3 gives what can be said about the iOS limit, and §7 gives the two checks that would settle it.

## 1. Method

- Code: read from main, cited by file and line.
- Measurement: production build of main (`next build`, `next start`), Playwright Chromium 1150x722, the repo's own demo clip (`public/Demodjokovic.mp4`, 1920x1080 H.264, 60 fps) cut to 8 s and transcoded to VP9 WebM, 5 frames (the panel default), **AI auto-detect pressed once**. Sampled every second: `performance.memory` (JS heap only), live `ImageBitmap`s (wrapped `createImageBitmap`/`close`), and RSS of the browser's processes from `ps` (renderer = the tab's process; GPU process separate).
- Two runs of the same clip: default settings (racket pass on) and `localStorage autoRacket=0, samRacket=0` (racket pass off) to isolate what the racket pass costs. Not a proposal to turn it off.
- **Limits:** desktop Chromium is not iOS: no jetsam, a different allocator, wasm threads and SIMD may differ, and Chromium's RSS counts shared pages differently from iOS's footprint. Use the numbers as *relative* evidence (what is big, what is released), not as an iPhone peak.

## 2. Trace: from the last mask to the editor

Entry: `handleStroAutoSelectAll` (`app/analysis/page.tsx:2877-3004`) calls `autoProcessStroFrames` which is `autoProcessFrames` (`hooks/useStroMotion.ts:588-1038`). Order of events and what each holds:

| # | Step | Code | Memory held | Released? |
|---|---|---|---|---|
| 1 | Median background plate | `useStroMotion.ts:575-576`, `backgroundPlate.ts:72` | one 640x360 bitmap per plate sample; the plate stays in the draft | plate kept; the 11 samples are closed (measured: 1 plate bitmap live at end) |
| 2 | Foot-pose pass: MediaPipe full pose (`pose_landmarker_full.task`, 9.4 MB) per frame | `useStroMotion.ts:700-770` | **one native-resolution `ImageBitmap` per frame, kept in `preCaptured` for the rest of the pass** (7.9 MiB each at 1080p, 31.6 MiB at 4K) | closed by the sweep at `:949-952` only if `proposeFrameMask` did not take them; the ones it takes become `sourceFrame` |
| 3 | Racket phase A: D-FINE on every frame, ONNX Runtime wasm (`public/ort`, `public/models/dfine-n`) | `useStroMotion.ts:810-870`; flag `autoRacketFlags.ts:25-54`; default object type `racket` (`useStroMotion.ts:157`), so **on by default** | the ORT wasm heap plus D-FINE weights | **yes, deliberately**: `disposeRacketDetector` (`racketDetect.ts:265`), log "D-FINE disposed". The wasm heap's high-water mark is not returned to the OS (see §3.2 note) |
| 4 | Mask pass: `proposeFrameMask` per frame with the person segmenter (MediaPipe selfie / multiclass) | `useStroMotion.ts:884-945`, `proposeFrameMask.ts:369-505` | per frame: `aiSnapshot` and `working` masks, **full-frame, one byte per pixel** (`embedRegionMask(vw, vh, …)` at `proposeFrameMask.ts:415-418`) plus a temporary letterboxed square canvas for the segmenter | masks kept (they are the result); square inputs: **10 unclosed bitmaps measured**, ~43 MiB at 1080p/5 frames (sizes 1010², 1058², 1080²: the segmenter's letterbox squares, created inside the library, never closed by the app) |
| 5 | Racket phase C: **SAM-2** on every frame with a detection | `useStroMotion.ts:960-995`, `samRacket.ts` | SAM-2 session (vision encoder 28.5 MB + decoder 4.6 MB, wasm) resident, plus **16.8 MB embedding per frame (measured)**, cached up to 420 MiB (`samRacket.ts:115-122`) | **No.** The session is never disposed after the pass (`sessionPromise` is only cleared in the WebGPU-downgrade path, `samRacket.ts:397`). `clearRacketEncodings` (`:279`) says "called when a draft is cleared" but its **only caller is the downgrade path** (`:395`); nothing in `app/`, `components/`, `hooks/` calls it |
| 6 | Atomic commit | `useStroMotion.ts:1019-1038` | one `setDraft`: each frame gets `sourceFrame`, `aiSnapshot`, `working`, and a **new `readyMask` clone** (`cloneAlphaMask(b.working)`, `:1032`) so 3 full-frame masks + 1 bitmap per frame; old `f.sourceFrame` is closed (`:1028`) | the previous frame bitmaps are closed; the clones are transient peak +1 mask per frame while the updater runs |
| 7 | After the commit | `page.tsx:2980` `void refreshStroPreviewFromDraft()` | **nothing**: it runs with the draft from when the button was pressed (the callback closes over `stroMotionDraft`, `page.tsx:2021-2042`), sees frames that are not export-ready, and returns early. Measured: **0 new bitmaps in the 25 s after the commit** | n/a. **This corrects `docs/MOTION_LAYER_FREEZE.md` §12.3**, which said the refresh re-captures every frame at the end (that file is on branch `docs/motion-layer-freeze`, not on main) |
| 8 | Editor opens only when the coach taps a frame (`page.tsx:2173`, `handleStroSelectFrame`) | `components/stroMotion/FrameMaskEditor.tsx` | measured: **+85 MB renderer, +35 MB GPU, 0 new bitmaps** | closes with the editor |

**Held at the end of the pass, 5 frames, 1080p (measured):** 18 live bitmaps = 99 MiB: 7 full-frame (5 draft `sourceFrame`s, background and end plates), 1 median plate, 10 square library leftovers. JS heap peaked at 190 MB (it is the small term).

## 3. Memory estimate

### 3.1 Frames and masks (estimated from code, checked against the measured live bitmaps)

Per frame at commit: bitmap `4·W·H` + three masks `3·W·H` (`aiSnapshot`, `working`, `readyMask`).

| Clip | One frame | 5 frames | 6 frames | 15 frames |
|---|---|---|---|---|
| 720x1280 | 6.15 MiB | 31 MiB | 37 MiB | 92 MiB |
| 1080p | 13.9 MiB | 69 MiB | 83 MiB | 208 MiB |
| 4K (3840x2160) | 55.3 MiB | 277 MiB | 332 MiB | 830 MiB |

Plus the plates, the ~43 MiB of unclosed square bitmaps (1080p; scales with resolution) and the SAM embeddings: **16.8 MB per frame measured** = 84 MB for 5, 252 MB for 15 (cap 420 MiB).
Frames are small next to the models for a phone clip at 1080p, but **a 4K clip makes them a real term** (330 MiB for 6 frames, before the unclosed bitmaps and embeddings). iPhones record 4K by default in some modes, so ask what Vin's clip is (§7).

### 3.2 What is resident (measured, desktop, 1080p, 5 frames, renderer process = the tab)

| | Racket pass on (default) | Racket pass off (`autoRacket=0`) |
|---|---|---|
| Renderer at start, Motion Layer open | 602 MB | 525 MB |
| **Renderer peak during the pass** | **2186-2291 MB** (two runs) | 1034 MB |
| Renderer after the pass, editor closed | 1958-1960 MB | 991 MB |
| Renderer with the editor open | 2045 MB | n/a |
| GPU process | 793-832 MB | 791-795 MB |
| Pass duration | **120 s** (SAM-2 encode 12-15 s per frame on a desktop CPU) | 34 s |

So the racket pass costs about **+1.15 GB at peak** and **+0.97 GB still held afterwards**. After the pass the number barely falls because the models stay resident (step 5) and, inference, WebAssembly memory only grows: the heap that D-FINE and SAM-2 needed is not handed back to the OS even after their sessions are released.
Also resident from before the pass: the page, MediaPipe pose, the person segmenter, the 68 MB COCO-SSD detector warmed when Motion Layer opens (`page.tsx:3415`, `racketCocoDetect`; unused by Auto-detect, which uses D-FINE), the capture mirror `<video>` and the decoder.

### 3.3 The iOS limit (unverified)

iOS does not publish a per-tab limit. A web search found only second-hand statements: WebKit developers say the limit is not a fixed number and depends on device RAM and load; a 2026 Apple developer forum report describes a WebContent process killed by jetsam at an "ActiveHard 2048 MB" limit on a 12 GB iPhone; a 2026 WebKit bug confirms a page crash-and-reload is a jetsam kill ([forum thread](https://developer.apple.com/forums/thread/823061), [WebKit bug](https://bugs.webkit.org/show_bug.cgi?id=312727), [forum thread](https://developer.apple.com/forums/thread/678318); returned by a search, not opened here). **Treat a ~2 GB tab ceiling as a plausible order of magnitude, not a fact.** The measured desktop peak (2.2 GB renderer) is already at that level before iOS's own overhead, and an iPhone adds the wasm threads/SIMD differences and the 4K case.

## 4. Can anything reload the page other than an OS kill?

Searched `app/`, `components/`, `hooks/`, `lib/`, `public/sw.js`, `middleware.ts`, `instrumentation*`.

| Mechanism | Found | Fires at the end of Auto-detect? |
|---|---|---|
| `location.reload()` | only `app/analysis/error.tsx:70`, the button of the error screen | No: needs a click, and that screen reads "Something went wrong" |
| `location.href = …`, `router.refresh/replace/push` | billing and pricing buttons, sign-out (`WorkspaceChrome.tsx:41`), player/save navigation | No: all tied to clicks on other screens |
| Service worker | `public/sw.js` only `skipWaiting` and `clients.claim`; **no `controllerchange` listener anywhere**. #141 did not add one | No. A new worker taking over does not reload the page |
| Error boundary reset | only `app/analysis/error.tsx` (shows a message, waits). There is no `app/error.tsx` or `app/global-error.tsx` | No |
| Next.js recovery | hard navigations only on navigation or history events | No |
| The page's own reset | `page.tsx:4377-4402`: on a page load whose navigation type is `reload`, `resetSession()` runs, but only if no video is loaded yet (`:4388`) | It is what *wipes the session after* a reload; it does not cause one |

**Conclusion: no code path causes this reload.** What remains is the browser reloading a tab whose content process was terminated. Chrome on iOS is WKWebView: on content-process termination it reloads the tab (stated from general knowledge of WKWebView, **not verified here**), which matches a quick reload right after "loading finishes". A confirmation on the phone: Safari shows "This webpage was reloaded because a problem occurred"; Chrome shows no notice.

## 5. What is saved before the heavy phase, and what a reload loses

Nothing is written. The only `localStorage`/`sessionStorage` writes on the analysis page are UI preferences and the reload latch (`page.tsx:241, 3856, 3895, 9555`); there is no IndexedDB use; `beforeunload` (`page.tsx:3677-3681`) only disposes ffmpeg and the pose worker. The "autosave" at `page.tsx:3710-3712` copies the data column into the active snapshot **in memory**.
A reload therefore loses: the loaded clip (a `blob:` URL of a local file the browser cannot reopen), the skeleton and snapshots, the drawings and data column, the Motion Layer draft and every mask. Only an explicit **Save** to a player's session (`components/sessions/SaveSessionModal.tsx`) persists anything. The 2-minute-plus phone pass (it is 120 s on a desktop CPU) is the least protected part of the product.

## 6. Smallest fixes for the top cause (proposals, none implemented)

**Mitigation, keeps the racket detector and segmenter on: run the racket pass in a worker that is terminated afterwards.**
- Run D-FINE (phase A) and SAM-2 (phase C) inside one dedicated Web Worker; when phase C finishes, `terminate()` it. A terminated worker's wasm heap is returned to the OS, which is the only way to give back wasm memory. Peak is then the worker's, and the tab keeps only the small result masks. Embeddings stay in the worker only if "Redo mask" is allowed to re-encode (~12 s per frame on desktop) after it ends; otherwise decode all boxes before terminating.
- Cheaper partial step inside the same code: call `clearRacketEncodings()` and release the SAM session at the end of phase C (about 85 MB of embeddings, and the session weights). It lowers the *resting* memory but not the peak, so it may not prevent the kill.
- Also cheap, no behaviour change: close the 10 library-made square bitmaps, and on phones cap the stored full-frame bitmaps (downscale masks to the 420 px the motion-diff already uses), which matters most for 4K clips.
- **Frozen impact:** the worker option changes the Auto-detect pipeline: `hooks/useStroMotion.ts` (phase A/C wiring), `lib/stroMotionDraft/autoRacketPass.ts`, `racketDetect.ts`, `samRacket.ts` (plus a new worker file and a `public/ort` path check). The atomic commit block (`useStroMotion.ts:1017-1038`) and the Pose Worker are not touched; `public/sw.js` is not touched. The small partial step touches `samRacket.ts` and one call in the Auto-detect `finally` (`page.tsx:2998-3003`), also inside the frozen area, so each needs approval.

**Recovery, touches no frozen file: tell the coach and protect their work.**
1. A crash marker in `localStorage` written when the panel's Auto-detect button is pressed (`components/StroMotionPanel.tsx:418`) and cleared when `lastAutoRun` is set; on the next load, if it is still there, show "The last Auto-detect did not finish; this phone ran out of memory" and offer to run without the racket pass **this time** (the coach opts in; the default stays on). Saves nothing, stops the repeat, explains the reload.
2. Before Auto-detect on a phone, nudge "Save your session first" using the existing Save dialog (needs a player), so annotations and snapshots survive.
3. A light recovery file on `visibilitychange: hidden` (annotations, snapshots, column, frame times as small JSON) plus "Restore your last session" after the coach picks the same file again. A feature of its own; the video itself cannot be restored.
Pages touched: `components/StroMotionPanel.tsx`, `app/analysis/page.tsx` outside `handleStroAutoSelectAll`, and a new small module. None of the frozen files.

## 7. What would settle it, and what to ask Vin

1. The resolution and length of Vin's clip (Info in Photos, or Settings → Camera → Record Video): if it is 4K the frame term in §3.1 is large.
2. Whether Safari shows "This webpage was reloaded because a problem occurred" when the same clip is run in Safari (Chrome shows none).
3. A device log: Settings → Privacy & Security → Analytics Data → `JetsamEvent` entries for the WebContent process at that minute. This is the only proof.
4. Run Auto-detect once with `localStorage autoRacket=0` (a test, not a fix): if the tab survives, cause 1 is confirmed.
