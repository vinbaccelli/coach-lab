# Auto-detect on phones — memory budget

Evidence: iPhone Chrome shows "Can't open this page" (the OS killed the tab) while Auto-detect removes the background, racket pass on or off. Every change below is behind `isPhoneBudgetActive()` (`lib/stroMotionDraft/phoneBudget.ts`); on desktop no caller takes a different path.

Gate: `window.__stroPhoneBudget` (true/false) > `localStorage stroPhoneBudget` ('1'/'0') > iPhone/iPod UA > Android+Mobile UA > coarse pointer + touch + short side ≤ 500 px. iPads and desktops are not phones.

## What changes on a phone
1. **Cap**: frames/masks used by the pass are drawn at ≤ **1280 px long edge** (`PHONE_MAX_EDGE`). 1280 kept: it is the size D-FINE/SAM resize to anyway (SAM works at 1024), so little detector/segmenter input is lost; going lower would cut the person-mask edge detail. Before the commit, masks are bilinearly upscaled to native and native frames re-captured (`phoneFinalize.ts`), so the draft, editor and export still see native-size data. A frame whose native recapture fails keeps its capped picture+masks pair.
2. **Bitmaps**: selfie-segmenter's library-made mask bitmap is closed after each read.
3. **Release**: segmenter state released after Phase 1; SAM-2 + all embeddings released (`releaseSamRacket`) before the commit; each frame's 16.8 MB embedding is dropped right after its decode (`dropRacketEncoding`). Cost: the editor's Object tool re-loads SAM and re-encodes (~12 s a frame on wasm).
4. **ORT arena**: D-FINE and SAM sessions use `enableCpuMemArena:false, enableMemPattern:false`.
5. **Stages** run one after another with a 60 ms yield between them.
6. **Marker**: `anglemotion:autodetect-in-progress` set before the heavy phase, cleared on every exit; on load a marker < 30 min old shows "Auto-detect was stopped by your phone's memory. Close other tabs and apps, then run it again." through the status text, once, never blocking.

## Measured (desktop Chromium, 1080p/5 frames, gate forced on; renderer RSS peak via `ps`)
| run | renderer peak | total browser RSS peak | live bitmaps |
|---|---|---|---|
| racket on, gate off | 2249 MB | 3383 MB | 18 (99 MiB) |
| racket on, gate on | **1873 MB** (−17%) | **2920 MB** (−14%) | 13 (66 MiB) |
| racket off, gate off | 1008 MB | 2154 MB | 18 |
| racket off, gate on | 1023 MB (no change) | 2036 MB (−5%) | 13 |

An earlier version with only the cap/releases measured −9% (2245 → 2044); the arena flags + per-frame embedding drop made the SAM heap grow ~100 MB per frame less (1731 → 1873 across 5 frames vs 1838 → 2162).

## Honest limits
- Dominant term is the SAM-2 wasm heap (~1.1 GB at load, +~100 MB per encode); wasm memory does not shrink, so release helps the editor afterwards, not the peak.
- Racket off: the renderer is ~1 GB and the cap does not move it on a 1080p clip; the saving is larger on 4K phone clips (frame 33 MB → 3.7 MB each, ×~3 masks), **not measured here**. Desktop Chromium RSS is not the iOS footprint; the kill limit is unpublished. Not proven on a real iPhone.
- Quality of the cap: not measured numerically. Masks are computed at ≤ 1280 and bilinear-upscaled, so edges can be softer on a 4K clip than a native pass. Check mask edges on the clip.
