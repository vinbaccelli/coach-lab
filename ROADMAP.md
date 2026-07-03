# AngleMotion — Engineering Roadmap

> **Purpose:** Defines *what remains to be built*, prioritized. This is not an
> architecture spec (`ARCHITECTURE.md`) or a decision log (`DECISIONS.md`).
>
> **Source of truth alignment:** P0 items map directly to the Technical Debt
> register in `ARCHITECTURE.md` §14. Keep them in sync — when a debt item is
> resolved, update both files.
>
> **Status legend:** Planned · In Progress · Complete · Blocked
> **Complexity:** S (hours) · M (1–2 days) · L (3–5 days) · XL (1+ week)

---

## P0 — Critical for V1 (analysis workflow + Drive/YouTube export)

> **V1 priority (ARCHITECTURE §1.1, DECISIONS ADR-012):** V1 is an analysis app
> with a **local editing session** and a **Google Drive + YouTube export**
> strategy. Cloud Snapshot persistence and Supabase video storage are
> **deferred past V1** (kept below for traceability, marked *Deferred*). The
> live V1 P0 work is the export chain: **P0-A → P0-B → P0-C**.

### P0-A · Final export: Download MP4 (verify) + YouTube upload
- **Description:** From Generate's final video, offer two outputs: **Download
  MP4** (already wired via `convertWebmBlobToMp4`) and **Upload to the user's
  YouTube account** (their OAuth, Unlisted by default), returning a video link.
- **Why it matters:** This is V1's "save". The YouTube link is what gets archived
  into the player's Timeline Doc (P0-C).
- **Dependencies:** YouTube Data API scope at sign-in; existing Generate/MP4 path.
- **Maps to:** ARCHITECTURE §1.1, §6, §8.1; DECISIONS ADR-012.
- **Complexity:** L
- **Status:** Complete (2026-07-02) — `lib/export/exportService.ts` + Generate workspaces
  (`components/metrics/GenerateWorkspace.tsx`, StroMotion Generate modal) drive
  Download MP4 + YouTube (Unlisted) via `/api/youtube/upload`.

### P0-B · "Attach lesson to player?" prompt (No Player | Existing Player)
- **Description:** After export, prompt to attach the lesson to **No Player**
  (keep MP4/link only) or an **Existing Player** (proceed to P0-C).
- **Why it matters:** Routes the export into the right player archive without
  forcing every lesson to be filed.
- **Dependencies:** P0-A; Player Database (§8).
- **Maps to:** ARCHITECTURE §8.1.
- **Complexity:** S
- **Status:** Complete (2026-07-02) — "No player | Attach to <player>" selector in both
  Generate export panels.

### P0-C · Auto-update player's Timeline Google Doc on export
- **Description:** When a player is chosen, append a dated lesson entry to that
  player's Timeline Google Doc (`app/api/players/[id]/google-doc`) containing:
  timestamp, YouTube link (if uploaded), snapshot screenshots, notes,
  measurements, and AI Detect values — read from the in-session snapshots.
- **Why it matters:** Makes Google Drive the durable per-player archive with
  **zero** infra cost on our side.
- **Dependencies:** P0-A, P0-B; per-player Google Doc route (exists); snapshots
  in memory.
- **Maps to:** ARCHITECTURE §8.1; DECISIONS ADR-012, ADR-010.
- **Complexity:** M
- **Status:** Complete (2026-07-02) — `/api/google/report` creates the formatted
  report Doc (screenshots, measurements, notes, YouTube link), files it under
  AngleMotion/Players/<Name>, and prepends a dated link entry to the player's
  Timeline Doc.

---

> **Deferred past V1 — cloud persistence chain (do not build until priority
> changes, ARCHITECTURE §1.1 / DECISIONS ADR-012):**

### P0-1 · Snapshot persistence (serialize + restore) — **DEFERRED PAST V1**
- **Description:** Serialize `snapshots[]` into the session payload and hydrate
  it back on session open, so a saved analysis re-opens with identical phases,
  columns, drawings, overlays, skeleton, and AI detection.
- **Why deferred:** V1 keeps the editing session local; durability comes from the
  Drive/YouTube export (P0-A→C), not a DB.
- **Dependencies:** Storage offload for `screenshot`/`skeleton` payloads (don't
  inline base64 in the DB row).
- **Maps to:** ARCHITECTURE §10, §14.1.
- **Complexity:** L
- **Status:** Deferred past V1

### P0-2 · Media Layer (dual-source MediaAsset) — **V1: local-only**
- **Description:** `MediaAsset` model (`lib/media/mediaAsset.ts`) with
  `localUrl`/`remoteUrl`/`status` + `getVideoSource` resolver. **In V1 the remote
  Supabase-upload path is dormant** — playback runs on the local blob; `remoteUrl`
  stays null. The dual-source structure remains as the post-V1 seam. Snapshots
  reference `mediaId` only.
- **Why it matters:** Decouples playback identity from analysis state without
  incurring storage cost in V1.
- **Dependencies:** none for V1 (no Supabase bucket needed). `player-videos`
  bucket required only post-V1 when remote upload is re-enabled.
- **Maps to:** ARCHITECTURE §9.1, §3 (mediaId); DECISIONS ADR-011, ADR-012.
- **Complexity:** M
- **Status:** Complete (V1 local-only scope); remote upload Deferred past V1

### P0-2b · Session save/load using Snapshot — **DEFERRED PAST V1**
- **Description:** Replace the legacy `aiMetricsDraft.frameMarkers` source in
  `lib/sessions/buildSessionPayload.ts` with snapshot-derived markers; write/read
  `snapshots` (+ `MediaAsset.remoteUrl`) JSONB on `player_sessions`.
- **Why deferred:** part of the cloud-persistence chain not in V1 scope.
- **Dependencies:** P0-1, P0-2 remote.
- **Maps to:** ARCHITECTURE §8, §10, §14.1.
- **Complexity:** M
- **Status:** Deferred past V1

### P0-3 · Restore Snapshot after reload — **DEFERRED PAST V1**
- **Description:** On opening a player session, hydrate `setSnapshots(...)` and
  re-render the timeline green balls + active snapshot from persisted data.
- **Why deferred:** depends on the deferred persistence chain.
- **Dependencies:** P0-1, P0-2 remote.
- **Maps to:** ARCHITECTURE §3.3 (Serialization/Restoration), §10.
- **Complexity:** M
- **Status:** Deferred past V1

### P0-4 · Legacy Frame Capture migration onto Snapshot
- **Description:** Re-implement the Frame Capture screen + biomech report on the
  Snapshot model, then delete the legacy refs (`biomechFrameDrawingsRef`,
  `biomechFrameMeasurementsRef`, `biomechCapturedImages`, `biomechFrameNotes`,
  `biomechMeasurements`, `biomechActiveFrameIndex`).
- **Why it matters:** Removes the last parallel analysis model; satisfies the
  single-source-of-truth invariant app-wide. Required so the lesson export (P0-C)
  reads the **in-session** snapshots, not the legacy frame model.
- **Dependencies:** none for V1 (report/export read in-session snapshots, not a
  persisted DB).
- **Maps to:** ARCHITECTURE §14.2.
- **Complexity:** L
- **Status:** Planned

### P0-5 · Complete Player Database
- **Description:** Run the pending migrations in production (subscriptions table,
  academy forum, `players.google_doc_id/google_folder_id`); verify entries,
  sessions, and artifacts round-trip for a real player.
- **Why it matters:** Several features (Stripe webhook, Q&A, Google Docs export)
  depend on schema that may not be applied in prod yet.
- **Dependencies:** Supabase SQL execution.
- **Maps to:** ARCHITECTURE §8.
- **Complexity:** S
- **Status:** Planned

---

## P1 — Core Features

### P1-1 · Google Docs polish
- **Description:** Consolidate the two Google code paths into shared `lib/google/`
  helpers; add per-screenshot section headers, image sizing options, and graceful
  re-auth prompts when the Docs scope is missing.
- **Why it matters:** Reliability + maintainability of the export coaches rely on.
- **Dependencies:** None (extends existing route).
- **Maps to:** ARCHITECTURE §8, §14.7.
- **Complexity:** M
- **Status:** Planned

### P1-2 · AI Detect editing
- **Description:** Confirm every AI-detected overlay (shoulder, hip, head, foot,
  racket) is draggable and that edits write back to `snapshot.aiDetection` /
  `jointAngles` / `column`.
- **Why it matters:** AI output is a draft the coach must be able to correct.
- **Dependencies:** None.
- **Maps to:** ARCHITECTURE §4 (AI Detect), §6.
- **Complexity:** M
- **Status:** In Progress

### P1-3 · Better Skeleton editing
- **Description:** Render the skeleton from `snapshot.skeleton` when paused on a
  snapshot (data-driven restore) instead of live re-detection; allow nudging
  individual joints.
- **Why it matters:** Makes restore deterministic and lets coaches fix bad poses.
- **Dependencies:** P0-1 (persisted skeleton).
- **Maps to:** ARCHITECTURE §14.3.
- **Complexity:** M
- **Status:** Planned

### P1-4 · Timeline improvements
- **Description:** Re-capture a snapshot's screenshot on green-ball drag-end;
  visual distinction for AI vs custom phases; snap-to-frame on drag.
- **Why it matters:** Keeps the timeline accurate after edits.
- **Dependencies:** None.
- **Maps to:** ARCHITECTURE §5, §14.6.
- **Complexity:** M
- **Status:** Planned

### P1-5 · Snapshot management
- **Description:** Per-snapshot delete; rename; reorder; confirm-before-replace
  when the Phases picker would overwrite existing snapshots; de-dupe / reuse the
  active snapshot when AI Detect fires twice within a small time tolerance.
- **Why it matters:** Prevents silent data loss and stray duplicate phases;
  gives coaches control.
- **Dependencies:** None.
- **Maps to:** ARCHITECTURE §3.3 (Deletion), §14.4, §14.5.
- **Complexity:** M
- **Status:** Planned

---

## P2 — Advanced Analysis

> All P2 items must integrate as **Snapshot fields** read by the Canvas renderer,
> never as a parallel state model (ARCHITECTURE §13).

### P2-1 · Racket detection
- **Description:** Detect racket position/angle; store as `snapshot.racket`.
- **Why it matters:** Removes the current wrist-based racket *estimate*.
- **Dependencies:** Detection model; P0-1 for persistence.
- **Maps to:** ARCHITECTURE §13.
- **Complexity:** XL
- **Status:** Planned

### P2-2 · Ball tracking
- **Description:** Track ball position + trail; store as `snapshot.ball`.
- **Why it matters:** Contact timing, trajectory, shot analysis.
- **Dependencies:** Detection model.
- **Maps to:** ARCHITECTURE §13.
- **Complexity:** XL
- **Status:** Planned

### P2-3 · Center of mass
- **Description:** Derive COM from skeleton; store as `snapshot.centerOfMass`.
- **Why it matters:** Balance and weight-transfer analysis.
- **Dependencies:** Skeleton (exists).
- **Maps to:** ARCHITECTURE §13.
- **Complexity:** M
- **Status:** Planned

### P2-4 · Motion trails
- **Description:** Render joint/racket trails across a phase window.
- **Why it matters:** Visualizes swing path and acceleration.
- **Dependencies:** P2-1 (racket) for racket trails; skeleton for joint trails.
- **Maps to:** ARCHITECTURE §13.
- **Complexity:** L
- **Status:** Planned

### P2-5 · Custom metrics
- **Description:** Coach-defined measurements stored as `snapshot.customMetrics`.
- **Why it matters:** Extensibility without code changes per metric.
- **Dependencies:** P0-1 for persistence.
- **Maps to:** ARCHITECTURE §13.
- **Complexity:** L
- **Status:** Planned

---

## P3 — UX

### P3-1 · Better onboarding
- **Description:** Extend the existing guided tour to cover the Snapshot/Phases
  workflow and Generate.
- **Why it matters:** The phase workflow is powerful but non-obvious.
- **Dependencies:** None.
- **Complexity:** M
- **Status:** Planned

### P3-2 · Faster workflow
- **Description:** Reduce clicks from skeleton → AI Detect → phases → Generate;
  smart defaults; quicker model load feedback.
- **Why it matters:** Coaches analyze many clips per session.
- **Dependencies:** None.
- **Complexity:** M
- **Status:** Planned

### P3-3 · Keyboard shortcuts
- **Description:** Shortcuts for next/prev snapshot, create snapshot, play/pause,
  frame step (some exist in PlayControls — extend to snapshots).
- **Why it matters:** Speed for power users.
- **Dependencies:** None.
- **Complexity:** S
- **Status:** Planned

### P3-4 · Better visualization
- **Description:** Polish the Scroll Visualization panel (zoom a phase, compare
  two phases side by side, larger thumbnails).
- **Why it matters:** Review quality.
- **Dependencies:** None.
- **Maps to:** ARCHITECTURE §6.
- **Complexity:** M
- **Status:** Planned

---

## Sequencing notes
- **V1 P0 order:** **P0-A → P0-B → P0-C** (the export chain), with **P0-4**
  (Frame Capture → Snapshot) done first/alongside so the export reads in-session
  snapshots, and **P0-5** (Player DB migrations) as independent infra that ships
  alongside. This is the live V1 path.
- **Deferred past V1:** P0-1, P0-2 (remote upload only), P0-2b, P0-3 — the cloud
  persistence chain. Do not build until the priority changes (ARCHITECTURE §1.1,
  DECISIONS ADR-012).
- P1 items are mostly independent and can be parallelized after the P0 export
  chain. (P1 items that assumed persistence now read in-session snapshots in V1.)
- P2 advanced-analysis items render from in-session snapshots in V1; their
  *persistence* waits on the deferred chain.
- Update this file and `ARCHITECTURE.md` §14 together whenever an item moves to
  Complete.
