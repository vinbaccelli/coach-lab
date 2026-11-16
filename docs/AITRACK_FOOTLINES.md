# AI Track Foot Lines (Stage 1)

AI Track keeps its MediaPipe pipeline unchanged. Its baked track already carries heel and toe points (`lib/mediapipePose.ts`); this stage only makes the foot lines part of the standard output, optional via the existing "Foot line" checkbox (`components/ToolPalette.tsx`).

## Why a separate flag
`skeletonShowFootLine` (page) also chooses the LIVE pose model: Canvas `useMediaPipeLive()` (foot lines on ⇒ MediaPipe Live), the MediaPipe live-landmarker preload/dispose effect keyed on it, and the RTMPose gate `useRtmposeLive()`. Setting it from AI Track would (a) preload the live landmarker needlessly and (b) after "AI Track ON — tap to clear" switch Live Skeleton from RTMPose-t to MediaPipe Live. So AI Track gets its own draw-only flag `aiTrackFootLines` (`app/analysis/page.tsx`, prop on `Canvas`).

## Behaviour
- After an AI Track run keeps ≥ 2 poses and the baked track contains a real toe (`left/right_foot_index`, score ≥ 0.3, sampled at 15 times over the range): `aiTrackFootLines = true`. Every run re-enables it. The MoveNet fallback bake has no toes, so it never enables.
- Canvas draws foot lines when `skeletonShowFootLine || aiTrackFootLines` (`footLinesDrawOn()`, 4 draw sites). The live-engine code reads only `skeletonShowFootLine`.
- Checkbox with a baked track: shows either flag; ticking/unticking drives only `aiTrackFootLines` (no popup, no engine change); unticking also clears the legacy flag if it was on. Without a baked track: the existing behaviour, unchanged.
- Clearing the baked track, "Clear all" path and loading another video reset `aiTrackFootLines` to false. The tracking, refinement and bake commit code is untouched.

## Unchanged, to decide
Ticking "Foot line" BEFORE any AI Track still opts the live skeleton into MediaPipe Live (existing feature, `handleSkeletonShowFootLineChange`). Live Skeleton is meant to have no foot lines, so the architect may want that pre-AI-Track tick disabled or hidden; not changed here.

## Verification
- `tsc` 0 errors, `npm test` 550 pass / 0 fail (+4: `tests/aiTrackFootLines.test.ts`, including a source guard that the live-engine functions never read the AI Track flag).
- Headless Chromium (desktop, VP9 640×360 clip, software GL), real app: AI Track (MediaPipe, 181 frames) → checkbox on by default; foot lines visible on the feet (screenshot crops differ with the flag on vs off, PSNR 27.6 dB); untick → off, retick → on, no popup; clear → off; after clear and play the live panel shows `rtmpose: … det/s` again (RTMPose-t resumed).
- NOT tested: real iPhone; MoveNet-fallback bake in the browser (covered by the unit test only); a locked-player pass.
