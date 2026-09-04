---
version: 1
slug: "components-landingpage-tsx"
primary_target: "components/LandingPage.tsx"
related_targets: ["app/page.tsx","app/login/LoginClient.tsx","app/login/page.tsx"]
---

# Landing page + sign-in (`/` and `/login`, logged-out)

## Scope and mode

Persuade. The public marketing surface at `/` (rendered by `app/page.tsx` for
unauthenticated visitors) **and the sign-in page at `/login`**, which is the
only destination every call to action on the landing page leads to.

Both are explicitly outside the app's design-token consolidation: the app is
Operate and quiet, this surface is Persuade and loud. Deliberately different
objective, same brand.

`/login` is in scope as one surface with the landing page, not a separate
identity. Today it is a full-screen black, Google-only card with no route back
to the marketing page — an unbranded dead end at the exact moment a visitor has
decided to act. It carries the redesigned landing page's visual world, and it
gives the visitor a way home: the wordmark links to `/`, plus an explicit back
affordance. Its own job is unchanged (Google OAuth, the `redirect` param).

## Audience and job

**Coach-first, players genuinely second — not as recipients.** The working
tennis coach is the buyer; a player or parent building their own analysis
record over time is a real, addressed visitor, not an afterthought. Both are
served by the same spine rather than a fork.

**Job:** make a visitor believe that footage they already have becomes a
permanent, shareable record of a player's development — *video in, report out* —
and get them into the free trial hour.

**Primary action:** start the free trial hour. Secondary: see how it works.
The action completes on `/login`, so that page is part of the conversion, not
an afterthought to it.

## Proof and content

The only proof this page may use is what exists. **No testimonials, named
customers, club or federation logos, user counts, accuracy benchmarks, press, or
case studies exist anywhere in this project.** They are not to be invented or
implied through placeholder social proof.

Real and usable: the logo/icon set, `public/demo.mp4` / `demo.MOV`,
`public/court/`, the three real pricing tiers and the 1-hour trial in
`lib/plans.ts`, and shipped copy. Product screenshots for the tutorial section
are promised by the user in a later pass — the structure reserves the slot; the
content is not authored ahead of them.

Any illustrative player-development data the spine needs is authored at full
fidelity and labelled synthetic wherever a visitor could mistake it for a real
customer.

## Chosen direction

**The Timeline Spine, with each entry unfolding to the tool that made it.**
Form ① on the ordered list, fused with the mechanic of form ③ (The Report,
Unfolded), at the user's explicit direction. Seed key `anglemotion-landing-1`,
surface scope, dealt indices 3/5/2.

The page is one player's timeline read forward in time. Sections are dated
entries; each entry opens to reveal the capability that produced it, in the
user's own chain: every angle → AI-detected skeleton smoothed into clean video →
Motion Layer with coach-chosen frames and layers, under the coach's control →
Manual Match Analyzer's in-depth stats → both timeline docs → YouTube publish as
permanent, cost-free, unlimited history → sent to the client.

The argument that everything funnels into a durable record is made
**structurally**, by the page's own architecture, rather than claimed in a
headline.

**Memorable moment:** a continuous ruled spine down the page with a traveling
active band that tracks the reader's position through the player's development,
and tabular date stamps in the margin — donated from the daylight-section
challenger, rendered in the product's own light palette and single accent.

**`/login` in the same world:** the sign-in page reads as the spine's final
entry rather than a modal dropped on top of it — same ground, same type, same
accent, the ruled spine and date stamps carried through, the wordmark linking
home. The visitor should not be able to tell they changed pages, only that they
arrived at the step that starts their own record.

Raises carried in from declined and competitive challengers: display type at
poster scale (the current page's h1 stops at 56px), an emergence reveal for the
Motion Layer composite, and a strict numbered margin column held in reserve for
the tutorial section.

**Refused:** the category default — the four-viewport
upload/analyse/produce/timeline pipeline every analysis SaaS ships. And, for
`/login`, the unbranded centered auth card on a black field.

## Constraints

- Latitude is pinned by the user: **same visual world as the app, much louder.**
  White ground, the product's single blue accent, Apple-clean foundation; scale,
  type, motion, and imagery push hard inside it. No new palette, no dark world,
  no red accent.
- Desktop and mobile are both first-class; the page must hold up on a phone.
- The Academy is presented as an additional tool offering training, tutorials,
  and examples so coaches and players apply better video-analysis technique —
  not renamed, not made a pricing argument. It is **included with the Pro tier**,
  not free; the user confirmed this and `lib/plans.ts` is correct as written.
- `/login`'s auth behavior is not redesigned — only its presentation. Google
  OAuth, the `redirect` query param, and the error state keep working exactly as
  they do now.

## Unresolved

- **Where the primary CTA lands.** Now that `/login` carries the landing page's
  world, sending "Start Free" straight there is defensible; it was not before.
  Confirm during the build whether the hero CTA goes to `/login` or holds the
  visitor on the marketing surface first.
- **The tutorial section's content** waits on real product screenshots.
- **Name collision, recorded not resolved:** the Academy *pricing tier* (5 coach
  seats) and AngleMotion Academy the *library* (ships inside Pro) share a name.
  The user has decided this does not need resolving.
