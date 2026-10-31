# Edit timeline — investigation and plan (no code)

Status: **PLAN, awaiting approval.** Nothing here is implemented, and no source file changes in this PR.
Code references are to `main` @ `9fbd242` (2026-10-30). Point IDs (M1, T3, …) are stable, so later messages can refer to them.

**Vision (restated).** Like DaVinci Resolve's page tabs. The current play control and timeline stay exactly as they are. A button next to the play control switches the dock to an **Edit timeline**. There, every drawing and every user-uploaded overlay or image is a bar on a row (track). The coach can add and remove rows, drag a bar to move it in time or to another row, and drag a bar's edges to change how long it stays in the video. This mode edits positions and durations only. Later, effects (draw-on, fade, the V2 ball tail) attach to items.

---

## 1. The current model (Task 1)

| # | Fact | Where |
|---|---|---|
| M1 | Every drawing is a `Stroke`, a discriminated union on `tool`: `pen`, `line`, `arrow`/`arrowAngle`, `circle`/`bodyCircle`, `rect`, `triangle`, `swingPath`/`manualSwing`, `jointChain`, `text`. It holds geometry (points, centre and radii, `pos`) and style (`color`, `lw`, `opacity?`, `dashed?`, `spinning?`, `arrowAtEnd?`, `fontSize`, `eraserStrokes?`). There is **no `id`**, **no time** and **no visibility flag**. | `components/Canvas.tsx:193-234` |
| M2 | Angle measurements are a separate list, `AngleMeas` (`v,p1,p2,deg` plus style). It also has no id and no time. | `Canvas.tsx:236-240`, `angleMeasRef` `:2466` |
| M3 | Storage is in memory only: `strokesRef` holds `Stroke[]` and undo keeps whole-array snapshots of strokes and angles. Selection, move and erase all address a stroke by **array index**. | `Canvas.tsx:2444-2465`, `Selection` `:243-248` |
| M4 | Serialisation is `exportStrokes()` / `importStrokes()`, a plain `JSON.stringify` of the strokes array, so **unknown fields round-trip**. Angles are *not* included. | `Canvas.tsx:4233-4250` |
| M5 | Every geometry writer spreads the stroke (`{...st, …}`), so extra fields survive resize re-fit and move. | `remapStroke` `Canvas.tsx:1552-1575`, `translateStroke` `:7776-7799` |
| M6 | **Live drawings are always visible.** The render loop draws every stroke on every repaint, with no time test. | `Canvas.tsx:6585-6587` |
| M7 | **Snapshot drawings are tied to a snapshot hold.** A `Snapshot` carries `timeSec` plus `drawingsJson` (strokes) and `drawingsBox`. Selecting a snapshot imports its strokes and seeks to it. When the playhead moves more than 0.12 s away, the "autopilot" returns to LIVE and the canvas strokes become `[]`. Creating a snapshot *moves* the live strokes into it. | `lib/snapshots.ts:35-64`; `app/analysis/page.tsx:1118-1144` (autopilot), `:1167-1186` (save), `:1190-1206` (select), `:1215-1223` (exit to live), `:1242-1270` (create) |
| M8 | The mode is `live` or `snapshot` only (`analysisMode`). | `page.tsx:985-988` |
| M9 | **Already time-based:** the ball trail. Its points carry a video `time`, the trail shows the last `trailDuration` s, and its coordinates are normalised 0–1. It draws on screen from `video.currentTime`. It is **not** drawn by the export. | `lib/ballTrail.ts:1-33`; `Canvas.tsx:6448-6463` |
| M10 | Other overlays with no item model: the racket multiplier (`Canvas.tsx:6466-6470`), the webcam PiP, the watermark and the Motion Layer ghosts. None of these is a coach "item"; all stay out of scope. | — |
| M11 | **User-uploaded overlays and images do not exist.** The analysis page has only two file inputs, both for video (A and B). No tool draws a user image (`drawImage` in Canvas is used only for video, mask and webcam). | `page.tsx:9672-9686`; `Canvas.tsx` `drawImage` at `:5842`, `:6511`, `:6514` |
| M12 | Nothing persists drawings beyond the session: no Supabase table and no report stores strokes (reports store screenshots). | grep over `lib/`, `supabase/`, `app/api` |
| M13 | **Swing path today:** `swingPath` (each click adds a point; a 500 ms pause finishes it) and `manualSwing` (each click adds a point; a double-click finishes it) store points only. Neither records the video time of the first or last click. `drawSwingFromSegment` (auto) has `SwingSegment` timing available but drops it. | `Canvas.tsx:7449-7493`, `:7987-8019`, `:3660-3685` |
| M14 | **Branch `fix/arrows-swingpath` does not exist** on origin, and no open PR matches (checked `git ls-remote` and the open PR list, 2026-10-30). See U1. **How it should fit:** record `video.currentTime` at the first click and at the finishing click, and store them on the stroke as the **suggested range** (`drawn: {t0, t1}`), not as the display range (D3). Better still, store a time per point (`ptTimes`), which is the exact input the draw-on effect (E3) needs. The Edit timeline then offers "Snap to drawn range" on a swing bar. | — |

---

## 2. The current play control and timeline (Task 2)

| # | Fact | Where |
|---|---|---|
| T1 | `PreciseTimeline` is the single component. It renders, top to bottom: the scrub track (fill, selection band and handles, green snapshot balls, yellow frame-stop balls, playhead ball), the ruler and overview bar, and then the control row (`A/B/AB`, `+ − Fit All`, **▶/⏸**, frame-step ◀ ▶, sound, time readout, Options on phone). | `components/PreciseTimeline.tsx:1241-1760` |
| T2 | It is mounted three times in `renderTimelineDock()` (slot B, slot A with B loaded, A only). The analysis props come from `analysisTimelineExtras`. | `page.tsx:6671-6765`, `:6562-6660` |
| T3 | **Selection (trim) handles:** these are the Metrics/AI Track section (green) or the Motion Layer range (orange). Only the **above-track grab tabs** drag (46 px wide on phone, 38 px on desktop); the in-track stripe is inert, so a press anywhere on the track scrubs. Drags are **relative** to the pointer at the current zoom. | `PreciseTimeline.tsx:1209-1232`, `:1322-1487`; `lib/timelineView.ts:58-94` (`beginTrimDrag`/`dragTrimTo`) |
| T4 | **Timeball (playhead ball):** 26 px on phone, 24 px on desktop, `pointerEvents: none`, so the scrub track owns the press. When a frame stop sits under the ball, `lib/timelinePress.ts` decides: moving at once scrubs the playhead; holding still for 400 ms (`HOLD_TO_GRAB_MS`) grabs the frame stop; a tap selects it. | `PreciseTimeline.tsx:1206`, `:1546-1637`, `:1638-1652`; `lib/timelinePress.ts:1-60` |
| T5 | **Touch:** pointer events with `setPointerCapture`; `touch-action: none` on the track, tabs and balls; a second concurrent finger is ignored during a scrub; a two-finger touch on any `[data-tl-zoom]` surface becomes a pinch zoom (`pinchView`); the ruler drags to scroll. | `PreciseTimeline.tsx:996-1040`, `:1264-1290`, `:1654-1706` |
| T6 | View maths are pure and unit-tested: `secondsPerPx`, `timeAtClientX`, `zoomAt`, `pinchView`, `panView`, `followPlayhead`, `rulerTicks`. | `lib/timelineView.ts:18-337` |
| T7 | **Where the mode switch fits.** Add one optional prop, `modeSwitch?: ReactNode`, rendered in the control row right after the frame-step buttons (`:1755-1759`). When the prop is absent, the render is byte-identical, so the current behaviour cannot change. The page passes a small `[ Play \| Edit ]` segmented button only to the A-slot instances. |  |
| T8 | **Edit mode layout:** `PreciseTimeline` **stays mounted** (it owns the video listeners, FPS, zoom and follow state, and the play, step and time controls stay usable for preview). The page renders a new `<EditTimeline>` panel **above** it in `renderTimelineDock()` and may collapse the scrub track (via a `hideScrub` prop, absent meaning unchanged). Nothing in the current component's handlers changes. |  |

---

## 3. The export (Task 3)

| # | Fact | Where |
|---|---|---|
| X1 | `drawExportOverlay(ctx, mediaTime, …)` captures the video box plus **copies of all strokes and angles once** at export start (`frozen`). On every frame it draws **all** of them; `mediaTime` is used only for the spin animation tick (`round(mediaTime*60)`) and the AI Track pose lookup. | `Canvas.tsx:3852-3946` |
| X2 | **Snapshot holds:** with Snapshots on, each snapshot in range becomes a hold (`holdSchedule`). During a hold, the export draws **only** that snapshot's strokes (in its own `drawingsBox`) and its frozen pose, with no live drawings and no AI Track skeleton. | `lib/exportOverlay.ts:466-520`; `components/metrics/MetricsExportPanel.tsx:654-707`; `Canvas.tsx:3863-3890` |
| X3 | During a hold, `cropExport` pauses the video at `h.at` and calls the overlay with `mediaTime = h.at` and the hold index, repainting for `seconds`. The overlay is **not** told how far into the hold it is. | `lib/cropExport.ts:74-80`, `:440-443`, `:467-490` |
| X4 | **Speed:** the hidden video plays at `playbackRate`; overlays still receive **media time**; hold seconds are output seconds. | `lib/exportSpeed.ts:1-5`; `lib/cropExport.ts:82-88` |
| X5 | **What would change for ranges:** inside the non-hold branch of `drawExportOverlay`, draw only `frozen.strokes` (and angles) for which `isVisibleAt(item, mediaTime)` is true. Ranges are in media seconds, so the speed needs **no change**. Holds stay unchanged: the hold shows its snapshot's strokes, which are snapshot-owned and ignore ranges (D5). `frozen.drawingCount` keeps counting all items. |  |
| X6 | **For effects (later):** pass `progress` per item, computed from `mediaTime` (E1). If an effect should also animate *during* a hold, `cropExport` must pass the hold's elapsed time to `drawOverlay` (new optional argument). Defer that until it is asked for. |  |

---

## 4. Smallest data model (Task 4)

- **D1** Add optional timing fields **on the item itself** (a `Stroke`, and later an `AngleMeas` or an `ImageItem`):
  ```ts
  interface TimedFields {
    id?: string;      // stable identity (Edit timeline, effects, undo-safe selection)
    t0?: number;      // visible from (media seconds)
    t1?: number;      // visible until (media seconds), t1 > t0
    track?: number;   // row index, 0 = top
    fx?: ItemEffect[]; // later (E2), ignored until then
  }
  ```
  These fields ride through `exportStrokes`/`importStrokes`, snapshot `drawingsJson`, resize re-fit and move unchanged (M4, M5).
- **D2 Migration (no range means the old behaviour):** `t0`/`t1` absent means always visible, exactly as today. `track` absent means auto-placement (first free row by creation order). `id` absent means one is assigned on import or when the Edit timeline opens (`crypto.randomUUID`). No stored data exists outside the session (M12), so nothing else needs migrating.
- **D3** New strokes are created **without** a range, so drawing behaves as today. A range appears only when the coach edits the bar. A swing path may carry `drawn: {t0, t1}` as a *suggestion* (M14).
- **D4** One pure module, `lib/editTimeline.ts`, unit-tested: `isVisibleAt(item, t, dur)`, `itemProgress(item, t)`, `assignIds`, `placeOnTracks` (first fit, no overlap), `moveItem`, `resizeItem` (relative drags reusing `dragTrimTo` semantics, minimum length of one frame), and `removeTrack`.
- **D5 Mode contract:** ranges apply in **LIVE mode only**. Snapshot strokes stay snapshot-owned and are shown on their hold as today. The Edit timeline is read-only (or disabled, with "Return to live to edit timing") while a snapshot is selected. This keeps one mode owning the canvas (CLAUDE.md "architecture contract").
- **D6** Rows: `track` lives on the item. Rows the coach adds while empty live in page state (`editTrackCount`). Rows are lost on reload, as drawings are.
- **D7 Item types shown first:** every `Stroke` tool (M1), meaning pen, line, arrow/angle-arrow, circle/body-circle, rect, triangle, swing paths, joint chain and text. **Second:** angle measurements (M2, a separate list, also needs ids). **Later:** uploaded images (M11, a new feature with its own storage and `drawImage` in render and export; store in **video-normalised** coordinates to avoid KNOWN_ISSUES 010) and the ball trail as one item (M9).

---

## 5. Build vs library (Task 5)

App versions: **React 18.3.1, React DOM 18.3.1, Next 15.5.24** (`package.json`).

| | L1 `@xzdarcy/react-timeline-editor` 1.0.0 | L2 `evo-timeline-editor-react` 0.2.6 | L3 Custom |
|---|---|---|---|
| Gives | Rows and actions, drag and edge-resize (interact.js), grid and guide-line snapping, a time area, a cursor, virtualised rows (react-virtualized), and a playback "engine" with per-effect callbacks | The same component as L1 (a fork) | Exactly the needed surface; reuses `lib/timelineView.ts` (T6) and `lib/timelinePress.ts` (T4) |
| Move to another row | **No.** Action drag is `lockAxis: 'x'` (`row_rnd.tsx:331`) | **No** (`lockAxis: "x"`, dist line 8877) | Yes (long-press, P1) |
| Touch (read from source) | Drag and resize go through interact.js pointer events, so they can work on touch. **But:** no `touch-action` CSS is shipped (interact.js itself warns), the resize edge is a fixed **20 px** inside each bar on touch devices (`interact.js:1692`; a bar under about 40 px wide cannot be moved), **row reorder is mouse-only** (`edit_row.tsx:52-62,90`, document `mousemove`/`mouseup` in `edit_area.tsx:411-416`), and there is no pinch zoom and no long-press | Same code as L1 | Designed for 390 px from the start (P1) |
| Works with React 18.3.1 | **Yes**: rendered with `react-dom/server` 18.3.1 in a scratch project | **No.** It declares `react ^19` and `react-dom ^19` as **dependencies** (not peers), so npm installs a nested React 19. Rendering fails with "Invalid hook call". Its dist also inlines React 19's JSX runtime (`react.transitional.element`) | n/a |
| License | MIT (engine `@xzdarcy/timeline-engine`: ISC) | MIT | n/a |
| Maintenance (npm) | One author. 0.1.9 in Mar 2023, alphas in Sep 2025, 1.0.0 on 2026-01-25 | 8 versions, all published on **2025-04-03** within about 4 hours, none since; one maintainer; no `repository` field | Ours |
| Bundle (esbuild, minified, React external) | **≈ 248 KB min / 67 KB gzip** + 4.6 KB CSS | ≈ 245 KB min / 66 KB gzip | Estimated **< 15 KB min**: ≈ 700–900 lines of component + ≈ 200 lines of pure lib |
| Responsiveness risk | It holds its own `editorData` and `cursorTime` state. Driving the cursor from the video means calling `setTime`, which re-renders the whole timeline grid at the time-update rate. Its engine runs its own clock, which must never drive playback (the video is the clock) | Same, plus a second React | Low: the playhead is drawn from a ref and positioned without React state per frame (the pattern in `PreciseTimeline`) |

**Recommendation: L3, build a small custom timeline.** L2 is not usable on React 18. L1 is the larger dependency and still needs patching for exactly the phone interactions this feature depends on (cross-row move, touch edge handles, touch row management, pinch), and it brings a second clock and a state model to keep in sync with the video. The pieces that are hard to get right (zoom, pan, pinch, relative drags, press disambiguation, ruler) already exist in this repo with tests. Load `EditTimeline` with `next/dynamic` so `/analysis` pays nothing until Edit mode opens.

---

## 6. Phone design, 390 px (Task 6)

Shared by both options: each row is ≥ 40 px high (plus 4 px gap). The ruler and pinch zoom are reused (T5, T6). The playhead line spans all rows. Unselected surfaces use `touch-action: pan-y` (the lane list scrolls vertically); only the *selected* bar's grips use `touch-action: none`.

**Option A: Resolve-style lanes, select then edit (recommended)**
- **A1 Select:** a tap on a bar selects it (outlined, with its tool icon and colour). It does not seek, and an unselected bar never drags, so a stray swipe scrolls instead of moving a drawing. A double-tap seeks to the bar's start.
- **A2 Edges:** the selected bar shows two **grab tabs outside the bar ends** (44 × 28 px, the above-track tab pattern from T3). They work even on a bar that is 1 frame wide. The drag is relative at the current zoom (`dragTrimTo`).
- **A3 Move in time:** drag the selected bar's body. **Move to another row:** hold the bar for 400 ms (`HOLD_TO_GRAB_MS`), then drag vertically; the target row highlights.
- **A4 Nudge:** a bottom action bar for the selection: `◀ 1f ▶` (move), `[← start] [end →]` (one frame each), **"Start at playhead" / "End at playhead"**, and Delete-from-timeline (which clears the range only and keeps the drawing).
- **A5 Rows:** a `+ Row` button under the last lane. A row's ⋯ menu removes it; a non-empty row asks first and moves its items to the row above.
- **A6 Overlaps:** on drop, if the bar overlaps another on that row, it goes to the first free row below (a new row if none) with a toast. **Neighbours are never shoved** (the lesson from KNOWN_ISSUES 039).
- Trade-offs: direct and familiar, and the bars show timing at a glance. Narrow bars depend on zoom (mitigated by the outside tabs and pinch). This is the most code.

**Option B: item list plus inspector**
- **B1** One item per line (a layer list: icon, name, small bar on a mini-timeline), so overlaps can never occur. "Rows" become optional groups.
- **B2** A tap on a line selects it and opens a bottom sheet with Start and End steppers (±1 frame, ±0.1 s), "Set to playhead" for each, and a group picker.
- Trade-offs: very robust on a phone, precise, and the least code. It is not a Resolve-like visual timeline: no direct dragging, and relations between items are harder to see.

**Recommendation:** A, with B's precise controls in its action bar (A4). On desktop, A is the same component with mouse hover cursors and smaller tabs.

---

## 7. Effects (Task 7, design only)

- **E1 Progress:** `p = clamp((t − t0) / (t1 − t0), 0, 1)` in media seconds. It is undefined (no effect) when the item has no range. Both the screen render (`video.currentTime`) and the export (`mediaTime`, X4) feed the same pure function, so slow-motion export works without extra handling.
- **E2 Attach:** `fx?: ItemEffect[]` on the item, each with `{ kind, ...params }` and its own sub-window (for example `in: 0.3` s). The pure `applyEffects(item, p, tLocal) → { alpha, drawFraction, ... }` is evaluated before `drawStroke`. `drawStroke` gets an optional `fraction` argument; when it is absent, drawing is unchanged.
- **E3 Draw-on:** `drawFraction = ease(p_on)`, where `p_on` is progress over the first `dur` seconds of the range (or the whole range). Paths (pen, swing, joint chain) draw the first `fraction` of their arc length. Line and arrow grow from p1 towards p2, and the arrowhead appears at 1. Circles, rects and triangles sweep their outline. Text reveals characters. A swing path with `ptTimes` (M14) can instead draw exactly the points whose time ≤ t, so it follows the real motion.
- **E4 Fade:** `alpha = min(1, (t − t0)/in, (t1 − t)/out)`, multiplied into the existing `strokeOpacity`.
- **E5 Ball tail (V2):** a ball-trail item (M9) whose range bounds the trail. The tail head is the trail point at `t`, and the tail length is a parameter. It needs the trail added to the export first (M9: it is screen-only today).
- **E6 Holds:** during a hold, `t = h.at`, so effects freeze. Animating inside a hold needs X6.

---

## 8. Risks and phased plan (Task 8)

### Risks
- **R1 Hot files.** `Canvas.tsx` (10.5k lines) and `page.tsx` (10k) are high-risk. Each phase touches at most one or two small, named spots.
- **R2 Render loop is dirty-gated** (`Canvas.tsx:5616-5700`). Time-ranged items must force a repaint when the time changes, including with the native video underlay, where `videoFrameChanged` is false. Measure before and after (CLAUDE.md §7): this covers paint cost per frame with 0, 20 and 100 strokes, while playing and while paused.
- **R3 Hidden items must not be hit.** Select, move, eraser and outline-erase hit-tests (`hitTestStroke`, `Canvas.tsx:7566`, used at `:7652`, `:7686`, `:8843`, `:8949`) must skip strokes that are invisible at the current time, or the coach grabs or erases what they cannot see.
- **R4 Identity.** Selection and undo are index-based (M3). The Edit timeline must use `id`. Range edits must go through `strokesRef` + `pushHistory` so that undo restores timing.
- **R5 Protected invariants.** D5 (live-only ranges, snapshot strokes untouched) needs explicit approval under CLAUDE.md §6.
- **R6 Export** (X5) changes what every Metrics export draws when ranges exist. The no-range path must stay byte-identical (a regression test on the pure filter).
- **R7 YouTube.** The canvas reads `video?.currentTime` (`Canvas.tsx:5635`). A YouTube time source exists elsewhere in Canvas (`:5281`). Ranged items on YouTube are unverified; until checked, treat them as always visible.
- **R8 Uploaded images** are a new feature (M11): storage, memory, export `drawImage`, and coordinates in video space (KNOWN_ISSUES 010). It is not part of the first phases.
- **R9 Concurrent work.** PR #113 touches `PreciseTimeline.tsx` (+13 lines) and `page.tsx`, so land it first. PR #83 (IN/OUT plan) is compatible: ranges are in media seconds, and IN/OUT would only bound the Edit view.
- **R10 Guided tour** targets `tour-frame-controls` and `tour-play`. Adding the switch must keep those ids on the same elements.

### Phases (one small PR each; none touches a frozen system from `docs/V1_FREEZE.md`)

| Phase | PR | Touches | Behaviour change | When |
|---|---|---|---|---|
| **P0** | `lib/editTimeline.ts` + tests (D4, E1 maths) | new files only | none | before checkpoint |
| **P1** | `modeSwitch` slot in `PreciseTimeline` (T7) + page toggle (off by default, behind a feature flag) | `PreciseTimeline.tsx` (≈ 5 lines), `page.tsx` dock | none when off | before checkpoint |
| **P2** | `EditTimeline` read-only: rows and bars for live strokes, playhead, zoom/pan, select-to-highlight; `id` assignment on read | new component; Canvas handle gains `getTimelineItems()` (read-only) | none; nothing is gated yet | before checkpoint |
| **P3** | Editing: move, resize, rows, nudge, long-press row change (Option A); writes `t0/t1/track` through a new Canvas handle `setItemTiming(id, …)` + `pushHistory` | `Canvas.tsx` (handle only) | fields are stored, **not yet applied** | after checkpoint |
| **P4** | **Apply ranges on screen:** filter in the render loop, a repaint on time change when ranged items exist (R2), and hidden items skipped in hit-tests (R3) | `Canvas.tsx` render + hit-test | yes, only for items the coach gave a range | **after checkpoint** (perf numbers required) |
| **P5** | **Apply ranges in export** (X5) | `Canvas.tsx` `drawExportOverlay` | yes, ranged items only | **after checkpoint** |
| **P6** | Swing path drawn range (M14) and "Snap to drawn range" | `Canvas.tsx` swing finish handlers | new metadata only | after checkpoint |
| **P7** | Angle measurements as items (D7) | `Canvas.tsx` angles | as P4/P5 | after checkpoint |
| **P8** | Effects: fade, then draw-on (E2–E4) | `drawStroke` optional args, export | opt-in per item | **after checkpoint (V2)** |
| **P9** | Uploaded images as items (R8), ball tail (E5) | new feature | new | **V2** |

The approval gates are P4 and P5 (they change what is drawn) and D5 (protected invariant).

---

## 9. Not verified (Task 9)

- **U1** Branch `fix/arrows-swingpath` was not found on origin or in open PRs, so its first-click/last-click range was not read. M14 describes how it *should* fit.
- **U2** Library touch behaviour was read from source, not tested on a phone. The L1 touch assessment (works through interact.js, 20 px edge, no `touch-action`, mouse-only row drag) is from code. Real-device feel is unknown.
- **U3** For L2, the "aliasing React to 18 would still fail" conclusion is inferred from the inlined React 19 JSX runtime; only the default install (nested React 19 → "Invalid hook call") was actually run.
- **U4** The GitHub activity of both libraries (issues, stars, commit cadence) was not checked. This session's GitHub access is scoped to this repo, so maintenance is judged from npm publish dates only.
- **U5** Bundle sizes are esbuild measurements in a scratch project, not a Next build of `/analysis`.
- **U6** YouTube time for ranged items (R7).
- **U7** "V1 checkpoint": `docs/V1_LAUNCH_CHECKPOINT.md` records the `v1.0` tag (2026-10-15). I read "after the checkpoint" as "after the next checkpoint the coach calls". The phase table marks what is safe before it (additive, off by default, no change to what is drawn) and what must wait.
- **U8** No performance numbers yet. R2 lists what to measure in P4.

## Open questions for Vin
- **Q1** When a bar is dropped on an occupied row: push it to the next free row (A6), or allow overlaps on a row?
- **Q2** Should a newly drawn item get a default range (for example from the playhead to +2 s), or stay "always visible" until edited (D3, recommended)?
- **Q3** Should drawings made while in a snapshot ever get ranges, or do snapshots stay hold-only (D5, recommended)?
- **Q4** Option A or B for phone (§6)?
