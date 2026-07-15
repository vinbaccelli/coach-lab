# RESEARCH — In-browser subject segmentation for StroMotion

Status: research only (no feature code written). Author pass: 2026-07-15.

## Problem recap

"StroMotion" = Dartfish-style stroboscopic overlay: for ~3–8 sampled frames of a
clip, cut the moving SUBJECT (athlete **+ held implement** — racket/bat/club) out
of the background and composite the cutouts. The current auto-proposer is a
motion-difference matte vs a temporal-median plate; it only auto-succeeds ~30% of
the time. We want a real segmentation model that can be **prompted** by the pose
data we already compute.

Key facts established by reading the code:

- The output contract is `AlphaMask` — single-channel alpha `0..255`, length
  `width*height`, full frame resolution (`lib/stroMotionDraft/types.ts:9`). The
  manual brush/flood editor (`maskUtils.ts:32`, `:62`) and the compositor all
  consume this. Any new segmenter must ultimately emit an `AlphaMask`.
- The proposal ladder we would replace lives at
  `proposeFrameMask.ts:222-280`: (1a) motion-diff vs median plate, (1b) motion-diff
  vs single reference frame, (2) color flood-fill matte
  (`matteMaskInSelection` → `buildMatteAlphaMask`, `objectMultiplier.ts:189`),
  (3) guaranteed solid box fill (`fillBoxMask`, `maskUtils.ts:149`).
- We already have a pose skeleton available on the paused frame:
  `detectFullPoseOnFrame` (`mediapipePose.ts:102`) returns COCO-17 keypoints **in
  video pixels** + appended feet. Wrists = indices 9/10, elbows 7/8, shoulders
  5/6, hips 11/12, ankles 15/16 (`mediapipePose.ts:35-53`). MoveNet worker
  produces the same convention live.
- We already have an implement box detector: `detectTennisRacketNearHint`
  (`racketCocoDetect.ts:97`) returns a normalized racket/bat box (COCO-SSD, no
  golf-club class).
- **`@mediapipe/tasks-vision@0.10.35` is already a dependency** and its WASM is
  already self-hosted at `public/mediapipe-wasm/` (loaded via
  `FilesetResolver.forVisionTasks('/mediapipe-wasm')`, `mediapipePose.ts:76`).
  Models are self-hosted at `public/models/` (`pose_landmarker_full.task`).
- Crucially: the installed `vision.d.ts` **exports `InteractiveSegmenter`** and
  `RegionOfInterest`, and the ROI accepts `keypoint` (a single normalized point)
  or `scribble` (a list of normalized points) — `vision.d.ts:2646-2651`. It does
  **not** accept a box. Its result exposes `confidenceMasks: MPMask[]` (default
  on, Float32 `[0,1]`) and optional `categoryMask` — `vision.d.ts:1963-1980`.
  `MPMask.getAsFloat32Array()` / `getAsUint8Array()` give us CPU pixels
  (`vision.d.ts:2203`, `:2212`).

GPU-contention note: a live MoveNet pose worker + TFJS WebGL/WebGPU backend are
already active. Any new GPU segmenter competes for the same GPU. This is a strong
argument for a model that (a) runs only on the paused, per-frame StroMotion path
(never during live playback — same discipline as `mediapipePose.ts`), and (b) can
fall back to CPU delegate cleanly, exactly like the existing pose landmarker.

---

## Candidate comparison

| Criterion | **1. MediaPipe Interactive Segmenter (MagicTouch)** | 2. MediaPipe Image Segmenter (Selfie / DeepLabV3) | 3. MobileSAM via onnxruntime-web | 4. U²-Net / MODNet / rembg (onnx/tfjs) |
|---|---|---|---|---|
| Promptable? | **Yes** — point (`keypoint`) or multi-point (`scribble`) ROI. No box, but points are exactly what pose gives us. | **No** — whole-frame class mask only. | **Yes** — points (+labels) **and** box, high quality. | **No** — salient-object cutout, no prompt. |
| Mask quality on athlete **+ implement** | Good on the athlete; implement captured **only if a prompt point lands on it** (scribble along the racket). Semi-transparent motion-blur edges are the weak spot. | Person only. Selfie/DeepLab **have no racket class** → implement is dropped. Disqualifying. | Best-in-class boundaries; box+point prompt can enclose athlete+racket in one mask. Thin/blurred racket still hard but best of the four. | Cuts the most-salient blob; often grabs athlete but **arbitrarily includes/excludes** the racket and any other salient object. Unpredictable. |
| In-browser latency (paused, per-frame) | ~15–40 ms/frame GPU (WebGL delegate), ~80–150 ms CPU. Single forward pass. | ~10–30 ms GPU. | Encoder ~50–200 ms (WASM) / ~10–30 ms (WebGPU) **per image**; decoder ~5–15 ms **per prompt**. Encoder dominates. | u2netp ~50–120 ms; full U²-Net/MODNet 200 ms–1 s+ CPU. |
| Model size (self-host) | **6.23 MB** (`magic_touch.tflite`, float32). | selfie float16 **244 KB**; deeplab_v3 **2.78 MB**. | Tiny-ViT encoder ~28–40 MB ONNX (int8 ~10 MB) + decoder ~5–16 MB. | u2netp ~4.7 MB; U²-Net full ~168 MB; MODNet ~25 MB; RMBG-1.4 ~44 MB. |
| Self-hostable? | **Yes — reuses the already-bundled `tasks-vision` runtime + existing `public/mediapipe-wasm` WASM.** Only need to drop the .tflite in `public/models`. | Yes, same runtime. | Yes but adds **new dependency `onnxruntime-web`** (+ its own WASM/WebGPU assets, several MB). | Yes but adds onnxruntime-web or a tfjs graph model + weights. |
| License | Apache-2.0 (MediaPipe model & task). | Apache-2.0. | Code Apache-2.0; **weights Apache-2.0** (MobileSAM). SAM base also Apache-2.0. | u2netp/U²-Net Apache-2.0; **MODNet weights non-commercial**; **RMBG-1.4 non-commercial** (BRIA) — license risk for a commercial launch. |
| Integration difficulty | **Lowest** — same load pattern as `mediapipePose.ts`, zero new deps, output maps straight to `AlphaMask`. | Low, but wrong output (no implement). | **High** — new dep, encoder/decoder session plumbing, ONNX tensor pre/post-proc, WebGPU/WASM backend juggling, GPU contention with TFJS. | Medium — new runtime + non-trivial post-proc; promptability absent so still needs the box to constrain. |

Model URLs / sizes confirmed by HTTP `content-length`:

- MagicTouch: `https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite` — **6,227,884 B (5.9 MiB)**.
- Selfie segmenter (float16): `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite` — **249,537 B**.
- DeepLabV3: `https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite` — **2,780,176 B**.

---

## #1 Recommendation — MediaPipe Interactive Segmenter (MagicTouch)

**Rank: 1. Interactive Segmenter → (fallback ladder unchanged) → 2. MobileSAM only
if quality proves insufficient. Image Segmenter and U²-Net/MODNet are rejected.**

Why it wins for *this* codebase:

1. **Zero new dependencies and reuses the exact self-hosted pattern already in
   place.** `@mediapipe/tasks-vision@0.10.35` is installed and its WASM already
   ships at `public/mediapipe-wasm/`. We load it the same way `mediapipePose.ts:75-82`
   loads `PoseLandmarker` — `FilesetResolver.forVisionTasks('/mediapipe-wasm')`
   then `InteractiveSegmenter.createFromOptions(...)` with GPU→CPU fallback. The
   only new asset is one 5.9 MB `.tflite` dropped into `public/models/`.
2. **It is prompt-driven and our prompt is free.** The pose skeleton already gives
   pixel-accurate wrist/elbow/hand points; the racket detector gives the implement
   box. MagicTouch's `scribble` ROI takes a list of points — we feed it points on
   the torso, the dominant wrist/hand, and (from the racket box) points marching
   up the implement. This directly targets the athlete+implement, which is exactly
   the ~70% failure mode of the motion-diff approach (implement missed, or wrong
   mover kept).
3. **It fits the GPU-contention budget.** Single forward pass, runs only on the
   paused per-frame path, GPU delegate with clean CPU fallback (mirrors the pose
   landmarker). MobileSAM's per-image ViT encoder plus onnxruntime-web's separate
   WebGPU context is far heavier and would contend with TFJS.
4. **License is clean (Apache-2.0)** for a commercial launch — unlike MODNet /
   RMBG-1.4 weights.

MobileSAM is the only candidate with *better* masks, but it costs a new runtime,
30–50 MB of assets, encoder/decoder plumbing, and GPU contention — not justified
until MagicTouch is shown to be inadequate on real clips. Keep it as the documented
"if quality misses" upgrade.

Selfie/DeepLab (candidate 2) is rejected: no implement class, so the racket is
always dropped — fatal for StroMotion. U²-Net/MODNet/rembg (candidate 4) is
rejected: not promptable (can't be told "this athlete, not that one"), unpredictable
about the implement, and the good-quality weights (MODNet/RMBG) are
non-commercial.

---

## Concrete integration sketch

### New module (proposed): `lib/stroMotionDraft/interactiveSegment.ts`

Mirror `mediapipePose.ts` structure: a memoized `getSegmenter()` promise, GPU→CPU
delegate fallback, `preload...()` for warm start.

```
FilesetResolver.forVisionTasks('/mediapipe-wasm')  // already self-hosted
InteractiveSegmenter.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: '/models/magic_touch.tflite', delegate: 'GPU' },
  outputConfidenceMasks: true,     // Float32 [0,1] — what we want
  outputCategoryMask: false,
})
```

### 1. Pose keypoints → ROI prompt

We already have, on the paused frame:
- COCO-17 in **video pixels** from `detectFullPoseOnFrame` (`mediapipePose.ts:102`)
  (or the live MoveNet array — same indices).
- The racket/bat box (normalized) from `detectTennisRacketNearHint`
  (`racketCocoDetect.ts:97`), when available.

MagicTouch ROI points are **normalized 0..1** (`NormalizedKeypoint`,
`vision.d.ts:2262`), so divide pixel keypoints by `video.videoWidth/Height`.

Build a `scribble: NormalizedKeypoint[]` (best of the two ROI shapes — multiple
seed points, not one):
- Athlete body seeds: torso centroid (mean of shoulders 5/6 and hips 11/12),
  plus the dominant-side shoulder→elbow→wrist chain (the swinging arm). Filter by
  `score >= 0.3` (same threshold the code already uses, `mediapipePose.ts:126`).
- Implement seeds: sample 3–5 points along the racket box's long axis, anchored at
  the dominant **wrist** (index 9 or 10) and marching toward the far corner of the
  detected box. If no racket box, march a short distance beyond the wrist along the
  elbow→wrist vector (same heuristic the golf path already uses per
  `racketCocoDetect.ts` comments).

MagicTouch segments the object under the *seed* points; multiple seeds spanning
athlete-torso-through-racket bias it to return the union. If a single call
under-segments (returns only the body), a practical option is **two calls** — one
seeded on the body, one seeded on the implement — and OR the two confidence masks
via the existing `mergeMasksPreferForeground` (`maskUtils.ts:118`). This reuses
code we already have.

### 2. Model output → `AlphaMask`

`InteractiveSegmenterResult.confidenceMasks[0]` is an `MPMask`. Get CPU pixels with
`mask.getAsFloat32Array()` (`vision.d.ts:2212`), values `[0,1]`, laid out at the
mask's own `width*height` (typically the model's internal resolution, not the
frame's). Then:

1. Threshold/scale to alpha: `alpha = clamp(round(conf * 255))`, optionally with a
   soft knee (`smoothstep` around ~0.4–0.6) to keep motion-blur edges — the
   existing motion-diff path already uses a smoothstep skirt
   (`proposeFrameMask.ts:94-96`), reuse that idea.
2. Resize the mask to full video `vw*vh`. The mask is full-frame (MagicTouch
   segments the whole image, not a crop), so no `embedRegionMask` offset is needed
   — but if we run it on a **cropped ROI** for speed (recommended, crop to the
   padded selection box like `boxToPixels`, `proposeFrameMask.ts:16`), then reuse
   `embedRegionMask(vw, vh, px, py, regionMask)` (`maskUtils.ts:127`) exactly as
   the motion-diff path does (`proposeFrameMask.ts:193`).
3. Return `{ width: vw, height: vh, data: Uint8ClampedArray }` — a valid
   `AlphaMask`. From here the brush/flood editor and compositor work unchanged.

A tiny helper analogous to `extractAlphaMaskFromBitmap` (`maskUtils.ts:13`) can do
the Float32→alpha+resize step; there is no need to round-trip through an
`ImageBitmap`.

### 3. Exact change in `proposeFrameMask.ts`

Insert the segmenter as the **new step 1 (highest rung)** of the ladder at
`proposeFrameMask.ts:238-273`, keeping every existing rung below it as fallback:

- **New 1.** `await segmentInteractiveInSelection(sourceFrame, box, pose, racketBox, vw, vh)`
  → try MagicTouch with the pose/racket-seeded scribble. If it returns a mask that
  passes `maskHasContent` (already imported, `proposeFrameMask.ts:6`) **and** a
  sanity area check (e.g. filled fraction within 0.2%–90%, mirroring the
  motion-diff guard at `proposeFrameMask.ts:163`), use it as `aiSnapshot`.
- **1a/1b (unchanged).** Motion-diff vs median plate, then vs single frame — kept
  as fallback when the model is unavailable (returns `null`, e.g. WASM/model load
  failed) or produces an empty/insane mask.
- **2 (unchanged).** Color flood-fill matte.
- **3 (unchanged).** `fillBoxMask` guaranteed non-empty proposal.

`proposeFrameMask` already takes the selection box and object type; add optional
params `pose?: PoseKeypoint[]` and `racketBox?: NormRect | null` (both already
computed elsewhere on the paused frame) so the seeds can be built. When they're
absent, the function still works — MagicTouch can be seeded from the selection
box's center point alone (`keypoint` ROI at the box centroid), then the ladder
falls through as today.

### 4. Fallback strategy (unchanged safety net)

The existing ladder **is** the fallback and must stay:
- Model unavailable / errors / returns empty → fall to motion-diff → flood matte →
  solid `fillBoxMask`. The coach's manual brush/flood editor
  (`maskUtils.ts:32`,`:62`) remains the final say on every frame, exactly as the
  header comment at `proposeFrameMask.ts:212-221` promises. No regression to the
  guaranteed-non-empty behavior.
- Because MagicTouch is additive at the top of the ladder, worst case we're no
  worse than today; best case the ~30% auto-success rate rises substantially on
  the tripod/phone-mount clips that are V1's capture case.

---

## Assets to self-host

| Asset | Path to place it | Size |
|---|---|---|
| `magic_touch.tflite` (float32) | `public/models/magic_touch.tflite` | **5.9 MiB (6,227,884 B)** |
| WASM runtime | already at `public/mediapipe-wasm/` (reused) | — |

Source URL to download once and vendor (do **not** load from CDN — the app's
self-hosting discipline, `mediapipePose.ts:20-23`):
`https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite`

---

## Sources

- MediaPipe Interactive Image Segmenter task guide — https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter
- `@mediapipe/tasks-vision` package — https://www.npmjs.com/package/@mediapipe/tasks-vision
- Installed API surface: `node_modules/@mediapipe/tasks-vision/vision.d.ts` (v0.10.35) — `InteractiveSegmenter` (`:1807`), `RegionOfInterest.keypoint/scribble` (`:2646`), `confidenceMasks`/`MPMask.getAsFloat32Array` (`:1963`, `:2212`).
- MobileSAM (encoder 5M-param Tiny-ViT, ~12 ms/img GPU; Apache-2.0) — https://github.com/ChaoningZhang/MobileSAM and https://docs.ultralytics.com/models/mobile-sam
- MobileSAM/SAM2 in-browser via onnxruntime-web + WebGPU (asset sizes, encoder/decoder split) — https://github.com/akbartus/MobileSAM-in-the-Browser , https://github.com/lucasgelfond/webgpu-sam2
- ONNX Runtime Web WebGPU acceleration — https://onnxruntime.ai/docs/tutorials/web/
- Model sizes verified via HTTP `content-length` against `storage.googleapis.com/mediapipe-models/...` (2026-07-15).
