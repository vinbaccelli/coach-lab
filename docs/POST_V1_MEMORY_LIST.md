# Memory improvement list — AFTER V1 (agreed with the architect, 2026-11-10)

**Rule:** until V1 (including the database) is done, only the *biggest* phone memory robbers are worked, so every tool runs smoothly on a phone. Everything below is the follow-up list; each item becomes its own PR, measured before and after (CLAUDE.md §7), desktop and phone results kept separate. Desktop benefits too: a lighter app is better everywhere.

## What the phone work established (so the list starts from facts)
- A page never gets back the memory of a model that runs in it (WebAssembly / WebGL heaps only grow). A **terminated Web Worker** returns all of it.
- Desktop RSS is a poor judge of phone behaviour: restarting the racket worker looked *worse* on desktop (peak 4252 vs 2689 MB, Linux keeps freed heap in RSS) and *worked* on a real iPhone.
- Measured on desktop (phone limits, same flags): opening Motion Layer 2042 MB resident with the live skeleton engines vs 1484 MB with them parked (MoveNet worker ~350 MB, RTMPose ORT worker ~130 MB). Page-side wasm heaps are small (16 MB at open, 61 MB after Auto-detect); the big heaps are in workers.
- iPhone results can vary a lot with the phone's own state: the same code crashed repeatedly, then both builds worked after a cache clean / restart. Always compare A/B builds after a restart.

## The list (ideas, none measured on a phone yet unless stated)
1. **Second hidden video decoder.** Motion Layer keeps a private hidden copy of the video for frame grabs (`lib/stroMotionDraft/captureSource.ts`). Create it only for a pass and drop it afterwards.
2. **MediaPipe pose model used by Auto-detect and AI Track** lives in the page; move to a worker stopped after each pass.
3. **Person-cutout segmenter.** The default ("legacy") is a script-tag MediaPipe solution (DOM + WebGL), so it cannot move to a worker; the multiclass one can but changes cutout quality. Decide with a side-by-side quality comparison.
4. **Idle release.** Unload any model unused for a few minutes (MoveNet, RTMPose, MediaPipe) and reload on demand. Biggest win on desktop.
5. **Racket box hint (COCO-SSD tfjs, ~430 MB):** already skipped on phones; skip on desktop too (D-FINE does not need it).
6. **MP4 export converter (ffmpeg wasm):** confirm it is disposed right after each export.
7. **Webcam segmentation:** release when the webcam is turned off, not only on unmount.
8. **Ball tracking:** check whether the model lives in the page or a worker.
9. **Frames and masks:** cap their size on desktop too; keep the draft on disk (M4 local draft) instead of full-size copies in memory.
10. **Restart-after-use pattern** for any worker whose heap grows with use (SAM already: restarted every 2 frames; Object tool: retry with a fresh worker after an out-of-memory load).
11. **Longer videos:** process only the selected section (drop the unused part of the video) — the architect's idea.

## Known issues found during this work (not fixed)
- Motion Layer mask drawn in the wrong place on some frames (a person-shaped blob over the floor shadow), only seen with racket detection on, only on iPhone; not reproduced on desktop. Needs the `?debug=1` panel from a wrong frame (picture size, mask size, selection box). See 079.
- During Auto-detect the skeleton jumps between frame poses over a frozen video (the pass reads a hidden copy of the video while the visible one stays still). Cosmetic; hide or sync the overlay during the pass.
- Playing the video while Motion Layer is loading freezes it (see 078).
