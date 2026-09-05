---
version: 1
slug: "components-coach-coachpublicprofile-tsx"
primary_target: "components/coach/CoachPublicProfile.tsx"
related_targets: ["app/coach/[slug]/page.tsx","lib/coach/curated/types.ts"]
---

# Coach public profile (`/coach/[slug]`)

## Scope and mode

**Operate register on a revenue-facing surface.** The page sells (Stripe
checkout is the success condition) but it is rendered in the APP's design system
— "The Quiet Instrument" — not the landing page's marketing scale. Pinned by the
user: a premium, clean link-in-bio page, not a persuasive landing composition.

Type runs on the app ramp (11 / 13 / 16 / 18, plus DESIGN.md's documented
`headline` step for the coach's name). Radii 8 / 10 / 16 only. Colour from
`--cl-*` tokens. 44px targets. White ground, single blue accent.

This surface replaced a dark-gradient treatment (`#0a0a10 → #0f1420`) that
contradicted DESIGN.md's light-theme rule. Do not reintroduce a dark world here.

## Audience and job

A stranger arriving from Instagram or a WhatsApp link. They must recognise Vin
as credible and buy within one screen-length of deciding. Secondary and real:
they should get curious about AngleMotion itself rather than reading a bio and
leaving.

## Structure — fixed by the coach

**Top of page, in this order and no other:** circular photo (176px) → name →
bio lines → social icons → a single dark "Message Me" contact button → the
button menu.

The role is NOT in the heading: the first bio line already establishes it. The
contact button is the only dark button above the fold — the social row is where
to find him, that button is how to reach him, and the dark fill keeps it
distinct from the white menu buttons directly beneath.

Brand marks (WhatsApp, X, TikTok) are authored SVG in this file: lucide 0.263
ships no brand icons, and a generic chat bubble sitting beside real logos reads
as a placeholder.

**The button menu is a table of contents, not navigation.** Seven buttons, each
an in-page anchor (`<a href="#id">`) that smooth-scrolls to its section further
down the same page. Deliberately no button for the testimonials or the review
grid. Labels are Vin's, verbatim, emoji included.

**Sections below, in Vin's order:** 1 video analysis · 2 ebook · 3 Coach Life ·
4 online coaching · 5 NCAA consulting (+ the parent testimonial) · 6 €10 review
bonus · 7 about · 8 testimonials · 9 platform reviews.

He sells first and proves last. **Do not reorder without asking him.** The order
is data (`blocks[]` and `menu[]`), not layout.

Smooth scrolling is native: `scroll-behavior: smooth` on the `.cp-root` scroll
container plus `scroll-margin-top: 76px` on every section, so a heading clears
the sticky nav. No JavaScript, so it works before hydration. Reduced-motion
callers get `scroll-behavior: auto`.

## Chosen direction

**A centred, stacked sequence of quiet white cards on the app's grey ground.**
Refinement, not redesign: the incumbent structure was preserved wholesale and the
execution was rebuilt — spacing rhythm, type hierarchy, card treatment, hairline
separators over shadow, dark commit buttons, themed browser surfaces (selection,
focus ring, scrollbar, tabular numerals).

**The one hard problem: sixteen payment links in one section.** Four analysis
tiers, three of them priced across five stroke counts. Rendering them as sixteen
buttons is unusable; hiding them in a dropdown buries the price. Each tier
carries a **segmented stroke selector** that resolves to exactly one price and
one Stripe URL, so the visitor makes two small choices instead of reading a
matrix. Every link stays present in the data and reachable. Tiers hold
independent state.

A `priceList` whose options all share one destination renders **one** shared
action rather than three identical buttons; differing destinations render per-row
links. This is why NCAA and online coaching read as clean price tables.

## Content rules

Every price, Stripe link, testimonial and review is real and supplied by Vin, or
carried verbatim from `components/LandingPage.tsx`. Nothing is invented or
completed. A missing fact is left out or set to `null`, never filled with a
plausible stand-in — the `reviewBonus` action renderer drops any action whose
`url` is null for exactly this reason.

The seven platform reviews are reviews of **Vin's coaching**, which is precisely
what this page sells, so they need no disclaimer here — but they may never be
presented as reviews of the AngleMotion product. Only the founder's COACHING
Trustpilot profile appears; the app's own (0 reviews) does not.

## Discovery — six links, one of them contextual

This page is a way INTO AngleMotion. Five route-level links carry that: header
wordmark, header "Coaches", footer "Browse other coaches", footer "What is
AngleMotion?", footer "Powered by AngleMotion". **All five must survive any
future edit.**

The sixth is the one that actually works: a single quiet line directly under the
video-analysis tiers — "I build these breakdowns in AngleMotion — my own analysis
platform. You can open the same tool yourself." It is deliberately not a card and
not a banner (a card reads as another offer, a banner as an ad), and it sits
where the visitor has just finished reading what they would receive.

## Bio lines are editable; nothing else is yet

The bio is an ordered `string[]`, edited in CoachProfileEditor (add / edit /
remove / reorder) and persisted in the EXISTING `bio` column, newline separated.
There is no `bio_lines` column and none is needed — see `lib/coach/bioLines.ts`.
Saved lines win at render time; the curated defaults are the fallback.

A stored bio is only accepted as bio lines when it reads like one (≤12 short,
markup-free lines). That guard exists because the production row holds a pasted
HTML document; without it the page would render hundreds of junk lines.

Services, pricing tiers and every other curated block remain code-only. That is
deliberate scope, not an oversight.

## Data model and Phase 2

`blocks[]` is an ordered array of typed blocks, each with a stable `id`.
Reordering a profile is reordering that array. Phase 2's block builder persists
these objects; adding a kind is a union member plus a switch case.

Curated content wins over the database **for slugs in `CURATED_PROFILES` only** —
every other coach keeps the untouched DB path. `avatarUrl` is the deliberate
exception and still comes from the DB, so the existing photo-upload flow keeps
working for curated coaches.

## Unresolved

- **`--cl-accent` as text fails WCAG AA.** #007AFF measures ~4.0:1 on white and
  ~3.7:1 on the soft accent wash, under the 4.5:1 floor for normal text. It
  affects the whole app, not this page. The system already has the pattern for
  the fix (`--cl-destructive-text` / `--cl-warning-text` / `--cl-success-text`);
  an `--cl-accent-text` sibling is the missing piece. Not done here because
  tokens were out of scope. Three links on this page currently carry it.
- **`--cl-text-muted` (#8E8E93) fails too** — 2.99:1 on the page ground. This
  file no longer uses it; other surfaces still do.
- **No photo.** The hero renders a letter monogram until Vin uploads one through
  the profile editor.
- **The `vinbaccelli` DB row is now dead for display.** Its `bio` holds a pasted
  HTML document and its `tagline` is "Tennis coach"; `coach_services` and
  `coach_links` do not exist in the production database at all.
