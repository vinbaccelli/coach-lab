# Page refreshes when the toolbar arrow is tapped after Auto-detect (phone)

Branch `fix/phone-refresh-after-autodetect`, from `fix/post-autodetect-freeze` (#147). Phones only (the existing phone check); off a phone nothing here is reached.

## 1. What the tap does (code), and is there a reload path?
Tap trail, with file:line on this branch's base:
1. `components/ToolPalette.tsx:810-814` — the arrow commits on pointer-up and calls `onToggleToolbarLabels`.
2. `app/analysis/page.tsx:7227` (`setToolbarLabelsExpanded`) → `toolbarWidthPx` (`:3908`, 60 → 196 px).
3. `app/analysis/page.tsx:7415` — the rail `<aside>` is a flex child with `transition: 'width 200ms ease'`: the canvas container shrinks a little on **every frame** of those 200 ms.
4. `app/analysis/page.tsx:3710` — a `ResizeObserver` on the container → `updateSize` (`:3683`) → `setCanvasSize` each time.
5. `components/Canvas.tsx:5436-5443` — each new size assigns `canvas.width/height` (clears and re-allocates the backing store) and marks the canvas dirty.
6. `components/Canvas.tsx:5834` — with Motion Layers shown (`page.tsx:7240-7247`), the dirty render runs the original one-pass `renderStroMotionDraftComposite`: one `drawImage` + full-frame `getImageData` + per-pixel loop + `putImageData` per layer, at native size. #147's progressive path declines a changed canvas size and hands back to this call.

**Reload paths: none in code.** `grep` for `location.reload|location.href =|location.replace|location.assign|controllerchange|skipWaiting|clients.claim|.reload(` across `app components hooks lib public/sw.js`: the only reload is the button in `app/analysis/error.tsx:70` (a user tap on the "Something went wrong" screen, never automatic). `public/sw.js:209,215` call `skipWaiting`/`clients.claim`, which do not navigate pages, and nothing listens for `controllerchange` (`app/ServiceWorkerRegistration.tsx:40` only registers). `public/sw.js` has no `client.navigate`. An error boundary shows a screen; it does not restart the page.

So the restart is not code asking for it. The code **does** cause a burst of large allocations on that tap, which is the usual way iOS ends a tab ("killed by the phone", then Chrome loads the page again). That is an inference: it is not proven on an iPhone, which is what the breadcrumb below is for.

## 2. Measured (desktop Chromium, iPhone 13 emulation so the phone gate is on, demo clip 1920×1080, 2 frames, 4× CPU throttle on the tap)
Auto-detect finished, 12 s settled, then the arrow tapped three times (collapse, expand, collapse), real touch taps.

| | before (#147) tap 1 / 2 / 3 | after tap 1 / 2 / 3 |
|---|---|---|
| composites run per tap (`getImageData` calls ÷ layers) | 5 / 3 / 5 | 0 / 0 / 0 |
| `getImageData` bytes | 79 / 47 / 79 MiB | 0 |
| canvases created | 5 / 3 / 5 | 0 |
| canvas backing-store resizes | 16 / 10 / 14 | 0 |
| longest main-thread block | 2033 / 821 / 1556 ms | 166 / 64 / 96 ms |
| renderer RSS peak over the tap | +171 / +104 / +99 MB | +5 / +9 / +7 MB |

The one 166 ms block (first tap, throttled 4×) is the rail re-rendering its labels; no allocation is involved. On a real phone with a 4K clip the "before" cost scales with native pixels (a 4K layer readback is 33 MiB), which is why the same tap is much worse there.

## 3. Fix (smallest change)
`app/analysis/page.tsx`, phone only (`railOverlay = phoneGate && compactToolbarRail`): the rail keeps a **fixed footprint in the layout** (60 px, no transition) and its content is an absolutely positioned panel whose width goes 60 → 196 px **over** the video. The canvas container never changes size, so there is no resize and no re-composite. Off a phone the rail is exactly as before (tested). Judgment call to flag: the labels now open over the left edge of the video on phones instead of pushing it, and this edits the rail `<aside>` in `page.tsx`, which the prompt's allowed list did not name explicitly (it lists the toolbar component and the page only for the notice and breadcrumb). `Canvas.tsx` is untouched.

## 4. Restart breadcrumb
`lib/restartBreadcrumb.ts`, installed in `app/analysis/page.tsx` on phones only. One record in `sessionStorage` (`anglemotion:page-trail`: `running | hidden | leaving`, timestamp, last error). Written on load, `visibilitychange`, `pagehide`/`pageshow`, `error`, `unhandledrejection`. On the next load, with the navigation type of that load:

| previous record | this load | line shown |
|---|---|---|
| leaving (pagehide seen) | navigate / back_forward | none |
| leaving | reload | "…Reason: a reload (the page was refreshed or reloaded itself)." |
| running (no pagehide) | any | "…Reason: killed by the phone (the page ended without warning, usually its memory)." |
| hidden (no pagehide) | any | "…killed by the phone while it was in the background." |
| error/rejection ≤ 30 s before the end | reload or no pagehide | "…Reason: a script error (message)." |

One dismissible line at the top ("The page restarted. Reason: …"); nothing is blocked. `pagehide` can arrive before the `visibilitychange` that follows it (seen on a Chromium reload): once leaving, a later hidden does not undo it (tested). Checked in the browser: first load none; reload → "a reload"; normal navigation → none; script error then reload → "a script error (…)"; a record left "running" and loaded in a new tab → "killed by the phone"; dismiss works.

## 5. Crash notice wording
Now: "Auto-detect was stopped by your phone's memory. Close other tabs and apps, then run it again." (`lib/stroMotionDraft/phoneBudget.ts`). No clip-length advice.

## 6. Proposal (not built): keep the Auto-detect result across a restart
Save masks and layers to IndexedDB right after the commit, so a restart restores them instead of losing everything.
- **What is stored** per frame: index, time, selection box, status, `aiSnapshot` and `working` masks (1 byte/pixel; run-length or deflate them, a 1080p mask is ~2 MB raw and a few KB compressed), and the source picture as a JPEG/PNG blob (~0.3–1 MB at 1080p, more at 4K). Plus draft header (object type, background plate blob, video size) and an identity for the video (name, size, lastModified) because the blob URL dies with the page.
- **Files**: new `lib/stroMotionDraft/persistDraft.ts` (IndexedDB store, serialise/deserialise, delete); `hooks/useStroMotion.ts` (one fire-and-forget write after the existing commit, one `restoreDraft`, delete on clear; the atomic commit itself is not touched); `lib/stroMotionDraft/clearDraft.ts` (delete on clear); `lib/stroMotionDraft/types.ts` (a serialisable shape); `app/analysis/page.tsx` (on load: if a saved draft matches the re-selected video, offer "Restore Auto-detect result?"); tests.
- **Costs and risks**: encoding five frames to blobs is ~100–300 ms each at 1× on the main thread (sliced and yielded like #147); the write must not race the memory pressure it is meant to survive; a private tab's IndexedDB is ephemeral and may be small; the video file itself is not kept (the coach re-selects it, or it is stored too, tens of MB).
- Needs your approval before anything is built.

## 7. Second phone test, and what was added (PROMPT 30)
Phone report, same PR: first try, the AI auto-detect button did not respond for a while but the video still played, and it finished; second try, the frames were detected ("loaded and detected the frames"), then the page restarted before it finished, and the line said "killed by the phone". No Auto-detect notice showed.

What that tells us (from code, not yet from the phone):
- It is the phone ending the page, and it happened **after the per-frame detection pass and before the end**, so inside the mask / racket phases where the renderer grows the most (desktop timeline, phone gate on, 8 frames of 1080p: renderer 690 MB after the detection pass, 1.05 GB with the racket detector loaded, 1.9 to 2.0 GB through the SAM-2 frames, 2.09 GB at the first draw; GPU 0.7 GB). The 1280 px cap and the releases from #145 do not touch the SAM-2 wasm heap, which is the largest term. This build does not reduce it. **I have not found a safe lever for that heap and did not change it**; the stage trail below is what will say whether this is where the phone dies.
- The Auto-detect notice did not show because the marker lived only in `localStorage`, and a Private tab on iOS may not keep `localStorage` across the reload that follows a kill, while the breadcrumb in `sessionStorage` did survive. Also, the marker started only when the mask pass began, after the detection pass.
- The first-try freeze is the cold-click compile block from `docs/MOTION_LAYER_COLD_CLICK.md`.

Changes (all phone only):
1. **Stage trail.** `recordStage()` (`lib/restartBreadcrumb.ts`) writes the last step to the same sessionStorage record, and the restart line ends with "Last step: …". Steps: Motion Layer opened / loading the racket-tool detector; object detection or pose pass frame n/N; foot pose; racket detector; removing background frame n/N; racket segmentation frame n; releasing models and finalize; committing frames; opening the editor; editor open. Measured on desktop: the trail advanced through every step and the marker was set from the click until the first layers were drawn.
2. **Marker from the click, in both stores.** `markAutoDetectStarted()` now runs when the button is pressed (so the detection pass is covered), and the marker is written to `sessionStorage` and `localStorage`; either one set shows the notice. Every path that does not reach the pass clears it.
3. **Cold-click.** On phones the COCO-SSD warm-up (racket tool, object detection) starts 1.5 s after the segmenter warm-up and never while Auto-detect is running, and "Preparing Motion Layer…" is on screen from the first frame until it is ready (option b, and the sequencing half of option a). Measured: the text appears at once and clears when the detector is ready.
   **Not done:** the asynchronous shader compile (`ENGINE_COMPILE_ONLY`) or a worker. It means replacing `cocoSsd.load` with our own loader in `lib/racketCocoDetect.ts`, would affect the racket tool and object detection (Auto-detect's object mode uses it), and is unverified on iOS. It needs its own spike and your approval.
4. **Memory in the detection pass.** Measured above: the detection pass grows the renderer by about 130 MB over eight frames and the GPU process stays flat, so it was not capped.

## 8. Quick fix for now: racket pass off on phones
Four restarts on the phone (last steps: racket segmentation frame 1, finalize twice, first layers drawn) all came after the racket model (SAM-2) loads. With Object set to player (racket pass off) Auto-detect finished on the preview and on the production site. So on phones `autoRacketEnabled` (`lib/stroMotionDraft/autoRacketFlags.ts`) now returns false unless explicitly switched on: `localStorage 'autoRacket' = '1'` or `window.__autoRacket = true`. Desktop is unchanged (tested). Effect: on a phone, Auto-detect cuts out the person only; the racket is not segmented automatically. This reverses the earlier "do not turn the racket detector off" for phones by the owner's decision. Proper work from Saturday: run the racket models where their memory can be given back (a worker that is terminated after the pass), or a lighter model, then switch the default back on. No visible switch was added in this quick fix. Also reported and not investigated: with Object = player the video file was unplayable and the object selector did not work in one run.

## Lessons learned / known issues
- Symptom: page restarts when a toolbar arrow is tapped. Root cause: a layout-driven canvas resize, repeated every frame of a CSS width transition, each re-running the heaviest draw at native size. Class of mistake: letting a purely cosmetic layout change flow into a backing-store resize and an uncached full re-composite.
- Known, not fixed: any other event that resizes the canvas after Auto-detect on a phone (rotation, the address bar collapsing, the keyboard) still runs the one-pass composite per resize. A resize-debounce or a cached composite in `Canvas.tsx` would cover those; it was outside this change.
- Not run on a real iPhone.

## Tests
`tests/phoneStages.test.ts` (7): stage in the restart line, stage no-op off a phone, editor events as stages, clean exit stays silent, the marker kept in either store, blocked stores, and source checks of the wiring. `tests/restartBreadcrumb.test.ts` (17): normal load, normal exit, background/foreground, reload, unclean exit (visible and background), bfcache pagehide, script error and rejection, old error not blamed, error then reload, pagehide-then-hidden, blocked/corrupt storage, dispose, the new notice wording, and source checks that the overlay and breadcrumb are phone-gated and the off-phone rail is unchanged. No existing test changed. `npm test` 468/468, `tsc` 0 errors, `next build` clean.
