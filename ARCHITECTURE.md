# AngleMotion — Architecture Specification

> **Status:** Living document. This is the permanent source of truth for the
> AngleMotion analysis platform. Read it before implementing anything. Update it
> whenever the architecture changes.
>
> **Audience:** Engineers working on the Video Analysis / Metrics systems.
>
> **Last reviewed:** after the Snapshot architecture migration + production
> readiness review.
>
> **Companion doc:** `DECISIONS.md` records *why* these architectural choices
> were made (ADR log). This document covers *how* the system works.

---

## 1. Project Philosophy

AngleMotion is a Next.js 15 (App Router) PWA for tennis/sports coaching: video
analysis, AI pose estimation, stroke-phase breakdowns, StroMotion composites,
player database, and report export.

**Goals**
- Give coaches a frame-accurate, annotatable analysis surface.
- Make every AI output a *draft* the coach reviews and adjusts — AI is never authoritative.
- Keep analysis state predictable, inspectable, and serializable.

**Design principles**
- **Single source of truth.** For the Metrics/Phases flow, the `Snapshot` is the
  only container for analysis state. UI reads from the active snapshot; it never
  keeps a parallel copy.
- **Predictable state.** State transitions are explicit (`createSnapshot`,
  `selectSnapshot`, `saveActiveSnapshot`). No side effects inside state updaters.
- **Derived over duplicated.** Timeline markers, ordered lists, and visibility
  flags are computed from snapshots via `useMemo`, never stored twice.
- **Long-term maintainability.** New analysis capabilities become *fields on the
  Snapshot*, not new state stores. See §13.

---

## 2. Global Architecture

```
                         ┌──────────────────────────────┐
                         │      app/analysis/page.tsx     │
                         │   (state hub / orchestrator)   │
                         └───────────────┬───────────────┘
                                         │
        ┌────────────────┬──────────────┼──────────────┬─────────────────┐
        │                │              │              │                 │
   ┌────▼────┐     ┌─────▼─────┐  ┌─────▼──────┐  ┌────▼─────┐    ┌──────▼──────┐
   │ Canvas  │     │ToolPalette│  │PreciseTime-│  │Playback  │    │ Snapshot     │
   │(render, │     │(toolbar / │  │line        │  │Controls  │    │ store        │
   │ strokes,│     │ subscreens│  │(green balls│  │(play/seek│    │ snapshots[]  │
   │ skeleton│     │ Metrics)  │  │ = phases)  │  │ rate)    │    │ + activeId   │
   │ overlays)│    └───────────┘  └────────────┘  └──────────┘    └──────┬──────┘
   └────┬────┘                                                            │
        │  getSkeletonKeypoints / exportStrokes / getOverlayAdjustments   │
        └────────────────────────────────────────────────────────────────┘
                                         │
        ┌────────────────┬───────────────┼────────────────┐
   ┌────▼─────┐    ┌──────▼──────┐  ┌─────▼──────┐   ┌──────▼───────┐
   │ Generate │    │ Scroll Viz  │  │ StroMotion │   │ Player DB /  │
   │ (replay) │    │ Panel       │  │ (separate  │   │ Sessions /   │
   │          │    │             │  │  draft)    │   │ Google Docs  │
   └──────────┘    └─────────────┘  └────────────┘   └──────────────┘
```

**Subsystem interaction**
- `page.tsx` owns the snapshot store and passes derived data + callbacks down.
- `Canvas.tsx` is the render surface and the *transient* runtime buffer for
  strokes/keypoints/overlay-drags. It exposes imperative handles
  (`exportStrokes`, `importStrokes`, `getOverlayAdjustments`,
  `setOverlayAdjustments`, `getSkeletonKeypoints`, `captureStream`) so the
  snapshot store can read/write it.
- `ToolPalette.tsx` renders the toolbar and Metrics sub-screens; it is stateless
  about analysis data — it only fires callbacks.
- `PreciseTimeline.tsx` renders phase "green balls" from derived markers.
- Generate + Scroll Visualization read snapshots only.
- StroMotion is a **separate** system (its own draft model) — see §7.

---

## 3. Snapshot System (CORE)

A **Snapshot** is one analysis state anchored at a video timestamp (a green ball
on the timeline). It is the only container for Metrics/Phases analysis state.

### 3.1 Schema (`lib/snapshots.ts`)
```ts
interface SnapshotMeasurement { id: string; label: string; value: number; unit: string; type: string; }
interface OverlayAdjustment   { dx1: number; dy1: number; dx2: number; dy2: number; }
interface SnapshotKeypoint    { x: number; y: number; score: number; name: string; }

interface Snapshot {
  id: string;                                   // `snap-<ts>-<counter>` (unique)
  timeSec: number;                              // timeline anchor (== videoFrame/timestamp)
  label: string;                                // "Contact", "Phase 1"
  short: string;                                // "C", "1"
  column: SnapshotMeasurement[];                // measurements + manual notes (NOT live angles)
  drawingsJson: string;                         // serialized Fabric strokes
  overlaysOn: boolean;                          // measurement angle-arrow overlays visible
  overlayAdjustments: Record<string, OverlayAdjustment>; // per-overlay endpoint drags
  screenshot?: string;                          // PNG data URL (captured on Generate)
  notes?: string;
  skeleton?: SnapshotKeypoint[];                // pose at this frame
  aiDetection?: Record<string, number>;         // raw AI values
  jointAngles?: Record<string, number>;         // derived joint angles
}
```

### 3.2 Ownership
- Store lives in `app/analysis/page.tsx`: `snapshots: Snapshot[]` +
  `biomechSelectedPhaseId: string | null` (the active snapshot id).
- Everything else about a phase is derived: `biomechPhaseMarkers` (timeline),
  `orderedSnapshots` (sorted), `activeSnapshot`, `dataColumnVisible`.

### 3.3 Lifecycle
- **Creation** (`createSnapshot(timeSec, label, short)`): saves the active
  snapshot first, appends a new one, makes it active, and **resets the displayed
  column to live-angles-only + clears overlay adjustments** to prevent leakage.
  Created ONLY by **AI Detect** and the **Phases** picker.
- **Update**: Skeleton/Draw/Column edits mutate the *active* snapshot. The
  measurement column auto-saves into `activeSnapshot.column` (guarded to skip
  no-op writes). AI Detect writes `column`, `aiDetection`, `jointAngles`,
  `skeleton`, `overlaysOn` into the snapshot it creates (using the returned id).
- **Switching** (`selectSnapshot(id)`): `saveActiveSnapshot()` → restore target's
  column/overlays/adjustments/drawings → seek video to `timeSec` → pause →
  set active. Atomic; no cross-snapshot leakage.
- **Deletion**: currently only via full reset (`resetSession` → `setSnapshots([])`)
  or Phases replacement. Per-snapshot delete is not yet exposed.
- **Serialization / Restoration**: **NOT YET IMPLEMENTED** — see §10 and §14.1.

### 3.4 Invariants
- IDs are unique and stable for a snapshot's life.
- The active snapshot is always either `null` or a member of `snapshots`.
- `column` never stores `type: 'skeleton-angle'` rows (those are live-only).

---

## 4. Metrics Module

All Metrics tools integrate through the active snapshot. Sub-screens live in
`components/ToolPalette.tsx`; rendering in `components/Canvas.tsx`; AI logic in
`lib/biomechanics/`.

| Tool | Behavior | Snapshot integration |
|------|----------|----------------------|
| **Draw** | Freehand/line/arrow/angle/etc. | Strokes → `drawingsJson` via Canvas `exportStrokes`/`importStrokes`. Modifies active snapshot only. |
| **Skeleton** | Live MoveNet pose overlay | Renders from Canvas `latestKeypointsRef`; captured into `snapshot.skeleton` on save/AI-detect. Does NOT create a snapshot. |
| **AI Detect** | Computes joint angles, shoulder/hip lines, foot/racket direction | **Creates** a snapshot; writes `column` + `aiDetection` + `jointAngles` + `skeleton`; enables overlays. |
| **Phases** | Preset (8-step FH/BH/serve, 2-step volley) or custom 1–20 | **Creates** N snapshots spread across the trim range. |
| **Columns** | Right-side data column | Derived from `activeSnapshot.column` + live skeleton angles. Visible only when paused within 0.3 s of the active snapshot. |
| **Measurements** | Angle/ruler/differential rows | Stored as `column` items (`type` distinguishes kind). |
| **Angle tools / Overlays** | Editable arrow overlays from skeleton | `overlaysOn` + draggable endpoints in `overlayAdjustments`. |

**Behavior rules (frozen):** Skeleton and Draw modify the active snapshot only;
AI Detect and Phases create snapshots; column derives from the snapshot.

---

## 5. Timeline (`components/PreciseTimeline.tsx`)

- **Green balls** = phase markers, derived from `snapshots` via `toPhaseMarkers`.
- **Active snapshot**: clicking a ball calls `selectSnapshot(id)` which restores
  that snapshot's full state and seeks the video to `timeSec`.
- **Dragging a ball** updates only `snapshot.timeSec` (see debt §14.4 — capture
  does not move with it).
- **Synchronization**: column/overlay visibility is gated by `isNearActivePhase`
  (|videoTime − activeSnapshot.timeSec| < 0.3 s), driven by a throttled (~10 Hz)
  rAF video-time poll.
- **PlayControls** (`components/PlaybackControls.tsx`) owns play/pause, frame
  stepping, and `playbackRate` (reused by the Generate replay at 0.25×).

---

## 6. Generate Engine

Deterministic replay built entirely on snapshots (`handleGenerateSnapshots`,
`handleReplaySnapshots` in `page.tsx`; UI in
`components/metrics/SnapshotScrollPanel.tsx`).

- **Screenshot generation**: for each snapshot (sorted by `timeSec`): seek →
  restore drawings/overlays → `captureFrame` (`lib/drawingTools.ts`) → store
  `snapshot.screenshot`.
- **Scroll Visualization sync**: the panel maps `orderedSnapshots`; the active
  index (`replayIndex`) highlights the current card.
- **Replay state machine** (Freeze → Play → Snap → Freeze): snap to a snapshot →
  restore state → freeze 3 s → `playbackRate = 0.25` → play until next snapshot
  `timeSec` → pause + snap → repeat. Each snapshot visited once, 3 s each, no
  interpolated state.
- **MP4 export** (optional): records the Canvas `captureStream` during replay →
  `convertWebmBlobToMp4` (`lib/ffmpegWebmToMp4.ts`). Output only; does not affect
  snapshot state.

**Rule:** Generate depends ONLY on snapshots. No legacy state influences replay.

---

## 7. StroMotion

StroMotion is a **separate analysis system** with its own draft model
(`hooks/useStroMotion.ts`, `lib/stroMotionDraft/`) — multi-frame ghost
composites, not phase analysis. It is intentionally NOT part of the Snapshot
model.

Integration points:
- It can **import** phase times: opening StroMotion with snapshots present seeds
  StroMotion frame times from the snapshot timestamps.
- Its toolbar panel shares the toolbar label state (`panelShowLabels`) so it
  renders labeled buttons in both expanded and compact-expanded modes.

If StroMotion ever needs to persist per-phase masks alongside Metrics, it should
attach to the Snapshot as an optional field rather than spawning a third model.

---

## 8. Player Database

- **Players / entries**: `supabase` tables `players`, `player_entries`
  (`supabase/migrations/`). Screenshots upload via `uploadDataUrl`
  (`lib/supabase/storage.ts`) → signed URL → `/api/players/[id]/entries`.
- **Sessions**: richer `player_sessions` with artifacts, measurements, and
  `frame_markers` (`lib/sessions/`). Save flow: `useSessionDraft` →
  `buildSessionPayload` → `/api/players/[id]/sessions` + artifact upload.
- **Notes**: per-frame notes currently in the Frame Capture model (§14.2).
  Player-level notes (`players.notes`) are seeded into the player's Google Doc.
- **Google Docs (per-player auto-export):** `app/api/players/[id]/google-doc`
  maintains the Drive tree `AngleMotion / Players / <Player Name> / <Doc>`. The
  per-player Doc + folder IDs are cached on the `players` row
  (`google_doc_id`, `google_folder_id`) so every screenshot for a player appends
  to the same document. Each screenshot is inserted at the **top** of the body
  with a timestamp; player notes are seeded at doc creation. Requires the
  `documents` + `drive.file` OAuth scopes (granted at sign-in). Wired into the
  screenshot→player flow (`handleScreenshotSaveToPlayer`) as a **best-effort**
  step — a Docs failure never blocks the screenshot save.
  - Legacy `app/api/google/create-document` still creates a one-off report doc
    from a body string (used by the report path).
- **Future persistence**: snapshots must be added to the session payload (§10).

---

## 9. State Management

**Snapshot-owned (the only analysis source of truth):** `snapshots[]` and
`biomechSelectedPhaseId`.

**Derived (never stored twice):** `biomechPhaseMarkers`, `orderedSnapshots`,
`activeSnapshot`, `isNearActivePhase`, `dataColumnVisible`.

**Allowed non-snapshot state (explicit allowlist):**
- *UI prefs* (global, not per-frame): skeleton display toggles
  (`skeletonShowAngles/HeadLine/HeadDirection/FootLine/RightArm/...`),
  `skeletonKeepAlive`, `skeletonLocked`, toolbar layout flags.
- *Transient render buffers* in `Canvas.tsx`: `latestKeypointsRef`,
  `skeletonFramesRef`, `poseSmoothPrevRef`, `strokesRef`, `overlayAdjustmentsRef`.
  These are runtime scratch space, snapshotted on save.
- *Transient interaction*: `liveAnglesRef`, `currentVideoTime`,
  `replayIndex`, `generateRecording`.

**Not allowed:** any *persistent analysis data* outside the Snapshot for the
Phases flow. The Frame Capture model (§14.2) currently violates this and is
tracked as debt.

---

## 10. Session Persistence — Intended Architecture

**Intended:** Snapshots are serialized into the session payload and fully
restored on load, so a saved analysis re-opens with identical phases, columns,
drawings, overlays, skeleton, and AI detection.

**Required shape:** add `snapshots: Snapshot[]` to the session create/patch
payload (`lib/sessions/types.ts`, `buildSessionPayload.ts`, `db.ts`), persist as
JSONB on `player_sessions`, and hydrate back into `setSnapshots` on session open.
`drawingsJson` and `screenshot` are already serialization-friendly; large
screenshots should be uploaded to storage and referenced by URL rather than
inlined.

> ⚠️ **Outstanding Technical Debt.** The current implementation does **not**
> serialize or restore snapshots. Session save still reads `frameMarkers` from
> the legacy `aiMetricsDraft`, not from snapshots. Snapshots are component-state
> only and are lost on reload/navigation. See §14.1.

---

## 11. Performance

- **Rendering strategy:** `Canvas.tsx` uses an imperative rAF render loop with a
  `renderDirtyRef` dirty flag; React re-renders are minimized. Heavy panels are
  code-split via `React.lazy`.
- **Synchronization:** video-time tracking uses a throttled (~10 Hz) rAF poll
  with a meaningful-delta gate (avoids 60 fps re-renders of the analysis tree).
- **State copies:** the column auto-save effect skips no-op snapshot
  reallocations (structural compare) so live-angle flushes don't churn the
  snapshots array / timeline.
- **Optimization philosophy:** prefer dirty-flag canvas redraws and derived
  memos over React re-render storms. Throttle anything tied to playback.
- **Scalability:** snapshots are small plain objects; hundreds of phases are
  fine in memory. The risk is inlined base64 `screenshot`/`skeleton` payloads —
  offload screenshots to storage when persistence lands (§10).

---

## 12. Coding Standards

- **Naming:** `camelCase` values, `PascalCase` components/types, `on*` for
  callbacks, `*Ref` for refs, `handle*` for event handlers, derived memos named
  for what they represent (`orderedSnapshots`).
- **Folder structure:** `app/` routes, `components/` UI (feature subfolders:
  `metrics/`, `sessions/`, `coach/`, `academy/`, `stroMotion/`), `lib/` pure
  logic + adapters, `hooks/` stateful logic, `supabase/migrations/` schema.
- **Reusable components:** put shared analysis UI under `components/metrics/`.
- **Reusable hooks:** stateful subsystems are hooks (`useAIMetrics`,
  `useStroMotion`, `useSessionDraft`).
- **TypeScript:** export interfaces from the owning `lib/` module
  (`lib/snapshots.ts` owns `Snapshot`). Avoid `any`; prefer explicit unions for
  `type` discriminants. No `require()` in client modules — use ESM imports.
- **State updaters are pure:** never call other setters or imperative handles
  inside a `setState(prev => ...)` callback.

---

## 13. Future Extensions

New analysis capabilities — **racket detection, ball tracking, center of mass,
motion trails, custom metrics** — MUST integrate as optional fields on the
`Snapshot`, read by the Canvas renderer. Example:

```ts
interface Snapshot {
  // ...existing...
  racket?: { tipX: number; tipY: number; angle: number };
  ball?: { x: number; y: number; trail: Array<{ x: number; y: number; t: number }> };
  centerOfMass?: { x: number; y: number };
  customMetrics?: Record<string, number>;
}
```

Rules:
- No parallel state store for a new analysis type.
- Add capture in `saveActiveSnapshot` / the relevant tool handler.
- Add render in the Canvas render loop, gated by snapshot data presence.
- Add to serialization (§10) at the same time.

---

## 14. Technical Debt

### 14.1 Snapshot persistence — **PRIORITY: HIGH**
- **Description:** Snapshots are not serialized to the session or restored on
  load; session save still uses legacy `aiMetricsDraft.frameMarkers`.
- **Impact:** Coaches lose all phase analysis on reload/navigation; "save/load
  restores identical Snapshot model" is unmet.
- **Recommended solution:** Add `snapshots` JSONB to `player_sessions`; wire
  through `lib/sessions/{types,buildSessionPayload,db}.ts`; upload screenshots to
  storage; hydrate into `setSnapshots` on open.

### 14.2 Legacy Frame Capture model — **PRIORITY: MEDIUM**
- **Description:** The separate Frame Capture screen + report use
  `biomechFrameDrawingsRef`, `biomechFrameMeasurementsRef`,
  `biomechCapturedImages`, `biomechFrameNotes`, `biomechMeasurements`,
  `biomechActiveFrameIndex` + `aiMetricsDraft` — a second analysis model.
- **Impact:** Two models for analysis data; cognitive overhead; risk of drift.
- **Recommended solution:** Re-implement the report + Frame Capture UI on top of
  snapshots, then delete the legacy refs. Kept intact for now to avoid breaking
  the working save-to-player report.

### 14.3 Skeleton rendering source — **PRIORITY: LOW**
- **Description:** `snapshot.skeleton` is captured but never read back for
  rendering; the on-screen skeleton always comes from live re-detection.
- **Impact:** "Restore" relies on re-detection at the seeked frame, not stored
  data; a snapshot can render a slightly different pose than when captured.
- **Recommended solution:** When paused on a snapshot, render from
  `snapshot.skeleton` instead of live keypoints.

### 14.4 Phase replacement UX — **PRIORITY: MEDIUM**
- **Description:** The Phases picker does `setSnapshots(newSnaps)`, silently
  wiping any existing snapshots.
- **Impact:** Data loss with no confirmation.
- **Recommended solution:** Append, or confirm-before-replace.

### 14.5 Duplicate snapshots at same timestamp — **PRIORITY: LOW**
- **Description:** AI Detect always creates a snapshot, so repeated clicks at the
  same frame produce duplicates at identical `timeSec`.
- **Impact:** Redundant green balls; minor confusion.
- **Recommended solution:** Reuse the active snapshot when within a small time
  tolerance, or de-dupe on create.

### 14.6 Dragged ball capture staleness — **PRIORITY: LOW**
- **Description:** Dragging a green ball updates `timeSec` but not the stored
  `screenshot`/`skeleton`.
- **Impact:** Thumbnail/pose no longer matches the frame until re-Generate.
- **Recommended solution:** Re-capture on drag end, or invalidate the screenshot.

### 14.7 Two Google Docs code paths — **PRIORITY: LOW**
- **Description:** `app/api/google/create-document` (one-off report doc) and
  `app/api/players/[id]/google-doc` (per-player persistent doc + folder tree)
  both build Google clients independently.
- **Impact:** Minor duplication of OAuth/client setup; risk of drift.
- **Recommended solution:** Extract shared Drive/Docs client + folder helpers
  into `lib/google/` and have both routes consume them.

---

## 15. Development Rules

Every future implementation must obey:

1. **Read this document first.** It is the source of truth.
2. **Snapshot is the only analysis model.** New analysis data are Snapshot fields.
3. **Never introduce duplicate state.** Derive, don't copy.
4. **Prefer refactoring over patching.** Fix the model, not the symptom.
5. **No persistent analysis state outside the Snapshot** (the Frame Capture model
   is grandfathered debt, not a precedent).
6. **State updaters stay pure;** side effects go in explicit helpers/effects.
7. **Update this document whenever the architecture changes** — especially when
   resolving any §14 debt item, move it to the relevant section and delete it
   from the debt list.

### 15.1 Architecture Regression Audit (required before "complete")

No feature is complete until both the implementation **and** this audit pass.
Answer all six explicitly:

1. **New state?** If yes, justify why it cannot belong to existing state. Any
   *analysis* state must be a Snapshot field, never a new store.
2. **Duplicates existing functionality?** If yes, refactor instead of duplicating.
3. **Requires `ARCHITECTURE.md` changes?** If yes, update it in the same commit.
4. **Technical-debt delta?** Add/remove §14 items accordingly.
5. **Could it extend an existing system?** Prefer extending over creating new.
6. **Cross-file consistency?** Review all modified files together — naming, state
   management, UI behavior, and architecture must stay consistent.
