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
