# CoachLab V1 — Product Freeze (Official Architecture)

**Status:** FROZEN — governs all development until V1 launch  
**Supersedes:** Any conflicting StroMotion, AI Metrics, or Save Report assumptions in older docs or code comments  
**Date:** June 2026

---

## Authoritative principle

> **AI is never considered authoritative in CoachLab.** Every AI-generated mask, frame selection, measurement, line, arrow, label, or recommendation is a **draft** that can be modified by the coach before export or saving.

**Universal Coach Override:**

```text
AI Proposal → Coach Review → Coach Adjustment → Coach Ready → Export / Save Report
```

Nothing bypasses this chain. No export, player save, or report may depend on raw AI output alone.

**Product stance:** CoachLab is a **coaching platform**, not an AI analysis tool. AI accelerates work; the coach is always the source of truth.

---

## Platform topology (target)

CoachLab must evolve from tool-first to **player-first**:

```text
Today (wrong):     Tools → Reports → Player

V1 target:         Player → Sessions → Tools → Save Report → Timeline
```

1. Open **player**
2. Create or continue a **session**
3. Use tools (Draw, StroMotion, AI Metrics, Match Decoder, future)
4. **Save Report** (identical everywhere)
5. Entry appears on the **player timeline** (newest first)

The player timeline is the long-term coaching record. This is what separates CoachLab from standalone analysis apps.

---

## Shared concepts (both analysis tools)

StroMotion and AI Metrics are **separate tools** with different outputs. They share:

| Shared | Not shared |
|--------|------------|
| Trim range (one stroke) | Output artifacts |
| Frame count (typically 4–7) | Data models |
| Green balls on timeline | Panel workflows |
| Draggable frame times | Measurement vs mask layers |
| Coach Override status per frame | |

**Frame status** (both tools):

```ts
type FrameStatus = "pending" | "edited" | "ready";
```

Use **Ready**, not Approved — coaches may return and change work later. Export and Save Report use **ready** values only.

**Mobile (both tools):** Vertical toolbox with frame count display, **−** and **+** buttons. Green balls remain draggable on the timeline.

---

## StroMotion V1

### Purpose

Visual multiplication of an object through time (primary: **racket**). Coach thinks: *What am I multiplying?*

**Object type (coach-facing, not Athlete/Object mode):**

- Player
- Racket
- Ball
- Custom

Extraction strategy is an **internal implementation detail**. Never expose Athlete Mode or Object Mode in the UI.

### Workflow

**Step 1 — Frames**

- Choose number of frames (4–7 typical).
- Green balls appear on timeline; coach drags each to exact time.
- Desktop: balls on timeline. Mobile: frame count + − / + in vertical toolbox.

**Step 2 — Select object (every frame)**

Each frame has its own **Select Area** button. Coach selects the object independently per frame — not only on frame 1.

**Step 3 — AI mask proposal (draft only)**

CoachLab may propose background removal / isolation for that frame. Proposal is **draft only**; coach can ignore or replace entirely.

**Step 4 — Mask editor (every frame)**

| Control | Purpose |
|---------|---------|
| Brush Add | Add missing pixels |
| Brush Remove | Remove leakage |
| Reset | Return to AI proposal |
| Regenerate | Run AI again for this frame |
| Zoom | Inspect and edit precisely |

**Step 5 — Frame status**

Each frame: `pending` → `edited` → `ready`. Generate and export require **ready** masks (policy: all frames ready, or explicit product rule documented at implement time).

**Step 6 — Generate StroMotion**

Output uses **only ready masks**.

| Output | Description |
|--------|-------------|
| **PNG** | Background frame + multiplied object masks (classic StroMotion still) |
| **Video** | Normal stroke playback with ghost objects showing movement through space |

Coach must be able to complete the full workflow **manually** if AI fails.

### Frame data model (conceptual)

The source of truth is **mask state**, not raw generated bitmaps as the workflow center:

```text
Frame
├─ timeSec
├─ selectionBox (coach)
├─ aiProposal (mask)
├─ coachEdits (mask)
├─ readyMask (used for export)
└─ status: pending | edited | ready
```

---

## AI Metrics V1

### Purpose

Biomechanical **measurements** for coaching — not scores, ratings, or grades.

Same Coach Override philosophy as StroMotion; **completely separate tool and output**.

### No universal “phases”

Do **not** architect around fixed phase names (Preparation, Unit Turn, Contact, etc.). Those vary by coach (5–10 steps), sport, and methodology.

Architecture:

```text
Stroke Type + Frames
```

Example — Forehand, 8 frames:

```text
Frame 1 … Frame 8   (coach may rename labels)
```

- **Frame time** = truth (green ball position).
- **Label** = optional (Preparation, Load, Custom Step 1, …).

Custom stroke type allows any coaching methodology.

AI may **suggest** initial ball positions; coach always moves them.

### Workflow

**Step 1 — Stroke type**  
Forehand, 1HBH, 2HBH, Serve, Volley, Smash, Custom.

**Step 2 — Frame count + green balls**  
Same as StroMotion; coach controls timing.

**Step 3 — AI proposes measurements (draft)**  
Per frame, from pose/video — all overridable.

**Step 4 — Per-frame measurement editor**

Vertical toolbox: **independent measurement modules** (checkbox activates a layer, like drawing tools):

| Module | Behavior |
|--------|----------|
| □ Skeleton | Read-only overlay; enable/disable anytime globally |
| □ Joint Angles | Editable; elbow, shoulder, knee, hip |
| □ Shoulder / Hip separation | Editable shoulder line + hip line; angle derived live |
| □ Foot direction | Editable arrows; coach can rotate |
| □ Foot spacing | Auto-calculated; updates live |
| □ Racket angle | Editable line handle → tip |
| □ Stringbed direction | Editable 3D arrow ⊥ stringbed; AI proposes, coach adjusts |

**Step 5 — Frame status**  
`pending` → `edited` → `ready` per frame.

**Step 6 — Generate report**  
Uses **ready** measurements only — never raw AI values.

### Measurement value model

Every measurement supports:

```text
ai      → AI proposal
coach   → coach adjustment
ready   → value used in export / Save Report
```

Reports and player history store **ready** values.

---

## Toolbar & tools

### Skeleton

- Dedicated icon; unique from other tools.
- Can be enabled/disabled **at any time** while using any other tool.
- Skeleton/keypoints are **not** manually edited in V1.

### Icons (V1)

Each tool needs a **distinct** icon (no placeholder duplicates):

- Skeleton, StroMotion, AI Metrics, Draw, Arrow, Angle, Text, Save Report, …

### Save Report — universal

**Every tool in CoachLab uses the same Save Report button and the same save system:**

- Draw
- StroMotion
- AI Metrics
- Match Decoder
- Future tools

Prevents multiple incompatible report pipelines.

**Save Report always captures:**

| Field | Required |
|-------|----------|
| Screenshot | Current canvas |
| Notes | Coach comments |
| Date / timestamp | Yes |
| Player | Selected player |
| Tool payloads | Ready drafts / annotations as applicable |

Stored under **player history**, timeline style, newest first.

---

## Explicitly deleted from V1 product surface

| Removed from coach UX | Reason |
|----------------------|--------|
| Athlete Mode / Object Mode | Engineering split; use Object Type instead |
| Auto-detect / tracking gates (StroMotion) | Optional assist only; never block manual path |
| Fixed phase models (AI Metrics) | Frame + optional label only |
| Scores, ratings, biomechanical grades | Measurements only |
| Batch extract → then edit (StroMotion) | Violates Coach Override |
| Separate save flows per tool | Use universal Save Report |

---

## Future integrations (NOT V1 — hooks only)

Do not implement until Priorities 1–4 are genuinely complete:

| Priority | Item |
|----------|------|
| 5 | Google Docs export (player timeline sync) |
| 6 | YouTube integration (unlisted upload, link attach) |
| 7 | AI accuracy / segmentation improvements |

Reserved for later: progress tracking, historical comparisons, AI coaching assistant.

**Rule:** Once Coach Override exists, AI improvements are **time-savers**, not **dependencies**. The platform must be usable with AI wrong or disabled.

---

## Implementation priority (frozen roadmap)

```text
Priority 1 — StroMotion Coach Override Layer
Priority 2 — AI Metrics Coach Override Layer
Priority 3 — Player-Centric Database (Player → Sessions → Tools)
Priority 4 — Universal Save Report
Priority 5 — Google Docs Export
Priority 6 — YouTube Integration
Priority 7 — AI Accuracy Improvements
```

### Priority 1 deliverables (StroMotion)

- Per-frame Select Area
- Per-frame mask editor (add / remove / reset / regenerate / zoom)
- Frame status: pending | edited | ready
- Generate PNG + video from **ready** masks only
- Remove Athlete/Object UI; Object Type coach vocabulary
- Delete tracking-box / auto-detect-gated workflow

### Priority 2 deliverables (AI Metrics)

- Stroke type + frames (no phase engine as primary UX)
- Optional frame labels; frame time is truth
- Measurement modules as independent checkbox layers
- Geometry editing + live recalc
- ai / coach / ready per measurement
- Report from ready values only

### Priority 3 deliverables (Player-centric)

- Session belongs to player before or during tool use
- Timeline as primary history view

### Priority 4 deliverables (Save Report)

- One button, one pipeline, all tools
- Screenshot + notes + timestamp + player + ready payloads

---

## Development governance (for all contributors and AI assistants)

**Freeze all new AI work** until Coach Override layers exist for StroMotion and AI Metrics.

Do **not**:

- Improve extraction/segmentation quality as a substitute for manual override
- Add auto-detect gates, tracking prerequisites, or batch extract-first flows
- Merge StroMotion and AI Metrics workflows or data models
- Build Google Docs, YouTube automation, or scoring systems in V1 scope

Do **focus on**:

1. Per-frame object selection (StroMotion)
2. Per-frame mask editing + ready state
3. Measurement geometry editing + ready state (AI Metrics)
4. Universal Save Report
5. Player → Sessions → Tools navigation

---

## Relationship to other docs

- **`docs/COACHLAB_V1_SPEC.md`** — May contain implementation audit notes and legacy UI lists. Where it conflicts with **this document**, **this document wins**.
- **Code** — Must be refactored toward this freeze; existing extract/track/phase paths are legacy until removed.

---

*End of V1 Product Freeze*
