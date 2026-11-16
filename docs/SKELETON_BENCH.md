# Skeleton benchmark harness (Phase 2, Stage 0)

Purpose: give every Stage-2 skeleton change a **before/after number on the same definitions**.
Nothing here touches app behaviour (no changes to `app/`, `components/`, workers, `sw.js`).

## Parts

| Part | Where | Needs |
|---|---|---|
| Metrics (pure) | `lib/skeletonBench/metrics.ts` | nothing |
| Synthetic ground-truth swings + corruptions | `lib/skeletonBench/synthetic.ts` | nothing |
| Automated tests (in `npm test`) | `tests/skeletonBench.test.ts` | nothing |
| In-browser detector benchmark (full-frame vs fixed ROI) | `scripts/skeleton-bench/{server.js,harness.html,run.js,analyze.ts}` | Playwright Chromium, a VP9/WebM clip |

## Metrics

`trackStats` (no truth needed, usable on real clips): missing frames, jump rate (steps > 0.12 body-heights/frame), L/R swaps, jerk p95/p99, bone-length CV and violation rate.
`compareToTruth` (synthetic only): joint error (body-heights), wrist **peak-speed ratio** (swing preserved?), wrist **lag** in frames, swaps vs truth.
Body height = median shoulder/hip/knee/ankle y-extent (arms excluded so a raised racket doesn't change the scale). *The Phase-1 scripts used all 12 joints; numbers differ slightly.*

## Run

```bash
npm test                                   # includes skeletonBench.test.ts
ffmpeg -i clip.mp4 -c:v libvpx-vp9 -b:v 4M -an clip.webm   # Chromium can't decode H.264
CLIP=$PWD/clip.webm node scripts/skeleton-bench/server.js &
NODE_PATH=/opt/node-tools/node_modules MODEL=heavy T0=2 N=90 FPS=60 node scripts/skeleton-bench/run.js
npx tsx scripts/skeleton-bench/analyze.ts bench-out/heavy_s1.json
```
`bench-out/` is git-ignored.

## Baseline (before Stage 2)

Synthetic forehand, 90 frames @60 fps, 600 px body, current `smoothBakedTrack` (median-5 + Gaussian σ1.2):

| Case | Result |
|---|---|
| Gaussian noise 4 px | mean error 0.0088 → 0.0049 body-heights; **wrist peak speed retained 0.912** (≈9 % of the swing flattened); lag 0 |
| 15 % single-joint outliers (200 px) | jumps 41 → 3; max error 0.347 → 0.029 |

Real clip (Demo, 1080p VP9, large player, 90 frames from 2 s, MediaPipe heavy, desktop CPU): full-frame vs fixed ROI crop — 0 missing, 0 swaps, 0 % jumps for both (slow segment); ROI has higher jerk p95 (0.0171 vs 0.0130) and bone violation (4.9 % vs 2.4 %). Time 239 → 206 ms/frame (desktop CPU, **not** representative of iPhone).

## Findings from building the harness

1. **A step-size threshold cannot tell glitches from real swings.** Synthetic serve wrist peaks at ≈0.15 body-heights/frame at 60 fps (realistic), above the 0.12 "jump" threshold. Stage 2 validation must use joint-level plausibility (bone length, L/R, confidence), not "reject big jumps".
2. **Production smoother already costs ~9 % of wrist peak speed** on a fast forehand (no lag). Stage 2 must not add smoothing on top; it should be measured with the same synthetic case.
3. First draft of `bodyHeight` used all joints and inflated mid-swing (576 → 751 px); caught by the new tests and fixed in the metric (new code; no existing test changed).

## Limitations (needs real footage / devices)

- Synthetic tracks are kinematic stick figures. They test metrics and post-processing logic, **not** detector behaviour on real pixels; they cannot prove a real-world accuracy gain.
- Desktop Chromium CPU timings say nothing about iOS Safari / Android Chrome GPU delegates. Phone numbers need physical devices.
- Playwright's Chromium decodes VP9/WebM only.
