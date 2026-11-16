# AI Track ON vs OFF — audit, measurements, fixes (Skeleton Stage 2a, commits 4–5)

Two different pipelines draw "the skeleton". They share the overlay but nothing else: different model, different person choice, different timing, different smoothing. Findings below are from reading the code (line refs on this branch) and from measurements; what is NOT proven is listed at the end.

## 1. Where the two pathways differ

| | **AI Track ON** (baked) | **AI Track OFF** (live) |
|---|---|---|
| Model | MediaPipe Pose Landmarker (full/heavy), `lib/mediapipePose.ts` `detectPosePrecise` (:339), single pose | MoveNet (Lightning/Thunder) in a worker, `lib/poseWorker.ts`, via `lib/poseWorkerBridge.ts` |
| Who is tracked | **No identity tracking** in the unlocked pass: each frame the model returns its own "most salient" person (`app/analysis/page.tsx` unlocked loop, after `:1670`). Only the *locked* pass follows a person (`followStep`, `lib/aiTrackLock.ts`) | Worker auto-focus crop around the person it already found (`setFocusPoint`, `Canvas.tsx:4588`) |
| Timing | Offline: seek to the exact frame, detect, store with that frame's time → no latency by construction | Real time: capture → worker → result → draw. The result describes a frame ~inference-time old |
| Smoothing | median-5 outlier repair + centred Gaussian (zero lag, `lib/trackSmoothing.ts`) | One Euro (`lib/keypointSmooth.ts:54`, timed by result *arrival*) + a display blend in `Canvas.tsx` |
| Shown | `lookupBakedPose(video time)` — exact for the frame | newest detection, blended |
| Saved/exported | the baked track (this is what the Metrics export reads) | never saved except as a snapshot's frozen pose |

So "the final saved track differs from the live result" is **true by design**: different model, different keypoint noise, and the baked pass may follow a different person than the one the coach saw live.

## 2. AI Track ON — why limbs get mixed

Checked and **ruled out as the cause**:
- joint index mapping (`COCO_FROM_MEDIAPIPE`, `mediapipePose.ts:36-54`) matches MediaPipe's landmark order;
- left/right un-mirroring for flip-TTA only swaps same-class pairs (`LR_PAIRS`, `:113`), so it cannot turn an arm into a leg;
- baked playback matches joints by *name* (`lookupBakedPose`), smoothing is per named joint.

**Measured cause: the detector's own output on small players.** On stored real MediaPipe-heavy detections of the Demo clip (new metric `crossClassJumps`: a joint jumping to where a *different limb class* was):

| Player height in frame | arm→leg + leg→arm jumps | whole-body jumps | missing frames |
|---|---|---|---|
| large (≈ 600 px, 249 frames) | **0** | 0 | 0 |
| ≈ 300 px, full-frame detection (what AI Track ON ran) | **26** in 62 frames (16 at score ≥ 0.2) | 3 | 21/90 |
| ≈ 300 px, crop tracking | **0** | 0 | 0 |

The wrong joints are often *confident*, so a confidence threshold cannot catch them; and they are *sustained* (neighbouring frames are wrong too), so per-joint neighbour checks (commit 2) did not remove them either (4+2 jumps remained vs 4+1 with the old smoother). Crop tracking (commit 3) removes the cause where it applies (small, known player). Where it does not apply, commit 4 adds a **frame-level layout gate** (see §7 for its redesign after the first device test): arms longer than legs, or an inverted body in an upright clip, ⇒ the frame is dropped like a missed detection.

Identity (which person): no code path in the unlocked pass guarantees the same person frame to frame. I could not reproduce a switch on the single-player Demo, so this is **a code-level risk, not a measured failure**. The bake report (below) counts whole-body jumps so your clips can show it.

## 3. AI Track OFF — why it is late (model, then fixes)

Measured in a model of the live path (`lib/skeletonBench/liveSim.ts`; truth sampled at 240 Hz, forehand with ≈ 4800 px/s wrist, 60 Hz render, detection back-to-back, 3 px noise). Lag = best-fit shift between what is on screen and the player in the frame being shown.

| Inference time | Previous display lag | Smoothing alone (no filter vs One Euro) | **New display lag** |
|---|---|---|---|
| 40 ms | 85 ms | 65 vs 65 ms | **50 ms** |
| 80 ms | 165 ms | 130 vs 130 ms | **115 ms** |
| 150 ms | 305 ms | 235 vs 235 ms | **220 ms** |

Findings:
1. **The smoother is not the cause.** One Euro vs no smoothing: identical lag. Changing its derivative cutoff also made no difference (my first suspicion, wrong).
2. **Lag ≈ 2 × inference time.** One inference time is unavoidable; the second is the display itself: `Canvas.tsx` interpolated *prev → latest*, always showing a pose one whole detection interval older than the newest one.
3. Fix (`lib/liveDisplay.ts`, used in `Canvas.tsx`): continue the motion from the newest detection using the last two samples' velocity, bounded (1.25 intervals, 150 ms), and falling back to the old smooth interpolation for joints inside the noise floor (otherwise a still player's noise was amplified: σ 2.2 → 3.9 px, caught by a test; and slow motion stair-stepped).
4. Not done on purpose: compensating the inference latency itself. Full compensation cuts lag further (≈ 95 ms at 80 ms inference) but overshoots on a decelerating swing: mean error 0.169 vs 0.132 and max error 1.32 vs 1.02 body-heights. Accuracy wins over responsiveness here.

Result (model): lag −35 / −50 / −85 ms; mean error equal or lower; max error equal; stair-stepping 0 %; still-player jitter 2.18 → 2.15 px.

## 4. Rollback and report
- `localStorage['anglemotion:skeleton-legacy']='1'` ⇒ previous behaviour for **both** pathways (bake: full-frame + smoothing only; live: prev→latest blend, read once at page load — reload after setting it).
- `?debug=1`: after an AI Track bake, the debug panel's event list shows `bake: N frames · swaps fixed · frames dropped · joints hidden` (and, in dev builds, the console shows crop/full counts).

## 5. NOT proven (needs real clips / devices)
- Model ≠ device: real inference time, worker scheduling and frame skipping on iPhone Safari / Android Chrome are unmeasured here. The `?debug=1` panel shows inference and round-trip time; send me those numbers per device.
- Real-world arm/leg confusion evidence is from one clip (Demo) with a *shrunk* player; real far-court footage may differ.
- Identity switches between two players are untested on real footage.
- Thresholds (frame gate 1.5× / 0.6× / ≥ 3 bones; display deadband 1.2 % of body height) are my choices, not tuned on real data.
- `exportPose.ts` also uses the One Euro class; it is untouched by these changes.

## 6. Manual test plan (both modes, existing vs new)
Use `localStorage['anglemotion:skeleton-legacy']='1'` (+ reload) for "existing", clear it for "new".
**AI Track ON** — serve, forehand, backhand, a far-court player, two players on court: limb assignment (no legs-as-arms, no L/R flips), same player throughout, wrist keeps its speed, `?debug=1` bake report numbers.
**AI Track OFF** — play at 1× and 0.25× during fast swings: does the skeleton sit on the racket arm? Pause on contact: is the pose the frame's pose? Note `?debug=1` inference/round-trip ms and tell me the device.


## 7. First real-device test (build cc66f1c, phone, locked player on a serve clip) and what changed after it

What the panel showed (facts, not model):
- The run used the **locked-player** pass ("Following locked player"). The crop tracking from commit 3 only covered the *unlocked* pass, so **it never ran on that test**. Fixed: the locked pass now tries a crop around the followed box first and requires the crop pose to pass `followStep` (so it still continues the locked player, not a known other); otherwise the unchanged full-frame multi-person detection runs. Debug line: `locked crop: N crop frames · M full-frame/gap · K identity-rejected`.
- Bake report: `37 frames · frames dropped 8 · joints hidden 120` — **22 % of frames and ≈ 27 % of joints removed in the middle of a serve**. That is too aggressive and is the likely reason later stills show a fragmented skeleton (arms missing). Cause: the first frame gate compared each bone with its own local median length; arm↔leg swaps only marginally exceed its thresholds (arm bone ×1.55 vs a 1.5 limit) while real serve foreshortening also trips it. Replaced by a limb-class invariant (mean arm-bone length > 1.25 × mean leg-bone length; or an inverted body while arms are not clearly shorter, only in upright clips — a rotated clip switches that rule off). Tests: 16/16 injected frames still dropped, 0 drops on clean swings, foreshortened-arm + squat serve, and a rotated clip. Real small-player data: 10/69 dropped, visible jumps 67 → 7; large player 0 drops. The bake line now also splits hidden joints into low-score / outlier / bone so the next test shows which rule acts.
- Live path (idle, paused, seek-detections): inference p50 **54–67 ms**, round trip **94–106 ms** (≈ 40 ms transport/capture on top of inference); during the AI Track pass: inference 36 ms but round trip **167 ms**, main-thread 21 fps (the bake runs on the main thread). So the live skeleton is at least ≈ 100 ms behind before any display effect; the display fix removes about one more detection interval (model: −35…−50 ms) but cannot remove the round trip.
- Both screenshots taken while PLAYING show `calls/s 0` and no skeleton: once a baked track exists the skeleton is deliberately hidden outside tracked sections (`hiddenByTrackScope`), so that run says nothing about live speed. **Needed:** panel numbers while playing with no AI Track baked.

Options for going below the ≈ 100 ms round trip (not done; each has a cost): lighter model (Lightning: faster, less accurate); a look-ahead second decoder that detects the frame the main video will show one round trip later (aligns skeleton and picture, but a second video decoder is a real memory/battery risk on phones); or leave live as a preview and use AI Track for analysis. Needs your decision.
