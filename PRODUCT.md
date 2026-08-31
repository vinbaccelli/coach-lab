# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary operator: the tennis coach.** They record or upload a video of a
player, analyse it with the app's tools, and produce artifacts (screenshots,
short videos, reports) that go onto that player's timeline.

**Also real users, not just recipients:** players themselves and parents use the
app. The product is not coach-only software that players merely receive output
from — a player can run their own analysis and keep their own timeline.

**Centre of gravity: the coach-to-player relationship.** The report and the
timeline are the product; the coach is the operator. Design decisions resolve in
favour of what reaches and helps the player.

*Open decision:* there is no role system in the codebase today — Supabase auth
grants one authenticated user type, and players exist as records in a coach's
player database rather than as accounts. Whether players and parents get their
own logins is undecided; do not design as if it is settled either way.

## Product Purpose

AngleMotion turns match and practice video into a durable, shareable record of a
player's development.

The core loop: **upload a video → analyse it with the tools → produce screenshots
and videos → add them to the player's timeline.**

The timeline is the point. It exists to answer *what needs to improve, what has
improved, and how the player is progressing over time* — questions a single
analysis session cannot answer.

Every player carries **two parallel timelines**, implemented as two separate
Google Docs (`PlayerDocKind = 'technical' | 'match'`, backed by distinct
`google_doc_id` and `google_match_doc_id`):

1. **Technical** — video analysis output: annotated frames, Motion Layer
   composites, pose/metric readings, coaching notes.
2. **Match analysis** — competitive performance data, fed by the two match tools.

Both are shareable with the player.

## Positioning

- **The timeline, not the analysis session, is the artifact.** Standalone
  analysis apps end at the export. AngleMotion's output accumulates into a
  per-player record that shows progress across months.
- **AI is never authoritative.** Every AI-produced mask, frame selection,
  measurement, line, or label is a *draft*. The chain is fixed: AI Proposal →
  Coach Review → Coach Adjustment → Coach Ready → Export/Save. Nothing bypasses
  it; exports use `ready` values only. (docs/COACHLAB_V1_PRODUCT_FREEZE.md)
- **Match Decoder builds on top of SwingVision rather than competing with it.**
  It reads SwingVision screenshots and derives stats that SwingVision does not
  itself surface. The stance is additive to a tool coaches already use.
- **A coaching platform, not an AI analysis tool.** AI accelerates the work; the
  coach remains the source of truth.

## Operating Context

**Desktop and mobile are both first-class and must reach feature parity.** This
is a hard product requirement, not progressive enhancement:

- **Desktop** is the *more comfortable* place to do video analysis — more room,
  finer pointing, longer sessions.
- **Phone** is how the coach *shows the analysis to the player on court*, in the
  moment.
- **Both must do everything the app offers, the same way.** A capability that
  exists on one and not the other is a defect, not a tier.

Desktop additionally offers a **9:16 mode** for recording vertical video —
content produced on desktop specifically to be watched on a phone. Aspect ratio
is a content decision, not a device constraint.

Courtside conditions are real: standing, often one-handed, outdoors in sunlight,
seconds between drills.

**The two match tools:**

- **Match Decoder** — ingests SwingVision screenshots (OCR) and improves on the
  stats SwingVision already provides.
- **Manual match stats** — the coach follows a player live during a match and
  logs points by hand, producing date → stats.

Both write into the player's match-analysis timeline.

## Capabilities and Constraints

**Surfaces:** `/analysis` (the main analysis workspace), `/decoder`,
`/match-report`, `/players` and `/players/[id]`, `/academy`, `/coaches` and
public `/coach/[slug]` profiles, `/dashboard`, `/billing`, `/pricing`,
`/profile`.

**Analysis tools:** freehand and shape drawing, angle and ruler measurement,
skeleton pose overlay (MoveNet / MediaPipe), Precision AI Track, Motion Layer
(StroMotion composites), ball trail, object multiplier, snapshots and stroke
phases, screen/canvas recording with webcam PiP, YouTube import.

**Export:** Google Drive + YouTube (unlisted by default) + Google Docs. This is
V1's "save".

**Terminology — use these exact words in UI:**
`Snapshot` · `Phase` · `Motion Layer` (not StroMotion, which is the internal
name) · `AI Track` · `Ready` (never "Approved" — coaches may revisit and change
work later) · frame status `pending | edited | ready` · `Coach Override`.

**Technical constraints:**
- Next.js 15 App Router PWA; Supabase auth; Stripe billing.
- V1 keeps the **editing session local** and infrastructure cost near zero;
  cloud snapshot persistence and video storage are deferred past V1.
- One analysis mode owns the canvas at a time (`live | snapshot | frame`); pose
  display writes are provenance-gated. (CLAUDE.md, ARCHITECTURE.md)
- No automated test runner is configured.
- Screen recording (`getDisplayMedia`) is unavailable on iOS Safari — a platform
  limit the product must communicate, not work around.

*Open decision:* **navigation spine.** docs/COACHLAB_V1_PRODUCT_FREEZE.md (June
2026) targets player-first (Player → Sessions → Tools → Save Report → Timeline);
the shipped app is tool-first, with `/analysis` as the centre. The described loop
starts at "upload a video" and *ends* at the player timeline. Which of these is
the durable navigational spine is not settled — do not let design work quietly
lock it in.

## Brand Commitments

- **Name: AngleMotion.** Used consistently in the wordmark, PWA manifest, layout
  metadata, landing page, and app chrome. "CoachLab" is legacy — it survives only
  in `docs/COACHLAB_V1_*` (June 2026) and the repository directory name, and is
  not the product name.
- **Descriptor:** "Coaching intelligence platform" (layout metadata).
- **Existing assets:** `public/logo-wordmark.svg` (Angle + Motion as two words),
  `logo-mark.svg`, `logo-square.svg`, `logo-rect.svg`, `logo-watermark.svg`
  (stamped onto exports), favicon set, PWA icons at 192/512.
- **Declared theme colour:** `#007AFF` on `#FFFFFF` (manifest).
- **Voice, from shipped landing copy:** plain, direct, coach-to-coach, lightly
  confident, no hype. "Coaching that stays yours." · "From video to
  student-ready report in three steps." · "Pricing that fits how you coach." ·
  "Questions, answered."

**Binding visual constraint volunteered by the user:** minimalist, clean,
Apple-like. Recorded as stated; not expanded here. The visual world is decided
in design work, not in this file.

## Evidence on Hand

**Real and usable:** the full logo/icon set above; `public/demo.mp4` and
`public/demo.MOV`; shipped landing, pricing and FAQ copy; three pricing tiers
(entry / Pro with Academy / team); locally hosted models (`movenet-lightning`,
`movenet-thunder`, `pose_landmarker_full`, `sam2`, `dfine-n`, selfie
segmentation); `public/court/` assets.

**Absent — must not be fabricated:** no testimonials, named customers, logos of
clubs or federations, user counts, accuracy benchmarks, press coverage, or case
studies are confirmed anywhere in the repository. Do not invent them, and do not
imply them through placeholder social proof.

## Product Principles

1. **The timeline outlives the session.** Any feature is judged by what it
   leaves behind on a player's record, not by how it feels in the moment.
2. **The coach is the source of truth; AI only drafts.** Never present an AI
   output as final, and never let one reach an export without passing through
   review.
3. **Parity is not negotiable.** Desktop and phone do the same jobs. Comfort may
   differ; capability may not.
4. **Built to be shared with the player.** Output is designed to be handed over
   and understood by someone who was not in the analysis session.
5. **Additive to the coach's existing stack.** Work with the tools coaches
   already use (SwingVision, Google Drive, YouTube) rather than demanding
   replacement.

## Accessibility & Inclusion

No formal standard has been established as a product requirement. Established in
the codebase and worth preserving: 44px minimum touch targets throughout the
toolbar and controls, `aria-label` on icon-only controls, and
`role="status" / aria-live="polite"` on the transient status toast.

Product-specific need: courtside use means **outdoor sunlight, one-handed
operation, and glanceable state** are real accessibility conditions, not edge
cases.
