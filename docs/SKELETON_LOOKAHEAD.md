# Look-ahead live skeleton (Skeleton Stage 2b) — EXPERIMENTAL, OFF BY DEFAULT

> **iPhone result (first phone test, build 5b8b8fe):** with look-ahead ON the debug panel showed `main fps 25, max gap 1050 ms, in flight 1041 ms` right after `look-ahead video started`, then the app's stuck-video recovery printed "Video reset. Ready to play.", and later the main video was black ("Tap to Play", readyState 0). A second PLAYING video starved the main video's decoder on that phone. This could not show up in headless Chromium. Consequences: look-ahead is now **opt-in** (`?lookahead=1`, not recommended on iPhone), a stall guard releases the hidden video and blocks it for the session if the main video stops advancing for 0.7 s, and a second playing decoder is **not** a viable way to get zero latency on iPhone. The same test also exposed the stale-pose bug (fixed in d915f3db).
>
> Real phone live-path numbers from the same test: Lightning/wasm inference 19–36 ms, round trip 33–88 ms at 28–30 detections/s; Thunder/webgl inference 52–84 ms, round trip 73 ms+ (first frame 1.1 s). The worker fell back to Lightning/wasm in the first session (`thunder model load timed out` at 50.7 s: cold model download on a new preview address).

Goal: a standard-play skeleton that is on the player at the frame being shown, with AI Track remaining the slow exact pass.

## How it works
- While the main video **plays**, a hidden second `<video>` of the same source is kept `lead` seconds ahead (`lead` = measured worker round trip + 40 ms, × playback speed; `lib/lookAheadPose.ts`).
- The existing pose bridge (**unchanged**, Pose Worker untouched) reads frames from that hidden video. Each result carries the video time of the frame it describes and is stored in a time-indexed buffer (`AheadBuffer`, ≤ 240 entries, ≤ ~1 s behind the playhead).
- The canvas draws `buffer.lookup(mainVideo.currentTime)`, interpolated between neighbouring results, exactly like a baked track (`Canvas.tsx`, the one line that picks the pose to draw). Angles follow the same pose.
- A drift controller (playbackRate nudge ≤ ±10 %, hard seek if > 350 ms off) keeps the hidden video at the lead. 
- **Lifecycle / memory:** created lazily on the first frame of a play, destroyed (`src` removed, `load()`, node removed) on pause, seek-pause, end, skeleton off, unmount. Nothing exists while paused, so the paused/exact path is unchanged.
- **Fallback:** if the hidden video errors, cannot play, is refused autoplay, or stalls (continuously unplayable 3 s / not advancing 2.5 s), the previous live path (commit 5 display) is used. Reason shown in the `?debug=1` panel (`look-ahead failed (…)`).
- **Off switches:** `localStorage['anglemotion:lookahead-off']='1'` (this feature) or `anglemotion:skeleton-legacy='1'` (all skeleton changes), reload.
- Not used when foot lines are ON (MediaPipe live owns the pose) and not during AI Track (bake) — unchanged.

## Measured
**Model** (`lib/skeletonBench/liveSim.ts`, forehand with ≈ 4800 px/s wrist, round trip 100 ms = your phone's 94–106 ms): 

| Display | lag (video ms) | mean error (body heights) | max error |
|---|---|---|---|
| previous prev→latest blend | ≈ 205 | — | — |
| commit-5 display @1× | 140 | 0.149 | 1.05 |
| **look-ahead @1×** | **25** | **0.033** | 0.59 |
| look-ahead @0.5× | 15 | 0.019 | 0.33 |
| look-ahead @0.25× | 10 | 0.012 | 0.17 |

The remaining error at 1× is **detection density**, not lag: ≈ 10 detections per second sample a swing that rotates the arm ~120° in one interval. Detections per VIDEO second = detections per second ÷ speed, so at ≤ 0.5× the track is dense like AI Track; at 1× on the fastest swings it is not. Smoothing and cubic interpolation made no difference in the model (so linear interpolation is used). Doubling the rate needs two frames in flight in the bridge/worker (frozen system: needs explicit approval).

**Real Chromium (headless, 1080p VP9):** hidden video ready in ≈ 135–170 ms; lead error median 9–17 ms at 1×, p95 ≈ 29 ms, brief excursions to ~70 ms at a loop wrap; ≈ 29.5 ms (on the safe, ahead side) at 0.5× / 0.25×. **Second decoder ≈ 30 MB RSS** (summed browser RSS before/after release; Chromium software decode — a proxy, **not an iPhone number**).
**Real app (production build, headless):** `look-ahead video started`; hidden 2 px video plays at the same rate and sits ≈ 0.06–0.10 video-s ahead (target 0.085); bridge keeps detecting (≈ 7/s, software inference ≈ 135–145 ms), no page errors; skeleton drawn from the buffer on the player (screenshot), angles update.

## Found while testing
- First version marked the hidden video failed if it was un-playable at any moment after 3 s (a normal rebuffer) → fixed to "continuously for 3 s".
- A rejected `play()` (e.g. interrupted by a seek) is not fatal; only an autoplay refusal is.

## NOT proven (needs real devices)
- **iPhone Safari / Android Chrome:** hardware decoder limits, autoplay of a hidden muted video, memory of a second H.264 decoder, thermal behaviour. The ~30 MB figure is Chromium software decode. If a tab reloads or the hidden video fails, the panel says why and the old path takes over.
- Real playback sync on a phone (frame-time tag uses the hidden video's `currentTime`: up to one frame of skew, i.e. the skeleton can lead the picture by ≤ 1 frame).
- Seek-while-playing and speed changes were exercised only through the drift controller in Chromium, not on a phone.
- Visual quality on real clips (identity, limb assignment) is the same MoveNet output as before, only re-timed.

## Manual test
1. Play a swing clip at 0.25× / 0.5× / 1× with the skeleton on. Compare with `localStorage['anglemotion:lookahead-off']='1'` + reload. Does the skeleton sit on the racket arm *during* the swing? Is it better at 0.5× than 1×?
2. `?debug=1`: you should see `look-ahead video started` shortly after pressing play and `look-ahead video released` on pause. Send me `infer`, `rtt`, `sent/s` **while playing** and any `look-ahead failed (reason)` line.
3. Scrub/seek while playing, change speed while playing, pause/resume repeatedly (10×): skeleton must recover, no freeze, no tab reload.
4. Watch for memory problems: long clip, phone warm, repeated play/pause. Tell me device + browser.

## Stage 2d — feasibility probe (rolling look-ahead, deeper lead)
Switches (links, persisted): `?lookahead=decode` (hidden video plays, detection and display stay on the live path — isolates the cost of a second decoder), `?lookahead=1` (full look-ahead), `?la_lead=0.3|1|2.5` (target lead in VIDEO seconds, 0.04–3; `auto` = one measured round trip), `?lookahead=0` off.
- **Warm-up gap:** a hidden video that starts `lead` s ahead leaves [playhead, playhead+lead) without results, so until the playhead reaches the first hidden frame every second detection comes from the MAIN video (live quality, as today). Playback never waits. Last `lead` s of a clip: main video only (the hidden video is pinned at the end).
- **Panel line (every 2 s):** `la-stats: N det/s · depth +Nms · covered N% · main dropped D/T` — detections per second, buffer depth ahead of the playhead, share of draws that found a result near the playhead, dropped frames of the MAIN video.
- **Graceful degradation:** past the warm-up, covered < 50 % ⇒ hidden video released, live path until the next play (`look-ahead released: not keeping up`). Main video stalled 0.7 s ⇒ released for the session (unchanged).
- Headless Chromium (software inference ≈ 150 ms, 854×480): lead error −30 ms (want 1000 ms, got 970), covered 100 % after the warm-up, main dropped 0 after a start spike of 13–22 frames. **Not an iPhone result.**
