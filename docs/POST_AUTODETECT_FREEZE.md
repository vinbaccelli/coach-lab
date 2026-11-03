# Page freezes after Auto-detect finishes (phone, #145) — diagnosis

Diagnosis only. No source, test or config changed (branch `diag/post-autodetect-freeze`, from `fix/autodetect-phone-memory` at `2f9c934`). Measured on desktop Chromium (not WebKit, not an iPhone), phone gate forced on (`window.__stroPhoneBudget = true`), **4× CPU throttle** from the start of Phase C, software GL. Main-thread blocks = gaps in a 4 ms timer (>50 ms), cross-checked with `longtask` entries and a CPU profile. Clips: 1920×1080 (5 frames, racket + segmenter on) and the same clip scaled to 3840×2160 (VP9; real phone footage will differ in content, not in pixel counts).

## 1. Trace: last racket mask done → editor responsive

Line refs are on `2f9c934`. "Block" = longest uninterrupted main-thread run at 1080p / 4K, both at 4×.

| # | Step | Where | Sync/async | Yield after | Work per frame | Block 1080 / 4K |
|---|---|---|---|---|---|---|
| 1 | SAM embedding drop + loop yield | `hooks/useStroMotion.ts:1039-1045` | async | `requestAnimationFrame` | dispose one 16.8 MB tensor | – |
| 2 | `releaseSamRacket` (cache clear, `model.dispose`) | `samRacket.ts:293-303` | async (wasm free on main) | `stageYield` 60 ms | once | 68 / 115 ms |
| 3 | `finalizeBuiltAtNativeSize` (#145) | `phoneFinalize.ts:22-55` called `useStroMotion.ts:1056-1059` | async per frame, JS sync inside | none between the upscale and the next capture | native `captureVideoFrameAtTime` (seek mirror, `createImageBitmap` 35–50 ms @1080, ~150 ms @4K), then `upscaleAlphaMask` ×2 (`aiSnapshot`, `working`; two distinct objects) bilinear in JS | **485–671 ms** ×5 / **1.7–2.3 s** ×5 |
| 4 | Commit `setDraft` + `cloneAlphaMask` per frame (unchanged atomic commit) | `useStroMotion.ts:1063-1085` | sync inside React updater | none | one clone of `working` per frame | included in 5 |
| 5 | Return → `setStatus('configuring')`, `setLastAutoRun`; page `refreshStroPreviewFromDraft` | `useStroMotion.ts:1086-1098`, `page.tsx:2022,2981` | async | – | stale-closure early return (`allReady` false), no PNG export seen in the profile | – |
| 6 | **First render of the new layers**: `stroDraftPreviewActive` turns true (`page.tsx:7240-7247`), Canvas rAF loop calls `renderStroMotionDraftComposite` (`Canvas.tsx:5834`) | main thread | sync, one rAF | none | per layer: `drawImage` + full-frame `getImageData` + JS alpha loop + `putImageData` + filtered draw (`compositeFromDraft.ts:62-85`), all layers in one call, no cache | **2594 ms / 8548 ms** |
| 7 | Coach taps a frame → editor (`setStroEditingFrameIndex`, `page.tsx:2173`) | main thread | sync React + canvases | – | FrameMaskEditor mount, Canvas rAF `drawImage` of the video | 199 and 280 ms / 3.2 s (+ ~75 ms blocks every 75 ms for the next ~10 s at 4K) |

Everything runs on the main thread. No worker is involved after Phase C (the pose worker is idle; ORT wasm runs on the main thread in this build).

## 2. Measured (4×, phone gate on)

1080p: last racket mask at 0 ms → `auto-detect committed` at +4.35 s → first-layer block (+4.55 s, 2.59 s) → idle. The page is unresponsive for about **7 s**, of which ~5.3 s is in blocks ≥485 ms. 4K: re-captures 5 × 1.7–2.3 s (≈ 9.2 s), commit at +14.3 s, first-layer block 8.5–9.5 s, editor tap 3.2 s. Cross-check run with the gate **off** (desktop path, 1080p, 4×): first-layer block 2444 ms — same as gate on (2594 ms), so step 6 is not caused by #145.

CPU profile (1080p): step 3 is 439 of ~600 ms in `upscaleAlphaMask`, `createImageBitmap` ~18–34 ms; step 6 is `getImageData` 1321 ms + `restore` 410 ms (GPU readback, software GL here) + 153 ms of per-pixel JS. At 4K the first-layer block shows mostly as idle/native time (blocked on readback), so its absolute value on an iPhone GPU is unknown.

Measurement artefact to avoid: starting the CPU profiler at the last racket frame itself caused a fake 2.1 s block at +38 ms; the numbers above come from runs without a profiler at that moment, profiles from later starts.

## 3. Is SAM reload / editor first draw / thumbnails in the window?
- SAM-2 reload: **no**. No `/models`, `/ort` or `.wasm` request after the commit in any run. It only loads when the Racket tool is selected (`FrameMaskEditor.tsx:511-526`).
- Editor first draw: **not until the coach taps a frame** (`page.tsx:2173`); then step 7 (small at 1080p, 3.2 s at 4K).
- Layer thumbnails: **none exist**; `stroFrameRows` is metadata only (`page.tsx:2084-2095`). The strip and timeline markers are cheap.
- The *first render of the new layers* (step 6) **is** in the window and is the longest block.

## 4. Ranked causes
1. **First composite render of N native-size layers in one rAF** (`Canvas.tsx:5834` → `compositeFromDraft.ts renderMaskedFrame`): 2.6 s at 1080p, 8.5–9.5 s at 4K, GPU readback per layer, no cache, no yield. Present with the gate off too. #145 makes it the *final* frame size on phones by design, so the 1280 cap gives no relief here.
2. **#145 native re-capture** (`phoneFinalize.ts`): five blocks of ~0.5 s (1080p) or ~2 s (4K); 80% of each is the JS bilinear upscale of two masks, not the capture. Confirms your suspicion as the *first* stall the coach sees (no progress text changes during it), but not as the largest.
3. **Editor first open at 4K** (Canvas rAF `drawImage` of a 4K frame plus the mask surface): 3.2 s block, ~75 ms blocks sustained for ~10 s. Small at 1080p.
4. Not causes: SAM-2 release (68 ms), SAM reload, thumbnails, `refreshStroPreviewFromDraft`.

Memory (not measured here): at 4K the re-capture creates 5 × 33 MiB bitmaps plus 3 × 8.3 MiB masks per frame right after the heavy models were released; a tab that is near its limit can be stalled or killed here with no crash notice if the OS reload happens before the marker is read (marker is cleared in `finally`, `useStroMotion.ts:1114-1120`, so a kill *after* the commit leaves no notice — consistent with the report).

## 5. Options

**(a) Yield / batch so no block exceeds 100 ms.**
- a1 (`phoneBudget.ts upscaleAlphaMask`, `phoneFinalize.ts`): process 32–64 rows per slice and `await` a macrotask between slices and between the capture and the upscale. 1080p ≈ 440 ms/frame at 4× → ~10 slices of ~45 ms. Total time slightly longer, UI stays responsive. Fixes cause 2.
- a2 (cause 1): to get under 100 ms per slice the composite must stop doing a sync full-frame readback per layer: either build each masked layer once, one layer per tick (still ~500 ms/layer at 1080p/4× unless rows are chunked), or draw it at the capped size on phones. That edits `compositeFromDraft.ts` / `Canvas.tsx` (the render path). It cannot be reached by yielding alone.

**(b) A visible "Opening editor…" state at once.** In `onProgress`/`setProcessingStatus` (`page.tsx:2872` and `page.tsx:2978`, text only) set the text before step 3 and wait two animation frames so it paints before the first block, and keep it until the first composite has painted (`canvasRef.current?.waitForRender`, already used at `page.tsx:2203`). Does not shorten any block; the page is still frozen, but the coach sees why.

**Frozen-file impact**
| Option | Pose Worker | `public/sw.js` | atomic batch commit | Foot Line | StroMotion architecture | other hot files |
|---|---|---|---|---|---|---|
| a1 | no | no | no (runs before `setDraft`, commit untouched) | no | no | `phoneFinalize.ts`, `phoneBudget.ts` (#145 files) |
| a2 | no | no | no | no | **yes — composite renderer / Canvas draw path** (needs approval) | `Canvas.tsx` or `compositeFromDraft.ts` |
| b | no | no | no | no | no | `app/analysis/page.tsx` (status text), `useStroMotion.ts` progress callback |

## 6. Recommendation
Do (b) + (a1) now: a status text painted before the finalize loop and kept until the first layers draw, and a sliced upscale so the finalize phase never blocks >100 ms. Leave cause 1 for a separate approved change: it is the longest block, exists without #145, and needs a composite/Canvas change (a2) that the freeze list makes the architect's call.

## Limits
Desktop Chromium, software GL, CPU throttle that does not scale GPU-process work, 4K clip upscaled from 1080p, 1× not measured, not run on an iPhone. The absolute values on a device will differ; the ranking (composite > finalize > editor) and the per-frame structure should hold. Native-size memory at 4K was reasoned from sizes, not measured in this diagnosis.
