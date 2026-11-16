# Racket pass in terminable workers (phones)

**Problem.** On iPhone the page is killed by memory during Auto-detect's racket pass ("Last step: Auto-detect: racket segmentation, frame 3").
Measured (desktop, phone limits, 5 frames, 1080p): releasing the D-FINE ONNX session inside the page returned almost nothing (1629 → ~1600 MB); SAM-2's first
encode added ~+550 MB; each further frame added +45–80 MB; the pass ended at 2499 MB. The wasm heap only grows within a page.

**Change.** On phones (or `localStorage racketWorker='1'`), Auto-detect runs D-FINE in a worker terminated after detection, and SAM-2 in a second worker terminated after the last
frame (`lib/stroMotionDraft/racketWorker.ts`, `racketWorkerClient.ts`, `autoRacketPass.ts`). A worker that cannot start or crashes falls back to the old in-page path. Desktop is unchanged.
The model modules were made worker-safe (`frameCanvas.ts`, no `instanceof HTMLCanvasElement`/`document`); the manual Object tool still uses the in-page SAM.

**Measured (desktop, same clip and phone limits; NOT an iPhone):**
| | before | workers |
|---|---|---|
| peak renderer memory | 2623 MB | 2355 MB |
| memory after the pass | 2413 MB | 1430 MB |
| per-frame growth during SAM | +45–80 MB | flat |
| first SAM encode jump | +554 MB | +509 MB (unchanged: intrinsic to the model) |

**Lessons.** (1) Next's client build replaces `typeof window` with the constant `"object"` even in a worker bundle, so `typeof window !== 'undefined'` guards pass in a worker and then
read `window.…`; the worker shims `window` before importing the models. (2) A first measurement looked like a 1 GB win because the detector had silently failed to load in the worker; always check
that the racket was actually found before trusting a memory number.

**Not tested:** a real iPhone (does the first SAM encode still fit?), ORT wasm threads inside a worker on iOS, manual Object tool after a worker pass, desktop with the flag off in a browser.
