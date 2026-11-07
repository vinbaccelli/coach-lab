# Can skeleton and Motion Layer be light and fast on a phone? — feasibility

Diagnosis only, no source changed. Branch `diag/phone-tracking-feasibility`, from `main` at `caf593e5`. Code claims carry `file:line`. Numbers are **measured** (desktop Chromium, CPU delegate, this session) or **reasoned**, and labelled. Competitor statements come from their own pages and are marked unverified. I have no insider knowledge of CoachNow or Dartfish.

## 0. Answer
1. **The "drunk" skeleton is mostly a missing piece, not a weak model.** AI Track runs MediaPipe on the **whole frame, every frame, with no memory** (no crop around the player). Measured on the demo clip with the subject shrunk to simulate a player further from the camera: at ~300 px tall in a 1080p frame the whole-frame pass lost the player in **23% of frames** and, in the frames it kept, **12% of joint steps were jumps** of up to ~1 body height in one frame. At ~210 px and below it found **nobody at all**. The same pass with a crop around the last known position: **0 missing, 0 jumps**, at every size tested. (§2)
2. **Lighter and better at once is possible for the skeleton:** with the crop, the smaller `full` model agrees with `heavy` to a median 0.9% of body height (about 2 px at 210 px; p95 2.8%) and runs **2.9× faster** (66 ms vs 193 ms per frame on this CPU). On a phone the AI Track is an offline pass, so this is feasible **on the device**, without a server. Not yet measured on a phone. (§2, §5)
3. **Motion Layer's racket is a different problem:** the memory wall is the SAM-2 and detector models (about 1 GB of WebAssembly heap that the page cannot give back; `docs/PHONE_REFRESH_AFTER_AUTODETECT.md` §7). A phone cannot do it "as on the computer" without either a worker that is terminated after the pass, a much lighter model, or a server. (§4)
4. **A cloud server is not needed for the skeleton.** It is the honest option only for the racket pass, and for a later "heavy" tier. (§6)

## 1. What exists (read from code)
| Piece | Where | Facts |
|---|---|---|
| Live skeleton | `lib/poseWorker.ts:1-60` | MoveNet in a worker, Thunder on GPU with a 80 ms budget, Lightning fallback; a phone was measured at 40–53 ms after a 37 s first shader compile. |
| Live MediaPipe (foot line) | `components/Canvas.tsx:4647-4681` | 15 Hz, 70 ms budget, falls back to MoveNet when slow. |
| AI Track | `app/analysis/page.tsx:1531` (`runPrecisionPass`), `lib/mediapipePose.ts:304-308` | frame-stepped: seek, wait for the frame, detect. Tiers: fast = full @30 fps, balanced = heavy @45, **max = heavy + flip test @60** (the "0.1×" is the pass speed, not playback). |
| Model mode | `lib/mediapipePose.ts:92-96, 233` | `runningMode: 'IMAGE'`, `numPoses: 1`: **stateless**, a cold detection every frame. |
| Locked player | `lib/aiTrackLock.ts:1-30, 43` | asks for up to 4 people on the **full frame** and picks the one continuing from the last box; a gap > 0.25 s splits the track. |
| Cropping | `grep -i crop lib/mediapipePose.ts` | **no matches**: the AI Track never crops. (The live MoveNet worker does: a 0.6 crop, `poseWorker.ts`.) |
| Cleanup | `lib/trackSmoothing.ts:1-30` | rolling median over 5 samples repairs 1–2 frame outliers, then a centred Gaussian (±3). |
| Display | `components/Canvas.tsx:2341-2400` | straight-line interpolation between samples; over a gap > 0.5 s it snaps to the nearest sample. |

## 2. Experiment: whole frame vs a crop that follows the player
Setup: `demo_1080.webm` (1920×1080, 60 fps), 90 consecutive frames (t = 2.0–3.5 s, the swing), MediaPipe PoseLandmarker in the browser, IMAGE mode, one pose, same assets the app serves. To simulate a smaller player the video was drawn at 100/50/35/25% of the frame size onto a flat background (the player's pixel height scales the same way as a player further away; real footage adds blur and clutter, so treat this as a floor). Pass A = whole frame (what AI Track does). Pass B = crop around the previous frame's body box +50%, seeded once from the lock frame (what the lock click already provides), results mapped back to frame coordinates. Jump = a joint moving > 12% of body height in one frame; swap = left/right identities exchanging.

| Player height (of 1080) | Pass | Frames with a pose | Jumps (joint steps) | Max step | Swaps | Jerk p95 |
|---|---|---|---|---|---|---|
| 605 px (56%) | whole frame | 90/90 | 0% | 0.02 | 0 | 0.013 |
| 605 px | crop | 90/90 | 0% | 0.02 | 0 | 0.017 |
| ~300 px (28%) | whole frame | **69/90** | **12.05%** | **0.98** | 0 | **0.643** |
| ~300 px | crop | 90/90 | 0% | 0.03 | 0 | 0.016 |
| ~210 px (19%) | whole frame | **0/90** | – | – | – | – |
| ~210 px | crop | 90/90 | 0% | 0.02 | 0 | 0.017 |
| ~150 px (14%) | whole frame | **0/90** | – | – | – | – |
| ~150 px | crop | 90/90 | 0% | 0.02 | 0 | 0.018 |

Cost and model choice (subject ~210 px, crop pass): `heavy` 193 ms/frame, `full` 66 ms/frame (2.9×). Distance between `full` and `heavy` joints, in body heights: median 0.009, p95 0.028, max 0.050 (wrists: median 0.011, p95 0.027).

Not measured: motion blur, occlusion, two players (the locked path asks for 4 poses), the GPU delegate, a real phone, 4K footage. The clip's player is large, so the clip alone looked fine (row 1). That is why the problem hides on easy clips and appears on a wide court shot.

## 3. Why the skeleton "gets drunk" (ranked)
1. **No memory between frames + the person is small in the frame.** The model's detector sees a fixed small version of the whole frame, so the fewer pixels the player covers, the less it can place the joints. (measured: §2)
2. **The repair cannot fix it.** A median over 5 samples fixes 1–2 bad frames, not a stretch of them; a gap longer than 0.25 s splits the track and the display snaps over a gap > 0.5 s (`aiTrackLock.ts`, `Canvas.tsx:2357`; split constant `aiTrackLock.ts:28`). So the skeleton jumps, vanishes and returns: "drunk". (code + measured)
3. **Not the model tier.** `max` is already `heavy` + flip test at 60 fps (`mediapipePose.ts:307`). Spending more on the same whole-frame pass is the wrong lever. (code)
4. **Untested, possible:** motion blur on the racket arm, the 4-pose locked path, a different clip orientation. I need the screenshots or the clip to separate these.

## 4. Motion Layer on a phone: what is possible
- Person cutout alone runs on phones (shipped in the quick fix).
- Racket: D-FINE (detect) and SAM-2 (segment) hold ~1 GB of WebAssembly memory that stays reserved after release (measured on desktop: renderer 0.7 GB → 2.0 GB; four phone kills, all after SAM-2 loads).
- Options, none built: **(a)** run both in a dedicated worker and terminate it after the pass, so the OS gets the memory back (cheapest, needs a spike; unproven that the runtime releases it); **(b)** a lighter segmentation for rackets (the racket is a thin object; a box-prompted small model on a crop around the wrist is the likely candidate; quality unknown); **(c)** a server for the racket step only (§6).

## 5. What the skeleton is missing, in order of value
1. **Follow the player with a crop** (new, small): crop around the last box with margin, run the same landmarker on the crop, map back; re-acquire on the whole frame when lost. Uses the lock click we already have. Fixes the measured failure and removes the 4-pose full-frame pass.
2. **Use `full` + crop as the phone default, `heavy` + crop on desktop:** 2.9× faster at ~2 px difference.
3. **Run the pass both ways in time and fuse** (forward and backward from the lock frame already exists in `aiTrackLock.passPlan`): cheap quality gain.
4. **Replace the median-5 repair with a gap filler** that bridges short misses instead of splitting the track.
5. **Live skeleton:** unchanged for now (MoveNet worker, measured on a phone at 40–53 ms).

## 6. Do we need a server?
- **Skeleton (AI Track): no.** Crop + `full` is an offline pass of roughly 70 ms per frame on this CPU (reasoned for a phone: 300 frames for a 10 s clip at 30 fps is about 20 s; to be measured on a phone). Smaller models do not hit the memory wall that the racket models do.
- **Racket in Motion Layer: possibly.** On a server GPU, SAM-style segmentation is a fraction of a second per frame instead of 10–15 s on wasm (reasoned, not measured). Costs to decide: per-video GPU cost, upload time on gym/court mobile data, and privacy of players' videos (many are minors; EU rules apply). It fits a Pro plan feature, not Light.
- **CoachNow and Dartfish: what public sources say (searched 2026-11-07; the CoachNow site itself could not be fetched from this session, only search snippets).**
  - CoachNow advertises "AI-enabled skeleton tracking" that "automatically detects and tracks" athletes "in your videos", works "from a range of camera angles, including from behind" and with overlapping limbs, with tap-a-joint angles, inside the paid Analyze suite ([blog](https://coachnow.io/blog/using-coachnows-ai-tools), [help center](https://help.coachnow.io/en/articles/8533900-what-s-included-with-coachnow-analyze), [Analyze](https://coachnow.com/analyze)). **No public page I found says whether it runs on the phone or on a server, what model it uses, or how long it takes.** The App Store lists the developer as Golf Genius Mobile, LLC ([listing](https://apps.apple.com/us/app/coachnow-sports-coaching-app/id596598472)); the privacy policy (`coachnow.io/privacy`) is the place to look for processors, and I could not read it.
  - Dartfish: I found no official page on AI body tracking. One third-party review mentions an AI-assisted overlay ([review](https://www.bow-international.com/?p=7278)). Dartfish has a research partnership with EPFL's VITA lab on person tracking in sport, tested with ten cameras in a hockey arena ([EPFL news](https://actu.epfl.ch/news/artificial-intelligence-deployed-to-enhance-sports)); that is multi-camera, not the phone overlay.
  - **So the architecture of both is unknown from public information.** Anything more would be guessing.
- **My judgement, labelled as reasoning:** CoachNow is a cloud video platform: videos are uploaded and shared anyway, so running pose estimation on the server after upload would be natural for them, and it would explain a heavy model that copes with behind-the-athlete views. But a native app can also run pose models on the phone's neural chip (Apple's Vision framework has built-in body-pose requests; Google ships ML Kit pose), which a web app cannot use. **Either is plausible; I would not bet on one.** The part that matters for us is the second one: a native app gets the phone's neural engine and a PWA only gets WebGL, WebAssembly and, on recent iOS, WebGPU.

### How to find out without reverse-engineering their app
Black-box checks on your own phone, 10 minutes, legitimate use of the app:
1. **Airplane mode.** Load a video into CoachNow, switch on airplane mode, run skeleton tracking. Works = on the phone. Spins or fails = server.
2. **Data used.** iPhone Settings > Cellular (or Wi-Fi usage in a data monitor): note the app's bytes, run tracking on a 20 s clip, check again. A jump near the size of the video = upload.
3. **Clip length and device.** On-device time grows with clip length and differs between an old and a new phone; server time is flat-ish and arrives with a "processing" state or a notification.
4. **Heat and battery.** A phone that warms up during tracking is doing the work itself.
5. **A second device.** Open the same video on another device logged into the same account; a skeleton that is already there was stored by a server.
6. **Ask support in plain words:** "Is skeleton tracking processed on my device or on your servers?" It is a normal customer question.
Do the same checks on Dartfish. I would not intercept their traffic or decompile their apps; that is outside what this project should do.

## 7. Proposed order (smallest steps first)
1. **Phone download fix** (small, safe): use the share sheet or a new tab instead of a same-tab blob link on phones; needs one answer from the tester (see the reply that accompanies this PR). The "add column" control needs a repro.
2. **ROI crop in AI Track** (§5.1) with tests and the same measurement script: the main visible win.
3. **`full` model on phones** (§5.2), measured with the stage trail on a real phone.
4. **Motion Layer racket on phones:** spike (a), then decide (b) or (c).
5. Then the player database.

## 8. Limits
Desktop Chromium, CPU delegate; synthetic downscaling; one clip; 90 frames; the harness lives in the session scratchpad (not in the repo). A phone's GPU delegate and thermal limits will change the absolute times. The ranking and the crop effect are the parts I trust.
