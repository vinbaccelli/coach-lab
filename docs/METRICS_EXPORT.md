# Metrics → Generate: video export (V1)

Metrics → **Generate** opens the export panel
(`components/metrics/MetricsExportPanel.tsx`, wired in `app/analysis/page.tsx`
`onMetricsGenerate`). It exports the loaded video, whole or a trimmed section,
with the coach's **drawings** and the **AI-tracked skeleton** drawn on when they
are included (see *Skeleton and drawings* below).

## What it does

- **Opens instantly.** Opening only pauses the analysis video. No seek, no frame
  capture, no snapshot writes; snapshots and angle data are not needed.
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
- **Estimate.** `estimateExportBytes` = (video + audio bits/s) × trimmed
  duration ÷ 8, shown as "≈ X MB (approximate)" and updated live. It is the
  recorder's *target*; see KNOWN_ISSUES 042 for how far real files land from it.
- **Export.** `lib/cropExport.ts` `exportEditedVideo` with the Metrics-only
  options `maxHeight`, `videoBitsPerSecond`, `signal`, `pauseWhenHidden`,
  `onRenderProgress`. Real time: a 20 s range takes about 20 s. Progress bar,
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
- **Snapshot report** (bottom of the panel) runs the previous Generate flow
  unchanged (`handleGenerateSnapshots` → GenerateWorkspace: images, report,
  Replay, Record video). With no snapshots it shows the existing message.
- Closing the panel unmounts it and frees its object URLs.

## Skeleton and drawings

Two switches in the panel's **Include** section; the quality panel names what
the file will contain ("Includes: video + skeleton + drawings").

- **Drawings** (lines, shapes, text, angle measurements) are the LIVE-mode
  drawings on the analysis canvas. In SNAPSHOT mode the canvas drawings belong
  to the snapshot and are not exported ("Snapshot drawings aren't exported.
  Use Snapshot report."). With none: "No drawings on the video".
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
column in the export, snapshot drawings in the export (would need holds or
time-bound drawings), ball tracking,
effects, a WebCodecs encoder (faster than real time), and a JPEG change to the
snapshot report's per-snapshot PNG capture (the main cost of the old Generate:
2.7 s to open with 6 snapshots of a 1080p clip).
