# Metrics → Generate: video export (V1)

Metrics → **Generate** opens the export panel
(`components/metrics/MetricsExportPanel.tsx`, wired in `app/analysis/page.tsx`
`onMetricsGenerate`). It exports the loaded video, whole or a trimmed section,
as a **clean** video file: no drawings, skeleton or measurements are burned in.

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

The Recording Hub calls `exportEditedVideo` without the new options, which
keeps its render exactly as before (full size, 5 Mbps, crf 23 on MP4
conversion, no cancel, no pausing).

## V2 (not built)

Out of scope for V1 and not started: burned-in drawings/measurements (needs
annotations in video coordinates first, KNOWN_ISSUES 010), ball tracking,
effects, a WebCodecs encoder (faster than real time), and a JPEG change to the
snapshot report's per-snapshot PNG capture (the main cost of the old Generate:
2.7 s to open with 6 snapshots of a 1080p clip).
