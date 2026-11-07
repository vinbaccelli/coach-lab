# Fast, high-quality skeleton in a web app: options, evidence, cost and time

Research and diagnosis only, no source changed. Written 2026-11-07 on `diag/phone-tracking-feasibility` (PR #149). Companion to `docs/PHONE_TRACKING_FEASIBILITY.md`.
Evidence labels: **measured** (this session, desktop Chromium CPU), **sourced** (a public page, linked, one search pass each, snippets only: the session's network blocks most sites, so I could not open papers or repos), **reasoned** (my engineering estimate, no source). Dev times and costs are estimates and say so. No app was reverse-engineered.

## 1. What the three screenshots show
Three frames from one serve, all captioned "Following locked player".
1. **Collapsed skeleton.** Every joint is bunched in a ~60 px patch on the chest; the racket arm overhead and both legs are not represented. Data column: L knee 0°, R elbow 153°.
2. **Arm up, legs gone.** A yellow line runs from the raised hand to the hip, but the lower body is missing: L elbow 177°, R elbow 0°, L knee 0°, R knee 173°.
3. **Wrong arm.** In the video the tossing arm is stretched up to the ball; the skeleton draws it hanging down along the thigh. Both knees read 0°.
Readings of exactly 0° in the data column are joints that were not found or sit on top of each other, not real angles.

What this tells us:
- **These are most likely raw per-frame detections shown while the pass runs.** The green "Following locked player" label is set only inside the locked-player pass (`app/analysis/page.tsx:1612, 1629`), and the playhead is moving through the section. The baked track is later cleaned (median over 5 samples, then a Gaussian: `lib/trackSmoothing.ts`), but a frame that collapses to the chest is garbage the cleanup cannot repair.
- **The serve is the hardest case for a single-frame model:** arms overhead, the body stretched along the image axis, fast racket arm, motion blur at the contact point. Collapsing to the torso and losing the legs is the typical way such a model fails when it is not confident.
- **This clip is not the "tiny player" case from my first experiment.** On the demo clip (large player, 653 px body extent) I scanned all 250 frames at 30 fps with the heavy model: **0 collapsed frames, 0 jumps, 0 left/right swaps**, whole frame and crop alike (measured). So "no crop" alone does not explain a bad serve clip; it explains small players. For this serve the likely contributors are: a player at roughly 35% of the frame (the measured failure band begins below ~30%), the **4-person full-frame detector the locked path uses** (`lib/aiTrackLock.ts` `MAX_TRACK_POSES = 4`, which I did not test), and the serve pose itself. I cannot separate them without the clip.

## 2. What the industry does (sourced; the web gives patterns, not CoachNow's recipe)
- **Top-down, two stages.** A detector finds the person, then a pose model runs on a **crop of that person**. RTMPose is this design: RTMPose-m reaches 75.8% AP on COCO with 90+ fps on a desktop CPU, with flipping ([paper](https://arxiv.org/pdf/2303.07399)). A clinical-movement comparison found RTMPose the most accurate direct 2D estimator and BlazePose the fastest ([Scientific Reports](https://www.nature.com/articles/s41598-025-22626-7)).
- **It already runs in a browser.** An RTMDet + RTMPose-s demo runs through ONNX Runtime Web with 17 COCO keypoints at 256×192 and a ~22 MB + 3 MB download ([EZ-MMLA](https://mmla.gse.harvard.edu/tools/rtmpose/)). I found **no published browser benchmark** against BlazePose, and none for an iPhone.
- **Sports serves specifically.** A 2026 workshop paper estimates 3D professional serves from broadcast video with RTMDet + RTMPose (2D) + MotionBERT (lift to 3D), code and data public ([CVBW 2026](https://cvbw2026.github.io/_pages/11.html)). Another notes broadcast tennis adds motion blur, changing angles and low resolution ([NHSJS](https://nhsjs.com/wp-content/uploads/2026/09/Using-AI-Pose-Estimation-to-Characterize-Tennis-Serve-Phases-and-Explore-Serve-Speed-Prediction-1.pdf)). I found no ViTPose-vs-RTMPose test on serves.
- **Dropout and swap handling** is done outside the model: keep a joint's side label for a short time after a loss, blend predicted to measured over a few frames, per-joint Kalman filter ([GitHub issue example](https://github.com/Gann4Life/HandCameraDriverbyDmonOw/issues/41), [Kalman example repo](https://github.com/BlazeWild/Real-Time-Motion-Transfer-to-a-3D-Avatar)). Small projects, but the same pattern.
- **WebGPU on iPhone:** shipping in Safari 26 / iOS 26 ([WebGPU in iOS 26](https://appdevelopermagazine.com/webgpu-in-ios-26/)); one source says it covers every iOS browser because they all use WebKit, which I could not confirm against a primary source. Older iOS versions have no WebGPU. No data on ONNX Runtime Web's WebGPU backend on iPhone.
- **CoachNow and Dartfish:** public pages say nothing on where or how (see the feasibility doc §6). "Feels fast" is most likely a precomputed track you scrub, not live inference (reasoned).

## 3. Options (web only)
| | What it is | Dev time (reasoned) | Run cost | Expected quality | Main risk |
|---|---|---|---|---|---|
| **A** | Keep MediaPipe. Add a crop that follows the player, a re-acquire step, forward + backward fusion, a gap filler (replaces split-on-gap), left/right and collapse checks | 4–6 days incl. tests | none | fixes small-player failure (measured); serve robustness unproven | serve-pose failures may remain |
| **B** | Top-down RTMDet + RTMPose in a worker (ONNX Runtime Web, WebGPU where available, WASM fallback), same crop tracker | 8–12 days (model export and hosting, crop/affine and keypoint decoding, foot keypoints via a Halpe26/whole-body variant, integration, A/B test) | none (static files ~25 MB) | likely better on hard poses (sourced, general benchmarks); unmeasured here | ORT-web memory on phones (we hit its wall with SAM-2; these models are far smaller), foot keypoints, no browser benchmark exists |
| **C** | GPU server for the AI Track: heavier model (RTMPose-x / ViTPose-class) + tracker + bidirectional smoothing; same server later for SAM-2 racket masks | 3–5 weeks (upload and queue, job status, auth and quotas, GDPR terms for minors' videos, cold starts, monitoring) | ~$0.003–0.015 per 10 s clip of GPU (reasoned: a T4/L4-class GPU at roughly $0.6–1.2/h for 15–40 s per clip; **I could not source L4/T4 prices**; H100 quoted $2–4/h across vendors, [comparison](https://blog.premai.io/9-best-serverless-gpu-providers-for-llm-inference-2026)) + storage and egress | best attainable, and the only route to heavy SAM-2 on phones | engineering, compliance, network dependence at the court |
| **D** | A on the phone now; C later as a "high quality" Pro/Academy feature | A + C | as C, only for those jobs | both | scope |
The costs that matter are developer time and compliance, not GPU money. As an illustration (reasoned): 10,000 clips a month would be roughly $30–150 of GPU.

## 4. Recommendation
1. **Do A first, tested on your serve clip.** It is the cheapest, it is on every path (B and C also need the crop tracker), and it will show how much of the serve problem is the crop and how much is the model.
2. **In parallel, a 2–3 day spike for B** on the same clip and the demo clip: RTMPose-s/m via ONNX Runtime Web against MediaPipe full/heavy, accuracy by eye plus the jump/collapse/swap counters, speed on desktop and on your phone. Decide B only on that data.
3. **C only if A and B leave serve quality short, or when we price a "heavy" tier.** Same server also unlocks the Motion Layer racket on phones.
4. **Do not change the live skeleton path** (MoveNet worker, measured 40–53 ms on a phone); the speed users see comes from the baked track.

## 5. What I need
- **A short serve clip (5–10 s) from your phone**, or a link, as the test set. Without it every number above is the demo clip. (Google Drive is connected to this session; a clip dropped in Drive can be fetched if small enough.)
- **Network access for the spike:** huggingface.co and download.openmmlab.com are blocked here, so I cannot download RTMPose models until you approve those hosts for this session. I have not requested it.

## 6. Not found / limits
No published RTMPose-in-browser vs BlazePose benchmark; no iPhone WebGPU timing; no CoachNow/Dartfish architecture; GPU prices for T4/L4 not sourced; all dev times are my estimates; the serve-failure attribution in §1 is a judgement from three screenshots.
