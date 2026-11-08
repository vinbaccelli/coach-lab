# RTMPose spike — isolated pose-engine lab (NOT in the product)

Question: can RTMPose become the Live Skeleton engine? Method: one page, `/rtmpose-lab`, runs several engines on the **same frames** of one clip and reports accuracy proxies, speed and real-time behaviour. Nothing here touches the analysis page, AI Track, the pose worker, `sw.js` or Motion Layer. The live skeleton keeps using MoveNet (worker); MediaPipe live exists only for Foot Lines.

## What is in the lab
| id | what it is |
|---|---|
| `movenet-thunder` / `-lightning` | MoveNet via tfjs. In the app this is the default live engine (in a worker); the lab runs it on the main thread. |
| `mp-live-full` | `detectPoseLive` — the MediaPipe live path used with Foot Lines (full model, VIDEO mode) |
| `mp-crop-full` | MediaPipe full, tracked crop (`detectPosePreciseTracked`), no seed |
| `mp-crop-seeded` | same, but a person box from YOLOX-tiny starts the crop tracker |
| `mp-crop-heavy` | heavy model, tracked crop, YOLOX-seeded — **the reference** (AI Track quality) |
| `rtmpose-t` / `-s` / `-m` | RTMPose body7 256×192 (ONNX, onnxruntime-web wasm) + YOLOX-tiny to find / re-find the person; the next frame's box comes from this frame's joints |

Code: `lib/rtmpose/core.ts` (pure pre/post-processing, tested), `engine.ts` (browser), `labEngines.ts` (adapters), `labMetrics.ts` (pure metrics, tested), `app/rtmpose-lab/page.tsx`. Weights: `public/models/rtmpose/` (t 13 MB, s 22 MB, m 54 MB, YOLOX-tiny 20 MB; official OpenMMLab ONNX, see its README for the licence caveat). Desktop node runner: `scripts/rtmpose-bench/node-bench.ts`.

## Two tests
- **Run comparison** (paused frames, same frames for every engine): per-engine inference ms, found %, jumps / left-right swaps / arm↔leg jumps / frames the validator would drop (need no reference), and vs the reference engine: mean joint error in body heights, PCK@0.1, wrist-speed ratio. The reference is **pseudo-truth, not ground truth**.
- **Run LIVE test (1×)**: the clip plays in real time, the engine detects the latest frame with one detection in flight (like the live skeleton). Reports detections/s, pose age (capture → result), age at draw (capture → next screen refresh), dropped frames of the playing video, refresh gaps > 50 ms. Battery is only reported where the browser has the Battery API (not iPhone): for the phone, note battery % before/after a fixed run.

## Desktop results (headless Chromium, CPU-only sandbox) — NOT phone results
The sandbox has no GPU: MoveNet/MediaPipe fall back to software WebGL / CPU and block the main thread (refresh gap p50 ≈ 270–570 ms), so their ms are **not** representative of a phone. RTMPose runs on wasm threads (crossOriginIsolated = true here) and never blocked the page.
- Footage: the bundled practice forehand (large player) and a derived clip with the same player at 165 px (≈15 % of frame height). Both are easy motion — **no fast serves, no ground truth**.
- Large player: every engine agrees with the heavy reference within ≈ 0.01–0.014 body heights, PCK@0.1 = 1.0, no jumps/swaps/arm↔leg errors. Peak wrist speed vs reference (10 fps sampling): mp-live 1.81×, mp-crop 1.36×, MoveNet 1.24×, RTMPose-t 1.10×, RTMPose-s 0.96× (> 1 = noise inflates the peak).
- Small player (165 px): **MediaPipe found the player in 0 % of frames in all three unseeded modes**; MoveNet and RTMPose found 100 %. With the YOLOX seed MediaPipe full/heavy find 100 % and agree with RTMPose within 0.01 body heights. (Same root cause as the AI Track finding: MediaPipe's own detector misses small people.)
- RTMPose desktop pipeline ms (crop + inference + decode, p50): t 19–30, s 33–41, m ~14 native / 80 in the live test. Live (5 s, 1×): t 36 det/s age 24 ms (32 at draw), s 22 det/s age 40 (49), m 12 det/s age 81.
Conclusion so far: the pipeline is **correct** and cheap enough to be interesting on desktop; it says nothing yet about an iPhone or about fast serves.

## Open questions only a phone can answer
1. Does ORT-web wasm run multi-threaded on iOS (needs `crossOriginIsolated`; the page sends COOP same-origin + COEP credentialless)? The lab prints it. Single-thread would be several times slower.
2. RTMPose-t/s/m ms and detections/s on the A-series chip, with the page in the foreground; thermal throttling over a longer run.
3. Fast serves / forehands / backhands, lunges, different camera distances — compare joints visually with the overlay viewer and via the numbers.
4. Model download size on first visit (13–54 MB + 20 MB detector) vs the existing models.
5. WebGPU is not available on iOS 18 Safari/Chrome: no GPU path to try here.

## Test steps (iPhone)
1. Open `<preview>/rtmpose-lab`, choose a clip from the camera roll.
2. Defaults: 15 fps, 6 s, start 0; engines: movenet-thunder, mp-live-full, mp-crop-full, mp-crop-seeded, mp-crop-heavy (reference — leave on), rtmpose-t, rtmpose-s. Tap **Run comparison**; keep the tab in the foreground. Tap **Copy result** and paste it. Use **start at** to aim the 6 s window at the serve / swing.
3. Tap **Run LIVE test (1×)** (same engines, reference excluded); copy the result again.
4. Optional: tick `rtmpose-m`; set RTMPose threads to 1 vs auto to see the thread effect; scrub the overlay viewer (select an engine, drag the slider) to check joints by eye.
5. Note battery % before and after a full run.

Known separate issue (not part of this spike): the stuck-video bug.

## First iPhone run (iPhone, Chrome/WebKit, iOS 18.5, clip 1080×1920, 7.6 s) — mostly INVALID, lab bugs fixed after it
- **Paused comparison: every engine "detected 0 %" and the run took 54 min.** iOS never decodes a frame of a paused video that was never played, so every seek showed a black frame; each seek then timed out. Nothing from that table says anything about the models. Fixed: the video is primed (short play/pause), every seek checks the frame is not black (retry, then stop with a clear message after 5 black frames), shorter waits, defaults now 10 fps × 5 s.
- **Live test was truncated for most engines** (1–2 s instead of 6 s; negative dropped-frame counter = the media pipeline was reset). The loop stopped when the video reported paused/ended. Fixed: the clip loops, a paused video is resumed, the loop runs for the wall time asked.
- **`rtmpose-s: FetchEvent.respondWith … Load failed`** in the paused run: the app's service worker failed one large model fetch; the same model loaded fine later. Fixed in the lab only (4 retries, bytes handed to ORT; `sw.js` untouched).
- **`crossOriginIsolated: false` on iPhone Chrome** (the page sends COOP same-origin + COEP credentialless; WebKit does not provide SharedArrayBuffer here) ⇒ RTMPose runs **single-threaded wasm** (`threads: 1`), as feared. New option "run RTMPose in its own worker" keeps the page responsive in that case (costs ≈ 10–15 ms of messaging).
- Valid but short live numbers from that run (treat as indications): MoveNet Thunder (tfjs WebGL, main thread, 6 s): 15.2 det/s, age p50 58 ms, age at draw p95 118 ms, 88 refresh gaps > 50 ms. MediaPipe Live full (2.2 s): 30.9 det/s, age p50 28 ms. RTMPose-s (1.3 s): 16.4 det/s, age p50 47 ms, p95 109 ms, max 229 ms. RTMPose-t and the MediaPipe crop variants produced ≤ 1 s of data.

## Second iPhone run — paused comparison VALID, live test failed to load (iPhone, Chrome/WebKit iOS 18.5)
Clip 1080×1920, 7.6 s, 10 fps × 5 s from t = 0; player ≈ 254 px tall (≈13 % of the frame); **slow motion** (reference peak wrist speed 0.17 body heights/s) — an easy clip, not a fast swing. RTMPose ran **single-threaded wasm in its own worker** (`crossOriginIsolated: false`). p50 ms = crop + inference + decode per frame, sequential.

| engine | p50 / p95 ms | fps | found | err vs ref (bh) | PCK@.1 | wrist-speed ratio | jerk median | bone-length CV |
|---|---|---|---|---|---|---|---|---|
| MoveNet Thunder (tfjs WebGL, **main thread**) | 80 / 103 | 12 | 100 % | 0.017 | 0.998 | 1.57 | 0.0059 | 0.016 |
| MediaPipe live full | 38 / 42 | 27 | 100 % | 0.015 | 0.998 | 2.89 | 0.0056 | 0.025 |
| MediaPipe crop (unseeded) | 72 / 86 | 14 | 100 % | 0.017 | 1.00 | 1.87 | 0.0138 | 0.035 |
| MediaPipe crop + YOLOX seed | 72 / 86 | 14 | 100 % | 0.017 | 1.00 | 1.73 | 0.0140 | 0.027 |
| MediaPipe heavy crop (reference) | 109 / 135 | 9 | 100 % | – | – | – | 0.0098 | 0.022 |
| **RTMPose-t** | 46 / 50 | 22 | 100 % | 0.014 | 1.00 | 1.04 | 0.0087 | 0.014 |
| **RTMPose-s** | 65 / 68 | 15 | 100 % | 0.013 | 1.00 | 0.73 | 0.0056 | 0.0096 |

All engines: 0 jumps, 0 swaps, 0 arm↔leg errors, 0 validator drops. **On this clip no engine is wrong; the differences are speed and stability.**
- Read the wrist-speed ratio with care: on slow motion the peak speed is dominated by jitter, so a ratio above 1 means noisier than the reference, and 0.73 on a slow clip says nothing about whether a fast swing's speed is preserved. A fast serve is needed for that.
- RTMPose-s has the lowest bone-length variation and the lowest jerk; RTMPose-t is as accurate as MoveNet at 57 % of its time here.
- **Not apples to apples:** the lab runs MoveNet on the main thread (80 ms); the app runs it in a worker at ≈ 34–42 ms (earlier phone panel). New engine `movenet-app-worker` runs the app's own bridge for a fair baseline.
- **The LIVE test did not run:** every engine failed with "Loading chunk … failed (timeout)" on the first visit to the fresh deploy. The paused run later loaded the same chunks. Fixed: dynamic imports now retry 4×.

## Third iPhone run — FAST swing clip (1080×1920, 5.9 s, player ≈ 255 px; reference peak wrist speed ≈ 8 body heights/s), both tests valid
**Live (1×, 6 s, one detection in flight; RTMPose in a worker, single-threaded wasm; the worker option made no visible difference):**

| engine | det/s | age p50 / p95 (ms) | age at draw p50 / p95 | page refresh gap p50 / max | found |
|---|---|---|---|---|---|
| MoveNet as the app runs it (worker, Thunder/WebGL) | 24.8 | 40 / 44 | 52 / 56 | 17 / 29 | 100 % |
| MediaPipe live full (main thread) | 26.9 | 35 / 41 | 35 / 42 | 27 / 50 | 96 % |
| RTMPose-t | 32.6 | 30 / 32 | 39 / 46 | 17 / 23 | 100 % |
| RTMPose-s | 19.6 | 51 / 53 | 59 / 67 | 17 / 24 | 100 % |
No dropped frames in any engine. RTMPose-t is ≈ 10–13 ms faster than the app's MoveNet and runs ≈ 30 % more detections/s; RTMPose-s is ≈ 11 ms slower.

**Paused (10 fps × 5 s, 50 frames), vs the heavy MediaPipe reference (pseudo-truth):**

| engine | p50 ms | err (bh) | PCK@.1 | arm err | leg err | wrist err | wrist-speed ratio | arm↔leg jumps | validator outliers / bone |
|---|---|---|---|---|---|---|---|---|---|
| MoveNet (app worker) | 68 | 0.026 | 0.973 | 0.020 | 0.031 | 0.024 | 0.99 | 3 | 8 / 1 |
| MediaPipe live | 36 | 0.035 | 0.956 | 0.028 | 0.041 | 0.038 | 0.79 | 8 | 9 / 0 |
| RTMPose-t | 32 | 0.033 | 0.965 | 0.021 | 0.043 | 0.027 | 0.69 | 3 | 18 / 3 |
| RTMPose-s | 51 | 0.031 | 0.961 | 0.018 | 0.041 | 0.022 | 0.98 | 7 | 17 / 5 |

**Read this with care:** (1) 10 fps samples a swing that moves ≈ 0.7 body heights per sample, so "jumps" (30–38 % of steps for EVERY engine, the reference included) and "outliers" measure the motion, not the model. (2) The reference itself lost joints on 28 of 50 frames, so it is weakest exactly where it matters. (3) Differences vs the reference are small (0.026–0.035 bh, PCK 96–97 %): **no engine is clearly right or wrong on this clip.** (4) RTMPose-t drops swing speed (0.69), RTMPose-s keeps it (0.98), as MoveNet does. (5) Arm↔leg jumps are higher for RTMPose-s (7) and MediaPipe live (8) than for MoveNet (3) / RTMPose-t (3): needs a look at those frames, not a conclusion. The lab now overlays every engine on one frame in its own colour (white = reference) and lists the frames with the largest disagreement.
