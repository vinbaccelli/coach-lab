# Motion Layer click freezes the page on a cold load (iPhone, Private tab)

Diagnosis only. No source, test or config changed. Branch `diag/motion-layer-cold-click-freeze`, from main at `d5d13f8d` (includes #140, #141, #142).
Written 2026-11-03. Code claims carry `file:line` from main. Numbers are **measured** (desktop Chromium, this session) or **estimated**, and labelled.

## 0. Answer

**Ranked causes**
1. **Most likely: the COCO-SSD warm-up compiles 262 WebGL shader programs synchronously on the main thread.** Measured on desktop: 262 `compileShader` calls, and the `getShaderParameter(COMPILE_STATUS)` that follows each one blocks the thread for **4.1 s in total** (max 83 ms each); the CPU profile puts 4.1 s of self time in TF.js `createFragmentShader` (§3.3). Started by the Motion Layer click through `preloadRacketDetector` (`app/analysis/page.tsx:3413-3417`).
2. **Plausible, extends the dead time: a 64.6 MB download in a fresh Private tab.** 17 shards of 4 MB from `storage.googleapis.com` with `cache-control: public, max-age=3600`; a Private tab keeps no cache across tabs. It does not block the thread, but nothing on screen says anything is loading, and the compile starts only after it.
3. **Plausible, adds contention: three WebGL contexts and a 5.7 MB wasm start in the same second** (one for TF.js, two for the MediaPipe selfie solution), plus a second decoder for the capture mirror.
4. **Unlikely: memory.** At the click the renderer peaks around 650-700 MB (GPU process 410-430 MB), far below the Auto-detect end phase.
5. **Unlikely: a loop or a wait with no end** in the click path (nothing found).

**Recommended fix (3 lines):** stop compiling the COCO-SSD shaders on the main thread at click. Either move the detector warm-up into a worker (OffscreenCanvas WebGL), or compile the programs asynchronously (`ENGINE_COMPILE_ONLY`, supported by the installed TF.js 4.22), and start the warm-ups one after another with a yield. Add an immediate "Preparing Motion Layer…" state so the page never looks dead.
**Frozen files touched:** none of the frozen systems. The change is in `lib/racketCocoDetect.ts` (used by the racket tool and object tracking, not by Auto-detect's D-FINE pass) and the effect at `page.tsx:3413-3417`. `selfieSegmenter.ts` is only touched if the segmenter warm-up is also re-ordered (it is imported by Auto-detect, so that part needs approval). §6.

**Not proven:** that this is what freezes an iPhone for 30 s. The desktop block is 4-13 s, on a software-GL desktop. The iPhone's per-program compile time is unmeasured; §5 gives the arithmetic.

## 1. Method and limits

- Production build of main, `next start`, Playwright Chromium, viewport 390x844 touch, the repo's demo clip cut to 8 s and transcoded to VP9 WebM at 1920x1080, uploaded through the file input. Each cold run is a **fresh browser context** (empty HTTP cache, no service worker state); each warm run is a second page load in the **same** context.
- CPU throttling through CDP `Emulation.setCPUThrottlingRate` at 1x, 4x and 6x, applied from page load.
- Per run: main-thread long tasks (PerformanceObserver), a 25 ms heartbeat, a probe (`page.evaluate`) every 250 ms for the responsiveness of the main thread, renderer and GPU process RSS from `ps` every 0.5 s, network bytes from CDP `loadingFinished`, and (separate runs) a V8 CPU profile and counters wrapped around the WebGL calls.
- **Limits that matter:**
  1. This sandbox has **no GPU**: WebGL runs on SwiftShader (software) in the GPU process. CPU throttling slows the page's JavaScript but **not** that GPU process, so the 4x and 6x runs do not scale the shader-compile cost; do not read them as an iPhone.
  2. The service worker answers `/mediapipe-selfie` requests, which CDP reports as 0 bytes; a repeat run with workers blocked measured them (§3.4).
  3. Probe results vary between runs (§3.2); take them as ranges.
  4. A Safari **Private** tab's service worker support is not verified here.

## 2. Trace: what the click starts

The click is the toolbar item that calls `onNavigate('stromotion')` (`page.tsx:6880`), which sets `stroMotionActive` and nothing else heavy by itself ("opening StroMotion only opens the toolbar", `page.tsx:6896-6898`). Everything below is a React effect that runs on that state change, so all of it starts **in the same render commit**:

| # | Effect and code | What it starts | Where it runs | Blocks the UI? | Parallel or sequential |
|---|---|---|---|---|---|
| 1 | Panel mount and `setStroMotionConfiguring` (`page.tsx:3193-3198`) | React render of the Motion Layer panel and frame buttons | main thread | measured long tasks of 0.2-0.7 s at +0.2 s, +0.8 s, +1.4 s | first |
| 2 | Selfie warm-up (`page.tsx:2105-2110`, `selfieSegmenter.ts:194`, `:127-143`) | injects the MediaPipe solution script, then `solution.initialize()`: **5.7 MB wasm**, `selfie_segmentation.tflite` (249 KB), 2 WebGL contexts | main thread (legacy solution, no worker) | partly: wasm compile and init are mostly async; the script and glue run on the main thread. Log: initialised 1.1-2.9 s after the click | **starts at once**, concurrent with 3-5 |
| 3 | End-frame plate (`page.tsx:2113-2126`) | `captureVideoFrameAtTime`: creates a hidden capture `<video>` for the clip (second decoder), seeks, `createImageBitmap` | main thread, async seeks | no | concurrent |
| 4 | Draft sync (`page.tsx:2128-2143`, `initDraft.ts:48-50`) | one more capture for the background plate, builds the draft | main thread, async | no | queued behind 3 (captures are serialised, `captureSource.ts`) |
| 5 | **COCO-SSD warm-up** (`page.tsx:3413-3417` -> `lib/racketCocoDetect.ts:16-33`) | `import('@tensorflow/tfjs')`, `tf.setBackend('webgl')`, then `cocoSsd.load({ base: 'mobilenet_v2' })`: **17 shards x 4 MB = 64.6 MB** from `storage.googleapis.com`, then the library's own warm-up inference (`coco-ssd` `dist/index.js:106-117`: `executeAsync` on a zero tensor, then `data()` on every output) | **main thread** (TF.js WebGL backend, no worker) | **yes**: the warm-up compiles every shader the graph needs and uploads the weights to textures | starts at once; its download is concurrent with 2-4, its compile runs after the last shard arrives |

Not started by the click: D-FINE, SAM-2, MediaPipe pose, ONNX Runtime (all are loaded only when Auto-detect is pressed, `useStroMotion.ts:676-870, 972-1010`). So the "Preparing Motion Layer" cost is steps 2 and 5, and step 5 is the large one. The COCO-SSD detector is **not used by Auto-detect** (it uses D-FINE); it serves the racket-multiplier tool (`Canvas.tsx:3294-3311`, `detectTennisRacketNorm`) and object tracking (`lib/stroMotionObjectTrack.ts`).

## 3. Measurements (desktop, software GL)

### 3.1 Cold vs warm, three throttle settings (service worker allowed)

| Throttle | Run | Long tasks (count / total) | Longest task | Heartbeat gaps (sum) | Renderer: start -> peak | GPU process peak | Downloaded after the click |
|---|---|---|---|---|---|---|---|
| 1x | cold | 4 / 5.0 s | 4.74 s | 4.9 s | 241 -> 637 MB | 427 MB | 64.6 MB (+ ~2.3 MB selfie files, §3.4) |
| 1x | warm | 4 / 4.4 s | 4.13 s | 4.1 s | 271 -> 644 MB | 430 MB | 20.4 MB |
| 4x | cold | 24 / 12.6 s | 9.41 s | 13.0 s | 237 -> 657 MB | 429 MB | 64.6 MB |
| 4x | warm | 26 / 9.2 s | 6.09 s | 10.1 s | 256 -> 719 MB | 404 MB | 20.4 MB |
| 6x | cold | 29 / 12.3 s | 7.04 s | 13.4 s | 236 -> 655 MB | 422 MB | 64.6 MB |
| 6x | warm | 34 / 11.9 s | 6.89 s | 13.1 s | 257 -> 678 MB | 423 MB | 20.4 MB |

The long block starts when the last model shard has arrived: at +2.1 s (1x), +5.1 s (4x), +7.8 s (6x) after the click. JS heap stays near 11 MB (the weights are ArrayBuffers and GPU textures).

### 3.2 Does the page answer after the click? (cold, service worker blocked, probe every 250 ms)

| Throttle | First probe after the click | Intervals where probes took > 0.5 s | Longest probe |
|---|---|---|---|
| 1x | 34 ms | 2.2-9.1 s | 4.8 s |
| 4x | 15 ms | none seen (a 5.7 s long task was still logged) | 0.5 s |
| 6x | 41 ms | 1.0-3.7 s and **7.0-20.0 s** | 6.1 s |

So the click itself is answered at once; the freeze starts 1-7 s later and comes in blocks of 3-13 s. I did not capture when the panel is drawn (my panel detector never matched, so no number is reported). The run to run variation is large; do not quote a single figure.

### 3.3 What the long block is (1x cold, V8 CPU profile, 40 s window)

Self time outside `(idle)`: **4,094 ms in one function**, `createFragmentShader` (TF.js `webgl_util`, module 91090 in chunk `9513`, line 4078 of `.next/static/chunks/9513.790cde8b6f741005.js`): it calls `compileShader` and then `getShaderParameter(shader, COMPILE_STATUS)`, which waits for the GPU process. Next: `g` (program link) 257 ms. Everything else is below 100 ms each.

WebGL call counters over the same click (two runs agree):

| Call | Count | Total time | Max |
|---|---|---|---|
| `compileShader` | **262** | ~1 ms | 0 ms |
| `getShaderParameter` (the wait) | 262 | **4,087-4,178 ms** | 83 ms |
| `linkProgram` / `getProgramParameter` | 261 | 249-269 ms | 9 ms |
| `texSubImage2D` (weight upload) | 180 | 53-68 ms | 26 ms |
| WebGL contexts created | 3 | | one `offscreen-webgl2` at +0.37 s (TF.js), two `webgl2` at +0.62 s (MediaPipe selfie) |

The shader count is the whole story of the block: the 262 programs are compiled **one after another, each waiting for the previous** (TF.js asks for the compile status right after `compileShader`). The cost is the number of programs times the per-program latency of the GPU stack, not memory or download.

### 3.4 Download size

Cold: **64.6 MB** from `storage.googleapis.com` (17 shards of 4,194,304 B; their headers: `cache-control: public, max-age=3600`, ETag, no `no-store`), plus **2.3 MB** from `/mediapipe-selfie` measured with the service worker blocked (the 5.7 MB wasm travels as 1.7 MB compressed). Total about **67 MB**. Warm (same context): 20.4 MB + 2.3 MB: the HTTP cache kept most but not all shards (12 of 17 were not re-downloaded here).

## 4. What is skipped when the cache is warm?

**Only the network.** There is no branch in the click path that depends on a cache: `getRacketDetectorModel` always loads the graph and always runs the warm-up (`racketCocoDetect.ts:21-33`, `coco-ssd dist/index.js:106-117`), and the selfie solution always initialises (`selfieSegmenter.ts:127-143`). The measured warm run still compiles the same shaders: longest block 4.13 s warm vs 4.74 s cold at 1x, 6.1 vs 9.4 s at 4x, and 6.9 vs 7.0 s at 6x. What the warm run saved was 44 MB of the 65 MB download (§3.1).
Since #141 the service worker no longer touches `storage.googleapis.com` at all (`public/sw.js:72, :227`, `BYPASS_HOSTS`), so the 68 MB model is held only by the browser's HTTP cache, for one hour (`max-age=3600`), after which it is revalidated by ETag. A normal tab that opened Motion Layer within the last hour re-reads it from disk; a fresh Private tab downloads all of it.
**So caching alone does not explain "normal works, Private freezes"**: the compile cost is the same. The remaining candidates are the download (67 MB on a phone connection adds many seconds of dead time with no message) and anything WebKit does differently in Private mode, which cannot be checked from here.

## 5. Which step can freeze a phone for 30 s or more?

- **Shader compilation**: 262 serial waits. 30 s needs about 115 ms per program. Desktop software GL measured 16 ms per program; an iPhone's GPU stack (WebKit compiles through ANGLE to Metal) is unmeasured. Reports that TF.js WebGL warm-up is slow on iOS exist but I have no figure for this model. **Estimated: 30 s is plausible, not shown.**
- **Model download**: 67 MB at 10-20 Mbps is 27-54 s of wall time, with no progress message. It does not hold the main thread but would read as a frozen feature on a screen that shows nothing.
- **Model parse and weight upload**: 180 `texSubImage2D` calls cost 0.07 s here; not a candidate.
- **Several models initialising at once**: the selfie wasm and COCO-SSD overlap; measured long tasks of 0.2-0.7 s early on, small next to the compile block.
- **WebGL context creation**: three contexts in the same second; the cost here is tiny (the calls were not slow), but WebKit limits live contexts and GPU memory, which cannot be tested here.
- **Memory**: renderer 650-700 MB and GPU 410-430 MB on desktop at the click; much lower than the Auto-detect end phase (renderer 2.2 GB, see `docs/AUTODETECT_END_RELOAD.md`).

## 6. Smallest fixes for the top cause (proposals, none implemented)

**Option (a): keep everything on, stop blocking the main thread.**
1. Start the two warm-ups **in sequence with a yield**, not both in the click's commit: selfie first, COCO-SSD after it reports ready or after an idle callback. Cost: COCO-SSD is ready a few seconds later. It does not remove the 4 s+ block, only moves it away from the panel mount.
2. Compile the shaders **without waiting**: TF.js 4.22 has `ENGINE_COMPILE_ONLY` (`tfjs-backend-webgl/dist/webgl_util.js:80, 118`): programs are submitted and the status is checked later with `checkCompileCompletionAsync`, so the GPU process can compile in parallel and the main thread is free. Needs a spike: the library's own warm-up inside `cocoSsd.load` would have to be replaced by our own `loadGraphModel` + a compile-only run (about 30 lines in `racketCocoDetect.ts`), and it depends on the browser exposing parallel shader compilation (unverified on iOS).
3. Or run the detector in a **worker** with OffscreenCanvas WebGL2 (TF.js supports it): the compile waits happen off the main thread entirely; the racket tool then talks to the worker. The larger change.
- **Frozen files touched:** none of the frozen systems. `lib/racketCocoDetect.ts` and the effect at `page.tsx:3413-3417` serve the racket tool and object tracking, not Auto-detect (which uses D-FINE/SAM). Sequencing the selfie warm-up also touches `page.tsx:2105-2110`; changing `selfieSegmenter.ts` itself is inside a file Auto-detect imports and needs approval. The Pose Worker and `public/sw.js` are not touched.

**Option (b): UI only, so the page never looks dead.**
- Set a "Preparing Motion Layer… (downloading models, 67 MB)" state **in the click handler** (`page.tsx:6880`) and clear it when both warm-ups resolve. It paints before the block begins (the first block starts 1-7 s after the click, §3.2), and a CSS spinner on `transform` keeps animating on the compositor while the main thread is blocked, so the coach sees progress. It does **not** make taps work during the block.
- **Frozen files touched:** none. `page.tsx` (hot file, small edit) and the panel component. This is a 20-30 line change and can ship first; (a) removes the cause.

**Not proposed, but a decision for the architect:** the COCO-SSD warm-up is not needed until the racket tool or object tracking is used; loading it on first use instead of at the click would remove the 65 MB and the block from the click altogether (`docs/MOTION_LAYER_FREEZE.md` section 10.3 proposed this earlier). The brief says the racket detector and segmenter stay on; that is Auto-detect's D-FINE and person segmenter, which this does not touch, but it is a product call.

## 7. What would settle it (no data clearing)

1. In a Private tab on the phone, note the time from the tap to the first thing that moves, and whether it recovers by itself after 1-2 minutes (a compile block ends; a hung download or a kill does not).
2. Open Motion Layer **a second time in the same Private tab** (after Back and Motion Layer again) and time it: the models are then loaded and cached in that tab, so a fast second click would confirm download plus compile as the cost.
3. A second phone or a different network (Wi-Fi vs cellular) to see whether the freeze length follows the download.
4. Safari Web Inspector from a Mac, if available: the Timelines tab shows the long task and its `getShaderParameter` calls directly.
