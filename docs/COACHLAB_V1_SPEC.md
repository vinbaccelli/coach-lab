# CoachLab V1 — Product Specification (Source of Truth)

**Version:** 1.2  
**Date:** June 2026  
**Status:** Implementation audit & legacy UI reference  

> **Authoritative product governance:** [`COACHLAB_V1_PRODUCT_FREEZE.md`](./COACHLAB_V1_PRODUCT_FREEZE.md)  
> If anything in this file conflicts with the Product Freeze, **the freeze wins**.

---

## Document purpose

This document captures **implementation audit notes** and legacy UI structure. Product direction, priorities, and Coach Override rules live in **`COACHLAB_V1_PRODUCT_FREEZE.md`**.

Historically this file reflected:

- Current implemented architecture (as of commit `1b431e5`)
- Intended final V1 product direction
- Known launch-critical bugs (audited, not fixed here)
- Readiness assessments for upcoming tools

**Principle:** Recording captures reality. Cropping and trimming are post-processing only.

---

# PART 1 — UPDATED V1 SPECIFICATION

## 0. Platform architecture (unchanged summary)

CoachLab is a Next.js 15 App Router PWA. Auth via Supabase Google OAuth. Protected routes enforced in middleware.

**Primary modules:** Control Panel (`/`), Video Analysis (`/analysis`), Player Database, Manual Match Report, AI Match Data Decoder, CoachLab Academy.

**Video Analysis stack:** Canvas 2D rendering, MoveNet pose worker, MediaRecorder + FFmpeg WASM, AB sync for local HTML5 video.

---

## 1. Video Analysis toolbar — final V1 structure

The left toolbar is a **single persistent rail**. Sub-screens (Draw, Skeleton, Recording Hub) are navigation destinations inside the rail — not separate toolbars.

### 1.1 Home screen button order (top → bottom)

| # | Button | Action |
|---|--------|--------|
| 1 | **Expand Toolbar** | Toggle label visibility on mobile / compact rail |
| 2 | **Control Panel** | Navigate to `/` |
| 3 | **Recording Hub** | Open Recording Hub sub-screen |
| 4 | **Select** | Activate select tool; exit draw context |
| 5 | **Draw** | Open Draw sub-screen; activate pen if needed |
| 6 | **Skeleton** | Activate skeleton tool; open Skeleton sub-screen |
| 7 | **Stromotion** | Open Stromotion sub-screen *(V1 target — not yet in toolbar UI)* |
| 8 | **AI Metrics** | Open AI Metrics sub-screen *(V1 target — not yet in toolbar UI)* |

### 1.2 Fixed global actions (never move)

These four actions are **always pinned at the bottom** of every toolbar sub-screen. They must never move, disappear, shift horizontally, or become unreachable by scroll clipping.

| # | Button | Action |
|---|--------|--------|
| 9 | **Undo** | Undo last canvas action |
| 10 | **Redo** | Redo |
| 11 | **Clear All** | Clear all drawings on active markup target |
| 12 | **Clear Session** | Full workspace reset (videos + drawings + recording state) |

**Hard rule:** `GlobalActionsFooter` is a sibling of the scroll area — never inside it. Any sub-screen that violates this breaks V1 acceptance.

**Current deviation:** `angle` sub-screen still nests `GlobalActionsFooter` inside the scroll area (`ToolPalette.tsx` ~1075). This is a known bug.

### 1.3 Width states

| Context | Collapsed | Expanded |
|---------|-----------|----------|
| Desktop | 56 px (icons) | 208 px (icons + labels) |
| Mobile / compact | 40 px (icons) | 112 px (icons + labels) |

Desktop chevron collapse persists to `localStorage`. Mobile uses Expand Toolbar button.

### 1.4 Mobile-only

**Precision** draw tool remains available on mobile only (not part of the numbered V1 home list above; optional enhancement row).

---

## 2. Recording Hub — updated V1 specification

### 2.1 REMOVED: Selected Area Recording (pre-record)

**Removed from V1.** The old workflow — draw a viewport frame before recording and crop live capture — is deprecated.

**Reason:** Post-record crop is superior:
- Stable across This Tab / Window / Entire Screen
- No browser coordinate mapping during capture
- Same recording pipeline for all sharing modes

### 2.2 Current implemented hub (ordered action grid)

Recording Hub is the **only** place for recording, webcam, mic, and capture settings. No duplicate controls elsewhere in the toolbar.

| # | Control | Behavior |
|---|---------|----------|
| 1 | Layout 16:9 | Sets analysis layout mode |
| 2 | Layout 9:16 | Sets analysis layout mode |
| 3 | Screenshot — screen | `getDisplayMedia` → PNG |
| 4 | Screenshot — video frame | Canvas/video frame PNG |
| 5 | Start / Stop recording | Toggle; always records **full screen** |
| 6 | Select recording area | Optional metadata overlay; **does not affect capture** |
| 7 | Webcam on/off | Single toggle |
| 8 | Mic on/off | Single toggle |
| 9 | Background removal | Webcam cutout toggle |
| 10 | PiP shape | Rectangle ↔ circle |
| 11 | Reset recording settings | Clears area + layout + webcam + mic |

**While recording:** Start/Stop toggles red + a **sticky floating Stop button** (portal, high z-index) is always visible outside the scroll area.

### 2.3 V1 target workflow (full post-processing pipeline)

```
Record → Stop → Crop Layout → Trim Video Length → Download
```

#### Step 1 — Record
- User taps **Start recording**
- Browser `getDisplayMedia` — user picks tab/window/screen
- **Always full capture** — no crop params passed to recorder
- Optional webcam PiP composited into recording canvas
- Optional mic audio muxed
- Output: raw video blob (WebM or MP4 depending on browser)

#### Step 2 — Stop
- User taps **Stop** (hub toggle or floating Stop)
- Recording session ends; blob assembled
- `PostRecordingCropModal` opens automatically

#### Step 3 — Recording Complete modal
User chooses:
1. **Download Full Video** — export blob as-is
2. **Crop Before Download** — enter crop phase
3. **Cancel** — discard session metadata

If user pre-selected a recording area (metadata only), modal opens straight into crop phase with crop box seeded from that area.

#### Step 4 — Crop Layout (optional)
In crop phase:
- Video preview (recorded blob)
- Draggable + resizable crop rectangle
- Aspect presets: **Free**, **16:9**, **9:16**
- Crop applied at export via canvas pipeline (`lib/cropExport.ts`):
  - Hidden `<video>` → per-frame `drawImage` crop → `canvas.captureStream()` → `MediaRecorder` → blob → WebM/MP4

**Crop is the ONLY crop system in the product.** No live cropping during capture.

#### Step 5 — Trim Video Length *(V1 target — not yet implemented)*

After crop (or on full-video path before download), user can trim temporal length.

**Intended UX:**
- Timeline scrubber showing full recorded duration
- **Start handle** — drag to set in-point (e.g. 0:04)
- **End handle** — drag to set out-point (e.g. 0:09)
- Live preview plays trimmed segment loop
- Duration label: `4.0s – 9.0s (5.0s export)`
- **Download trimmed** applies trim during export (same canvas re-encode pipeline or FFmpeg trim filter)
- **Skip trim** proceeds to download full/cropped selection

**Example:** 15 s recording → user sets 4 s–9 s → downloaded file is 5 s.

**Implementation note (future):** Trim can share the post-processing modal shell with crop; export step runs crop first (if any), then trim, then download.

#### Step 6 — Download
- MP4 preferred (FFmpeg WASM conversion when source is WebM)
- Filename: `coach-lab-recording-{timestamp}.mp4`
- Session cleared after successful download or cancel

### 2.4 Recording area metadata (optional, pre-record)

`recordingArea = { x, y, width, height, aspectRatio }` stored in page state.

- Set via **Select recording area** overlay (`RegionRecordOverlay`)
- **Confirm area** stores metadata only
- Does NOT start recording
- Does NOT affect `getDisplayMedia` or `ScreenRecorder` paint loop
- Seeds post-record crop rectangle when present

### 2.5 Architecture constraints (non-negotiable)

| Rule | Status |
|------|--------|
| Display recording always full screen | ✅ Implemented |
| No `getViewportCropRegion` during capture | ✅ Removed |
| Crop only in `PostRecordingCropModal` + `cropExport` | ✅ Implemented |
| Trim only post-record | ❌ Not yet implemented |
| Canvas analysis recording (`mode="canvas"`) may use zoom crop region | ⚠️ Separate feature — not screen recording |

---

## 3. Webcam PiP (unchanged core rules)

- Overlay on canvas only — never part of video layer or toolbar chrome
- Movable, resizable; respects playback dock bottom inset
- Shapes: rectangle, circle
- Background removal via Body Segmentation (MediaPipe)
- **Opacity control removed from V1 hub** (dropped per product decision; internal default 100%)
- All webcam controls live **only** in Recording Hub (toolbar Webcam sub-screen removed)

---

## 4. Stromotion — V1 tool specification *(intent only)*

### Purpose
Visualize motion over time by overlaying semi-transparent "ghost" frames of the athlete at intervals through a swing or movement sequence. Helps coaches and players see path, timing, and body position changes without scrubbing frame-by-frame.

### Intended workflow
1. Coach opens **Stromotion** from toolbar (#7)
2. Sets time range (start/end) on timeline or via numeric inputs
3. Optionally selects a region on video (rubber-band) to isolate subject
4. Sets ghost count and opacity
5. Tool extracts frames from video, generates ghost `ImageBitmap`s
6. Ghosts render on canvas beneath drawings, above video
7. Coach can clear ghosts, adjust range, re-process

### Current codebase state
- `hooks/useStroMotion.ts` — frame extraction hook ✅
- `lib/stroMotion.ts` — config + draw helper ✅
- `Canvas.tsx` — ghost rendering + region select API ✅
- `page.tsx` — state wired, passed to Canvas ✅
- **No toolbar sub-screen or home button yet** ❌

### V1 scope
- Toolbar entry + sub-screen with range, count, opacity, region select, process/clear
- Works on local HTML5 video only (not YouTube/embed — same constraint as current hook)

---

## 5. AI Metrics — V1 tool specification *(intent only)*

### Purpose
Surface quantitative coaching metrics derived from pose estimation — joint angles, symmetry, head stability, segment velocities — without manual measurement. Complements Skeleton overlay with numbers coaches can reference in feedback.

### Intended workflow
1. Coach opens **AI Metrics** from toolbar (#8)
2. Video plays (or pauses on frame); pose pipeline runs via existing MoveNet worker
3. Panel shows metric cards for current frame or range:
   - Example: shoulder rotation, hip-shoulder separation, knee flexion L/R, head tilt
4. In AB mode: metrics shown per panel (A vs B) when both are local video
5. Optional: export snapshot of metrics to player entry (future)

### V1 scope (documentation only)
- Read-only metrics panel driven by existing pose keypoints
- No new ML models in V1 — derive from MoveNet output + skeleton angle math already in `Canvas.tsx`
- YouTube/embed slots show "metrics unavailable" state

---

## 6. V1 launch-critical feature checklist (updated)

**Must work before launch:**

- [x] Google OAuth
- [x] Local video upload A/B
- [x] All draw tools + select + style system
- [x] Undo/redo/clear all/clear session (always visible — with known angle-screen exception)
- [x] Skeleton overlay (MoveNet worker)
- [x] AB sync (local video)
- [x] Full screen recording → post-record crop → download (desktop)
- [ ] Full screen recording → post-record crop → download (**mobile — broken, see audit**)
- [ ] Video trim in post-record pipeline
- [ ] Stromotion toolbar integration
- [ ] AI Metrics toolbar integration
- [x] Webcam PiP + hub-only controls
- [x] 16:9 / 9:16 layouts
- [x] Mobile compact toolbar
- [ ] Mobile Control Panel scroll
- [ ] Mobile toolbar stability (expand + draw context)

**Explicitly removed from V1:**
- Selected Area Recording (live crop during capture)
- Webcam opacity slider in hub
- Upload video drag-drop in Recording Hub
- Toolbar Webcam sub-screen (consolidated into hub)

**Remain V2 unless promoted:**
- URL/YouTube direct analysis without download
- Cloud video storage
- Stripe billing, public catalog
- Racket Multiplier, Object Multiplier, Ball Trail (code exists, commented out)

---

# PART 2 — BUG AUDIT

## Critical Bug #1 — Mobile Control Panel does not scroll correctly

### Symptom
Entire Control Panel should scroll vertically; parts of the panel cannot be reached on mobile.

### Root cause (likely)
**Multi-layer scroll + global overflow lock conflict.**

1. **`app/globals.css`** sets `body { overflow: hidden; height: 100dvh; }` — document body never scrolls.
2. **`components/WorkspaceChrome.tsx`** wraps Control Panel in `<main style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>` — scroll is delegated to this inner container. This is correct in theory.
3. **`components/ControlPanelHome.tsx`** shell uses `minHeight: 'min(100%, 100%)'` which resolves ambiguously when the parent flex child doesn't establish a definite percentage height. On some mobile WebKit builds this prevents the main scroll container from recognizing content overflow.
4. **Viewport unit mismatch:** WorkspaceChrome outer wrapper uses `minHeight: '100vh'` while body uses `100dvh`. On iOS Safari the address bar show/hide causes the scrollable region to be sized incorrectly — bottom cards (Profile & Business section) get clipped below the visible fold with no scroll affordance.
5. **Install prompt banner** sets `--coachlab-install-banner-height` on `documentElement`; padding is applied to `main` but the outer chrome still uses `100vh`, compounding bottom clipping.

### Components / files
- `app/globals.css` (body overflow)
- `components/WorkspaceChrome.tsx` (scroll container, `100vh` vs `100dvh`)
- `components/ControlPanelHome.tsx` (shell minHeight, bottom padding)
- `components/InstallPrompt.tsx` (banner height CSS variable)

### Recommended fix strategy
1. Standardize WorkspaceChrome outer + main to `100dvh` (match analysis layout).
2. Remove `minHeight: 'min(100%, 100%)'` from ControlPanelHome; use `minHeight: 0` and let content define height naturally.
3. Verify scroll on real iOS Safari: Profile & Business cards must be reachable.
4. Optionally move scroll to body with `overflow: auto` on control-panel routes only (route-scoped CSS) instead of nested flex scroll.
5. **Do not change** analysis page layout (already `100dvh`).

---

## Critical Bug #2 — Toolbar expands incorrectly on mobile

### Symptom
Toolbar expands horizontally; some buttons become difficult to see.

### Root cause (likely)
**Horizontal width expansion steals canvas space; label mode exceeds rail width.**

1. **`app/analysis/page.tsx`** — `toolbarWidthPx` transitions 40 → 112 px when `toolbarLabelsExpanded` (`TOOLBAR_MOBILE_W` → `TOOLBAR_COMPACT_EXPANDED_W`). The `<aside>` animates width with `transition: 'width 200ms ease'`, shrinking the video canvas horizontally.
2. On mobile landscape (≤1024 touch), `phoneToolbarLayout` is true — toolbar is in-flow beside canvas. A 72 px width increase materially compresses the video area; slot pills and canvas controls appear "hidden" at the right edge.
3. When labels are shown at 112 px width, `ToolPalette` Row components render icon + label text. Long labels ("Session & record", "Clear session") truncate but row padding + 112 px rail is tight — touch targets overlap visually.
4. **`hubIconOnly={phoneToolbarLayout && !toolbarLabelsExpanded}`** — Recording Hub switches between icon-only and labeled rows on expand, adding more visual churn inside an already narrow rail.

### Components / files
- `app/analysis/page.tsx` (`toolbarWidthPx`, `renderToolbarRail`, `phoneToolbarLayout`, `TOOLBAR_*` constants)
- `components/ToolPalette.tsx` (`iconOnlyMode`, `ToolbarLead`, row rendering)
- `components/RecordingHub.tsx` (`hubIconOnly`, grid layout)

### Recommended fix strategy
1. **Do not expand toolbar horizontally on mobile.** Keep rail at 40 px; expand labels via tooltip/title only, OR use a bottom sheet / overlay drawer for labeled controls.
2. If horizontal expand is kept: expand to full-width overlay drawer (not in-flow width change) so canvas size is unaffected.
3. Enforce `flex-wrap` + 2-column icon grid inside hub at 40 px (already partially done) — never widen the aside.
4. Add `min-width: 0` on canvas column (already present in some paths — verify all mobile layout branches).

---

## Critical Bug #3 — Toolbar shifts and hides buttons when using draw tools

### Symptom
When using drawing tools, toolbar contents move. Undo/Redo remain visible; other buttons become partially hidden. Horizontal shifting occurs.

### Root cause (likely)
**Nested scroll containers + inline Mark Style expansion + vertical thickness slider.**

1. **Double scroll nesting:** `renderToolbarRail()` wraps `ToolPalette` in `overflowY: 'auto'`. Inside, `ToolPalette` shell also has `scrollAreaFor()` with `overflowY: 'auto'`. Only the inner or outer container receives scroll gestures — content between Back header and GlobalActionsFooter gets clipped without reliable scroll on some browsers.
2. **Draw sub-screen inline style expansion:** When `drawContextActive`, `MarkStyleControls` renders **inside** the scroll area (~15+ extra rows: 4 color swatches, custom color, vertical `ThicknessPxBar` 96 px tall, solid/dashed, highlight pulse, eraser + slider). Total height exceeds viewport; upper navigation (Back, tool list) scrolls away while GlobalActionsFooter stays pinned (correct) — user perceives "buttons hidden" as the top tools scroll off-screen without obvious scroll affordance.
3. **Vertical ThicknessPxBar on compact chrome:** `useVerticalThickness = compactToolbarChrome || mobileChrome || phoneLayout` — on mobile, style controls use a 96 px vertical slider inside a 40 px wide rail. The slider + labels may overflow horizontally (`width: 28` slider in 40 px rail with padding) causing horizontal clip/shift.
4. **`shellStyle` has `overflow: 'hidden'`** — any child wider than rail is clipped rather than wrapped.
5. **`angle` sub-screen bug:** GlobalActionsFooter inside scroll area — inconsistent footer pinning compared to Draw screen.

### Components / files
- `components/ToolPalette.tsx` (`scrollAreaFor`, `MarkStyleControls`, `ThicknessPxBar`, `GlobalActionsFooter`, draw/angle screens)
- `app/analysis/page.tsx` (`renderToolbarRail` outer scroll wrapper)
- `app/analysis/page.tsx` (`drawContextActive`, `handleToolChange`, `DRAW_CONTEXT_TOOLS`)

### Recommended fix strategy
1. **Remove nested scroll** — only ONE scroll container between rail aside and GlobalActionsFooter. Recommended: aside scrolls OR ToolPalette shell scrolls, not both.
2. **Move Mark Style to dedicated sub-screen** (`style` screen already exists) instead of inline expansion in Draw screen — prevents draw screen height explosion.
3. **Use horizontal thickness slider** even on mobile when rail ≤ 112 px (disable vertical slider in narrow rails).
4. Fix `angle` screen: move `GlobalActionsFooter` outside scroll area (match Draw/Skeleton pattern).
5. Add visible scroll fade or max-height with explicit scrollbar on draw/style screens for mobile.

---

## Critical Bug #4 — Toolbar icon consistency

### Audit: current toolbar icons

| Location | Item | Current icon | Clarity |
|----------|------|--------------|---------|
| Home | Expand Toolbar | `PanelLeftOpen` / `PanelLeftClose` | ✅ Clear |
| Home | Control Panel | `Home` | ✅ Clear |
| Home | Session & Record | `LayoutGrid` | ⚠️ Generic — suggests layout not recording |
| Home | Select | `MousePointer2` | ✅ Clear |
| Home | Draw | `Pen` | ✅ Clear |
| Home | Skeleton | `PersonStanding` | ✅ Clear |
| Home | Precision (mobile) | `Crosshair` | ✅ Clear |
| Draw | Pen | `Pen` | ✅ Clear |
| Draw | Line | `Minus` | ✅ Clear |
| Draw | Arrow | `ArrowRight` | ✅ Clear |
| Draw | Angle | Custom triangle SVG | ✅ Clear |
| Draw | Angle arrow | Custom triangle + arrow SVG | ✅ Clear |
| Draw | Rectangle | `Square` | ✅ Clear |
| Draw | Circle | `Circle` | ✅ Clear |
| Draw | **Swing path** | **`Zap` (lightning)** | ❌ **Unclear — reads as "flash/power" not motion path** |
| Draw | Joint chain | `Link2` | ⚠️ Moderate — chain/link ok but not obviously "body joints" |
| Draw | Text | `Type` | ✅ Clear |
| Draw | Style | `Palette` | ✅ Clear |
| Skeleton | Refresh pose | `RefreshCw` | ✅ Clear |
| Global | Undo | `Undo2` | ✅ Clear |
| Global | Redo | `Redo2` | ✅ Clear |
| Global | Clear all | `Trash2` | ✅ Clear |
| Global | Clear session | `RefreshCw` | ⚠️ Same icon as skeleton refresh — confusing |
| Recording Hub | 16:9 / 9:16 | `LayoutGrid` | ✅ Clear |
| Recording Hub | Screenshot screen | `Monitor` | ✅ Clear |
| Recording Hub | Screenshot frame | `ImageIcon` | ✅ Clear |
| Recording Hub | Start/Stop | Red dot / `Square` | ✅ Clear |
| Recording Hub | Select area | `Frame` | ✅ Clear |
| Recording Hub | Webcam | `Camera` / `CameraOff` | ✅ Clear |
| Recording Hub | Mic | `Mic` / `MicOff` | ✅ Clear |
| Recording Hub | Background removal | `Scissors` | ⚠️ Moderate — could mean "cut/trim" |
| Recording Hub | PiP shape | `Square` / `Circle` | ✅ Clear |
| Recording Hub | Reset | `RefreshCw` | ⚠️ Overloaded refresh icon |

### Suggested icon improvements (documentation only)

| Item | Suggested icon | Rationale |
|------|----------------|-----------|
| Session & Record | `Video` or `Disc` | Reads as recording session |
| Swing path | `TrendingUp` (curved path) or custom bezier SVG | Motion/path semantics |
| Joint chain | `GitBranch` or nodes SVG | Sequential connected points |
| Clear session | `RotateCcw` + warning color OR `LogOut`-style door | Distinct from refresh |
| Background removal | `PersonStanding` + cutout badge OR `ScanFace` | Segmentation semantics |
| Stromotion (future) | `Layers` or ghost overlay SVG | Multiple frames |
| AI Metrics (future) | `Activity` or `BarChart3` | Quantitative readout |

---

## Critical Bug #5 — Recording Hub does not record correctly on mobile

### Symptom
Desktop workflow (Record → Stop → Crop → Download) works. Mobile recording does not.

### Root cause (likely — multiple compounding factors)

#### A. Browser platform limitations (iOS Safari)
- **`getDisplayMedia` on iOS** only available from iOS 17+ and primarily for **tab/window** capture; entire-screen capture limited. PWA standalone mode has additional restrictions.
- User may pick wrong surface or OS may deny silently (`NotAllowedError` swallowed in `ScreenRecorder.tsx` line 222 — no user feedback on cancel/deny).
- **`documentPictureInPicture`** for webcam preview during recording — fails silently on iOS; not fatal but indicates mobile code paths less tested.

#### B. MediaRecorder codec support
- iOS Safari typically records **WebM** (if at all) or limited MP4; `getBestMimeType()` may pick WebM VP8.
- **`convertWebmToMp4ForScreenRecord`** (FFmpeg WASM) is **heavy** — often fails or OOM on mobile Safari due to memory limits. Desktop succeeds; mobile may produce WebM that never converts, or conversion hangs with no timeout UX beyond progress text.

#### C. Post-record crop export (`lib/cropExport.ts`) — second MediaRecorder pass
- Crop export runs **real-time re-encode**: plays full video, draws each frame to canvas, `captureStream(30)` → new `MediaRecorder`.
- On mobile: CPU/memory intensive; frequently fails mid-export or produces empty blob (`out.size === 0` guard).
- **`video.captureStream()` for audio** — non-standard; iOS likely silent on cropped export even when video works.
- **`video.onended` reliability** — WebM blobs from mobile MediaRecorder sometimes lack proper duration metadata; failsafe timeout may fire early/late.

#### D. UI / gesture issues
- Headless `ScreenRecorder` started via `recorderRef.current?.start()` from hub button — user gesture chain should be OK on tap.
- **Floating Stop** portal works on desktop; on mobile may be obscured by Safari UI or safe-area issues (bottom inset may be insufficient).
- **`PostRecordingCropModal`** full-screen — should appear, but if `onRecordingComplete` never fires (recorder `onstop` failure), modal never opens — user sees "recording stopped" with no feedback.

#### E. Hub icon-only mode
- Mobile hub is icon-only (`hubIconOnly=true`); error states from `ScreenRecorder` are headless (no inline error UI). Failures are invisible unless page-level banner exists (none wired for screen record errors).

### Components / files
- `components/ScreenRecorder.tsx` (display recording, headless mode, error swallowing)
- `components/RecordingHub.tsx` (headless recorder, floating stop, icon-only)
- `components/PostRecordingCropModal.tsx` (post-record UI)
- `lib/cropExport.ts` (canvas re-encode)
- `lib/ffmpegWebmToMp4.ts` (WASM conversion)
- `app/analysis/page.tsx` (`handleScreenRecordComplete`, `recordingSession`, modal portal)

### Recommended fix strategy
1. **Add explicit mobile error surfacing** — propagate `ScreenRecorder` errors to page-level toast/banner; never silent `NotAllowedError`.
2. **Mobile export path simplification:**
   - Allow **WebM download** without FFmpeg conversion on mobile (skip MP4 step when WASM fails).
   - Offer **download full recording without crop** as primary mobile path; crop optional with clear "may be slow" warning.
3. **Replace canvas re-encode crop on mobile** with FFmpeg WASM `crop` filter (single pass, no realtime playback) — lower CPU than frame-by-frame canvas loop OR server-side transcode (V2).
4. **Feature-detect before record:** if `MediaRecorder` or `getDisplayMedia` unavailable, disable Start with explanation.
5. **Test matrix:** iOS Safari 17+ tab capture, Android Chrome tab capture; document unsupported "Entire Screen" on iOS.
6. **Do not change desktop pipeline** — it works; gate mobile-specific fallbacks behind capability detection.

---

# PART 3 — RECORDING HUB AUDIT (current vs spec)

| Requirement | Desktop | Mobile | Notes |
|-------------|---------|--------|-------|
| Full screen record only | ✅ | ⚠️ | iOS surface picker limitations |
| No live crop | ✅ | ✅ | Display `paintOnce` draws full frame |
| Post-record modal | ✅ | ⚠️ | Modal works; export may fail |
| Crop export | ✅ | ❌ | `cropExport.ts` too heavy for mobile |
| Trim | ❌ | ❌ | Not implemented |
| Area metadata (optional) | ✅ | ✅ | UI-only seed for crop |
| Floating Stop always visible | ✅ | ⚠️ | Verify safe-area on iOS |
| Webcam/mic in hub only | ✅ | ✅ | Toolbar webcam screen removed |
| Single recorder instance | ✅ | ✅ | One headless `ScreenRecorder` |

**Gap summary:** Desktop matches V1 target except trim. Mobile fails at export/conversion stage, not necessarily at capture stage — diagnose whether blob is created before blaming `getDisplayMedia`.

---

# PART 4 — STROMOTION READINESS ASSESSMENT

## Can Stromotion be added cleanly to the current canvas system?

**Yes.** Architecture is already ~70% built.

### Reusable systems
| System | Location | Reuse |
|--------|----------|-------|
| Ghost frame extraction | `hooks/useStroMotion.ts` | Direct |
| Ghost rendering | `Canvas.tsx` render loop (~2811) | Direct |
| Region selection | `Canvas.startStroMotionRegionSelect` | Direct |
| Config types | `lib/stroMotion.ts` | Direct |
| Timeline time range | `PreciseTimeline` + `page.tsx` time state | Extend for start/end pick |
| Video ref | `videoRef` in page | Direct (slot A) |

### Extensions needed
1. **Toolbar sub-screen** — new `NavScreen: 'stromotion'` in `ToolPalette.tsx` with range, count, opacity, region, process/clear controls.
2. **Home button #7** — row pushing `'stromotion'` nav.
3. **Slot B / AB** — decide V1: slot A only (simplest) or active markup target.
4. **YouTube guard** — hook already disabled for embeds; show message in UI.
5. **Processing UX** — progress banner exists (`stroMotionProcessing`); wire to toolbar.

### Risk
- Frame extraction seeks video repeatedly — conflicts with AB playback if processing during sync. Mitigation: require pause before process (already implicit in hook seeking).

### Verdict
**Low integration risk.** Mostly UI wiring; no canvas architecture change required.

---

# PART 5 — AI METRICS READINESS ASSESSMENT

## Where pose estimation integrates today

| Layer | Location | Role |
|-------|----------|------|
| ML inference | `lib/poseWorkerBridge.ts`, `lib/poseWorker.ts` | MoveNet in Web Worker |
| Smoothing | `lib/keypointSmooth.ts` | EMA jitter reduction |
| Skeleton draw | `Canvas.tsx` `drawPoseSkeleton` | Lines, joints, angles |
| Angle math | `Canvas.tsx` (~436), `lib/drawingTools.ts` `calcAngleDeg` | Joint angle labels |
| Config toggles | `page.tsx` + `ToolPalette` skeleton screen | Show angles, body parts |
| Manual skeleton | `lib/skeleton.ts` | Legacy manual joints (separate from MoveNet) |

## What AI Metrics would extend

1. **Metrics derivation layer (new)** — `lib/aiMetrics.ts` or similar: pure functions from `PoseKeypoint[]` → metric definitions (shoulder turn, hip rotation, etc.).
2. **Toolbar sub-screen (new)** — `NavScreen: 'aiMetrics'` panel listing metrics with live values; reads from Canvas/page pose state.
3. **Pose state exposure** — Canvas currently consumes pose internally; need callback or shared ref to expose latest keypoints + timestamp to metrics panel without duplicating inference.
4. **AB comparison** — Architecture supports it: two Canvas instances, two video refs, independent pose bridges. Metrics panel would read from `markupTarget` active slot or show dual columns.
5. **Historical / range metrics (V2)** — would need pose buffer export beyond skeleton overlay buffer (~300 frames in Canvas).

## Video A / B comparison support

**Yes, partially ready.**
- Each canvas runs independent pose loop when skeleton enabled.
- `markupTarget` state exists in page but no UI toggle — metrics should respect same target.
- Performance risk: dual inference during AB (same as skeleton C-5 in old bug list) — metrics should gate inference to active panel only.

## Verdict
**Medium integration risk.** Inference exists; need new derivation layer + pose state API + toolbar UI. No new ML model required for V1 metrics if limited to angles/positions from MoveNet.

---

# PART 6 — RECOMMENDED DEVELOPMENT ORDER

Stabilization before features. Based on launch criticality and dependency chain:

| Phase | Work | Rationale |
|-------|------|-----------|
| **1** | Fix mobile Control Panel scroll (Bug #1) | Blocks navigation to all modules on phone |
| **2** | Fix toolbar scroll nesting + draw context height (Bug #3) | Blocks core annotation UX on mobile |
| **3** | Fix toolbar mobile expand strategy (Bug #2) | Blocks tool discovery on phone |
| **4** | Fix mobile recording pipeline (Bug #5) | Core V1 workflow; split mobile export fallbacks |
| **5** | Icon consistency pass (Bug #4) | Low risk, high UX clarity |
| **6** | Post-record **trim** step (new spec) | Completes Record→Stop→Crop→Trim→Download |
| **7** | Stromotion toolbar integration | Infrastructure ready; UI only |
| **8** | AI Metrics toolbar + derivation layer | Depends on stable pose + toolbar |
| **9** | AB metrics dual-panel + performance gating | Polish after single-panel metrics work |

**Do not start Stromotion or AI Metrics until phases 1–4 are verified on real iOS Safari and Android Chrome.**

---

# Appendix A — File reference map

| Area | Primary files |
|------|---------------|
| Toolbar | `components/ToolPalette.tsx`, `app/analysis/page.tsx` |
| Recording | `components/RecordingHub.tsx`, `components/ScreenRecorder.tsx`, `components/PostRecordingCropModal.tsx`, `lib/cropExport.ts` |
| Control Panel | `components/ControlPanelHome.tsx`, `components/WorkspaceChrome.tsx` |
| Canvas | `components/Canvas.tsx` |
| Pose / Skeleton | `lib/poseWorkerBridge.ts`, `lib/poseWorker.ts` |
| Stromotion | `hooks/useStroMotion.ts`, `lib/stroMotion.ts` |
| Layout | `app/analysis/layout.tsx`, `app/globals.css` |

---

# Appendix B — Glossary

| Term | Meaning |
|------|---------|
| Post-record crop | Only valid crop system; applied after recording stops |
| Recording area metadata | Optional pre-record rectangle; seeds crop UI; never affects capture |
| GlobalActionsFooter | Undo/Redo/Clear All/Clear Session — always pinned at toolbar bottom |
| Headless recorder | `ScreenRecorder` with no UI; driven by Recording Hub ref |

---

*End of CoachLab V1 Specification v1.1*
