# Motion Layer M1: repeated bitmap captures and leaks during Generate

Stage 2, step M1 (docs/V1_FREEZE.md on the skeleton stack; roadmap order M1, M4, M2, M3, M5, then M6/M7 investigations).

## Cause (read in code)
`hydrateDraftBitmapsForExport` (`lib/stroMotionDraft/exportDraft.ts`) re-captured the background plate and EVERY frame on every call and deliberately never closed the replaced bitmaps. It ran: once on editor close (`refreshStroPreviewFromDraft` → `exportStroMotionDraftPng`), and three times per Generate (`handleStroGenerate` → `hydrateStroDraftForExport`, again inside `exportStroMotionDraftPng`, again in `buildStroVideoPreview`). The two `setDraft` callers orphaned the old bitmaps; the copy inside `exportStroMotionDraftPng` was never closed at all; an end-plate captured per export was never closed either.

## Change
- `hydrateDraftBitmaps(video, draft, capture?)`: a bitmap is reused when it is alive and exactly the video's size (a closed ImageBitmap reports 0×0, so the original "closed bitmaps must not break Generate" safety is kept; phone-capped bitmaps of another size are still re-captured at native size). Nothing to re-capture returns the SAME draft object. `hydrateDraftBitmapsForExport` keeps its signature.
- `hydrateDraftForExport` (hook) skips `setDraft` when the draft is unchanged (no state update, no re-composite).
- `exportStroMotionDraftPng` closes the bitmaps it created itself and the end plate, and releases its scratch canvas.
- Replaced alive-but-wrong-size bitmaps are still not closed (the Canvas render loop may hold them via `stroMotionDraftRef`).
- Not changed: the Generate pipeline structure, composite code, Auto Detect, the manual workflow, the video export path.

## Measured (DESKTOP ONLY: headless Chromium, software GL, VP9 1080p `demo_1080.webm`, 5 frames, racket off, one run each, same script `mlexport.js`; NOT an iPhone)
| | before | after |
|---|---|---|
| Editor close: bitmaps made / live | +6 / 99 → 147 MiB | +0 / 99 → 99 MiB |
| Generate: bitmaps made | +27 | +18 (17 closed again) |
| Generate: live bitmaps | 147 → 289 MiB (+142) | 99 → 107 MiB (+8) |
| Generate: time to the PNG preview | 4036 ms | 1200 ms |
| Generate: renderer memory (RSS) | 1597 → 2153 MB (+556) | 1616 → 2015 MB (+399) |
| Generate: getImageData calls | +43 | +45 (unchanged, M2) |
| Longest main-thread blocks (ms) | 370, 214, 164, 156 | **623**, 76, 68, 63 |

Reading: the leak is gone (no live-bitmap growth on editor close, +8 MiB instead of +142 MiB per Generate) and Generate is faster because it no longer re-captures three times. **One regression to know about:** the single longest block rose from 370 to 623 ms; the same synchronous composite work now runs back to back because the capture waits that used to interleave it are gone. Renderer RSS still grows by about 400 MB per Generate (transient allocations, not returned by the browser); that is M2/M3 territory (composite cache, readbacks). The remaining 18 bitmaps per Generate are the video export's per-frame captures, closed afterwards.

## Not tested
Real iPhone (all numbers above are desktop), 4K, more than 5 frames, repeated Generate, the interrupted-Generate case, racket pass on.

## Tests
`tests/hydrateDraft.test.ts` (6): reuse of live native bitmaps (same draft object, no capture), re-capture of a closed frame / missing frame / closed plate, re-capture of a wrong-size bitmap, a failed capture keeps the old frame, a 0×0 video returns the draft untouched. `tsc` 0 errors; `npm test` 474 pass / 0 fail.
