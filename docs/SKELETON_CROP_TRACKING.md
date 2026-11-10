# Crop tracking for small players — Skeleton Stage 2a, commit 3

Single-player AI Track pass only (`app/analysis/page.tsx` unlocked loop). When the tracked player is **small** (box < 50 % of frame height) detection runs inside a square crop around them (`lib/skeletonCrop.ts`, `detectPosePreciseTracked` in `lib/mediapipePose.ts`). Everything else is the previous code: `detectPosePrecise` is untouched and is the fallback.

| Piece | Behaviour |
|---|---|
| When | known box and height < `CROP_BELOW` (0.5 × frame). Large players never crop (a crop was slightly worse for them) |
| Crop | square, longest side × 1.7 (≈ 35 % margin each side for the racket arm / fast reach), min 192 px, clamped to the frame |
| Accept | ≥ 6 of 12 body joints confident, size within ×2 of last box, centre moved ≤ 1 body height, **no ≥ 2 joints piled on a crop edge** (player cut off) |
| Re-acquire | any failed check ⇒ **full-frame detection in the same step** |
| Seed | first full-frame detection; if it finds nothing (far player), the skeleton currently on screen |
| TTA (`max` tier) | flipped crop merged with the same agreeing-joints rule; agreement radius 0.12 × crop height instead of 8 % of frame width |
| Locked-player path | unchanged (it has its own box-continuity follower) |
| Rollback | `localStorage['anglemotion:skeleton-legacy']='1'` ⇒ previous full-frame path (also disables validation, commit 2) |

## Measured (real MediaPipe-heavy detections, Demo clip, 90 frames @60 Hz, desktop CPU)
Small player simulated by shrinking the video inside the 1080p frame; crop seeded from the full-scale pose (stand-in for the on-screen skeleton). "tracked" uses the **real** `skeletonCrop.ts` decision logic.

| Player height | Full-frame (before) | Tracked (after) |
|---|---|---|
| ≈ 600 px (large) | 0 missing, jerk p95 0.012 | identical (stays on the full-frame path) |
| ≈ 300 px | **21/90 missing**, 12.35 % jumps, jerk p95 0.669 | 0 missing, 0 % jumps, jerk p95 0.0156 (90 crop / 0 re-acquires) |
| ≈ 210 px | **90/90 missing** | 0 missing, 0 % jumps, jerk p95 0.0162 |
| ≈ 150 px | **90/90 missing** | 0 missing, 0 % jumps, jerk p95 0.0164 |

Time per frame (desktop CPU): full-frame ≈ 237 ms, crop ≈ 205 ms.

## Limitations (read before trusting this)
- **Simulation, not real far-court footage.** Shrinking a close-up is not the same as a real distant camera (different blur, motion, background). Needs your clips.
- The harness exercises the real accept/re-acquire logic but a copy of the crop-draw/detect glue; **`detectPosePreciseTracked` itself was not run in a browser here** (only type-checked, built and unit-tested for the geometry). Manual test below covers it.
- Crop was seeded with a known location. With nothing on screen and a full-frame miss, there is still no way to start (unchanged from before).
- Single-player clip: crop staying on the right person among several players is **not** tested on real footage.
- TTA crop agreement radius and `max`-tier behaviour not benchmarked.
- Desktop CPU only; iPhone Safari / Android Chrome unmeasured.

## Manual test
1. Far-court player (small in frame) with the live skeleton visible on them: run AI Track, compare with `anglemotion:skeleton-legacy=1`. Expect fewer gaps and less jitter with the new path. In a dev build the console logs `crop tracking: N crop / M full-frame / K re-acquires`.
2. Large/close player: results should look the same as before.
3. Fast serve of a small player: the arm should not be cut off at the toss/contact (the crop-edge check re-acquires on the full frame if it is).
4. Two players on court, small target: confirm the track stays on the intended player; if it jumps to the other, send the clip.
