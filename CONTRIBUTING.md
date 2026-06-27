# Contributing to AngleMotion

> **This is the mandatory execution protocol for all development in this
> repository — human or AI (Claude Code). It is not optional.**
>
> It defines *how work is done*. It does not restate the architecture
> (`ARCHITECTURE.md`), the reasoning (`DECISIONS.md`), or the backlog
> (`ROADMAP.md`) — read those as directed below.

---

## 1. Mandatory Development Workflow

Every task MUST follow this exact order.

### Step 1 — Read Context
- Read `ARCHITECTURE.md` (how the system works + Technical Debt §14).
- Read `DECISIONS.md` (why choices were made — do not reverse a decision without
  superseding its ADR).
- Read `ROADMAP.md` (where this task fits; current status).

### Step 2 — Architecture Compliance Mode
- Validate the feature against the architecture.
- Identify affected systems/sections.
- Detect conflicts **before** writing code. On conflict: explain it, propose the
  smallest architectural change, and **wait for approval**.

### Step 3 — Implementation Plan
- Break the task into concrete changes.
- Identify the exact files to modify.
- Identify state changes (and confirm where each piece of state belongs — §3).
- Identify risks and regressions.

### Step 4 — Implementation
- Implement ONLY the approved scope.
- No feature expansion. No speculative additions.

### Step 5 — Architecture Regression Audit
(ARCHITECTURE §15.1). Verify:
- No duplicate state introduced.
- Snapshot remains the single source of truth.
- No parallel workflows created.
- No hidden state introduced.
- No UI desynchronization risk.

### Step 6 — Documentation Update (same commit)
If the architecture changed:
- Update `ARCHITECTURE.md` (and its §14 Technical Debt register).
- Update `DECISIONS.md` if reasoning changed (add/supersede an ADR).
- Update `ROADMAP.md` if progress changed (move item status).

### Step 7 — Commit
Per §6 below.

---

## 2. Core Engineering Principles (absolute)
- Snapshot is the **ONLY** analysis model.
- No parallel state systems.
- No duplicated logic across modules.
- Refactor instead of patching.
- All analysis features integrate into Snapshot.
- UI must always reflect Snapshot state.
- Generate is deterministic and Snapshot-driven (Freeze → Play → Snap).

---

## 3. State Management Rules

**Allowed:**
- **Snapshot state** — all analysis data.
- **UI state** — temporary, non-persistent (toggles, modals, layout).
- **Derived state** — computed from Snapshot (`useMemo`), never stored twice.

**Forbidden:**
- Duplicate analysis stores.
- Independent column systems.
- Independent skeleton stores (the Canvas render buffer is transient scratch,
  snapshotted on save — not a store).
- Independent measurement systems.

> The legacy Frame Capture model (ARCHITECTURE §14.2) is grandfathered debt
> scheduled for migration (ROADMAP P0-4). It is **not** a precedent for new code.

---

## 4. Snapshot Integrity Rule

All analysis must:
- originate from a Snapshot,
- belong to a Snapshot,
- be restored from a Snapshot,
- never exist outside a Snapshot.

---

## 5. Definition of Done

A feature is complete ONLY when:
- Implementation is finished.
- Architecture Compliance (Step 2) is verified.
- Regression Audit (Step 5) is passed.
- Documentation is updated (Step 6).
- `ROADMAP.md` status is updated.
- The build passes (`npm run build`) and the change is verified in the running
  app where observable.

---

## 6. Commit Standards
- One logical change per commit.
- Don't mix architecture + feature + refactor unless genuinely inseparable.
- Include documentation updates in the same commit when the architecture changed.
- Commit/push only when the user asks (per harness rules).

---

## 7. Anti-Patterns (STRICTLY FORBIDDEN)
- Creating a second state model.
- Bypassing the Snapshot system.
- Adding "temporary" parallel logic.
- Introducing hidden state flows.
- UI that is not Snapshot-driven.
- Silent architectural drift (changing behavior without updating the docs).

---

## 8. Mental Model

Always ask:

> **"How does this feature attach to Snapshot?"**

Never:

> "Should I create a new system for this?"

New analysis capability = a new optional field on `Snapshot` read by the Canvas
renderer (ARCHITECTURE §13), plus capture + serialization. Nothing else.

---

## 9. Enforcement Rule

If any rule conflicts with implementation convenience:
- Architecture wins.
- Refactor is mandatory.
- No shortcuts.

---

## 10. Final Principle

The system must remain **deterministic, traceable, Snapshot-driven, and
architecture-stable over time.** Every contribution must preserve these
properties.

---

### Companion documents
- `ARCHITECTURE.md` — how the system works + Technical Debt register.
- `DECISIONS.md` — why decisions were made (ADR log).
- `ROADMAP.md` — what remains to be built (P0–P3).
