# RESEARCH — Precision AI Track: near-perfect pose + no UI freeze

Research doc only (no feature code). Grounds every recommendation in the current
implementation and current web docs. Cite `file:line` and URLs throughout.

## 0. Current implementation (what we're improving)

- **Pass loop** — `app/analysis/page.tsx:1058-1120` (`runPrecisionPass`). Hardcoded
  `FPS=30` → `step = 1/30` (`:1086-1087`); **one** inference per frame
  (`mp.detectFullPoseOnFrame`, `:1095`); seek via `seekTo` that resolves on
  `'seeked'` **or a 200 ms timeout** (`:1075-1084`) — the timeout can fire before
  the new frame is painted and grab a **stale** frame.
- **Model** — `lib/mediapipePose.ts:71-95`. `pose_landmarker_full.task` **only**
  (9.0 MB on disk, confirmed), `runningMode:'IMAGE'`, `numPoses:1`, GPU→CPU
  fallback, **no confidence thresholds set** (defaults), image-space landmarks
  only — `worldLandmarks` never read (`:108-127`). Uses `.visibility` as `score`.
- **Smoothing** — `lib/trackSmoothing.ts:25-29`. Rolling-median outlier repair
  (window 5) + zero-lag centered Gaussian (half-window ±3, σ 1.2),
  confidence-weighted. This is good and stays; we only widen the window per tier.
- **Freeze cause** — MediaPipe `detect()` runs **synchronously on the main
  thread** inside the loop, and the video is continuously paused/seeked. The live
  skeleton (MoveNet, `lib/poseWorker.ts` via `lib/poseWorkerBridge.ts`) and the UI
  both starve. StroMotion's racket detector (`lib/racketCocoDetect.ts:21-36`,
  COCO-SSD + TFJS `webgl` backend) is **also main-thread** and blocks the same way.
- **Seek helper** — `seekVideoTo` (`app/analysis/page.tsx:870-877`) uses `'seeked'`
  + 1500 ms timeout; the pass uses its own tighter 200 ms variant.

Key implication for everything below: the loop is **offline / paused-frame**, so we
have unlimited time budget per frame and can trade latency for accuracy freely —
the only real constraints are total wall-clock (warn the user) and not freezing the
tab while it runs.

---

## 1. Model tier — FULL vs HEAVY vs LITE

Confirmed asset URLs and **actual sizes** (HTTP HEAD, float16/latest):

| Tier  | `.task` URL (storage.googleapis.com/mediapipe-models/pose_landmarker/…) | Size | GPU latency | CPU latency |
|-------|--------------------------------------------------------------------------|------|-------------|-------------|
| Lite  | `…/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`        | 5.5 MB | ~5 ms | ~15 ms |
| Full  | `…/pose_landmarker_full/float16/latest/pose_landmarker_full.task`        | 9.0 MB | ~8 ms | ~30 ms |
| Heavy | `…/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task`      | **29.2 MB** | ~15–20 ms | ~80+ ms |

- Heavy is a materially deeper network → **superior landmark stability and
  accuracy under occlusion / motion blur**, at ~2–3× the per-inference cost of
  Full on GPU (much worse on CPU). It is explicitly positioned as the "batch
  processing where latency doesn't matter" tier — which is **exactly** our offline
  paused-frame pass.
- All three share the same 33-landmark schema, so `COCO_FROM_MEDIAPIPE` /
  `FOOT_FROM_MEDIAPIPE` mapping (`lib/mediapipePose.ts:35-60`) is unchanged. Adding
  Heavy is a pure asset+config swap, not a data-shape change.
- **License:** MediaPipe (framework + published `.task` bundles) is **Apache 2.0**
  — commercial use, modification, redistribution all permitted. Self-hosting the
  file under `public/models/` (as we do for Full) is fine.

**Recommendation: add HEAVY and self-host it** (`public/models/pose_landmarker_heavy.task`,
29.2 MB). Make the model tier a function of the quality slider (Full at the fast
end, Heavy at the precise end). Heavy is worth it here specifically because we are
offline; it would be the wrong call for the live MoveNet path. Lazy-load it (only
fetch the 29 MB when a Heavy-tier pass is actually requested) so the app's initial
payload doesn't grow — mirror the existing `getLandmarker()` lazy pattern
(`lib/mediapipePose.ts:71-95`) but keyed by tier.

Sources: [Pose Landmarker guide (Google AI Edge)](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker),
[MediaPipe pose model card / solutions doc](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md),
[MediaPipe commercial use / license (QuickPose)](https://quickpose.ai/faqs/can-mediapipe-be-used-commercially/).

---

## 2. Multi-inference median per frame — mostly a trap; do TTA instead

**Is IMAGE mode deterministic per call?** Effectively **yes**. `runningMode:'IMAGE'`
(`lib/mediapipePose.ts:80`) carries **no temporal state** — unlike VIDEO/LIVE_STREAM,
which apply an internal Kalman-style landmark filter across timestamps. With the
same pixels and the same backend, `detect()` returns the same landmarks; GPU
floating-point non-determinism is sub-pixel and negligible. The MediaPipe docs
describe IMAGE mode as a stateless single-shot `detect()` with no smoothing.

Consequence: **running N inferences on the *identical* still frame and taking the
median buys almost nothing** — you'd average N near-identical vectors. It burns N×
time for ~0 jitter reduction. The jitter we care about is **frame-to-frame**, and
that is already handled offline by `trackSmoothing.ts`.

**What actually helps: test-time augmentation (TTA) median.** Perturb the *input*,
run detect on each variant, invert the transform on the output landmarks, then take
the **per-joint median**. Cheap, high-value perturbations:
- **Horizontal flip** (and swap left/right landmark names back) — the strongest
  single win; corrects the model's left/right bias and stabilizes limbs.
- **Small scale/crop jitter** (±3–5 %) and/or ±1–2° rotation — decorrelates the
  resize/letterbox quantization the task does internally.

Median-of-K-TTA-variants removes per-frame *bias*, which temporal smoothing can't
(smoothing only attacks variance across time; a consistently-biased joint stays
biased). This is where "extremely perfect" earns its cost.

**Per-tier K (TTA variants, not naive repeats):** fast tier K=1 (no TTA); default
K=2 (original + h-flip); precise tier K=3 (original + h-flip + one scale-jitter),
optionally K=5 at the extreme. Take the median across variants per joint x/y; carry
the max visibility as the sample score.

Caveat: TTA adds real implementation surface (transform/untransform + left/right
remap on flip). If you want a v1 that ships fast, **skip TTA, ship Heavy + rVFC +
worker**, and add TTA as the 0.1× tier later — Heavy alone closes most of the gap.

Sources: [Pose Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js),
[running modes / IMAGE vs VIDEO](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).

---

## 3. Exact-frame capture — adopt `requestVideoFrameCallback` (rVFC)

**Problem with today's code:** `seekTo` (`app/analysis/page.tsx:1075-1084`) resolves
on `'seeked'` **or** a 200 ms timeout. `'seeked'` fires when `currentTime` updates,
but the new frame is composited on the compositor thread slightly later — and if the
timeout wins first, `detect()` reads a **stale/previous** frame. That silently
corrupts samples on exactly the fast-moving frames we most care about.

**rVFC** fires its callback with a `metadata.mediaTime` that is populated from the
decoded frame's `presentationTimestamp` — i.e. it tells you **which frame is
actually painted**, not just that the clock moved. Correct pattern: set
`currentTime`, wait for `'seeked'`, then wait one rVFC callback whose `mediaTime`
has advanced past the last captured frame, and infer inside that callback.

```
// Shape only — not to be pasted verbatim.
async function seekAndGrab(video, targetT, lastMediaTime) {
  await new Promise(res => {
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); res(); };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = targetT;
  });
  return await new Promise(res => {
    const cb = (now, meta) => {
      // guarantee a NEW, painted frame (guards against a stale repaint)
      if (meta.mediaTime <= lastMediaTime + 1e-4) { video.requestVideoFrameCallback(cb); return; }
      res(meta.mediaTime);            // <-- frame is on screen; infer now
    };
    video.requestVideoFrameCallback(cb);
  });
}
```

- Infer **inside/after** the resolved callback; use the returned `mediaTime` as the
  bake sample's `t` (frame-accurate) instead of `video.currentTime`.
- **Browser support:** Chrome/Edge 83+, **Safari 15.4+**, **Firefox 132+** — broad
  enough to make rVFC the primary path. Keep the current `'seeked'`+timeout logic
  as a **fallback** guarded by `('requestVideoFrameCallback' in HTMLVideoElement.prototype)`.
- **Honest limitation:** the `<video>` element does **not** guarantee frame-accurate
  *seeking* — rVFC guarantees you capture *a* painted frame and *know which* one
  (via `mediaTime`), but the browser may land on an adjacent frame. For our use
  (dense sampling + offline smoothing) this is fine; only WebCodecs
  `VideoDecoder` gives hard frame-exactness, and that's a much larger rewrite —
  **not recommended for v1**.

Sources: [web.dev rVFC guide](https://web.dev/articles/requestvideoframecallback-rvfc),
[MDN requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback),
[WICG spec](https://wicg.github.io/video-rvfc/).

---

## 4. Sampling density — read true fps instead of hardcoded 30

There is **no direct fps API**. Two viable approaches:

1. **Derive from rVFC `mediaTime` deltas (preferred):** during a short warm-up
   (play/step ~10–15 frames), collect consecutive `mediaTime` values; the modal /
   median delta ≈ one frame period. `fps ≈ 1 / medianDelta`. Round to a common rate
   (24/25/30/50/60). This replaces the `FPS=30` constant (`:1086`) with the video's
   real cadence, so we sample **once per real frame** — the accuracy-correct density.
2. **Sensible default fallback:** if rVFC is unavailable or the warm-up is noisy,
   keep 30 fps (current behavior) as the floor. Never sample *below* the real frame
   rate (misses frames) and rarely gain from sampling *above* it on a normal video
   (you re-detect the same painted frame).

**Sub-frame / super-sampling for the extreme tier:** stepping *between* real frames
does not create new information (same painted frame), so don't. If the 0.1× tier
wants "more samples," spend the budget on **TTA (K) and Heavy**, not on sub-frame
steps. The one exception is if you later interpolate for slow-mo *output* — that's a
render concern, not a detection-density concern.

Sources: [web.dev rVFC — mediaTime for frame identity](https://web.dev/articles/requestvideoframecallback-rvfc).

---

## 5. Off-main-thread vs yielding — fixing the freeze

Two independent freeze sources, both main-thread: (a) MediaPipe `detect()`
(`lib/mediapipePose.ts:108`), (b) COCO-SSD `model.detect()` for StroMotion
(`lib/racketCocoDetect.ts:54`). The live MoveNet skeleton is already in a worker
(`lib/poseWorker.ts`) so it's a victim, not a cause.

### Can MediaPipe Tasks Vision run in a Web Worker? Yes — with constraints.
- Google ships an **official worker sample**
  (`mediapipe-samples-web/src/workers/pose-landmarker.worker.ts`) and the guide
  documents worker usage. `FilesetResolver.forVisionTasks()` works inside a worker
  pointed at our **self-hosted** `/mediapipe-wasm` fileset (same path we already
  copy, `lib/mediapipePose.ts:76`).
- **Frame transfer:** you cannot post an `HTMLVideoElement` to a worker. Convert on
  the main thread with `createImageBitmap(video)` and `postMessage({bitmap},
  [bitmap])` (transferable — zero-copy). `ImageBitmap` is a valid input to
  `PoseLandmarker.detect()`.
- **Gotchas:**
  - **Module-worker vs `importScripts`:** older `@mediapipe/tasks-vision` builds
    used `importScripts` internally, which breaks in ESM workers. With Next.js,
    instantiate the worker as `new Worker(new URL('...', import.meta.url), { type:
    'module' })` and import `@mediapipe/tasks-vision` normally; verify against our
    pinned `^0.10.35`. If it fails, the documented workaround is a classic worker +
    `importScripts` of a namespaced build.
    (`package.json`: `"@mediapipe/tasks-vision": "^0.10.35"`.)
  - **iOS 17 OffscreenCanvas bug:** MediaPipe has tried to create a normal
    `<canvas>` inside the worker on some iOS builds → fails. Since we pass
    `ImageBitmap` (not an OffscreenCanvas we manage) and run offline, exposure is
    low, but test on iOS Safari.
  - We must **serialize** the returned landmarks over `postMessage` and re-run the
    COCO-mapping (`lib/mediapipePose.ts:114-130`) on the main thread, or move the
    mapping into the worker.

### Recommendation (staged)
- **Ship first — minimal yielding (low risk, ~1 day):** keep `detect()` on the main
  thread but (a) **suspend the live overlay/MoveNet worker** for the duration of the
  pass (it's redundant — the bake replaces it), and (b) `await` a **`requestAnimationFrame`
  (or `scheduler.yield()`/`setTimeout(0)`)** between every frame so the UI can
  paint the progress bar and stay responsive. rVFC (Section 3) already inserts a
  yield point per frame, so this is largely free once rVFC lands. This removes the
  *perceived* freeze even though inference still hits the main thread in bursts.
- **Then — worker-ize inference (medium risk, the real fix):** move the MediaPipe
  landmarker into its own worker (separate from the MoveNet live worker) using the
  official sample as the template, feed it `ImageBitmap`s. This fully decouples the
  pass from the main thread and lets the live skeleton keep running if we ever want
  overlap. **Risks:** Next.js worker bundling for `@mediapipe/tasks-vision`, the
  ESM/`importScripts` issue above, iOS Safari, and a second WASM+model load in the
  worker (memory: Heavy is 29 MB of weights per instance — don't hold both live and
  bake landmarkers if avoidable).
- **StroMotion / COCO-SSD:** same story — TFJS supports a **`webworker` context**;
  moving `racketCocoDetect` into a worker is feasible but lower priority since the
  racket pass is shorter. Apply the same rAF-yield stopgap there first.

Net: **do the yielding stopgap for v1** (kills the freeze perception, tiny risk),
**schedule worker-ization as the durable fix**. Don't block the precision feature on
full worker-ization.

Sources: [Running tasks-vision in a Web Worker (ankdev)](https://ankdev.me/blog/how-to-run-mediapipe-task-vision-in-a-web-worker),
[Official pose-landmarker.worker.ts sample](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/pose-landmarker.worker.ts),
[Pose Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js),
[iOS 17 worker issue #5292](https://github.com/google-ai-edge/mediapipe/issues/5292).

---

## 6. Confidence gating + world landmarks

**Confidence gating — adopt, lightly.** We already use `.visibility` as `score`
(`lib/mediapipePose.ts:119,125`) and gate feet at ≥0.3 (`:126`) plus a core-body
sanity check (`:129`). Additions worth making:
- Set explicit model thresholds instead of defaults: `minPoseDetectionConfidence`
  and `minPosePresenceConfidence` (defaults 0.5 each). For an offline pass you can
  **lower detection confidence** (e.g. 0.3) to avoid dropping whole frames on hard
  poses, then rely on **per-joint visibility gating + the outlier-repair median**
  (`trackSmoothing.ts:44-59`) to reject bad joints. `minTrackingConfidence` is
  irrelevant in IMAGE mode (no tracking).
- Before baking, **drop or down-weight** samples whose core-joint visibility is low
  rather than letting a low-confidence frame anchor the Gaussian. The smoother is
  already confidence-weighted (`trackSmoothing.ts:76`), so feeding real visibility
  through is enough — just make sure low-vis joints get *near-zero* weight, not the
  `0.05` floor, when they're clearly wrong.

**World landmarks — do NOT bake them for the on-screen skeleton.** `worldLandmarks`
are metric 3D in a **hip-centered** frame, decoupled from image pixels. Our overlay
draws in **video pixels** (`x*vw`, `y*vh`, `lib/mediapipePose.ts:117-118`); world
coords can't be projected back to pixels without camera intrinsics we don't have, so
they can't replace image-space landmarks for drawing. They also are **not inherently
more stable in 2D** — same network head. Where they *could* help later (V1.1+):
angle/biomechanics metrics that should be viewpoint-invariant (e.g. true 3D joint
angles), where image-space foreshortening distorts the measurement. For the
precision *track* itself: **stay image-space.** Note it in the V1.1 roadmap as a
metrics-accuracy idea, not a track-precision one.

Sources: [Pose Landmarker output (image + world landmarks)](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker),
[config options / confidence defaults](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js).

---

## 7. Parameter ladder — slider → concrete pass params

Slider semantics: **0.1× = extremely perfect (slowest), 0.5× = fastest, default
0.25×.** Lower value = more precision = more work. Cost multipliers are relative to
the **current** pass (Full, N=1, 1 sample/real-frame, ±3 smoothing = **1.0×**), on
GPU. CPU-only roughly triples the Heavy rows.

| Slider | Model | Sampling density | Inference per frame (K) | Smoothing half-window | Rel. time cost | User warning |
|--------|-------|------------------|--------------------------|------------------------|----------------|--------------|
| **0.5× (fastest)** | FULL | every real frame (rVFC-derived fps) | K=1 (no TTA) | ±3 (σ 1.2) | **~1×** | "Fast — good for a quick pass." |
| **0.25× (default)** | HEAVY | every real frame | K=2 (orig + h-flip), per-joint median | ±3 (σ 1.2) | **~5–6×** | "Recommended. ~5× longer than Fast." |
| **0.1× (extremely perfect)** | HEAVY | every real frame | K=3–5 (h-flip + scale/rot jitter) | ±4–5 (σ 1.5) | **~12–18×** | "Best quality. Can take 10–15× longer — good for a single stroke, not a whole clip." |

Cost derivation: Heavy ≈ 2.5–3× Full per inference; K multiplies linearly; sampling
density held at 1×/real-frame across tiers (Section 4). So default ≈ 3 (Heavy) × 2
(K) ≈ 6×; extreme ≈ 3 × 4 ≈ 12× (up to ~18× at K=5). **Always show an ETA** derived
from the existing per-second timing already logged
(`app/analysis/page.tsx:1112-1114`): measure the probe inference, multiply by
frames × K × tier factor, and surface it before the pass starts. Because time scales
with clip length, strongly steer the extreme tier toward **section scope**, not
whole-video (the scope arg already exists, `handlePrecisionTrack('section')`,
`:1122-1147`).

Notes on wiring the ladder:
- Smoothing half-window is `GAUSS_HALF_WINDOW`/`GAUSS_SIGMA` (`trackSmoothing.ts:28-29`)
  — make them a parameter of `smoothBakedTrack` rather than module constants.
- Model tier → a `tier` arg on `getLandmarker()` (`lib/mediapipePose.ts:71`) keyed
  cache so Full and Heavy landmarkers coexist without reload thrash.
- K (TTA) → a new option on `detectFullPoseOnFrame` (`lib/mediapipePose.ts:102`);
  median across variants before the COCO mapping return.

---

## 8. Prioritized recommendation (what to build, in order)

1. **rVFC seek/capture** (Section 3) — biggest correctness win, kills stale-frame
   samples, and gives real fps for free. Fallback-guard for Safari<15.4.
2. **True-fps sampling** (Section 4) from rVFC `mediaTime` deltas; drop the `FPS=30`
   constant.
3. **Yielding stopgap** (Section 5) — suspend the live MoveNet worker during the
   pass + `await rAF` per frame. Removes the perceived freeze at near-zero risk.
4. **Add HEAVY model** (Section 1), lazy-loaded, self-hosted (29.2 MB), tier-keyed.
5. **Quality slider → ladder** (Section 7): Full/Heavy + smoothing width + scope
   steering + ETA. Ship K=1 everywhere first.
6. **TTA median (K>1)** (Section 2) — the "extremely perfect" differentiator; add
   after 1–5 are stable. H-flip first (biggest bang), then scale jitter.
7. **Worker-ize MediaPipe inference** (Section 5) — durable freeze fix; schedule
   after the feature ships behind the stopgap.
8. **Confidence thresholds explicit + low-vis down-weighting** (Section 6). World
   landmarks: defer to V1.1 metrics, not the track.

Do **not**: sub-frame super-sampling (no new info), world landmarks for the overlay
(wrong coordinate space), naive N-repeat inference on identical pixels (deterministic
IMAGE mode → wasted compute), or a WebCodecs rewrite for v1 (scope explosion).
