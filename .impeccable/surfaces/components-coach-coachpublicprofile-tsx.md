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

Section order is Vin's own and is deliberate: he sells first and proves last.
1 intro · 2 video analysis · 3 ebook · 4 Coach Life · 5 online coaching ·
6 NCAA consulting (+ the parent testimonial) · 7 €10 review bonus · 8 about ·
9 testimonials · 10 platform reviews.

**Do not reorder without asking him.** The order is data (`blocks[]`), not layout.

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
