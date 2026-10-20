# Metrics → Generate: video export (V1)

Metrics → **Generate** opens the export panel
(`components/metrics/MetricsExportPanel.tsx`, wired in `app/analysis/page.tsx`
`onMetricsGenerate`). It exports the loaded video, whole or a trimmed section,
with the coach's **drawings** and the **AI-tracked skeleton** drawn on when they
are included (see *Skeleton and drawings* below), and each **snapshot** in the
range as a hold (see *Snapshots (holds)*).

## What it does

- **Opens instantly.** Opening only pauses the analysis video. No seek, no frame
  capture, no snapshot writes; snapshots are only read, at export start.
- **Range.** Defaults to the whole video. *Use section* copies the Metrics
  section handles (`metricsSectionStart/End`, read only). *Whole video* resets.
- **Trim.** `components/TrimRangeBar.tsx`: two handles on one track (pointer
  events, 44 px hit areas, arrow keys), *Use playhead* per handle, "Keeping X of
  Y". Same rules as the Recording Hub trim (copied, not shared:
  `PostRecordingCropModal.tsx` is untouched). The preview is the panel's own
  `<video>`; while dragging, only the latest seek is applied.
- **Quality.** 720p / 1080p / Original (`lib/exportEstimate.ts`
  `exportQualityOptions`). The preset names the short side, so a portrait phone
  clip at 720p is 720×1280. Presets larger than the source are disabled. Video
  bitrate: 720p 4 Mbps, 1080p 8 Mbps; Original uses the tier of its short side
  (≤720 → 4, ≤1080 → 8, larger → 16 Mbps). Audio 128 kbps.
- **Estimate.** `estimateExportBytes` = (video + audio bits/s) × output
  duration ÷ 8 (the trimmed range plus every hold), shown as "≈ X MB
  (approximate)" with the duration as "0:09.0 + 0:04.0 holds", updated live. It
  is the recorder's *target*; see KNOWN_ISSUES 042 for how far real files land
  from it.
- **Export.** `lib/cropExport.ts` `exportEditedVideo` with the Metrics-only
  options `maxHeight`, `videoBitsPerSecond`, `signal`, `pauseWhenHidden`,
  `onRenderProgress`, `holds`. Real time: a 20 s range takes about 20 s, plus
  the holds. Progress bar (on the output timeline, so it moves during holds),
  **Cancel** (the UI returns to idle at once), then Download, Share (when the
  browser can share files) and the real file size.
- **One decoder.** During the export the analysis video and the preview are
  paused and the preview's source is unloaded; only the hidden export video
  decodes. No pose work is started (the one pose detection a pause triggers
  happens when the panel opens, not during the export).
- **Background tab.** The render pauses (video + recorder) while the tab is
  hidden and resumes when it is visible; the panel says so and Cancel still
  works. If no progress arrives for 3 s in a visible tab, it shows a stalled
  state.
- **YouTube / embedded sources** cannot be read as a file: Export is replaced by
  a message. With no video loaded, the panel says "Load a video first."
- **Snapshot images & report** (bottom of the panel) runs the previous
  Generate flow unchanged (`handleGenerateSnapshots` → GenerateWorkspace:
  images, report, Replay, Record video). With no snapshots it shows the
  existing message.
- Closing the panel unmounts it and frees its object URLs.

## Skeleton and drawings

Two switches in the panel's **Include** section; the quality panel names what
the file will contain ("Includes: video + skeleton + drawings").

- **Drawings** (lines, shapes, text, angle measurements) are the drawings on
  screen now, drawn on EVERY frame outside snapshot holds: the live drawings, or
  in SNAPSHOT mode the selected snapshot's (the canvas holds exactly those). The
  line says which: "3 drawings on the video, shown on every frame" / "This
  snapshot's 1 drawing, shown on every frame except snapshot holds". On by
  default in LIVE mode, off in SNAPSHOT mode (its hold already shows them).
  Disabled only when there is nothing to draw, with the reason ("No drawings on
  the video / on this snapshot. Draw on … to include them."). Each Include row
  is one ≥ 44 px touch target (the text toggles too, not only the switch).
  Keys typed in the panel never reach the page's shortcuts (they used to
  frame-step the video behind it and leave SNAPSHOT mode, KNOWN_ISSUES 056).
- **Skeleton** is the AI Track pose for each frame's own time (the stored
  track; nothing is detected while rendering). The switch is never dead and
  does not depend on the on-screen Skeleton switch:
  - range fully tracked → "Skeleton ready." — Export renders straight away;
  - range untracked or partly tracked → "Not analyzed yet…" / "Skeleton covers
    X% of this range…", and Export becomes **Analyze skeleton + export** with
    the note "Skeleton will be analyzed first, this adds time."
  - an AI Track already running from the toolbar → "AI Track is running. Wait
    for it to finish, then export." (the only state that disables it).
  It is on by default when part of the range is tracked, off otherwise.
- **Not on a zoomed page.** While the page is pinch-zoomed (visualViewport.scale
  > 1.02) "Analyze skeleton + export" is disabled with "The page is zoomed in
  (N%). Pinch out to 100% first…": a zoomed page can hide the video the
  analysis seeks, and iOS then analyzes a stale frame (frozen skeleton).
- **Analysis before export.** The untracked parts of the range
  (`lib/exportOverlay.ts untrackedIntervals`) are tracked with the existing AI
  Track pass, unchanged: `runPrecisionPass(start, end, 'fast')` (wired in
  `app/analysis/page.tsx`, with the toolbar's running/ready bookkeeping). Each
  part is pulled 0.05 s in from its neighbours so the pass never replaces a
  track the coach already made (it drops tracks within 0.05 s of its range).
  **While it analyzes, the panel is a compact bar** (progress, "Analyzing
  skeleton… X% · about N s left", Cancel) docked outside the analysis video's
  picture (`lib/exportOverlay.ts dockAnalysisBar`: below, above, right or left
  of it; without its note when space is tight), so the video the pass seeks is
  on screen and uncovered, as with the toolbar's AI Track. Covered by the full
  panel, iOS Safari exported a frozen skeleton (KNOWN_ISSUES 052). The full
  panel comes back when the analysis ends, is cancelled or fails. The
  remaining-time estimate is measured from this run's progress (after 5% and
  3 s; none before Export). Cancel stops the pass (no track is kept) and
  returns to idle at once. If no player is found, the export stops and says so.
  Then the video renders exactly as before. The UI stutters during the analysis
  (KNOWN_ISSUES 050).
- **Skeleton checks.** A wrong skeleton is never exported; instead the export
  stops with "Skeleton could not be analyzed on this video (…numbers…)", the
  Skeleton switch turns off and shows that line, and Export saves the video
  without it. The numbers say what happened.
  - *Before rendering* (`checkAnalyzedTrack`, on the poses the analysis stored,
    sampled once per pass frame): at least 3 poses per analyzed second; a pose
    that moves (≥ 0.1% of the body's size from the first one); and the same
    pose repeated exactly from one frame to the next on no more than 60% of the
    range (a real detection always jitters; a pass that gets a fresh picture
    only now and then repeats). Numbers: poses, poses per second, motion,
    repeated share.
  - *While rendering* (`skeletonFollowsVideo`, any skeleton, also one from the
    toolbar): every 0.25 s of video, the picture around the skeleton (its joint
    box grown by half on each side, a 32×32 grey thumbnail of the frame being
    encoded, before the overlay) is compared with the previous step's, and the
    skeleton's own move with it. When the picture moved (mean change ≥ 6/255) on
    at least 6 steps (4 at the end) and the skeleton stayed within 0.4% of its
    size on more than 70% of them, the render stops and no file is given.
    Numbers: steps where the video moved, and where the skeleton stayed still
    (after the export's own analysis, also that analysis's numbers above).
    A still scene gives no verdict, so a player standing still is not refused.
- **Not exported in V1:** AI measurement overlays, the data column, the ball
  trail, the zoom (the file is always the full, unzoomed frame).

## Snapshots (holds)

A third switch, **Snapshots**. With it on, every snapshot inside the trimmed
range is a HOLD: the video plays, freezes on the snapshot's frame for the hold
length showing THAT snapshot's strokes and frozen pose, then continues.

- **Hold length:** 0.5–5 s in 0.5 s steps, default 2 s (− / + under the switch).
- **States.** No snapshots: switch disabled, "No snapshots yet. Create one
  (Create Snapshot or AI Detect) to hold on it in the video." None in the range:
  disabled, "No snapshot in this range." Otherwise on by default, "The video
  freezes 2 s on each, with its drawings and pose."
- **Trim bar.** A tick per snapshot (green inside the range, grey outside) and
  the line "2 of 3 snapshots are in this range · +4 s of holds" under "Keeping…".
- **Which snapshots** (`lib/exportOverlay.ts holdSchedule`): start ≤ time ≤ end
  (1 ms tolerance). One at the very start is held at the in-point (before
  playback starts); one at the very end is held one frame (1/30 s) before the
  out-point, where the render stops. Close or identical times are NOT merged:
  each snapshot keeps its own hold with its own drawings, and two on the same
  frame are held one after the other on the same picture.
- **Hold contents:** the snapshot's strokes (not angle measurements, not AI
  measurement overlays) and its frozen pose. Nothing else: no live drawings and
  no AI Track skeleton during a hold.
- **Which drawings.** Read at export start (`getSnapshotsForExport` in
  `app/analysis/page.tsx`): stored snapshots from `snapshots`; the ACTIVE
  snapshot from the canvas (its latest strokes and pose, unsaved edits
  included).
- **Alignment.** Stored strokes are in canvas pixels of the moment they were
  saved, while the canvas re-fits its own strokes on every resize (KNOWN_ISSUES
  010). Each snapshot therefore stores `drawingsBox`, the video box when its
  drawings were saved (`saveActiveSnapshot`, `createSnapshotFromLive`), and the
  export maps its strokes from that box. The box is the LOGICAL, unzoomed one
  the canvas and the export use (`strokesBoxOf` in the page, read through
  `drawExportOverlay`'s capture), never `getVideoBounds()`, which is
  backing-store px with the zoom applied (2× on an iPhone, KNOWN_ISSUES 060). The active snapshot uses today's box
  (its strokes are on the canvas). Snapshots saved before this change have no
  box and use today's box, as the screen does.
- **Audio.** Silent during a hold, in sync after it (see *How*). Safari already
  exports no audio on this path.

## How (holds)

`exportEditedVideo(…, { holds: [{ at, seconds }] })` (`lib/cropExport.ts`).
When the paint loop sees `currentTime ≥ at` it pauses the hidden video and
seeks it exactly to `at`; until 'seeked' nothing is redrawn (the canvas keeps
the last good frame). After 'seeked' it draws the paused frame on every paint
(so the canvas stream keeps feeding the recorder) with `drawOverlay(…, hold)`,
then plays on after `seconds`. If 'seeked' does not arrive within 300 ms the
hold goes on with the frame the paused video shows, the first painted at or
after `at` (within one frame; the fallback for a browser that will not seek a
detached hidden video; not verified on iOS). The hold timer counts running time
only: a hidden tab pauses it with the recorder. The stall guard adds the total
hold time. Progress = (media seconds + hold seconds done) ÷ (range + holds)
(`outputProgress`).

Audio: a paused element sends no audio, and the recorder closes that gap, so
everything after a hold would play early by its length (measured −2 s after
two 2 s holds). With holds, the source track goes through Web Audio
(`MediaStreamAudioSourceNode` → `MediaStreamAudioDestinationNode`), which runs
in real time: silence during a hold, in sync after. If Web Audio cannot start
(no user activation, within 0.5 s) the source track is used as before. Without
holds nothing changes (the Recording Hub never passes any).

**Diagnostics (?vdebug=1).** The export writes to the vdebug log: render
start, each hold's seek (seeked / fallback), the `play()` result after each
hold, the media time once a second (a video whose time stops shows here), and
once a second which pose the frame draws ("AI Track" by media time / "HOLD
(snapshot pose)" / none) with the left wrist's position.

The panel passes `drawExportOverlay(…, { hold: { strokes, box, skeleton } })`
for hold frames: Canvas draws only those strokes (mapped from `box`) and the
frozen pose with `drawSkeletonOverlay`, read-only. The render-time skeleton
check skips hold frames. The watermark is still the last draw call.

**How.** `lib/cropExport.ts` calls an optional `drawOverlay(ctx, mediaTime, ow,
oh)` right after drawing each video frame. The panel passes Canvas
`drawExportOverlay` (`components/Canvas.tsx`), a read-only handle method that
draws with the screen's own functions — `drawStroke`, `drawAngleMeas`,
`drawSkeletonOverlay` (same display options, `showAngles: false`) and
`lookupBakedPose` for the frame's media time. It maps the on-screen video box
onto the whole output frame (`lib/exportOverlay.ts overlayTransform`), so
drawings keep their place and proportion at 720p, 1080p and Original. The video
box, strokes and angles are captured once at export start, so a resize during
the export cannot move them. No pose work runs while rendering: the skeleton is
read from the stored track only (the analysis step, when needed, runs before).

The Recording Hub calls `exportEditedVideo` without the new options, which
keeps its render exactly as before (full size, 5 Mbps, crf 23 on MP4
conversion, no cancel, no pausing).

## V2 (not built)

Out of scope for V1 and not started: AI measurement overlays and the data
column in the export, angle measurements and AI measurement overlays in
snapshot holds, a playback-speed option, ball tracking,
effects, a WebCodecs encoder (faster than real time), and a JPEG change to the
snapshot report's per-snapshot PNG capture (the main cost of the old Generate:
2.7 s to open with 6 snapshots of a 1080p clip).
