---
version: 1
slug: "components-controlpanelhome-tsx"
primary_target: "components/ControlPanelHome.tsx"
related_targets: ["app/page.tsx"]
---

# Control Panel (`/`, signed-in)

## Scope and mode

**Operate.** The authenticated home screen, rendered by `app/page.tsx` for
signed-in users. It is the app's front door, not a marketing surface, and the
distinction is load-bearing: the visitor has already bought, already signed in,
and came to work.

`/dashboard` is a deprecated redirect to `/`. The analysis workspace itself
(`app/analysis/page.tsx`, `components/Canvas.tsx`,
`components/PreciseTimeline.tsx`) is out of scope and protected — this surface
is the shell that routes into it.

## Audience and task

A returning coach, often on a phone, often courtside with seconds between
drills. The job is **get to the right tool fast**, and the measured first
action is **open the analysis lab**.

Secondary but real: a coach who has not yet used a given tool needs to know
what it does and how the flow runs, without leaving the dashboard to find out.

## Chosen direction

**Tool-first spine with tutorials on demand.**

- **One dominant entry.** Video analysis is a single full-width card with the
  accent border and the only filled accent icon on the page. Everything else is
  quiet beneath it.
- **Three groups, nine destinations, nothing lost:** Players & learning
  (players, Academy) · Match intelligence (manual match report, AI decoder) ·
  Your business (coach profile, public catalog, plans, account & billing).
- **Tutorials on demand.** Each of the five actual tools carries a collapsed
  `How it works` walkthrough — 6 steps for the full analysis loop, 3–4 for the
  rest. Settings screens get a description and no walkthrough; a billing card
  does not need a tutorial.

**Why native `<details>` and not component state.** Collapsed by default keeps
the dashboard clean for the returning coach who needs none of it, while the
explanation stays one tap away for the coach who does. It also keeps this file
a server component, needs no client-side JS, works before hydration, and is
keyboard-operable for free. Do not replace it with a `useState` accordion
without a reason that beats all four.

**Every walkthrough step describes behaviour the app actually has.** They are
not aspirational. A step that stops being true is a bug in this file.

## Content rule: no marketing on the dashboard

The Control Panel carries **no testimonials, no star rating, no competitor
comparison and no plan pitch**. All persuasion lives on the landing page (see
[components-landingpage-tsx.md](components-landingpage-tsx.md)); the comparison
table sits at the end of that page.

This replaced six fabricated testimonials — invented names, roles and cities
under the heading "Real feedback from real coaches" with a 5.0 rating — that
shipped in the authenticated app. Nothing of that kind returns here. The real
reviews are of the founder's coaching and belong on the marketing surface,
framed as such.

## Constraints

- **The app's own design system only** (DESIGN.md, "The Quiet Instrument").
  This surface must never reach for the landing page's marketing type scale;
  more visual ambition is spent on craft within the app ramp, not on scale.
- **Colour comes from `--cl-*` tokens.** The per-tool colour palette that used
  to tint each icon (`#0D9488`, `#D97706`, `#7C3AED`) is gone: System Blue is
  reserved for the primary action and interactive states, so tool icons are
  ink. Reintroducing a decorative palette here breaks the One Voice Rule.
- 44px minimum touch targets, including the disclosure summaries.
- Desktop and phone are both first-class; the grid collapses to one column.
- Copy speaks from a shipped product. No "when you connect storage later"
  phrasing — that pre-launch language was removed and should not come back.

## Unresolved

- **The navigation spine is still an open product decision.** PRODUCT.md
  records the tension: the shipped app is tool-first, while the V1 freeze doc
  targets player-first (Player → Sessions → Tools → Report → Timeline). This
  surface is built tool-first because that is the confirmed first action today,
  **not** because the question is settled. A move to player-first would
  restructure this page, and that is a product call, not a design one.
- **No recents, no resume.** The dashboard cannot surface recent players or
  unfinished work because V1 keeps the editing session local. If cloud session
  persistence lands, a continuity row above the tool groups is the obvious next
  move and would change the first-action answer.
- **Plan-awareness.** The page shows the same nine cards to every tier. If
  upgrade prompting is ever wanted for trial or Light users, it needs
  subscription state this component does not currently receive.
