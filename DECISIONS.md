# AngleMotion — Engineering Decision Record (ADR Log)

> **Purpose:** Record *why* significant engineering decisions were made, so future
> developers (human or AI) understand the reasoning and do not accidentally
> reverse deliberate choices.
>
> **This is not an architecture document.** It does not describe *how* the system
> works — that is `ARCHITECTURE.md`. This log answers one question only:
> **"Why was this decision made?"**
>
> **Maintenance:** When a decision changes, mark the old one **Superseded**
> (never delete it) and add a new record. Preserve historical context.

---

## ADR-001 — Snapshot is the single source of truth

- **Date / commit:** Snapshot migration (`80dd885`)
- **Status:** Accepted

**Context.** Metrics analysis state was spread across four parallel refs
(columns, drawings, overlays, overlay-adjustments) plus the phase-marker array
and a separate frame-capture model. These drifted out of sync: the column failed
to appear, phases weren't created, and state leaked between phases. Each bug fix
touched several refs at once, and a fix in one path silently broke another.

**Decision.** Replace the multi-ref model with a single `Snapshot[]` store. Each
phase is one Snapshot that owns all of its analysis state.

**Consequences.** One place to read/write per-phase state; switching phases is a
single atomic save/restore; new analysis capabilities become Snapshot fields.
Trade-off: a large one-time refactor and a remaining persistence gap (see
ARCHITECTURE §10).

**Alternatives considered.** (a) Keep the refs and patch sync bugs individually —
rejected: the bugs were structural, not incidental. (b) A normalized store
(separate tables for drawings/columns keyed by phase id) — rejected: heavier and
re-creates the multi-source problem in a new shape.

**Why preferred.** A single self-contained object per phase eliminates the entire
class of cross-ref desync bugs and is the simplest model that scales.

---

## ADR-002 — Columns belong to Snapshots

- **Date / commit:** Snapshot migration (`80dd885`)
- **Status:** Accepted

**Context.** The data column was previously its own ref keyed by phase id,
separate from the phase it described.

**Decision.** The column is a field on the Snapshot (`column`), not an
independent model. The displayed column is `activeSnapshot.column` merged with
transient live skeleton angles.

**Consequences.** A column can never exist for a phase that doesn't exist, and
can never point at the wrong phase. Live skeleton angles stay transient (not
persisted), avoiding stale numbers.

**Alternatives considered.** A standalone column store keyed by phase id —
rejected: that was the previous design and was a primary source of leakage.

**Why preferred.** Co-locating the column with its phase removes a join and a
whole category of "column shows the wrong phase's data" bugs.

---

## ADR-003 — Skeleton modifies the active Snapshot instead of creating one

- **Date / commit:** Snapshot migration
- **Status:** Accepted

**Context.** Early iterations auto-created a phase whenever the skeleton was
enabled, producing stray phases the coach never asked for.

**Decision.** Skeleton (and Draw) only modify the *active* Snapshot. They never
create one.

**Consequences.** Enabling the skeleton to look around the video does not litter
the timeline with phases. Phases appear only at deliberate analytical moments.

**Alternatives considered.** Auto-create a phase on skeleton enable — rejected:
it created noise and made phase count unpredictable.

**Why preferred.** Fewer, intentional snapshots; the timeline stays meaningful.

---

## ADR-004 — AI Detect creates Snapshots

- **Date / commit:** Snapshot migration
- **Status:** Accepted

**Context.** A coach runs AI Detect at a specific, meaningful frame (e.g.
contact) to capture angles. That moment *is* an analysis checkpoint.

**Decision.** AI Detect creates a Snapshot at the current frame and writes its
column, aiDetection, jointAngles, and skeleton into it. The Phases picker also
creates Snapshots; Skeleton/Draw do not.

**Consequences.** Every AI Detect produces a reviewable checkpoint with its own
data. Snapshot creation is tied to intent, not incidental tool use.

**Alternatives considered.** Write AI results into a global "current
measurements" store — rejected: that is parallel state and loses the per-moment
association.

**Why preferred.** AI Detect marks the exact frames a coach cares about, so
binding snapshot creation to it matches the mental model.

---

## ADR-005 — Generate uses deterministic Snapshot replay

- **Date / commit:** Generate engine (`83c6aeb`)
- **Status:** Accepted

**Context.** The Generate feature must replay a stroke as a sequence of
analytical checkpoints, with each phase shown for a fixed time and the UI/scroll
panel always in sync.

**Decision.** Replay is a deterministic state machine — **Freeze → Play → Snap**:
snap to a Snapshot, freeze exactly 3 s, slow-play (0.25×) to the next Snapshot,
snap, repeat. Snapshots are the only valid pause anchors.

**Consequences.** Playback is reproducible; the scroll panel index, video frame,
and analysis overlays are always aligned. Adding/removing a Snapshot recomputes
the sequence.

**Alternatives considered.** Free-form playback with manual pausing — rejected:
non-deterministic, can't guarantee UI/video/panel sync or equal phase exposure.

**Why preferred.** Coaching review needs every checkpoint shown consistently;
determinism makes the output predictable and exportable.

---

## ADR-006 — Snapshot owns drawings, measurements, overlays, skeleton, AI Detect, notes

- **Date / commit:** Snapshot completion (`d0d26c0`)
- **Status:** Accepted

**Context.** These data types were owned by different refs/models, so a phase's
full state could never be reconstructed from one place.

**Decision.** Centralize ownership: a Snapshot fully contains drawings,
measurements (column), overlays + adjustments, skeleton, aiDetection,
jointAngles, screenshot, and notes.

**Consequences.** A Snapshot can fully reconstruct a frame's analysis state;
serialization (future) becomes "serialize the Snapshot." Future capabilities
(racket, ball, center of mass) attach as new fields.

**Alternatives considered.** Keep ownership distributed for "separation of
concerns" — rejected: separation here meant desync, not cleanliness.

**Why preferred.** One owner per phase is what makes restore, replay, and future
persistence tractable.

---

## ADR-007 — ARCHITECTURE.md is the project's source of truth

- **Date / commit:** `91c76b1`
- **Status:** Accepted

**Context.** Repeated rework happened because intent lived only in conversation;
deliberate choices were re-litigated or accidentally undone.

**Decision.** `ARCHITECTURE.md` is the authoritative spec. Code and doc must
never diverge; architectural changes update the doc in the same commit.

**Consequences.** A durable reference for humans and AI; the Technical Debt
register makes known limitations explicit instead of forgotten.

**Alternatives considered.** Rely on code + commit messages — rejected: neither
captures intent or the "do not reverse this" signal.

**Why preferred.** Documentation that evolves with the code prevents silent
architectural drift.

---

## ADR-008 — Architecture Compliance Mode is mandatory before implementation

- **Date / commit:** Process decision
- **Status:** Accepted

**Context.** Features were sometimes built first and reconciled with the
architecture afterward, occasionally introducing parallel state.

**Decision.** Before writing code, read `ARCHITECTURE.md`, identify affected
sections, verify compatibility, and — on conflict — propose the smallest
architectural change and wait for approval.

**Consequences.** Conflicts surface before code exists, when they're cheap to
resolve. Implementation starts from a compliant design.

**Alternatives considered.** Post-hoc review only — rejected: more expensive and
lets drift land before it's caught.

**Why preferred.** Validating intent up front is cheaper than refactoring after.

---

## ADR-009 — Architecture Regression Audit is mandatory before completing every feature

- **Date / commit:** `1842b4e` (rule added as ARCHITECTURE §15.1)
- **Status:** Accepted

**Context.** Compliance up front doesn't catch drift introduced *during*
implementation (new state, duplication, undocumented behavior).

**Decision.** A feature is complete only after a six-question audit passes: new
state justification, duplication check, doc-update check, debt delta, "extend vs
create," and cross-file consistency.

**Consequences.** Every feature ends in a known-consistent state with debt and
docs reconciled. Slightly more work per feature.

**Alternatives considered.** Trust the up-front compliance check alone —
rejected: implementation reality differs from the plan.

**Why preferred.** A closing audit guarantees the codebase and `ARCHITECTURE.md`
stay aligned over time.

---

## ADR-010 — Google Docs integration belongs to the Player Database, not Snapshot

- **Date / commit:** `1842b4e`
- **Status:** Accepted

**Context.** Screenshots export to a per-player Google Doc with cached Doc/folder
IDs. This is persistence/export, not stroke analysis.

**Decision.** Treat it as Player Database state (§8). Doc/folder IDs live on the
`players` row; the export extends the existing screenshot→player flow. It does
**not** touch the Snapshot model.

**Consequences.** Snapshot stays purely about analysis. Export concerns evolve
independently. (One low-priority debt: two Google code paths to consolidate —
ARCHITECTURE §14.7.)

**Alternatives considered.** Store doc references on Snapshots — rejected:
Snapshots are phase-level analysis; player export metadata is player-level and
unrelated, so this would pollute the analysis model.

**Why preferred.** Keeping export metadata out of Snapshot preserves the
single-analysis-model invariant and keeps each concern where it belongs.

---

# Future Decisions

Copy this template for every significant decision. Keep records append-only;
mark superseded ones rather than deleting them.

```markdown
## ADR-NNN — <short title>

- **Date / commit:** <date or commit hash>
- **Status:** Accepted | Superseded by ADR-XXX | Deprecated

**Context.** <what situation/problem prompted this decision>

**Decision.** <what was decided>

**Consequences.** <results, trade-offs, follow-on effects>

**Alternatives considered.** <options evaluated and why each was rejected>

**Why preferred.** <the deciding reason the chosen option won>
```

**Rules**
- This log answers *why*, never *how* (that's `ARCHITECTURE.md`).
- Do not duplicate implementation detail already in `ARCHITECTURE.md`.
- When a decision changes: add a new ADR, set the old one to **Superseded by
  ADR-XXX**, and preserve its original text for historical context.
