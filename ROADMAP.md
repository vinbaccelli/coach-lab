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

## P0 — Critical (blocks production reliability)

### P0-1 · Snapshot persistence (serialize + restore)
- **Description:** Serialize `snapshots[]` into the session payload and hydrate
  it back on session open, so a saved analysis re-opens with identical phases,
  columns, drawings, overlays, skeleton, and AI detection.
- **Why it matters:** Today snapshots are component-state only — **lost on
  reload/navigation**. This is the single biggest gap to production readiness.
- **Dependencies:** Storage offload for `screenshot`/`skeleton` payloads (don't
  inline base64 in the DB row).
- **Maps to:** ARCHITECTURE §10, §14.1.
- **Complexity:** L
- **Status:** Planned

### P0-2 · Session save/load using Snapshot
- **Description:** Replace the legacy `aiMetricsDraft.frameMarkers` source in
  `lib/sessions/buildSessionPayload.ts` with snapshot-derived markers; write/read
  `snapshots` JSONB on `player_sessions`.
- **Why it matters:** Saved sessions currently capture the wrong (legacy) phase
  data, disconnected from the snapshots the coach actually created.
- **Dependencies:** P0-1.
- **Maps to:** ARCHITECTURE §8, §10, §14.1.
- **Complexity:** M
- **Status:** Planned

### P0-3 · Restore Snapshot after reload
- **Description:** On opening a player session, hydrate `setSnapshots(...)` and
  re-render the timeline green balls + active snapshot from persisted data.
- **Why it matters:** Closes the round-trip; makes analysis durable.
- **Dependencies:** P0-1, P0-2.
- **Maps to:** ARCHITECTURE §3.3 (Serialization/Restoration), §10.
- **Complexity:** M
- **Status:** Planned

### P0-4 · Legacy Frame Capture migration onto Snapshot
- **Description:** Re-implement the Frame Capture screen + biomech report on the
  Snapshot model, then delete the legacy refs (`biomechFrameDrawingsRef`,
  `biomechFrameMeasurementsRef`, `biomechCapturedImages`, `biomechFrameNotes`,
  `biomechMeasurements`, `biomechActiveFrameIndex`).
- **Why it matters:** Removes the last parallel analysis model; satisfies the
  single-source-of-truth invariant app-wide.
- **Dependencies:** P0-1 (report should read persisted snapshots).
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
- **Do P0 first, in order.** P0-1 → P0-2 → P0-3 form the persistence chain; P0-4
  depends on it; P0-5 is independent infra that should ship alongside.
- P1 items are mostly independent and can be parallelized after P0-1.
- P2 is gated on detection models and on P0-1 (so advanced data persists).
- Update this file and `ARCHITECTURE.md` §14 together whenever an item moves to
  Complete.
