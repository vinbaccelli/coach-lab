# Timeline V1 — plan (no code)

Status: **PLAN, awaiting approval.** Nothing here is implemented.
Code references are to `main` @ `7db75790` (2026-10-12) unless marked otherwise.
Builds on PR #81 (timeline selection/zoom fix, `lib/timelineView.ts`), which should land first.

Point IDs (T1, R3, …) are stable; later messages refer to them.

---

## 1. Scope

**V1 (this plan)**
- T1 Fit-to-view and zoom (buttons, pinch, Ctrl/⌘-wheel).
- T2 Horizontal scroll, with the view following the playhead during playback.
- T3 A time ruler that is readable at every zoom level.
- T4 Non-destructive trim: IN / OUT points that limit playback, analysis and export.
- T5 Delete a section — **only if cheap.** Assessed below: it is not cheap → recommended for V2.
- T6 "Edit timeline" vs "drag timeline" — **only if needed.** Recommendation: not needed in V1 (§3.6).

**V2 only (listed, not built)**
- V2-1 Multiple clips on one timeline.
- V2-2 Adding other videos to the timeline.
- V2-3 The same timeline features for Video B (its own IN/OUT, its own zoom), and an A↔B offset.
- V2-4 Destructive cropping (a new file with the cut applied).
- V2-5 Delete section (T5), as a non-destructive cut list.
- V2-6 Persisting IN/OUT with a saved session.

---

## 2. What exists today (read from the code)

| # | Fact | Where |
|---|---|---|
| E1 | One timeline component, used for A and (separately) for B. Sources: local `<video>` or YouTube player. | `components/PreciseTimeline.tsx:38-40`, `app/analysis/page.tsx:6434-6500` |
| E2 | The view is `viewWindow {start,end} \| null` (null = whole clip); only zoom changes it: `+` / `−` (×0.65 / ×1.5 around the playhead), `Fit` (to the selection), `All`. **No scroll**, and the view never follows the playhead — it pins at 100 % when playback leaves the view. | `PreciseTimeline.tsx:332`, `:586-596`, `:1349-1354`, `:779` |
| E3 | The "ruler" is `TimelineMarkers`: tick lines placed by `time / duration` over the WHOLE clip, **ignoring the zoom**, no inset, labels only on hover; interval 1 s…30 s chosen from the duration alone. Zoomed in, the ticks are wrong. | `PreciseTimeline.tsx:30-36`, `:1505-1588` (`:1540`) |
| E4 | "Trim" today means **selections**, not IN/OUT: the Metrics/AI Track section (green) and the Motion Layer range (orange) are passed as `trimRange` / `onTrimChange`. Nothing limits playback. | `page.tsx:6325-6398`, `PreciseTimeline.tsx:983` |
| E5 | Consumers assume `[0, duration]` when no selection is set: AI Track "whole video" (`:1541`, `:1584-1590`), Metrics replay/recording defaults (`:1355`, `:1639`), Motion Layer default range (`:2978-2985`). | `app/analysis/page.tsx` |
| E6 | Current time reaches the UI via `timeupdate` (HTML, throttled to 100 ms) or a 100 ms poll (YouTube). | `PreciseTimeline.tsx:377`, `:386`, `:397` |
| E7 | Video B: the B slot gets its own `PreciseTimeline` with no selections; with "play both", B mirrors A's **absolute** time — `bTarget = () => vA.currentTime` — via play/pause/seeked listeners plus a ~15 Hz drift loop (50 ms dead-band, 350 ms hard seek). Only for two local files. | `page.tsx:6438-6455`, `:4601-4700` (`:4631`), `:6230-6237`, `:6279-6320` |
| E8 | Export of a trimmed range already exists, but re-encodes in **real time** (canvas `captureStream` + `MediaRecorder`): a 20-minute range takes ~20 minutes. Used only by the post-recording crop modal. | `lib/cropExport.ts:28-34`, `:64-140`; `components/PostRecordingCropModal.tsx:334` |
| E9 | The guided tour targets the timeline shell and frame controls by id. | `PreciseTimeline.tsx:899`, `:1312`; `components/GuidedTour.tsx:49` |
| E10 | Saved sessions do not store analysis state (no trim to persist today). | `app/api/players/[id]/sessions/route.ts`, `lib/supabase/schema.sql` |

---

## 3. Design per piece

### 3.1 T1 — Fit-to-view and zoom
- T1a Keep `+` / `−` / `Fit` / `All`. `Fit` fits the IN/OUT range when set (else the selection, else All).
- T1b Pinch (two fingers on the track) and Ctrl/⌘-wheel zoom, **anchored at the pointer**, not the playhead (the buttons keep the playhead anchor).
- T1c Zoom limits: min span = max(0.08 s, 20 frames); max span = clip. Ruler (T3) must stay legible at both ends.
- T1d All view maths in `lib/timelineView.ts` (from #81): `zoomView`, new `zoomAt(view, factor, anchorTime)`, `clampView`.

### 3.2 T2 — Horizontal scroll + follow the playhead
- T2a Scroll inputs: trackpad/wheel horizontal delta (and Shift+wheel), dragging the **ruler** (not the track), and a thin **overview bar** under the ruler showing the whole clip with the view as a draggable window (also shows IN/OUT and the playhead).
- T2b Follow: while playing, when the playhead passes 90 % of the view, the view pages forward (jump so the playhead sits at 10 %), not a continuous slide (cheaper to render, easier to read).
- T2c Follow pauses when the coach scrolls/zooms by hand during playback; resumes on the next play, or when the playhead re-enters the view, or via a "follow" button.
- T2d Seeking (click, frame-step, keyboard) outside the view scrolls the view to it.
- T2e Scroll/zoom never change selections or IN/OUT (#81 rule extended), and vice versa.

### 3.3 T3 — Readable ruler at every zoom level
- T3a Replace `TimelineMarkers` with a ruler drawn from the **view**, using the same inset as the track.
- T3b Tick step = the smallest "nice" step whose labels are ≥ 64 px apart: 1 frame, 2/5 frames, 0.1/0.2/0.5 s, 1/2/5/10/15/30 s, 1/2/5/10/15/30 min, 1 h. Minor ticks at 1/5 or 1/2 of the major step.
- T3c Labels: `h:mm:ss` over 1 h, `m:ss` normally, `m:ss.f` / `+frames` when the step is under 1 s. Labels never overlap; the first label is always on screen.
- T3d Rendered as one `<canvas>` or a handful of absolutely positioned labels (≤ ~30 DOM nodes at any zoom), recomputed only when view or width changes — not on every time update.
- T3e Pure, unit-tested: `rulerTicks(view, widthPx, fps) → [{t, major, label}]`.

### 3.4 T4 — Non-destructive trim (IN / OUT)
- T4a A **working range** `{in, out}` for video A, page state, per loaded clip (cleared on a new video, like the ruler calibration at `page.tsx:1609`). Distinct from the selections in E4 — `trimRange` keeps meaning "selection".
- T4b UI: IN/OUT handles on the **ruler/overview** (not the track, so they never fight the selection handles); the outside is dimmed; keys `I` / `O` set IN/OUT at the playhead, `Alt+X` clears.
- T4c Playback limit: play from IN when the playhead is outside; stop (or loop, a setting) at OUT. Enforced with `requestVideoFrameCallback` near OUT (E6's 100–250 ms `timeupdate` granularity would overshoot). Frame-step and scrub clamp to `[in, out]`.
- T4d Analysis: every "whole video" default in E5 becomes "whole working range": AI Track "all", Metrics section defaults, Motion Layer default range, snapshot creation (refuse outside, with a message).
- T4e Export: exports of the analysis (Metrics replay recording, Motion Layer export) already work on their own range — their defaults clamp to `[in, out]`. A **file** export of IN→OUT reuses `exportEditedVideo({ trim })` (E8): real-time, so the button shows the duration it will take; long ranges are a known cost (see R6).
- T4f B: unchanged in V1 — B keeps mirroring A's absolute time (§5).

### 3.5 T5 — Delete a section (assessed, not recommended for V1)
- A non-destructive delete is a **cut list**: playback must jump over cut ranges, and every time-based consumer (ruler, selections, markers, snapshots, AI Track, B sync, exports) must map "timeline time" ↔ "source time".
- That is a new time model under all of E4/E5/E7 — 4–6 days plus the riskiest regressions in this list. **Not cheap → V2-5.** IN/OUT covers the common "keep only the rally" case.

### 3.6 T6 — Edit vs drag mode (assessed, not needed in V1)
- Today a press on the track scrubs (`PreciseTimeline.tsx:923`), handles are separate grab tabs (#81). With T2, panning lives on the **ruler / overview**, zooming on pinch/wheel — no gesture is ambiguous, so no mode switch.
- Re-assess after phone testing (Q2): if coaches pan the track by accident, add a small "lock edits" toggle that disables handle drags (½ day).

---

## 4. How it fits the existing code
- F1 `PreciseTimeline` stays the single component. New props: `workingRange`, `onWorkingRangeChange`; the view logic moves into `lib/timelineView.ts` (started in #81) and a new `lib/timelineRuler.ts`.
- F2 `TimelineMarkers` is replaced by the ruler + overview (same position in the layout, so the dock height grows by ~10 px; check the phone dock, `page.tsx:6435` min-heights).
- F3 Page: one `workingRange` state for A; the E5 call sites read it as their default bounds; `analysisTimelineExtras` passes it down.
- F4 B's timeline (`page.tsx:6438-6455`) gets ruler/scroll/zoom for free (same component) but **no** IN/OUT in V1.
- F5 No change to Canvas, pose provenance, analysis-mode ownership or column isolation: the timeline only seeks/plays/pauses the video, as today. T4c's "stop at OUT" is a `pause()` — the same event a coach's pause produces — so every mode already handles it.

## 5. Video B sync
- S1 V1 keeps today's rule: B shows A's **absolute** time (E7). IN/OUT on A therefore also bounds B (B pauses when A stops at OUT; out of B's range B parks, as today at `page.tsx:4632`).
- S2 All B sync reads one function, `bTarget()` (`page.tsx:4631`). V2-3's A↔B offset changes only that function (`vA.currentTime − offset`) and `bInRange`; the plan keeps every new V1 code path going through it.
- S3 Zoom/scroll on A's timeline never seek, so they cannot desync B. Follow-playhead only moves the view.
- S4 The B-slot timeline (when "B" is the playback target) gets the new ruler/scroll; its IN/OUT is V2-3.

## 6. What would break (and how each is handled)
- B1 Every "assumes [0, duration]" site in E5 → changed to the working range in T4d; a unit-tested `rangeOrWhole(workingRange, duration)` helper replaces the literals.
- B2 Frame-stepping and keyboard seeks past OUT → clamped (T4c).
- B3 The guided tour's timeline steps (E9) → keep both `data-tour-id`s on the same elements; re-run the tour.
- B4 Selections (E4) created before IN/OUT exist may lie outside → they are kept (non-destructive) but drawn dimmed; consumers clamp their *use* to the intersection.
- B5 Ruler swap changes the dock height → check reels/phone layouts (`phoneChrome`, `compact`).
- B6 Tests: there are no UI tests; the pure parts (view, ruler, range helpers) get unit tests; UI paths are verified in Chromium (as for #80/#81).

## 7. Risks
- R1 **Playback limit precision.** `timeupdate` is too coarse; rVFC near OUT is needed for HTML. YouTube has no frame callback (100 ms poll, E6) → OUT may overshoot by up to ~150 ms on YouTube. Accept and document, or disable IN/OUT for YouTube in V1 (Q3).
- R2 **Seek cost on long H.264.** Phone footage often has 1–2 s keyframe intervals; scrubbing a 30-min clip at deep zoom issues many seeks. Existing coalescing (`scheduleScrubSeek`, `PreciseTimeline.tsx:467`) helps; must be measured (§8).
- R3 **Render churn.** The timeline re-renders on every time update; adding the ruler and overview must not add work per update (T3d). Measure before/after (CLAUDE.md §7).
- R4 **Touch gesture conflicts.** Pinch on the track vs the canvas pinch-zoom; the track already sets `touch-action: none` (`PreciseTimeline.tsx:919`), the page must not also handle it.
- R5 **Concurrent PRs.** #81 (same component), #82 (page.tsx around AI Track scope). Land #81 first; rebase T4d on #82.
- R6 **Export duration.** IN→OUT file export is real-time (E8). A 30-min range = 30-min wait. Show it; offer cancel (CLAUDE.md §6 "long operations must be cancelable").
- R7 Memory on long clips: the skeleton frame cache and baked tracks grow with duration — unchanged by this plan, but the long-video tests will exercise them.

## 8. Test plan (long videos, 30+ minutes)
Clips: L1 30-min 1080p H.264 phone MP4 (Safari/real device), L2 60-min VP9 WebM (Chromium), L3 2-hour 720p MP4, L4 30-min YouTube, S1 2-s clip, S2 9-s two-player clip.

| ID | Check | Pass |
|---|---|---|
| P1 | Fit / All / + / − / pinch / Ctrl-wheel at 1080p width and 390 px | view changes only; selections & IN/OUT unchanged |
| P2 | Ruler at every zoom level from whole-clip to 20 frames, L1–L3 | labels never overlap, ≥ 64 px apart, correct times (spot-check against frame-step) |
| P3 | Scroll via trackpad, ruler drag, overview drag | smooth; no seeks issued |
| P4 | Play at 1×/2×/0.25× zoomed to 10 s | view pages with the playhead; manual scroll pauses follow; play resumes it |
| P5 | Seek latency, deep zoom, L1/L2 | median < 150 ms on desktop Chrome, report phone numbers |
| P6 | IN/OUT: play stops at OUT (HTML ≤ 1 frame late, YouTube ≤ 150 ms), loops when set, frame-step clamps | measured overshoot reported |
| P7 | IN/OUT → AI Track, Metrics replay, Motion Layer default to the range | ranges match; nothing outside processed |
| P8 | B sync over 30 min of play-both (L1 + a 30-min B) | drift stays ≤ 50 ms (existing dead-band); B stops at A's OUT |
| P9 | Memory after 30 min playback + AI Track over a 5-min range | no unbounded growth vs main |
| P10 | Render cost: time-update → paint, before/after, 30-min clip | no regression (CLAUDE.md §7) |
| P11 | Guided tour, reels layout, phone layout | unchanged steps, dock fits |
| P12 | Unit tests: `timelineView`, `timelineRuler`, `rangeOrWhole` | all green |

## 9. Effort (working days, including tests and a Chromium pass)

| Piece | Effort | Notes |
|---|---|---|
| T1 zoom (pinch, wheel, anchor) | 1 | buttons exist |
| T2 scroll + overview + follow | 2 | |
| T3 ruler | 1.5 | pure algorithm + render |
| T4 IN/OUT: state, UI, playback limit | 2 | |
| T4 consumers (AI Track, Metrics, Motion Layer, snapshots) | 1.5 | touches page.tsx call sites |
| T4 file export of IN→OUT + cancel | 1 | reuses `exportEditedVideo` |
| B sync guard + tests (S1–S3) | 0.5 | |
| Long-video test pass (§8) + perf numbers | 2 | needs real devices from Vin |
| T6 lock toggle (only if Q2 says so) | 0.5 | |
| T5 delete section | 4–6 | **V2** |
| **V1 total** | **≈ 11.5** (12 with T6) | |

## 10. Recommended cut line for launch
- **Launch (must):** T3 ruler, T2 scroll + follow, T1 pinch/wheel zoom, T4 IN/OUT limiting playback + analysis defaults (T4a–T4d). ≈ 8 days.
- **Right after launch:** T4e file export of IN→OUT (real-time cost, needs cancel), overview bar polish. ≈ 2 days.
- **Not V1:** T5 delete section, T6 mode switch (unless phone testing shows it is needed), everything in V2.

## 11. Open questions for Vin
- Q1 At OUT: stop (default) or loop?
- Q2 After phone testing, is a "lock edits" toggle (T6) wanted?
- Q3 YouTube: allow IN/OUT with ~150 ms precision, or local files only in V1?
- Q4 Should IN/OUT bound Video B too (S1, today's absolute-time rule), or should B ignore A's IN/OUT until V2-3?
