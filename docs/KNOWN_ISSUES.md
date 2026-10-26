# Known issues

Defects found while working on something else. Recorded whether or not they were
fixed, and whether or not they are pre-existing — undocumented ≠ doesn't exist.

Format: symptom → verified root cause → fault assessment → proposed fix → severity.

Entry numbers are stable IDs (code and commits cite them), so they are never
reused or shifted. 019 and 020 were numbered 013 and 014 until 2026-10-01, when
two merges had each added their own 013/014; their "Found" dates are older
than their numbers.

---

## 001 — `--cl-accent` fails WCAG AA when used as text

**Found:** 2026-09-05, during the coach-profile refinement.

**Symptom.** System Blue text on a white or near-white surface does not reach the
4.5:1 contrast floor for normal-size text.

**Verified root cause.** Measured in a real browser against composited
backgrounds: `#007AFF` on `#FFFFFF` is **3.96–4.02:1**; on the soft accent wash
(`rgba(0,122,255,0.12)` over white) it is **3.69:1**. The 4.5:1 floor applies to
everything under 18.66px/700 or 24px. Large text (≥24px) is fine at the 3:1
floor.

**Fault assessment.** System-wide, not local to any one surface. DESIGN.md
already documents this exact failure mode and its remedy for the other semantic
hues — "The Text-Weight Variant Rule" gives `--cl-destructive-text`,
`--cl-warning-text` and `--cl-success-text` darker siblings precisely because the
fill colours fail as text. The accent simply never got the same treatment, so
every `color: var(--cl-accent)` on small text in the codebase inherits the
defect. It is a gap in the token set, not a misuse by any component.

**Proposed fix.** Add an `--cl-accent-text` sibling (a blue that clears 4.5:1 on
white — roughly `#0058CC` or darker) and use it wherever the accent carries TEXT,
keeping `--cl-accent` for fills, borders, icons and selected states. This touches
`styles/tokens.css` and DESIGN.md, so it needs a deliberate design-system pass
rather than a drive-by edit.

**Not fixed here.** Tokens were explicitly out of scope. Three links on
`components/coach/CoachPublicProfile.tsx` still carry the accent as text ("See
how it works", "Read on Trustpilot", "Read on Google"), and `app/pricing/page.tsx`
has three more instances of the *fill* half of the same problem — white text on a
System Blue fill is also 4.02:1 (the active billing toggle, its "2 months free"
label, and the "Choose Pro" button). Those three are DESIGN.md's own documented
`button-primary` (System Blue fill, Panel white text), so they are the system's
specification rather than local drift, and they clear the moment the token does.
The remaining accent uses on that page were changed to ink, left
consistent with the rest of the app rather than fragmented with a one-off colour.
The brand wordmark's blue "Motion" also measures 3.96:1, but a logotype is
exempt under WCAG 1.4.3.

**Severity:** medium — accessibility conformance, affects many surfaces.

---

## 002 — `--cl-text-muted` fails WCAG AA at body and label sizes

**Found:** 2026-09-05, same pass.

**Symptom.** The tertiary text token is unreadable at the contrast floor.

**Verified root cause.** `#8E8E93` measures **2.99:1** on the page ground
(`#F5F5F7`) and **3.26:1** on a white card. Both are well under 4.5:1, and the
token is used at 11–13px where the large-text exemption does not apply.

**Fault assessment.** The value is Apple's systemGray, which Apple itself uses
for non-essential text on larger surfaces. As DESIGN.md's "Tertiary Label" it is
applied to timestamps, counts and captions — supporting text that still has to be
readable.

**Proposed fix.** Either darken the token (`#6E6E73`, the existing secondary
value, passes) or restrict it to genuinely decorative, non-informational use and
document that boundary in DESIGN.md.

**Partially fixed.** `components/coach/CoachPublicProfile.tsx` no longer uses it —
all eleven references moved to `--cl-text-secondary`. Other surfaces still do.

**Severity:** medium — accessibility conformance.

---

## 003 — The production `vinbaccelli` profile row holds a pasted HTML document

**Found:** 2026-09-05, querying production Supabase to settle a precedence question.

**Symptom.** Before this change, `/coach/vinbaccelli` rendered a wall of CSS and
HTML source as the coach's bio, with no services and no links.

**Verified root cause.** The `coach_profiles` row for slug `vinbaccelli`
(`0bb0d24b-4662-4d0a-93a4-1277713b2479`) carries `tagline: "Tennis coach"` and a
`bio` containing a complete standalone `<!DOCTYPE html>` document — an entire
website mockup pasted into a textarea. `lib/coach/richText.tsx` renders it as
escaped text, which is safe (structurally XSS-immune, by design) but reads as
source code.

**Fault assessment.** Not data entry alone — **the editor invited it.** The field
was labelled **"Bio (HTML supported)"**, which was simply false:
`lib/coach/richText.tsx` renders a small markdown subset and deliberately never
renders HTML. A coach told the field accepts HTML will paste HTML. The renderer
behaved correctly throughout; the label was the defect, and there was no
validation on bio length or shape in `app/api/coach-profile/route.ts`.

**Fixed.** The mislabelled textarea is gone. `CoachProfileEditor.tsx` now edits
the bio as a list of short lines (add / edit / remove / reorder), capped at 12
lines of 160 characters, saved through the existing mechanism. When a stored bio
does not parse as bio lines, the editor shows an inline warning naming the
character count and stating that saving will replace it — so the old value is
never discarded silently.

**Still outstanding.** The bad row is still in the database. It is no longer
rendered (curated content takes precedence, and `parseBioLines` rejects it
anyway), and it will be overwritten the first time Vin saves his profile.

**Severity:** low now (not rendered, and the cause is removed); was high.

---

## 004 — `coach_services` and `coach_links` did not exist in production — RESOLVED

**Found:** 2026-09-05. **Resolved:** 2026-09-09, verified live.

**Was.** PostgREST returned `PGRST205 — Could not find the table
'public.coach_services' in the schema cache` for both tables, so every
database-driven profile rendered with no services and no links, silently.

**Now.** Both tables exist, RLS is enabled on both, and each carries a public
SELECT plus an owner-scoped `FOR ALL` policy with the ownership expression
`profile_id IN (SELECT id FROM coach_profiles WHERE user_id = auth.uid())` on
both USING and WITH CHECK. Verified against the live database on 2026-09-09:

```
information_schema.tables → coach_links, coach_services
pg_class.relrowsecurity   → true, true
pg_policies               → "Public can view services" (SELECT),
                            "Coaches manage own services" (ALL)
                            "Public can view links"    (SELECT),
                            "Coaches manage own links" (ALL)
```

The applied migration used different policy NAMES than the draft in
`lib/supabase/schema.sql` ("Public can view services" vs "Services are public")
and a single `FOR ALL` policy instead of split INSERT/UPDATE/DELETE. Both are
functionally equivalent and correctly scoped — no action needed.

**Also fixed along the way (2026-09-06).** The `PUT` handler no longer swallows
the delete errors, and validates name, slug, tagline, bio and avatar URL lengths
up front.

**Superseded by 009.** The tables exist, but `coach_services` was created with
different COLUMN names than the code reads and writes. See below.

**Severity:** resolved as written; the remaining problem is tracked as 009.

---

## 005 — The static `PROFILES` map shipped fabricated Stripe URLs — RESOLVED

**Found and fixed:** 2026-09-05.

**Symptom.** `components/coach/CoachPublicProfile.tsx` contained a hard-coded
`vinbaccelli` entry whose three services pointed at
`https://buy.stripe.com/video-analysis`, `/online-coaching` and `/match-report` —
placeholder URLs that are not real Stripe payment links — alongside invented
prices ($79 / $249 / $39) and an invented tagline.

**Verified root cause.** Launch-example scaffolding that was never removed.

**Fault assessment.** Dead in practice (the database row took precedence), but it
was one deleted row away from sending a real buyer to a broken checkout.

**Fixed.** The map is now empty; Vin's real content lives in
`lib/coach/curated/vinbaccelli.ts` with the real Stripe links.

**Severity:** was medium, now resolved.

---

## 006 — Coach profile photo upload fails silently — RESOLVED

**Found and fixed (client side):** 2026-09-06, reported by Vin: "can't upload my
profile picture".

**Symptom.** Choosing a photo in the profile editor appears to do nothing. The
button flickers to "Uploading…" and back to "Upload photo"; no photo appears and
no error is shown anywhere in the UI.

**Verified root cause — two independent faults, both required to reproduce.**

*1. No storage policy for the bucket (server side).* `storage.objects` has RLS
enabled and, verified against production, carries exactly four policies — two
for `frame-metrics-captures` and two for `analysis-screenshots`. **None mentions
`coach-avatars`.** With RLS on and no matching policy, every insert is denied.
Reproduced directly against the production endpoint:

```
POST /storage/v1/object/coach-avatars/... →
{"statusCode":"403","error":"Unauthorized",
 "message":"new row violates row-level security policy"}
```

The bucket itself is fine — it exists and is public. Only the write policy is
missing, so this failed for every coach, every time, since the feature shipped.

*2. Both upload paths were unsatisfiable anyway (client side).* The uploader
wrote to `avatars/<timestamp>.<ext>`, then on failure retried against the
`analysis-screenshots` bucket at `coach-avatars/avatars/<timestamp>.<ext>`. Every
storage policy in this project requires the object's **first path segment to be
the uploader's user id** (`(storage.foldername(name))[1] = auth.uid()::text`).
Neither path starts with a user id, so even once a `coach-avatars` policy exists
the original code would still have been rejected — and the fallback could never
have succeeded under any policy.

*Why it was silent.* The only report of failure was
`console.error('Avatar upload failed:', upErr2)` followed by a bare `return`. No
state, no message, nothing rendered. A user watching the screen sees a no-op.

**Not a curated-profile regression.** Checked explicitly, since curated content
takes precedence for `vinbaccelli`. The avatar exception is intact and working:
`app/coach/[slug]/page.tsx` maps `avatar_url` → `avatarUrl`, and
`CoachPublicProfile` passes `dbProfile?.avatarUrl ?? curated.avatarUrl`, so a
database photo still wins for a curated coach. Curated precedence never touched
the upload path and is not implicated — the upload has been broken since before
that system existed.

**Fixed (client).** Uploads now go to `<user-id>/<timestamp>.jpg`, matching the
project's storage convention. The unsatisfiable fallback is deleted. Every
failure now renders an inline error naming the cause, and an RLS rejection says
so explicitly and points here.

A mandatory crop step (`components/coach/AvatarCropModal.tsx`, built on
`react-easy-crop`) now sits in front of every avatar upload for every coach, so
a raw file never reaches storage: whatever is chosen leaves as a 512×512 JPEG.
That also removes file size as a variable — the upload is well under 200 kB
regardless of the source photo. Non-images and files over 15 MB are refused at
the picker with a plain-language message rather than failing later.

**RESOLVED 2026-09-09 — storage policies are applied.** Verified live against
`pg_policies` for `storage.objects`, filtered to the bucket. All four exist and
match the specification exactly:

```
INSERT  "Coaches upload own avatar"   {authenticated}
        WITH CHECK bucket_id='coach-avatars' AND foldername(name)[1]=auth.uid()
UPDATE  "Coaches replace own avatar"  {authenticated}   (USING + WITH CHECK)
DELETE  "Coaches delete own avatar"   {authenticated}
SELECT  "Public can read avatars"     {public}  USING bucket_id='coach-avatars'
```

Both halves of this issue are now closed: the client writes to
`<user-id>/<timestamp>.jpg` (matching the policy's folder rule) and the policies
exist to permit it. Vin should confirm one real upload end-to-end through
`/profile`, which is the only part that cannot be verified from here.

**Severity:** resolved.

---

## 007 — Light advertises $10 but Stripe charges $5 — SUPERSEDED (launch pricing)

**Update 2026-10-03.** The USD prices are retired with EUR launch pricing
(`claude/pricing-launch`). Nothing can drift silently any more: the checkout
route now retrieves the configured Stripe price and refuses to start (503)
unless its currency, amount and interval equal what `lib/plans.ts` displays,
and there is no fallback price ID. Closes once the EUR env vars are live.


**Found:** 2026-09-08, building the founding-pricing page. **BLOCKS DEPLOY.**

**Symptom (if shipped as-is).** `/pricing` advertises Light at $10/month and
$100/year. Checkout would charge $5/month or $50/year.

**Verified root cause.** The advertised price moved to founding pricing in
`lib/plans.ts`; the Stripe prices behind it did not. Read live from the Stripe
API on 2026-09-08 using the configured env vars:

```
STRIPE_PRICE_LIGHT_MONTHLY    → $5.00/month    active=true  livemode=true
STRIPE_PRICE_LIGHT_YEARLY     → $50.00/year    active=true  livemode=true
STRIPE_PRICE_MONTHLY   (Pro)  → $20.00/month   ✓ matches
STRIPE_PRICE_YEARLY    (Pro)  → $200.00/year   ✓ matches
STRIPE_PRICE_ACADEMY_MONTHLY  → $40.00/month   ✓ matches
STRIPE_PRICE_ACADEMY_YEARLY   → $400.00/year   ✓ matches
```

`priceIdFor()` resolves the tier to whatever ID the env var holds and never
compares it to the advertised number, so the mismatch is silent — the checkout
route's only guard is "is a price ID configured at all".

**Fault assessment.** Configuration, not code. Four of six prices are already
correct; only Light moved. There is no automated guard against advertised-price
drift, which is why this could only be caught by querying Stripe.

**Fix — Vin's action, not applicable from code.** Create two new LIVE recurring
prices in Stripe ($10/month and $100/year, USD), then repoint
`STRIPE_PRICE_LIGHT_MONTHLY` and `STRIPE_PRICE_LIGHT_YEARLY` at the new IDs.
Leave the old $5/$50 prices active so existing Light subscribers keep their
grandfathered rate — which is exactly what the founding-pricing promise says.

**Severity:** high until the env vars are repointed — advertised price would not
match the amount charged.

---

## 008 — Light's feature list promised the Academy while middleware blocked it — RESOLVED

**Found:** 2026-09-08, same pass.

**Symptom.** The Light tier now lists `AngleMotion Academy` as an included
feature. A Light subscriber who clicks through to `/academy` is redirected to
`/pricing?required=1`.

**Verified root cause.** `middleware.ts:86`:

```js
// Only 'light' is blocked from the academy; unknown/missing tier is
// treated as allowed (fail open) so a missing column never locks anyone out.
const academyOk = sub?.tier !== 'light';
```

The gate predates the founding-pricing feature list, where the Academy moved
from Pro-only down to Light.

**Fault assessment.** An entitlement decision, not a bug in the gate's
implementation — the gate does exactly what it says. Which of the two is wrong
is a pricing decision only Vin can make.

**RESOLVED 2026-09-09 — entitlement widened, option (a), on Vin's decision.**
The `academyOk` term is gone from `middleware.ts`; `/academy` now requires only
an active subscription, the same condition as `/analysis`.

Verified before changing that this was the ONLY Light exclusion: all four
`/api/academy/*` routes carry no tier logic at all, `app/academy/page.tsx` does
no gating, and `lib/stripe.ts:34` is the price→tier reverse map rather than a
gate. `middleware.ts:86` was the single carve-out.

Also caught in the same pass: `components/LandingPage.tsx` still read "Included
with the Pro plan." under the Academy section, which the change made false. Now
"Included with every plan."

**Related, still true:** the Academy contains **zero** resources in production
(`academy_resources` = 0 rows, verified 2026-09-08), so no tier receives content
today. That is a content gap, not an entitlement bug, and it constrains how the
Academy should be marketed.

**Severity:** resolved.

---

## 009 — `coach_services` column names do not match the code

**Found:** 2026-09-09, re-verifying 004 against the live database.

**Symptom.** Saving a profile that has any services returns an error, and any
service row that did exist would render with a blank title and a `#` link.
`coach_links` is unaffected — its columns match the code exactly.

**Verified root cause.** The applied migration created `coach_services` with a
different column vocabulary than the application reads and writes. Live
`information_schema.columns` vs. the code:

| live column     | code expects | used at |
|-----------------|--------------|---------|
| `name`          | `title`      | route.ts:158, page.tsx:68, editor |
| `price_label`   | `price`      | route.ts:161 |
| `stripe_url`    | `cta_url`    | route.ts:162 |
| *(absent)*      | `cta_label`  | route.ts:160 |

Reproduced through PostgREST with the anon key:

```
GET /rest/v1/coach_services?select=title,price,cta_label,cta_url
→ {"code":"42703","message":"column coach_services.title does not exist"}

GET /rest/v1/coach_services?select=name,price_label,stripe_url
→ []   (succeeds)
```

**Fault assessment.** Schema drift, not a code bug. `lib/supabase/schema.sql`
defines `title` / `price` / `cta_label` / `cta_url`, and all three consumers
(`app/api/coach-profile/route.ts`, `app/coach/[slug]/page.tsx`,
`components/coach/CoachProfileEditor.tsx`) agree with it — so the file and the
application are consistent with each other and only production differs.

`cta_url` is also the more accurate name: that column holds WhatsApp and
coachlife.com destinations as well as Stripe links, so `stripe_url` would be
wrong even if the code were changed to match it.

**Proposed fix — align production to the schema file. Both tables are EMPTY
(0 rows, verified), so the rename is data-safe:**

```sql
alter table coach_services rename column name        to title;
alter table coach_services rename column price_label to price;
alter table coach_services rename column stripe_url  to cta_url;
alter table coach_services add column if not exists cta_label text default 'Book Now';
```

**Not applied.** Schema changes to production are Vin's to run, consistent with
every other migration this session.

**Severity:** high — the coach services feature cannot work until the names
agree, and the failure is a 500 on save.

---

## 010 — Annotation coordinates live in canvas pixels, not video space

**Found:** 2026-09-26, while root-causing the compact↔expanded toolbar desync.

**Symptom.** Every drawing and manual measurement slides relative to the video
frame whenever the analysis panel changes size — expanding or collapsing the
toolbar, resizing the window, rotating a phone, adding the B panel, switching
reels ↔ 16:9. The marks stay where they are on the canvas while the video
re-fits underneath them.

**Verified root cause.** Strokes and angle measurements store ABSOLUTE
logical-canvas coordinates (`StrokeLine { p1: Pt; p2: Pt }`, `AngleMeas
{ v; p1; p2 }`, components/Canvas.tsx:169-212). The canvas backing store is
resized from the panel size (components/Canvas.tsx:4562) and the video's
letterbox rect is recomputed from that size every frame
(components/Canvas.tsx:4840-4846), so the frame moves and the coordinates do
not. Measured at toolbar 240px → 60px: a line held identical canvas
coordinates (558,328)-(761,401) while the video rect went 1260 → 1440 wide,
drifting the mark from u0 0.4429 to u0 0.3875 — about 5.5% of frame width.

The AI measurement overlays are NOT affected: their adjustments are stored
video-normalized (components/Canvas.tsx:7468-7476), and the data column's
position is normalized 0-1 (components/Canvas.tsx:388). That asymmetry is the
confirmation — what is stored in video space survives a resize, what is stored
in canvas space does not.

**Fault assessment.** Design-level, pre-existing, not a regression. The canvas
coordinate model was never given a video-relative anchor; the webcam PiP is the
only thing that was ever taught to rescale on container resize
(components/Canvas.tsx:2817-2837).

**Partially fixed.** The live symptom is fixed: annotations are now
re-projected old-rect → new-rect in the canvas-size effect
(components/Canvas.tsx:4652+), covering `strokesRef`, `angleMeasRef` and the
undo/redo history.

**Still open — the structural fix.** Store annotation coordinates
video-normalized (0..1 of the video rect) and convert at draw and hit-test
time. That is the only thing that fixes the remaining case: `exportStrokes` /
`importStrokes` (app/analysis/page.tsx:1016, :1043) persist the same canvas
pixels, so a snapshot saved at one panel width still restores misaligned at
another, and markup is not portable between a phone and a desktop. It also
removes the small float drift the re-projection accumulates over many resizes.
Needs a migration for snapshots already saved.

Not attempted here: the ruler (components/ruler/RulerOverlay.tsx) renders its
own SVG and was not audited for the same class of bug.

**Severity:** medium for the live symptom (now fixed); medium-high for the
persisted case, because it silently corrupts saved work rather than merely
looking wrong.

**Export only (2026-10-19, snapshot holds).** Each snapshot now stores
`drawingsBox`, the video box when its drawings were saved (`lib/snapshots.ts`),
and the Metrics export maps its strokes from that box, so a snapshot exported
after a resize lines up (measured: drawn at 1200 px, resized while active,
exported at 860 and 940 px: strokes within 0.5 px of where they were drawn). The
SCREEN is unchanged: re-entering a snapshot after a resize still restores its
strokes misaligned. Snapshots saved before this change have no box and use
today's box.

---

## 011 — A single joint-chain node can never be selected with the Select tool — FIXED (awaiting device test)

**Found:** 2026-09-28, browser-verifying the text-selection fix on `claude/text-tool-fix`.

**Symptom.** With the Select tool, pressing on a node of a joint chain and dragging
moves the WHOLE chain, never that one node. Measured in Chromium on this branch
and on `snapshot-v1` alike: pressing node 1 of a three-node chain and dragging
(+42, +18) moved all three nodes by exactly (+42, +18), and `selectionRef` held
`{kind: 'stroke'}`, never `{kind: 'jointNode'}`.

**Verified root cause.** The Select pointer-down runs a node pass and then a stroke
pass over the same marks. The node pass records `'jointNode'` with
`bestDist = d`, the distance to the node centre. The stroke pass then scores the
same chain with `hitTestStroke`, whose node term is `d - JOINT_NODE_RADIUS`
(`JOINT_NODE_RADIUS = 8`), which is always strictly smaller than `d`. So the
stroke pass always wins and overwrites the node selection, anywhere on or near a
node. The `'jointNode'` branch of the pointer-up finalize, and the node-drag code
behind it, are unreachable.

**Fault assessment.** Pre-existing: identical on `snapshot-v1 @ 1748ae8e`. The
stroke pass took its current back-to-front, strict-`<` form in `c596f706`
(Style mode, 2026-08-10); whether node selection ever worked before that has
not been checked.

**Proposed fix.** Give the node pass priority rather than competing on distance:
if it found a node, skip the stroke pass for that chain (or skip the stroke pass
entirely when a node hit exists). Needs its own browser check that dragging a
chain by its segments still moves the whole chain.

**Severity:** medium — per-node editing of a joint chain is impossible, but the
chain is still movable and redrawable.

**FIXED** (2026-09-30, uncommitted pending Vin's device test). The Select
pointer-down now skips the stroke and angle passes whenever the node pass found a
node: a node is a handle, like a text resize corner, and takes priority instead of
competing on distance. Browser-verified in Chromium on `cfbd0d0` + the fix, with a
three-node chain: pressing node 3 and dragging (+42, +60) moves node 3 only (the
other two stay, gold ring on the moved node); pressing mid-segment and dragging
still moves the whole chain; Undo after the segment drag reverts it. Reproduced
before the fix on unmodified `cfbd0d0` (a node press moved all three nodes). Undo
after a single-node drag needs two presses — see 016, a separate pre-existing
defect this fix makes reachable for nodes.

---

## 012 — A text label left selected keeps the canvas redrawing every frame — FIXED (awaiting device test)

**Found:** 2026-09-28, measuring the text-selection fix on `claude/text-tool-fix`
before and after, per CLAUDE.md §7.

**Symptom.** While a text label is selected and nothing else is happening, the
overlay canvas repaints at the display rate instead of idling. Measured in
Chromium, video paused, production build (`next start`):

| state (at rest, 3 s window) | redraws/s | main-thread ms/s |
|---|---|---|
| nothing selected | 0 | ~20 |
| a text label selected | 60 | ~126 |

About 106 ms of main-thread work per second, for as long as the label stays
selected. Returns to 0 redraws/s as soon as it is deselected (empty-canvas click,
switching tool, undo/redo, Clear all).

**Verified root cause.** The render loop treats any non-null `selectionRef` as an
active interaction (`hasActiveInteraction` includes `!!selectionRef.current`) and
repaints every frame while one exists. That was harmless while a text selection
could only exist mid-drag; the fix that keeps a clicked label selected (so its
resize handles are reachable) makes it a resting state. Joint-node selections had
the same property already, but were unreachable — see 011.

**Fault assessment.** A deliberate trade accepted with the fix, not an accident:
the render-loop gating is a protected behaviour (CLAUDE.md §6) and was not
changed without approval.

**Proposed fix.** Count a selection as an active interaction only while it is
being dragged (`isDraggingRef.current && !!selectionRef.current`), and set
`renderDirtyRef` wherever a selection is created, changed or dropped, so a resting
selection draws once and then idles. Needs approval before touching the render
loop, and a before/after measurement.

**Severity:** low-medium — no functional impact; continuous CPU and battery use
while a label is selected, most noticeable on phones.

**FIXED** (2026-10-01, approved). In the render loop, a selection counts as an
active interaction only while it is being dragged
(`isDraggingRef.current && !!selectionRef.current`), and the Style-mode target
(`contextualTargetRef`, the same static-box pattern) no longer counts at all.
Instead of a dirty flag at each of the 13 `selectionRef` and 4
`contextualTargetRef` write sites, the loop compares both refs' identity with
the last rendered values (the same pattern it already uses for zoom/pan): every
write replaces the object, so any create/change/drop repaints once. Edits that
mutate the selected mark already set `renderDirtyRef` (Style changes, the
pulse toggle, text-edit commit via `pushHistory`, eraser hover).

Measured in Chromium, production build (`next start`), 1400×900, video paused,
mouse parked off the canvas, 3 s windows, two runs each:

| state (at rest) | redraws/s before | after | main-thread ms/s before | after |
|---|---|---|---|---|
| nothing selected | 0 | 0 | 23–28 | 23–24 |
| text label selected | 60 | 0 | 224–237 | 23–26 |
| joint node selected | 60 | 0 | 234–236 | 22–23 |
| Style box selected | 60 | 0 | 213–233 | 22–25 |

Behaviour verified unchanged in the browser: each selection's box / handles /
node ring / Style box appears on select, persists at rest, and disappears on an
empty-canvas click; a dragged label follows the pointer before release; text
resize by corner handle works; the Style-mode eraser cursor follows the pointer;
picking a tool ends Style mode and removes its box; the full Undo/Redo suite
from 016 still passes.

---

## 013 — The foot-line notice blames the device for a model-load failure

**Found:** 2026-09-26, while fixing the false "can't run foot lines smoothly"
banner (lessons-learned 006, symptom 1).

**Symptom.** The banner always reads *"This device can't run foot lines smoothly
live — the live skeleton has switched back to the fast model."*

**Verified root cause.** `revertMediaPipeLive` takes a reason —
`'cpu-delegate' | 'too-slow' | 'init-failed'` (`components/Canvas.tsx`) — and
`handleFootLineLiveUnsupported` stores it in `footLineUnsupported`
(`app/analysis/page.tsx`), but the rendered notice never reads it. Two of the
three reasons are about the device; `'init-failed'` means the MediaPipe
landmarker could not be created at all, which on a capable machine usually means
the model or the WASM fileset did not load — a network or hosting problem, not
hardware.

**Fault assessment.** Pre-existing, cosmetic but misleading: it sends a coach
looking at their hardware when the fix may be a failed asset load. The reason is
already plumbed to the component, so nothing structural is missing — the copy
just ignores it.

**Proposed fix.** Branch the notice body on the stored reason: keep the current
wording for `'cpu-delegate'`/`'too-slow'`, and for `'init-failed'` say the
precision model could not be loaded and to retry or check the connection.

**Not fixed here.** The approved change list covered the false *trigger*, not the
copy; changing user-facing wording is a product decision. Severity: low.

---

## 014 — `@ffmpeg/core` is loaded from a third-party CDN at runtime

**Found:** 2026-09-26, while root-causing the unplayable Generate export
(lessons-learned 006, symptom 3).

> **CORRECTED 2026-09-30.** This entry originally called the CDN fetch "the
> realistic failure" for MP4 conversion. It was not. The conversion was failing on
> every webpack build for an unrelated reason — the bundler rewriting the worker's
> dynamic import (lessons-learned 007) — and that reproduced with the core served
> **same-origin at 200 OK**, so the CDN never entered into it. The reasoning below
> is still valid as a *robustness* concern and the proposed fix still stands; it is
> a latent risk, not a diagnosis of anything observed.

**Symptom.** Every MP4 conversion in the app — Metrics/Generate, tab capture,
screen recording, crop export — fails whenever `cdn.jsdelivr.net` is unreachable.
Reproduced here: `toBlobURL` throws `TypeError: Failed to fetch`, `getFFmpeg()`
rejects, and the conversion returns `ok: false`.

**Verified root cause.** `lib/ffmpegWebmToMp4.ts` pins
`CORE_BASE = https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm` and
fetches `ffmpeg-core.js` + `ffmpeg-core.wasm` from it at call time.
`package.json` depends on `@ffmpeg/ffmpeg` and `@ffmpeg/util` but **not** on
`@ffmpeg/core`, so the WASM binary has no local copy to fall back to. An
ad-blocker, a corporate proxy, an offline session or a jsdelivr outage takes out
every video export.

**Fault assessment.** Pre-existing, and the same class of dependency the project
already eliminated elsewhere: `lib/poseWorker.ts` self-hosts the MoveNet weights
precisely so that *"no third-party CDN a blocker or network policy could kill"*
is in the loop, and `scripts/copy-ort-wasm.mjs` stages the ONNX runtime into
`public/ort/` for the same reason. ffmpeg is the one runtime binary that never
got the treatment. Measured: with the core reachable, the primary libx264 pass
succeeds at 640×360 and 1280×720/≈20 s with and without the retime filter — so
this load step, not the encoder, is the realistic failure.

**Proposed fix.** Add `@ffmpeg/core` as a dependency and stage
`ffmpeg-core.js` / `ffmpeg-core.wasm` into `public/ffmpeg/` from a postinstall
script, exactly as `copy-ort-wasm.mjs` does for ONNX; point `CORE_BASE` at the
local path. ~31 MB of WASM, so it wants a deliberate look at what that does to
the deploy (and `next.config.js` already fights the 250 MB function limit) rather
than a drive-by edit.

**Not fixed here.** Out of the approved change list, and it touches the install
and deploy footprint. The conversion failure is now at least honest and visible
(the file keeps its real `.webm` extension and the UI reports the error), which
is what made this diagnosable. Severity: medium — degrades every export path, but
no longer silently.

---

## 015 — MP4 conversion was broken in EVERY caller, not only Generate

**Found:** 2026-09-30, fixing the Generate export failure (lessons-learned 007).

**Symptom.** `Cannot find module 'blob:http://localhost:3001/…'` from any code
path that converts a recording to MP4.

**Verified root cause.** All converters share one loader, `getFFmpeg()` in
`lib/ffmpegWebmToMp4.ts`, and the failure was inside it — so it took out every
caller equally, not just Metrics/Generate:

- `convertWebmBlobToMp4` → Metrics/Generate export, embed/tab-capture download
  (`app/analysis/page.tsx`)
- `convertWebmToMp4ForScreenRecord` → `components/ScreenRecorder.tsx`,
  `contexts/RecordingContext.tsx`, `lib/cropExport.ts`

**Fault assessment.** Pre-existing and wide. The Generate path was simply where
Vin happened to look, and the earlier session's claim that the H.264 combination
"works elsewhere" was never verified against the running app — the screen-record
path shares the same broken loader and will have been failing the same way. It
degrades visibly there (ScreenRecorder refuses to deliver and shows "Could not
convert recording to MP4"), which is probably why it read as an occasional
annoyance rather than a total outage.

**Fixed here** by the `classWorkerURL` change in `getFFmpeg()`, which is shared,
so all five call sites are fixed at once. Verified only through
`convertWebmBlobToMp4` (the reported path).

**Verified for Generate, in the real app.** `/analysis` is reachable on a local
dev server (middleware fails open with no Supabase env vars — see CLAUDE.md), so
the whole flow was driven in Chromium: upload → two snapshots → Generate → Record
video. With the core reachable it logs
`[ffmpegWebmToMp4] converted with libx264+faststart (379410 bytes)`, the workspace
says "Replay video ready" and the download button reads MP4. With the core
blocked it reports the failure in the workspace and the button reads WEBM.

**Still owed:** the same pass over the screen-record, crop-export and tab-capture
downloads. They share the fixed loader and the same encoder ladder, so the fix
should carry — but "should carry" is not "verified", and this repo has been burned
by exactly that gap. Now that runtime checking is possible, this is a doable task
rather than a standing unknown. Severity: medium — the defect is fixed for every
caller; the confirmation covers one.

---

## 016 — Undo after dragging a text label or a joint node needs two presses — FIXED (awaiting device test)

**Found:** 2026-09-30, browser-verifying the fix for 011.

**Symptom.** Drag a text label (or, since 011 was fixed, a single joint-chain
node) with the Select tool, then click Undo: nothing changes. A second Undo
reverts the drag. Measured in Chromium: after a node drag, Undo ×1 left the node
moved and Undo ×2 restored it; after a text-label drag of 120 px on unmodified
`cfbd0d0`, Undo ×1 left the label where it was dropped and Undo ×2 restored it.

**Verified root cause.** The canvas wires `onPointerLeave={onPointerUp}`
(`components/Canvas.tsx`, the `<canvas>` element's props). The Select finalize in
`onPointerUp` runs whenever `selectionRef.current` is set and always calls
`pushHistory()`. Every other stroke kind clears `selectionRef` on release, so a
later pointer-leave finds nothing to finalize. A text label (kept selected since
the text-tool fix, so its resize handles are reachable) and a joint node (kept
selected by its own finalize branch) are still selected at rest, so moving the
mouse off the canvas — which reaching the Undo button always does — runs the
finalize again and pushes a byte-identical second entry. The first Undo steps
onto that duplicate.

**Fault assessment.** Pre-existing for text labels since the kept-selection
change; newly reachable for joint nodes with the 011 fix. Same class as the
duplicate-history entry already fixed for Style mode (a push on a path that did
not change anything).

**Proposed fix.** Only finalize a Select drag while one is actually in progress:
in the finalize branch, return early when `!isDraggingRef.current` (a kept
selection at rest is not an edit). Separately, `dropKeptStrokeSelection` clears
`stroke`/`textResize` on undo/redo/tool switch but not `jointNode`, so a stale gold
node ring can survive an Undo — add `'jointNode'` to its kinds. Both need
approval; neither touches the render loop.

**Severity:** medium — Undo looks broken after the most common Select edit, but
nothing is lost (the second press works).

**FIXED** (2026-10-01). The Select finalize returns early unless a drag is in
progress (`isDraggingRef`), so a pointer-leave over a kept selection no longer
pushes; and `dropKeptStrokeSelection` now also drops a `jointNode` selection, so
Undo/Redo/tool switch clear the gold ring and its stale index. Browser-verified
in Chromium: text label dragged 150 px → Undo ×1 reverts, Redo re-applies; joint
node dragged → Undo ×1 reverts with no gold ring left, Redo re-applies; chain
segment drag + Undo, and line draw → drag → Undo ×2 → Redo ×2, all unchanged.
Not covered: a press-and-release with NO movement still pushes a no-op entry —
see 018.

---

## 017 — The video-slot pills cover the ruler panel's header and close button

**Found:** 2026-09-30, spot-checking the ruler panel drag after the PR #58 merge.

**Symptom.** With Video A loaded and the Ruler tool open on desktop (1400×900),
the "Remove A / + Add B" pills sit on top of the ruler panel's header. Measured
with `elementFromPoint` every 20 px along the header: the left 80 px is the
header, everything from x≈1193 to the right edge is the slot-pill group,
including the panel's close button (its centre hit-tests to the pill). A press on
the covered part of the header lands on Remove A / Add B instead of starting a
drag; the close button cannot be clicked until the panel is dragged clear.

**Verified root cause.** Both are anchored to the same corner of the same
panel: the slot pills at `top: 8, right: 8, zIndex: 110`
(`renderVideoSlotPills`, `app/analysis/page.tsx`) and the ruler panel at
`top: 12, right: 12` until its first drag (`components/ruler/RulerOverlay.tsx`,
the control panel's style). The pills win the stacking order.

**Fault assessment.** Pre-existing: the pills date from `5cef44a` (2026-08-11)
and the ruler anchor predates `e7376cc` (which made the panel draggable and kept
the anchor byte-for-byte). Not a regression from today's merges. Dragging the
panel by the uncovered left part of its header works (verified: exactly
−300/+150, and it stays put).

**Proposed fix.** Either open the ruler panel below the pill row (e.g. `top`
offset by the row's height when Video A is loaded), or hide the slot pills while
the ruler panel is open. Relevant to the recording-control redesign, which would
put more controls in that same row. Needs a decision.

**Severity:** low-medium — the panel is still movable and closable via the tool
rail, but the obvious close button is unreachable.

---

## 018 — Clicking a mark with the Select tool (no drag) adds a no-op Undo step — RESOLVED

**Found:** 2026-10-01, browser-verifying the fix for 016.

**Symptom.** Click a text label (or any mark) with the Select tool without
moving it, then press Undo: nothing visibly changes. The next Undo works. Measured
in Chromium after the 016 fix: plain click on a label, Undo ×1 left the label in
place; Undo ×2 removed it (undid its creation).

**Verified root cause.** The Select pointer-down sets `isDraggingRef = true` on
any hit, and the finalize on release calls `pushHistory()` unconditionally, so a
press-and-release that moved nothing pushes a byte-identical entry.

**Fault assessment.** Pre-existing for every mark kind (it is the same finalize
path); more noticeable now that a clicked text label stays selected, since
clicking a label to reach its resize handles is a normal step.

**Proposed fix.** Push only when the drag changed something: compare the mark
at `finSel.idx` against `finSel.orig` (identity is enough — every move replaces
the object) and skip `pushHistory()` when unchanged. Careful with the outline
eraser branch, which edits the stroke at pointer-down and stores the edited
object as `orig`; it must still push. Needs approval.

**Severity:** low-medium — one extra Undo press, nothing lost.

**RESOLVED** (2026-10-07, branch `claude/canvas-recording-polish`). The Select
finalize in `onPointerUp` (`components/Canvas.tsx`) now pushes only when
`liveStateDiffersFromHistoryTop()`: the live strokes or angles are no longer
the exact objects of the current history entry. Every move and resize
replaces the changed mark's object, so a click that moved nothing finds them
identical and pushes nothing; any real change (including the outline eraser,
which replaces the stroke at pointer-down) still pushes. Browser-verified in
Chromium at 1440 px and at 390 px with touch: line + circle drawn, plain
Select click on the line, Undo ×1 removes the circle (before the fix it did
nothing); click + drag the line, Undo ×1 restores it, Redo re-applies; plain
click on a text label, Undo ×1 undoes the label's creation; label drag, Undo
×1, Redo (016) unchanged; joint-node drag and chain drag each undo in one
press.

---

## 019 — Recorded PiP position is proportional, not pixel-exact, in tab/window share

**Found:** 2026-09-26, while fixing background removal during recording (items D/E).

**Symptom.** In a tab or window screen share, the webcam PiP in the recorded file
sits at roughly — not exactly — the spot the coach dragged it to on the canvas.
Size and shape are correct; the corner offset can be off by the height of the
app's own chrome.

**Verified root cause.** The composite stamps the PiP using a rect normalized
against the *drawing canvas* (`getNormalizedRect`, `lib/webcamPipPresentation.ts`),
then scales it onto the whole captured frame. The canvas is only part of that
frame (toolbar rail, header), and the browser exposes the shared surface's *type*
(`displaySurface`) but never its identity or the app's offset inside it, so the
true mapping is not computable. Aspect is preserved via `getAspect`, so the shape
is right; only the origin is approximate.

**Fault assessment.** Inherent to compositing a webcam into a screen grab whose
geometry the page cannot know. Not a regression — the previous behavior was a
hard-coded bottom-right box, which was further off. Whole-screen ('monitor')
share is exact, because there the coach's own canvas PiP is what gets recorded.

**Proposed fix.** None worth making. If pixel-exactness is ever wanted for tab
share, it needs the canvas's rect within the captured surface, which would mean
measuring the canvas against the viewport and assuming the shared surface *is*
this tab — an assumption the browser will not confirm.

**Severity:** low — cosmetic, sub-chrome offset; shape, size and opacity are correct.

**No longer reachable while `FLOATING_CAMERA_WINDOW` is off** (2026-10-07,
`contexts/RecordingContext.tsx`). The engine no longer stamps the webcam in any
share mode; the canvas PiP itself is what gets recorded whenever the shared
surface includes the AngleMotion page, so its position is exact in tab and
window share too. Applies again only if the constant is turned back on.

---

## 020 — Closing the floating window still turns the webcam off in a whole-screen recording — RESOLVED

**Found:** 2026-09-26, while implementing E2(a) (monitor-share PiP handling).

**Symptom.** During a whole-screen recording the floating window is deliberately
controls-only (Pause/Stop/timer, no camera). Closing it nevertheless turns the
webcam off, which now also removes the coach's PiP from the canvas — and so from
the recording.

**Verified root cause.** The `pagehide` handler in `contexts/RecordingContext.tsx`
implements the documented CORE RULE "closing the PiP window turns the webcam
region off (but never stops the recording)": it nulls the Source B element and
fires `onWebcamClosedByPip`, which the analysis page wires to `stopWebcam`. That
contract was written when the window always showed the camera, so closing it read
as "turn my camera off". With a controls-only window the gesture no longer
carries that meaning.

**Fault assessment.** Pre-existing contract, newly visible in monitor share.

**Severity:** low-moderate — recoverable (re-toggle the webcam), but it silently
dropped the coach from the rest of the recording.

**RESOLVED** (2026-09-27). The `pagehide` handler now branches on share mode.
Tab/window share is unchanged — the window IS the camera view there, so closing
it still reads as "turn my camera off". In monitor share the window is
controls-only, so closing it is treated as "hide these controls": the Source B
element is left alone and `onWebcamClosedByPip` is not fired, so the webcam —
and with it the canvas PiP that a whole-screen recording actually captures —
survives.

The open question this depended on ("how does the coach stop the recording once
the window is gone?") is answered by in-page recording controls (originally
`components/RecordingControlBar.tsx`, a full-width bar in the page's top chrome;
since 2026-10-01 `components/RecordingControls.tsx`, compact, in panel A's
top-right video-slot row). Pause / Resume / Stop live in the analysis page for the
duration of any recording, reachable from every tool and panel, so closing the
floating window never removes the only way to stop.

**Superseded for launch** (2026-10-07). With `FLOATING_CAMERA_WINDOW` off the
floating window never shows the camera in any mode; where it is still opened
(entire-screen and window share, as the keep-alive — see 022) it is
controls-only, so closing it never turns the webcam off.

---

## 022 — The recording painter runs in the AngleMotion page, so a hidden tab freezes the recording without the floating window

**Found:** 2026-10-07, while removing the floating camera window for launch.
(Numbered 022: 021 was held for the guided-tours branch, whose entry landed as 035.)

**Symptom (measured, not yet seen by a coach).** Without a floating Document PiP
window, a recording whose AngleMotion tab goes into the background drops to
about 1 frame a second until the tab comes back.

**Verified root cause.** The recorded video is `recCanvas.captureStream()`, and
the painter that copies the screen grab into `recCanvas` (`paintOnce` in
`contexts/RecordingContext.tsx`) is driven by a timer in the AngleMotion page
(or by the floating window's animation frames when one is open). Chrome
throttles a hidden page to one timer tick a second and stops its animation
frames. Measured in Chromium (real windowed browser under Xvfb, Playwright's
throttling opt-outs removed, entire-screen capture running): AngleMotion tab
sent behind another tab → timers 30 → 1 Hz, animation frames 60 → 0, painter
30 → 1 fps, canvas-recorded video 38 → 2 KB/s, while a MediaRecorder on the RAW
display track kept ~44 KB/s. With a Document PiP window open, the hidden page
kept 30 timer ticks and 60 frames a second and the painter ran at full rate.
The canvas render loop and the webcam background removal
(`lib/webcamSegmentation.ts`) are also animation-frame driven and stop the same
way, which only matters when the AngleMotion page itself is in the shared
surface.

**Fault assessment.** Architectural, pre-existing: it is why the floating window
existed. Not introduced by removing the camera window, because the window is
kept (controls-only) as the keep-alive for entire-screen and window share
(`KEEPALIVE_WINDOW_SURFACES`). Tab share closes it: it normally captures the
AngleMotion tab itself, which Chrome is expected to keep rendering while
captured; that could not be measured here (real tab capture does not start in
the test container) and is on Vin's real-Chrome test list.

**Proposed fix (needs approval — changes the painter/captureStream topology,
CLAUDE.md §6).** Record the display track directly instead of a canvas copy of
it: no page timer in the path, so no throttling in any mode and no keep-alive
window. Costs: the burned-in watermark (drawn by the painter today) would have to
move to post-processing (the WebM → MP4 ffmpeg pass already runs), the 1280 px
downscale would come from getDisplayMedia constraints instead, and it only works
while the engine stamps nothing into the frame (true with the camera window
off).

**Severity:** medium — silent quality loss in a recording, but avoided today by
the keep-alive window in the two modes where it is likely.

---

## 023 — A publishable/anon key in the service-role slot makes server writes fail on RLS (YouTube Connect broke in production)

**Found:** 2026-10-07, production report: Connect YouTube → "Could not save the
connection". Vercel log: `[youtube/connection] store failed: new row violates
row-level security policy for table "youtube_connections"`.

**Verified root cause (code side).** `public.youtube_connections` has RLS on and
deliberately ZERO policies (`supabase/migrations/20260728120000_youtube_connections.sql`);
the only writer is the service-role client (`lib/supabase/service.ts`), which
bypasses RLS. An RLS refusal therefore means the client was built from a key
whose role is NOT service_role. The helper read only `SUPABASE_SERVICE_ROLE_KEY`
and accepted any non-empty value, so a publishable (`sb_publishable_…`) or anon
key in that variable produced a client that looked configured and ran as anon:
writes refused by RLS, reads silently empty. No code on main changed between the
late-September key migration and the report, so the value in Vercel Production is
the remaining suspect; env changes apply only to deployments made after them.

**Fix (code).** `createSupabaseServiceClient` classifies the key by format
(`sb_secret_…` / service_role JWT accepted; publishable / anon JWT refused),
also accepts `SUPABASE_SECRET_KEY`, and logs one specific error naming the
variables and their kinds instead of building an anon client. `/api/health`
reports the key KIND (never the value). The production value itself must be
corrected in Vercel (see the PR).

**Same exposure elsewhere.** Only two server writers use this client on main:
the YouTube connection store and the Stripe webhook (`app/api/stripe/webhook/route.ts`).
The webhook on main IGNORES the write result (supabase-js returns `{ error }`, it
does not throw) and always answers 200, so a refused subscription write is lost
and Stripe never retries. PR #64 (`claude/billing-r0`) fixes that; #65 adds two
more service-client writers (`app/api/academy-members`, `app/api/ebook`).

**Severity:** high — YouTube Connect is unusable in production; paid checkouts
would not record a subscription while the key is wrong.

---

## 024 — YouTube upload blocked by CORS ("Failed to fetch") — resumable session created without an Origin

**Found:** 2026-10-07, production: Upload to YouTube on the Recording complete
screen failed with "Failed to fetch"; console: `Access to fetch at
'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable…&upload_id=…'
from origin 'https://www.anglemotion.com' has been blocked by CORS policy`.
(Numbered 024: 023 is on `claude/youtube-connect-fix`; the tours branch's entry landed as 035.)

**Verified root cause.** Since 2026-09-14 (`91dc569d`, PR #47) the server only
creates the resumable session (`app/api/youtube/upload-session/route.ts`) and the
browser PUTs the bytes to the session URL (`lib/export/youtubeResumableUpload.ts`).
That PUT is cross-origin, and Google's upload server answers it with
`Access-Control-Allow-Origin` only for the origin given when the session was
created. The session was created with Node's fetch, which sends no `Origin`
(measured locally), so no browser origin was ever allowed. Google's upload host
returns `access-control-allow-origin` only when the request carries an Origin
(measured against `www.googleapis.com/upload/youtube/v3/videos`).

**Fix.** The route reads the request's `Origin`, accepts only
`https://anglemotion.com`, `https://www.anglemotion.com` (and localhost in
development), and creates the session with it; a missing or other origin gets
no session. A failure before Google confirms any bytes now shows "YouTube upload
could not start. Try again, or download the file instead."

**Severity:** high — no browser upload to YouTube could succeed.

---

## 025 — Customer portal could open by email match, not by the linked Stripe Customer — RESOLVED

**Found:** 2026-10-07, while mapping the Stripe integration for the invoicing work.

**Symptom.** None reported. `docs/STRIPE_LAUNCH_SETUP.md` §6 said the portal
always opens "with the coach's stored Customer", and that was not what the code
did.

**Verified root cause.** `app/api/stripe/portal/route.ts` fell back to
`stripe.customers.list({ email })` when the coach's `subscriptions` row had no
`stripe_customer_id`. It opened the portal for the first Stripe Customer with
that email. That customer could be an old one-off buyer (ebook, analyses), or
an empty email if the session had none. An email match is not proof of
ownership.

**Fault assessment.** Pre-existing (before R0). Low exposure: sign-in is Google
with a verified email, so in practice the match was the same person. But it
contradicted the documented contract and could surface unrelated purchase
history.

**Fix.** The portal opens only for the Customer the webhook linked to the
account. No row means 404 ("subscribe first"). Read errors answer 503, and
Stripe errors are caught.

**Severity:** low.

---

## 026 — Two live webhook endpoints for one app, so one always failed its signature check — RESOLVED (dashboard)

**Found:** 2026-10-07, during the live Stripe setup.

**Symptom.** Live mode had two endpoints:
- `https://anglemotion.com/api/stripe/webhook`, created 2026-06-25;
- `https://www.anglemotion.com/api/stripe/webhook`, created 2026-07-04.

Each had the same three events.

**Verified root cause.** Each endpoint has its own signing secret. Vercel holds
one `STRIPE_WEBHOOK_SECRET`, so every delivery to the other endpoint failed
signature verification (400). The site is served at `www.anglemotion.com`
(`app/privacy/page.tsx:12`).

**Fault assessment.** Configuration only. No subscriptions existed, so nothing
was lost.

**Fix.** One new live endpoint on `www.anglemotion.com` with the launch events.
Its secret is the one in Vercel. Both old endpoints are **disabled**: the Stripe
connector can't delete endpoints, so delete them in the dashboard whenever
convenient.

**Severity:** medium while subscriptions exist (half the deliveries lost and
retried); none now.

---

## 027 — Subscription sales were recorded without their PaymentIntent, so a refund could not be matched — RESOLVED

**Found:** 2026-10-10, while adding refund tracking to invoicing.

**Symptom.** None yet (no live subscription sale so far). A subscription
record's `stripe_payment_intent_id` would have been empty.

**Verified root cause.** `fiscalDraftFromInvoice` (`lib/billing/invoicing/draft.ts`)
reads the PaymentIntent from `invoice.payments`, which Stripe does not include
in the `invoice.paid` webhook payload (it is an includable field). The value
was always null on the webhook path.

**Fault assessment.** Introduced with the invoicing work (P1); caught before
any live subscription sale.

**Fix.** When the payload lacks it, the webhook looks it up with
`stripe.invoicePayments.list({ invoice })` (`lib/billing/webhookSync.ts`,
`paymentIntentForInvoice`); the historical import does the same.
`charge.refunded` then matches the sale by PaymentIntent.

**Class of mistake.** Reading an expandable/includable field from a webhook
payload as if it were always present.

**Severity:** low (refunds of subscriptions are rare; nothing was lost).

---

## 028 — The forfettario wording contains a character SdI rejects (’ U+2019) — OPEN (needs Vin's decision)

**Found:** 2026-10-10, validating generated XML against the FatturaPA 1.2.1 XSD.

**Symptom.** An invoice whose Causale holds the wording exactly as on Vin's
existing invoices fails XSD validation: `Element 'Causale': [facet 'pattern']
… is not accepted by the pattern '[\p{IsBasicLatin}\p{IsLatin-1Supplement}]{1,200}'`.

**Verified root cause.** The text uses the typographic apostrophe ’
("dell’articolo", "d’acconto"), outside Latin-1. SdI accepts only Basic Latin
and Latin-1 Supplement.

**Fault assessment.** Not a code defect: the wording is preserved exactly, as
required. The app flags it in Invoice settings and blocks issuing; it never
rewrites it.

**Proposed fix.** Vin presses "Replace ’ with '" (and Save) in Invoice settings,
or edits the text directly.

**Severity:** blocking for issuing until decided; no data risk.

---

## 029 — The Eraser's size could not be changed on phones (or with the toolbar collapsed) — RESOLVED

**Found:** 2026-10-12, while adding size presets to the Eraser.

**Symptom.** With the Eraser picked, the Draw list showed an "Eraser size"
slider on a desktop-width toolbar, but nothing on a phone or with the toolbar
collapsed: those coaches were stuck at the 15 px default.

**Verified root cause.** `components/ToolPalette.tsx` rendered the slider only
when `!io` (not icon-only), and the toolbar is icon-only on phones, on mobile
chrome and when collapsed.

**Fault assessment.** Our defect (layout condition copied from the label-only
rows); no data risk.

**Fix.** The size control (Small / Medium / Large presets + slider) now shows in
every layout; in the icon-only column the presets stack and the slider is
vertical, like the Style panel's thickness bar. Verified at 1400 px and 390 px
(touch) in Chromium.

**Severity:** low (feature unreachable on phones; erasing itself worked).

---

## 030 — The skeleton-lock click point was never cleared — RESOLVED (cleared on a new video)

**Found:** 2026-10-12, while making AI Track use the locked player.

**Symptom.** None visible on its own; a latent wrong value. The point a coach
clicked to lock the skeleton (`pendingFocusRef` in `components/Canvas.tsx`) was
kept for the rest of the session — across unlocks and across loading a
different video — and is the fallback crop centre whenever auto-focus loses the
player.

**Verified root cause.** It was assigned in exactly one place (the click) and
never reset anywhere.

**Fault assessment.** Our defect; low impact (auto-focus usually overrides it),
but a point on one clip is meaningless on another.

**Fix.** Cleared together with the AI Track lock target when a NEW video loads
(the video-source lifecycle effect). Deliberately NOT cleared on unlock (owner's
decision, 2026-10-12).

**Severity:** low.

---

## 031 — The live MediaPipe skeleton ignores the player lock — OPEN

**Found:** 2026-10-12, same investigation.

**Symptom.** With foot lines on (live MediaPipe), the live skeleton can sit on a
different person from the one the coach locked.

**Verified root cause.** `detectPoseLive` (`lib/mediapipePose.ts`) runs the
VIDEO-mode landmarker on the full frame with `numPoses: 1`; the lock's click
point / crop is only sent to the MoveNet worker (`poseWorkerBridge.setFocusPoint`).

**Fault assessment.** Our gap; the lock was built for the MoveNet live path.

**Proposed fix.** Feed the live landmarker a crop around the locked player, or
run it multi-person and pick with `lib/aiTrackLock.ts` (as AI Track now does).
Needs a latency measurement first — the live budget is tight.

**Severity:** medium (wrong-player skeleton on two-player footage with foot lines on).

**Not changed** in the AI Track change (owner's decision, 2026-10-12).

---

## 032 — Timeline selection (Motion Layer / Metrics section) stuck or ran away after + / − — RESOLVED

**Found:** 2026-10-12, reported by Vin; reproduced in Chromium on a 9 s clip.

**Symptom.** After using the timeline's + / − zoom, the selection handles
could not be dragged, or a small drag threw the selection somewhere else.
Measured on main: (1) zoom in ×4 around a playhead outside the selection →
both handles disappeared; (2) Motion Layer: dragging the end handle to 30 %
collapsed the selection to 0.008–0.253 s; (3) zoomed in, dragging the end
handle +40 px reset the zoom mid-drag and moved the end to a different place
(2.64 → 6.67 s on the Metrics section instead of +0.14 s).

**Verified root cause** (`components/PreciseTimeline.tsx`).
- The handles rendered only while part of the selection was in view
  (`trimWidthPct > 0`), so zooming elsewhere removed them.
- The view effect was keyed on the `trimRange` OBJECT: with fitting off it set
  the view to "All" on every selection change (every drag frame); with fitting
  on (Motion Layer) it re-fitted mid-drag once the span changed by > 50 %.
  Either way the pixels under the finger meant a new time on the next move.
- Handle drags mapped the pointer to an ABSOLUTE time, ignoring the 10 px
  track inset, and had no pointercancel / lostpointercapture handling.

**Fix.** View and selection are independent (`lib/timelineView.ts`): zoom only
writes the view; the auto-fit reacts to the selection's values, never during a
handle drag; handle drags move by the pointer's movement converted with the
current zoom (so a handle pinned at the edge still moves); handles always
render; drags end on up, cancel or lost capture. Tests: `tests/timelineView.test.ts`.

**Severity:** high for the Motion Layer workflow (selection unusable after zooming).

## 033 — Third-party iframes are blocked by the site-wide COEP header — MITIGATED for the Trustpilot widget

**Found:** 2026-10-12, while adding the Trustpilot Review Collector to the landing.

**Symptom.** In Chromium, a cross-origin iframe on any page of this site
renders as an empty grey error box (`chrome-error://chromewebdata/`) unless
the framed page sends its own `Cross-Origin-Embedder-Policy` header. Measured
with a stub TrustBox served without that header; with the header it loads.

**Verified root cause.** `next.config.js` sends `Cross-Origin-Embedder-Policy:
credentialless` (with `Cross-Origin-Opener-Policy: same-origin`) on every
non-API route. COEP applies to nested documents, and `credentialless` only
relaxes subresources, not iframes.

**Fault.** Not a bug in the header (it gives the app cross-origin isolation);
a constraint any new embed must meet.

**Fix (Trustpilot).** `components/TrustpilotReviewCollector.tsx` marks the
widget's iframe with the `credentialless` attribute as the bootstrap inserts
it and restarts its load once (`markCredentialless`, `lib/trustpilot.ts`);
one request per load, measured. Chrome/Edge 110+ honour the attribute (the
iframe then runs without Trustpilot cookies, in ephemeral storage). Not
verified against the real widget.trustpilot.com (unreachable from the dev
sandbox), nor in Firefox or Safari. If a browser enforces COEP but lacks the
attribute and Trustpilot sends no COEP header, the widget shows the grey box.

**Any other new embed** needs the same treatment or its own COEP header.
Headers are unchanged.

**Severity:** medium (a broken box on the public landing in the worst case).

## 034 — Landing header wraps "Sign in" and "Start free" onto two lines at 390 px — OPEN (pre-existing)

**Found:** 2026-10-12, in the 390 px screenshots for the Trustpilot widget.

**Symptom.** On a 390 px-wide phone the sticky landing header has the
wordmark, "Sign in" and "Start free"; both buttons wrap onto two lines.

**Root cause.** Not investigated (header CSS in `components/LandingPage.tsx`,
untouched by the Trustpilot change). Proposed fix: `white-space: nowrap` on
the header buttons and a smaller gap below ~400 px.

**Severity:** low (cosmetic).

## 035 — Save Report has no button: the session save modal is unreachable

**Symptom.** The player profile tells coaches "Start from the player, use tools
in Video Analysis, then Save Report" and, with no Doc yet, "No Google Doc yet —
use Save Report to create one." There is no Save Report control anywhere in
Video analysis, so a session started with **New Analysis Session** cannot be
saved back to the player.

**Verified root cause.** `app/analysis/page.tsx` passes
`onSaveReport: () => setSessionSaveModalOpen(true)` (and `saveReportEnabled`)
into the toolbar props, and `components/ToolPalette.tsx` destructures
`onSaveReport` — but never renders anything that calls it. `SaveSessionModal`
("Save Report", with Source video → YouTube link) opens only from that state, so
no path reaches it. Present on `main` as well.

**Fault assessment.** Pre-existing (found while mapping the Player database tour,
2026-10-05). The other ways work reaches a player still work: Screenshot → Save
Screenshot → player; capture → Upload to YouTube (Unlisted) → Save to player
folder; Metrics → Generate → Attach to player; match report and match decoder.

**Proposed fix (needs approval — ToolPalette is a hot file).** Render a
"Save Report" row (disabled until `saveReportEnabled`) next to Screenshot in the
toolbar footer, calling `onSaveReport`; or remove the dead prop and change the
profile copy. The Player database tour deliberately does not send coaches down
the New Analysis Session → Save Report path until this is decided.

**Severity:** moderate — a documented, user-visible flow dead-ends.

## 036 — Tour steps that wait on slow work show no progress — PARTLY RESOLVED (Getting started step 7)

**Found:** 2026-10-13, reported by Vin on Getting started step 7 ("Check it
found your player"): while the skeleton loaded, the card said "give it a
moment" with no sign of progress.

**Root cause.** The tour card only knew a step's instructions and "Your turn…";
it had no view of an app task still running.

**Fix (step 7 only).** `lib/tourSignals.ts` keeps a tour STATE the app reports
where it already detects it (`components/Canvas.tsx`: 'loading' where it draws
"Preparing the skeleton…", 'ready' where it says "Skeleton ready", 'failed' on
the pose engine's "Skeleton load failed"); the "Is the skeleton over the
player?" prompt carries `data-tour-id="skeleton-confirm"`. A step with `wait`
shows a spinner and a loading line instead of its instructions, adds a
fallback line after 15 s or on failure, and switches to the instructions when
ready (`lib/tourWait.ts`). It never advances by itself. Tests:
`tests/tourWait.test.ts`.

**Same problem, not changed yet** (the card keeps the "press …" text and
"Your turn…" while the app works):
- Getting started 1, Draw and angles 1, Ruler 1 — "Load a clip": after Demo
  (Tutorial) the demo video downloads before the video slot appears; on a slow
  phone connection that is seconds with no sign in the card.
- Getting started 9 — "AI Detect Angles": waits on the detection; if it finds
  nothing, the app's status line says so but the card keeps waiting.
- Match decoder 2 — "Read screenshots": OCR of up to 25 screenshots can take
  tens of seconds; the highlighted button shows "(n/total)" but the card does
  not.
- Player database 1 — "Add a player": waits on the API call; an error shows on
  the page, the card keeps waiting (normally fast).

No tour has a step on AI Track or Motion Layer.

**Severity:** low–moderate (confusing, never a dead end: Skip step and Back
always work).

## 037 — Timeline tick marks ignored the zoom (and grew with the clip) — RESOLVED (timeline V1 stage 1)

**Symptom.** Zoomed in, the tick marks under the timeline no longer matched
the track: they were laid out over the whole clip whatever the view, with no
labels except on hover. On a 2-hour clip they were 240 elements re-rendered on
every time update (274 nodes in the timeline, measured).

**Verified root cause.** `TimelineMarkers` in `components/PreciseTimeline.tsx`
placed ticks at `time / duration` with an interval chosen from the duration
alone (1–30 s), ignoring the view and the 10 px track inset.

**Fix.** A time ruler drawn from the VIEW (`rulerTicks` in
`lib/timelineView.ts`): the smallest step from single frames to hours whose
labels are ≥ 64 px apart, minor ticks as one repeating pattern, memoised so
playback updates never re-render it (52 timeline nodes at any clip length),
plus an overview bar of the whole clip. Zoom (pinch, Ctrl/⌘-wheel), scroll
(trackpad, ruler drag, overview) and follow-the-playhead came with it.
Tests: `tests/timelineRuler.test.ts`.

**Not verified:** YouTube sources (unreachable from the dev sandbox) and real
phones (Chromium touch emulation only).

**Severity:** moderate (misleading ruler on any zoomed timeline).

## 038 — Motion Layer: dragging the playhead ball moved a frame stop instead — RESOLVED

**Symptom (owner, real phone, testing PR #86).** In the Motion Layer, dragging
the big playhead ball to a new time and letting go did not leave it there; the
time position could not be changed.

**Verified root cause (main and PR #86 alike — not a timeline V1 regression).**
The playhead ball in `components/PreciseTimeline.tsx` takes no pointer events,
and the Motion Layer frame-stop balls (14 px, z-index 9) are drawn on top of
it. Whenever the playhead rests on a frame stop — a freshly opened Motion Layer
(playhead at 0 on Frame stop 1, which is the selection start) or right after
tapping a frame stop — a press on the ball grabbed the FRAME STOP. The drag
then moved the frame stop (`onSampleMarkerChange`: clamped to the selection,
neighbours pushed by `enforceMonotonicSampleTimes`) and the video only
followed it. Reproduced in Chromium on both builds, mouse 1440 px and touch
390 px: with the selection ending at 40 %, the ball stopped at the selection
end instead of where it was dropped, and a plain ball drag from 0 to 70 %
piled Frame stops 1–4 onto 0:06. Stack traces of every `currentTime` write
showed the seeks coming from the frame-stop handlers, not the scrub.

**Not reproduced:** the exact "lands at 0 on release" seen on the phone. No
code path writes 0 on release on either build. The likeliest reading is the
fresh-Motion-Layer case above (the grabbed stop is Frame stop 1, at the
selection start = 0), but the release-at-0 itself was not seen in emulation.

**Fix.** A press on the ball over a frame stop is undecided until it moves or
is held (`lib/timelinePress.ts`): moving past 6 px first hands the pointer to
the playhead scrub (the ball follows the pointer and stays where it is
dropped, at any zoom; view and selection untouched); holding still for 400 ms
first grabs the frame stop (shown enlarged) for the old drag-to-adjust; a tap
still selects it. Frame stops not under the ball drag at once, as before.
Tests: `tests/timelinePress.test.ts`.

**Severity:** high (the Motion Layer's main control did not work on a phone).

## 039 — Dragging one frame stop shoves or crosses its neighbours — OPEN (pre-existing)

**Symptom.** Dragging a frame stop right past the next one pushes every later
stop along with it (they pile up at the drop time); dragging it left past the
previous one leaves the stops out of order (seen: "1 @0:00 | 2 @0:02 |
3 @0:00").

**Root cause.** `onSampleMarkerChange` in `app/analysis/page.tsx` runs the
override through `enforceMonotonicSampleTimes` (forward-only push) but also
writes the raw time into the draft frame (`updateStroFrameTime`) and seeks
to the raw time, so the two disagree when a stop crosses a neighbour.

**Proposed fix.** Clamp a dragged stop between its neighbours (previous +
gap, next − gap) before writing either place. Needs owner approval (changes
how stops can be re-ordered).

**Severity:** moderate (silently rearranges the coach's frame stops).

## 040 — Racket detector preload: unhandled "Failed to fetch" when the model cannot download — OPEN (pre-existing)

**Symptom.** `TypeError: Failed to fetch` as an uncaught page error a few
seconds after loading a clip (main and PR #86 alike), whenever the COCO-SSD
model host is unreachable (the dev sandbox's proxy; an offline phone).

**Root cause.** `preloadRacketDetector` in `lib/racketCocoDetect.ts` calls
`void getRacketDetectorModel()` with no `catch`, and the rejected promise stays
cached in `modelPromise`, so racket detection fails for the rest of the
session even after the network returns.

**Proposed fix.** Catch in the preload, and clear `modelPromise` on failure so
the next detection retries.

**Severity:** low (log noise; racket detection unavailable until reload when
the first download fails).

## 041 — Admin pages: dark text on dark cards in the light theme — OPEN (pre-existing)

**Symptom.** In the light theme, `/admin/invoices` (and `/admin/affiliates`,
which copies its styles on purpose) shows near-black text on dark-grey cards:
readable, but low contrast. Seen in Chromium on a local dev server, 2026-10-17.

**Root cause.** The cards use a fixed dark background
(`rgba(15, 15, 18, 0.65)`) while the text colour follows the theme
(`app/admin/invoices/page.tsx`, the `card` style at the end of the file).

**Proposed fix.** Use the theme's panel token for the card background (or a
fixed light text colour) on both admin pages. Admin-only, so low priority.

**Severity:** low (admin-only, still readable).

## 042 — Metrics export: real file is ~35–40% smaller than the size estimate in Chromium — OPEN (found with the export panel)

**Symptom.** Metrics → Generate shows "≈ X MB (approximate)"; in the test
Chromium the exported file came out at 0.59–0.66× of it, on every preset and
on a high-detail clip too (2026-10-17, production build, `next start`):

| Clip / range | Preset | Estimate | Real |
|---|---|---|---|
| 1080p tennis, 18 s | 1080p (8 Mbps) | 18.3 MB | 10.8 MB |
| 1080p tennis, 18 s | 720p (4 Mbps) | 9.3 MB | 6.0 MB |
| 1080p tennis, 18 s | Original (8 Mbps) | 18.3 MB | 10.9 MB |
| 1080p tennis, 4–13 s | 1080p | 9.1 MB | 5.4 MB |
| 1080p high-detail (mandelbrot), 12 s | 1080p | 12.2 MB | 8.0 MB |

**Root cause.** The estimate is the recorder's TARGET bitrate × duration
(`lib/exportEstimate.ts`). This Chromium has no H.264 encoder; MediaRecorder
writes VP9 (in MP4) with a software encoder that undershoots the requested
`videoBitsPerSecond` (a bare canvas recording at 8 Mbps gave 4.3 Mbps;
`videoBitrateMode: 'constant'` made no difference). The files are complete
(540 frames / 18.0 s for an 18 s range), so it is the encoder, not lost frames.
Real Chrome (H.264) and Safari (hardware H.264) were not measured.

**Fault assessment.** The estimate formula is as specified; the 25 % accuracy
target is not met in the test browser.

**Proposed fix.** Measure the same clip on an iPhone (Safari) and desktop
Chrome; if they also undershoot, scale the estimate per encoder (or show it as
"up to ≈ X MB"). Needs owner approval (changes the number coaches see).

**Severity:** low (the estimate is high, never low: files are smaller than
announced).

**Holds (2026-10-19).** The estimate counts hold seconds at the full bitrate. A
held frame does not change, so it costs far less: on a 9 s real clip with three
5 s holds the file was 4.29 MB vs 2.71 MB without (the 15 s of holds added
1.57 MB, ≈ 0.84 Mbps against ≈ 2.4 Mbps while playing), estimate 12.4 MB. Same
direction as above (high, never low).

## 043 — Crop/trim export: `webmFixDuration` parses MP4 output on the main thread — OPEN (pre-existing)

**Symptom.** At the end of every `exportEditedVideo` render (Recording Hub
crop/trim and the Metrics export) there is one main-thread long task of
60–800 ms (Chromium, 4.8–10 MB outputs; intermittent size).

**Root cause.** `lib/cropExport.ts` always runs `webmFixDuration` on the
recorded blob, also when the recorder wrote MP4. A CPU profile attributes the
task to the library's `setSource/updateBySource` (EBML parser) plus GC.

**Proposed fix.** Skip `webmFixDuration` when the recorder's MIME type is MP4.
Touches the Recording Hub path, so it needs approval.

**Severity:** low (one hitch when the export finishes; nothing is moving).

## 044 — Stale copy after Generate became the export panel — OPEN

**Symptom.** Two texts still describe the old Generate:
`components/ToolPalette.tsx` (the Generate row's tooltip: "Capture every phase
and replay the stroke in slow motion") and `components/tours/playersTour.ts`
("Metrics → Generate builds a report"). The report is now one tap further:
Generate → Snapshot images & report (renamed from "Snapshot report" with the
snapshot holds).

**Root cause.** Out of the file list allowed for the export-panel change.

**Proposed fix.** Tooltip: "Export the video or a section"; tour step:
"Metrics → Generate → Snapshot images & report builds a report".

**Severity:** low (wording).

## 045 — Metrics section default covers only the first snapshot — OPEN (pre-existing)

**Symptom.** Create snapshots at 3 s and then 8 s: the Metrics section (the
timeline handles, and the export panel's *Use section*) is 2.7–3.3 s, not the
2.7–8.3 s "snapshot span" the code comment promises. Seen in Chromium on the
export-panel branch, 2026-10-17; the code is unchanged from main.

**Root cause.** `app/analysis/page.tsx` (the effect after
`handleReplaySnapshots`, "Default the metrics section to the snapshot span")
only fills the section while it is null (`prev == null ? … : prev`), so the
first snapshot fixes it and later snapshots never widen it.

**Proposed fix.** Widen the default with each new snapshot until the coach
drags a handle (`metricsTrimUserAdjusted`). Changes what Replay/Record video
cover by default, so it needs approval.

**Severity:** low (the coach can drag the handles; *Whole video* is the
export default).

## 046 — Metrics export has no AngleMotion watermark — FIXED (export-panel fixes)

**Symptom.** Files exported from Metrics → Generate (the export panel, PR #92)
have no watermark; the analysis canvas shows it bottom-left of the video.
Seen comparing the screen and exported frames in Chromium, 2026-10-17.

**Root cause.** `lib/videoWatermark.ts` states the watermark "has to appear on
the live analysis canvas AND inside every recorded/exported video". The old
Generate recording captured the canvas, which draws it (`Canvas.tsx` render
loop, `drawVideoWatermark`). The export panel renders the video itself
(`lib/cropExport.ts`) and never calls `drawVideoWatermark`.

**Fault assessment.** Gap introduced by PR #92 (the export panel); the overlay
PR did not change it (out of its allowed scope).

**Proposed fix.** In the panel's export, always pass a `drawOverlay` that ends
with `drawVideoWatermark(ctx, ow, oh)` (no area: bottom-left of the frame, the
recording-canvas case the function documents). Needs approval (changes every
Metrics export).

**Severity:** moderate (branding contract; no functional loss).

**Fixed.** `MetricsExportPanel.tsx` now always passes `drawOverlay` and ends it
with `drawVideoWatermark(ctx, w, h)` (no area: bottom-left of the frame), after
the skeleton/drawings and after the render check's frame sample. The logo is
warmed when the panel opens. Measured (Chromium, production build), skeleton
and drawings both off: the mark is in the first and last frame at 720p, 1080p
and Original, landscape (1280×720, 1920×1080, 960×540) and portrait (720×1280,
1080×1920), inside the box the function computes, and nothing else in the
frame changed. Cost: 0.02–0.1 ms per frame (1280×720 … 3840×2160). The
Recording Hub path (`cropExport` without `drawOverlay`) is untouched: same
MP4/VP9 1280×720 + Opus, 3.11 s.

## 047 — Exporting right after turning the Skeleton on drops ~45% of frames (test browser) — OPEN (pre-existing)

**Symptom.** Metrics export of an 18 s 1080p clip, started within seconds of
turning the Skeleton on: 277–316 frames instead of ~540 — on main and on the
overlay branch alike. Skeleton off: 516–540. Skeleton on, export started after
waiting 60 s: 539.

**Root cause (partial).** Start-up work that turning the Skeleton on triggers in
the background competes with the export on this 4-core, GPU-less browser. The
main thread is not the cause (a CPU profile shows only the export's own
`drawImage`; the analysis canvas does not repaint during the export). Not
measured on a real phone or desktop browser.

**Proposed fix.** Measure on real devices first. If it reproduces, wait for the
pose model to be ready (or show "Preparing…") before an export starts.

**Severity:** low–moderate (choppier file, only right after enabling Skeleton).

## 048 — 4K Original export runs at ~6 fps in the test browser — OPEN (pre-existing, environment)

**Symptom.** A 6 s 3840×2160 clip exported at Original gives 35–39 frames on
main and 36–37 on the overlay branch (36 with skeleton + drawings on).

**Root cause.** Software 4K decode + `drawImage` in a GPU-less headless
Chromium; the overlay adds nothing measurable. Real phones decode 4K in
hardware — not measured here.

**Proposed fix.** None until measured on a real iPhone/Android. If real devices
also drop, cap Original at 1080p on phones.

**Severity:** unknown (environment-specific until measured).

## 049 — AI measurement overlays do not follow the player during tracked playback — OPEN (pre-existing, by code)

**Symptom (expected from the code, not seen at runtime).** With an AI Track and
measurement overlays on, the shoulder/hip/racket/foot arrows stay where the
last live pose put them while the video plays.

**Root cause.** The overlays draw from `latestKeypointsRef` (`Canvas.tsx`,
"Live measurement overlays"), but once any track exists the live pose loop
stops sending frames ("tracks own the display"), so that ref is not updated.
The skeleton itself uses the track (`lookupBakedPose`).

**Proposed fix.** Draw the overlays from the same pose the skeleton uses (the
baked pose when there is one). Touches skeleton/measurement display: needs
approval and a runtime repro first. This is why the export leaves them out.

**Severity:** moderate if confirmed.

## 050 — The export's skeleton analysis (AI Track pass) freezes the UI in bursts — OPEN (pre-existing pass)

**Symptom.** While the Metrics export analyzes the skeleton (the existing AI
Track pass), the page stutters: in the test browser (4 cores, no GPU) 57–75 long
tasks per analysis, the longest 1.4–1.5 s, and one ~6 s gap at the start (model
load). Rendering afterwards is smooth (0–1 long tasks). Cancel still answered
in 66 ms (it is checked between frames).

**Root cause.** `runPrecisionPass` (`app/analysis/page.tsx`) runs MediaPipe
(`lib/mediapipePose.ts detectPosePrecise`) on the MAIN thread, one frame at a
time; the same happens when AI Track is started from the toolbar. Its
internals are frozen, so the export reuses it as is.

**Proposed fix.** Run the precision detection off the main thread (a worker
for the precise pass), or yield to the UI between frames. Both change
`runPrecisionPass` internals or the pose-worker architecture: needs approval.
Measure on a real iPhone first (GPU delegate) — the bursts may be much shorter.

**Severity:** moderate (UI stutters during the analysis step only).

## 051 — Phone: "the app zoomed in after drawing and would not come back" — NOT REPRODUCED

**Reported.** Vin, real device, while testing PR #93: after drawing on the
canvas the app was zoomed in and did not return, so the export could not be
reached.

**What was checked (Chromium, 375 px touch, main and PR #93 alike).** Line,
angle (3 quick taps), text, pen and a double-tap on the canvas: no zoom
(`visualViewport.scale` 1, video transform unchanged). A two-finger pinch on the
canvas zooms the canvas — a 96 px finger spread jumps straight to the 500%
maximum — and the ⌂ button (title "Reset zoom & pan") brings it back on both.

**Candidates (not confirmed).** (1) A second finger or palm during a draw
stroke triggers the canvas pinch zoom (`Canvas.tsx` touch pinch →
`applyZoomAtRef`); the way back is ⌂, at the right edge of the video, which is
easy to miss. (2) iOS Safari's PAGE zoom (focus on a text field under 16 px —
the Text tool's box uses the chosen text size; default 24 px — or a
double-tap on an element without `touch-action: manipulation`): the canvas
swallows pinch gestures (`touch-action: none`), so there is no way to pinch the
page back out. Playwright cannot emulate iOS page zoom.

**Needed to decide.** Device + browser, and whether the whole page (toolbar too)
was zoomed or only the video with a "%" label in its corner. Fixes would be in
Canvas zoom code or `app/layout.tsx` viewport — outside PR #93's files.

**Severity:** high if (2) on iPhone (blocks the export).

## 052 — Phone: exported skeleton frozen when the export analyzed it (no prior AI Track) — FIXED (PR #93, confirmed on Vin's iPhone)

**Reported.** Vin, real device, PR #93: Metrics export, Include skeleton on, no
prior AI Track. The panel analyzed the range ("Analyze skeleton + export") and
the video had a skeleton that stayed in one position. The same clip exported
correctly after AI Track from the toolbar.

**What was measured (Chromium, 4 cores, no GPU, dev build; same 2 s clip).**
Every pass sample was tapped (`addBakeSample(t, kps)`) and the stored track
read back with `getBakedPoseAt`:

| Path | Poses | Spacing | Distinct poses | Joint shift from first pose, over 2 s | Time |
|---|---|---|---|---|---|
| Panel, on-screen skeleton never on | 58 (0.05–1.95 s) | 1/30 s | 58 | 0 → 19.9 px | 89 s pass |
| Panel, on-screen skeleton on | 58 | 1/30 s | 58 | 0 → 19.9 px | 87 s |
| Toolbar 0.5× (fast) | 61 (0–2 s) | 1/30 s | 41 | 0 → 20.3 px | 104 s |
| Toolbar 0.25× (balanced, the dialog default) | 91 (0–2 s) | 1/45 s | 60 | 0 → 21.6 px | 339 s |

All four used MediaPipe (`engine=mediapipe-full` in the pass log), the time
base is the analysis video's `currentTime` (absolute media time) in every case,
and the export reads it live per frame (`drawExportOverlay` → `lookupBakedPose(
video.currentTime)` of the hidden export video; only the video box, strokes and
angles are captured once, after the analysis). The exported files' joint dots
matched the stored track within 0.6–2.2 px and moved with it. So in this
browser the panel's track is not frozen, and the panel and the toolbar store the
same kind of track; only the tier differs ('fast' = FULL model at 30 fps,
balanced = HEAVY at 45 fps, about 3.3× slower here).

**What a frozen track would be, by code.** `detectPosePrecise` runs MediaPipe
on the analysis `<video>` after each seek. If the picture it reads never
changes (a frame the browser does not repaint after a seek), every sample gets
the same pose: a stored track with motion 0 — exactly the symptom. A pass that
finds the player on very few frames gives a few samples spread over the range,
and `lookupBakedPose` snaps to the nearest one across gaps over 0.5 s: a skeleton
that stands still and jumps now and then.

**Device-only candidates (not confirmed).** (1) During the panel's analysis the
analysis video sits under the panel (fixed, 85% black) while it is seeked;
WebKit may not hand a repainted frame to WebGL for a seeked paused video in
that state (the page already notes that hidden videos can block Safari frame
delivery, `app/analysis/page.tsx hiddenDecoderVideoStyle`). (2) The tier: the
panel uses 'fast' (the FULL landmarker, shared with other live features),
the toolbar's default is balanced (HEAVY).

**Device result (Vin).** AI Track from the toolbar at 0.5× — the same 'fast'
tier the panel uses — tracks the same clip correctly; the panel's analysis
still exports a frozen skeleton. So the tier is not the cause; how the pass
runs is. The only differences in page state (checked in code: both call
`runPrecisionPass` on the same `videoRef`, paused, same lock and mode; the
pass reads no skeleton display flag) are the panel itself — a fixed,
full-screen dialog (85% black) covering the video being seeked — and its
unloaded preview `<video>`. iOS Safari is known here to stop delivering frames
of a video it does not show (`app/analysis/page.tsx hiddenDecoderVideoStyle`).

**Fix (PR #93, third round).** While the skeleton is analyzed the panel is a
compact bar docked outside the video's picture (`dockAnalysisBar`); the video
is fully on screen and uncovered, as with the toolbar's AI Track. Measured in
the test browser: 0 of 49 points of the picture covered, opacity 1, nothing
hidden in the video's parents, at 375×812 and 1440×900, landscape and portrait
clips (a portrait clip on the phone needs the compact bar, without its note).

**Why the first guard (c8c72033) let a frozen skeleton through.** It refused
only a pose that never moved at all (≥ 0.1% of body size from the first pose)
or too few poses. Reproduced holes (tests in `tests/exportOverlay.test.ts`):
(1) a fresh picture only now and then — the pose repeats exactly between
jumps (motion 155%, passed); (2) a stale picture with detector noise — a pose
that jitters ~0.5% and never follows the player (passed). Whether Vin's
preview already had c8c72033 (Vercel preview ready at 11:44 UTC, 18 Oct) is not
known here; either way these holes are closed now:
- before rendering, `checkAnalyzedTrack` also refuses a pose repeated exactly
  from frame to frame on more than 60% of the range (simulated: refused,
  "repeated 86%");
- while rendering, `skeletonFollowsVideo` compares the picture around the
  skeleton with the skeleton's own move every 0.25 s and stops the export when
  the picture moves and the skeleton does not (simulated stale picture + noise:
  stopped 1.5 s into the render, "video moved 6×, skeleton still 6×").
The failure line carries the numbers (poses, poses/s, motion, repeated share,
video-moved / skeleton-still counts) so a phone screenshot says which case it was.

**Confirmed on the device.** Vin, iPhone, preview of ac8f6aed: the export with
no prior AI Track now exports a skeleton that follows the player.

**Left over → partly fixed.** When the panel's own analysis fails a check, finds
no player, or is cancelled, and there was NO track before it started, the panel
now clears every track (`clearBakedTrack`, the only Canvas call available) and
the toolbar returns to idle; the Skeleton switch is usable again. With an
earlier AI Track nothing is removed (Canvas can only clear all tracks) and the
error line says so. Removing just the failed part still needs a Canvas method:
needs approval.

**Severity:** high on the affected device (a wrong skeleton in a shared video);
now blocked by the self-check instead of exported.

## 053 — AI Track samples land on the previous frame about a third of the time (test browser) — OPEN (pre-existing pass)

**Symptom.** Found while dumping tracks for 052. Toolbar AI Track stores the
same pose for two consecutive sample times on 20 of 61 samples (0.5×, 2 s clip)
and 90 of 271 (0.5×, 9 s clip); 31 of 91 at 0.25×, where 45 samples a second on
a 30 fps clip repeat frames by design. The export's analysis of the same clips,
whose sample times start 0.05 s in, stores 0 repeats (58 of 58, 268 of 268).

**Likely cause (not proven).** The toolbar pass seeks to
exact frame boundaries (`start + k / 30` with start 0) and the browser can
show the previous frame for a time that sits on a boundary; the sample is
stamped with `video.currentTime` (the requested time), so the pose is one frame early. Mid-frame times
do not hit it.

**Proposed fix.** Seek to the middle of each frame (`+ 0.5 / fps`) in
`runPrecisionPass`, whose internals are frozen: needs approval. Check on
Safari and Chrome on devices first.

**Severity:** low (a one-frame lag on a third of samples, smoothed).

## 054 — For 1–2 s after Cancel during the export's analysis, the Skeleton switch reads "AI Track is running" — FIXED (export-panel fixes)

**Symptom.** Cancel returns the panel to idle at once (137 ms, production
build), but the pass stops only after the frame it is detecting (~1.4 s in the
test browser). Until then the page's AI Track state is still "running", so the
Skeleton switch shows "AI Track is running. Wait for it to finish, then
export." and is off; Export in that moment would save the video without the
skeleton.

**Root cause.** `skeletonExportStatus` treats any running pass as someone
else's once the panel is no longer analyzing; the cancelled pass is the
panel's own, winding down (`runPrecisionPass` checks the abort flag between
frames).

**Proposed fix (panel only).** Remember that the running pass is the panel's own
until `analyzeRange` settles, and show "Stopping the analysis…" with Export
disabled meanwhile.

**Severity:** low (a short, self-clearing state).

**Fixed.** Cancel during the panel's own analysis sets a "stopping" flag until
`analyzeRange` settles: the switch reads "Stopping the analysis…" and Export is
disabled (`skeletonExportStatus(…, stopping)`). Measured at 375 px: "Stopping
the analysis…" 6 ms after Cancel, back to normal at 1.4 s, "AI Track is
running" never shown.

## 055 — Uploaded video black until Play (iPhone) — FIX IN PR #94, to confirm on the device

**Symptom.** After uploading a video in /analysis the video area stays black
until Play.

**Root cause (code + platform behaviour; not reproducible in the test
browser).** The only thing that asks for a first frame is a tiny seek
(`currentTime = 0.001`) in the `loadeddata` handler, gated on
`readyState >= 2` (`app/analysis/page.tsx`, the `videoSrc` effect). Desktop
Chromium decodes the first frame on its own (`preload="auto"`), fires
`loadeddata`, and shows the picture — measured: brightness 128–132 of 255 in
the picture at 0.4 s after upload, 1280 px and 375 px. iOS Safari does not
decode a frame of a paused, never-played video: it stops at HAVE_METADATA, so
`loadeddata` never fires, the seek never runs and nothing is painted. With the
page's `loadeddata` listeners suppressed in the test browser (that iOS
condition), the seek indeed never ran (time stayed 0.000).

**Fix.** The same tiny seek also runs on `loadedmetadata` (only while paused at
0), for slot A and slot B. Every way a file enters /analysis (upload, drop,
Recording Hub / capture result, stream URL) goes through these effects; YouTube
and embeds do not. Measured after the fix: the seek runs at `loadedmetadata`
with or without `loadeddata`; one seek only; play, pause, seek and frame-step
unchanged; re-upload shows the new first frame; the skeleton overlay draws.

**Severity:** high on iPhone (the coach sees nothing after upload).

**Round 2 (PR #94: the seek alone did not fix Vin's iPhone).** The first-frame
code is now `lib/firstFrame.ts ensureFirstFrame`, layered, each step checked
with readyState ≥ 2 and a drawImage that paints pixels, stopping at the first
that works: S2 media fragment `blob:…#t=0.001` on the element's src (state,
revoke and the export keep the raw URL); S3 preload="auto" (already set on
both analysis videos, so no extra `load()`); S1 the seek to 0.001 on
loadedmetadata; S4 "prime": muted play() → pause() → seek back to 0.001, with
the play/pause/playing/timeupdate/volumechange events of that play swallowed in
the window's capture phase so no app listener runs (pose loop, playback UI,
A/B sync, return-to-live), muted restored; S5 the first tap on the video panel
retries S1 + S4 inside the gesture. `webkit-playsinline` added next to
`playsInline`. The paint switch, Canvas and the pose worker are untouched.
`/analysis?vdebug=1` shows a read-only box with the video's events, state and
which strategy ran and how it ended; nothing renders without the flag.

**Measured (Chromium, production build).** Plain: stops at S1 as before.
Simulated iOS (readyState held at 1 until the video really played, page never
sees loadeddata/canplay): S1 fails, S4 decodes the frame. With play() also
rejected without a gesture: S1 and S4 fail, the box says it waits for a tap,
the tap decodes it (S5). In both, the prime's play/pause reached the window
(positive control) but no listener on the element; the Play/Pause button kept
one look (a real play adds the second); muted restored; video B not started.
Play/pause/seek/frame-step, re-upload and the skeleton overlay unchanged.

**Round 3 — regression: "Could not load this video file" (Vin's iPhone, Chrome
for iOS / WebKit, PR #94 preview).** Uploading from the camera roll failed.

*Root cause (by code + simulation; WebKit not available here).* Round 2 put a
media fragment on the upload's blob URL (`src="blob:…#t=0.001"`, S2). It was the
only change to how the file LOADS; everything else ran after metadata. When a
blob URL with a fragment is refused, the element fails with MediaError 4 at
readyState 0, and the page's `error` handler shows exactly that message
(`app/analysis/page.tsx`, slot A effect). Reproduced in Chromium by making any
fragment-carrying blob src fail: same message, same state (rs 0, ns 3, code 4).
The other strategies were checked: S3 called `load()` only if `preload` was not
"auto" (never on this path); S1/S4/S5 run only after metadata and never touch
the src; nothing else assigns the src (React sets it once).

*Fix.* The src is the raw URL again, set once, as on main (fragment helper
removed). S3 removed: nothing writes `preload` or calls `load()`. Kept: S1 seek,
S4 muted prime, S5 tap retry, only on an element with metadata and no error,
each wrapped in try/catch. Safety net: an `error` after one of these touched a
video that HAD reached readyState ≥ 1 is ignored (logged under ?vdebug=1); any
other error is shown exactly as on main. The ?vdebug=1 box sits below the iPhone
status bar (`safe-area-inset-top`; the page draws under it with
viewport-fit=cover, which likely hid the box at `top: 4px`) and is also shown
inside the "Could not load" panel, with MediaError code + message,
readyState, networkState, src type (blob/stream, "#frag" if a fragment), how
many times the src was set, and the last strategy.

*Measured (Chromium, production build).* With fragment blob URLs forced to
fail: the upload now loads (rs 4, src set once, no fragment), first frame by S1.
A synthetic `error` after S1 ran: ignored, no message. A corrupt file: the same
message as main (rs 0, code 4), with the diagnostic in the panel. iOS
simulations as in round 2: S1 / S4 / tap still give the frame; muted restored,
pose worker not started (0 messages), video B not started. Upload, re-upload,
play/pause/seek/frame-step and the skeleton behave as on main.

## 056 — Arrow keys on the export trim bar also frame-step the analysis video — FIXED (PR #97 round 2)

**Found:** 2026-10-19, testing snapshot holds (Chromium, production build).

**Symptom.** With a trim handle focused in Metrics → Generate, each ArrowLeft /
ArrowRight moves the handle AND steps the analysis video behind the panel one
frame (10 presses: 5.5 s → 5.83 s). In SNAPSHOT mode that takes the playhead off
the snapshot, so the page leaves the snapshot (its edits are saved first, so
nothing is lost) and the Drawings switch changes from the snapshot line to "No
drawings on the video" while the panel is open.

**Root cause.** `components/TrimRangeBar.tsx` `onKey` calls `preventDefault()`
but not `stopPropagation()`. The frame-step shortcuts listen on `window`
(`components/PlaybackControls.tsx:100-114`, `components/PreciseTimeline.tsx:868-874`)
and only skip INPUT/TEXTAREA targets, not a `role="slider"` div or an open modal.

**Fault assessment.** Pre-existing since the trim bar (PR #92); not caused by
the holds. Pointer/touch trimming is not affected (phones are unaffected).

**Proposed fix.** In `TrimRangeBar` `onKey`, call `e.stopPropagation()` when a
key is handled (one line; the shortcuts are bubble-phase `window` listeners).
Needs approval (outside this task).

**Severity:** low (keyboard only; desktop).

**Fixed (PR #97 round 2).** The export dialog stops every key except Escape from
propagating (`onKeyDown` on the dialog root), so neither the trim arrows nor
Space on a focused button reach the page's window shortcuts. Measured: 10 arrow
presses on the trim start, main video stayed at 2.500 s, SNAPSHOT mode kept.

## 057 — Snapshot holds on iPhone: "Export produced an empty file", media t stuck at 0.000, drift — FIX IN PR #97 round 3, to confirm on the device

**What.** A hold pauses the detached, hidden export `<video>` and seeks it to
the snapshot's time (`lib/cropExport.ts startHold`). On Vin's iPhone (vdebug
log), the media time read 0.000 during the hold, the audio drifted −1.21 s,
and one export ended with "Export produced an empty file".

**Root cause (code read + Chromium mock; the iPhone itself not measured).**
Three gaps in the pre-fix code:
- the hold was painted only from the paused video (`paint` needs
  `readyState ≥ 2`), so a video that drops its frame paints nothing for the
  whole hold;
- `play()` after the hold was called once and never checked, so a rejected or
  ignored `play()` left the video paused for the rest of the render, with
  audio running on (the drift);
- only a 0-byte file was refused, so a render that painted nothing could
  "succeed".

`holds.mjs IOS=seek` makes the hidden video in Chromium ignore seeks while
paused, read t=0.000 with no decodable frame while paused, and reject the
first `play()` after each pause. On the pre-fix build the file has 1.55 s of
video (48 frames, stopping just before hold 1) under 18 s of audio, with no
holds. `IOS=dead` (never a decodable frame) gave a 124 KB "successful" file
with 0 painted frames.

**Fix.**
- The hold paints a copy of the frame taken when it starts, or the last frame
  drawn. It is replaced by the exact frame only if the seek lands
  (`holdSeekLanded`), and the seek is never retried.
- After the hold, a video that lost its place goes back to the hold's time
  (`holdResumeSeek`). `play()` is retried every 0.5 s until media time moves
  (`resumeAction`), and after 4 s the export stops with a clear message.
- The Metrics export refuses a render with no painted frame (after 4 s, or at
  the end) with "Export failed: no video frames were recorded…"
  (`emptyExportError`).
- Progress uses the hold's time while the video's clock is not trusted.

Measured on the fixed build: see the PR #97 round 3 report.

**Check on a phone.** Export with two snapshots and ?vdebug=1:
- each hold shows the snapshot's frame (or one frame from it) with its
  drawings and pose;
- the video continues after each hold;
- the log shows "seeked" or "holding the last drawn frame", then "playing
  again";
- no empty file.

**Severity:** medium until checked on an iPhone.

## 058 — iPhone: "the app zoomed in and became unusable" — FIX IN PR #97 round 2, to confirm on the device

**Found:** 2026-10-20, Vin, PR #97 preview, Chrome for iOS, after drawing on a snapshot.

**Causes found in code (which one Vin hit is unknown until the ?vdebug=1 box is read):**
1. *Browser pinch on the video.* Only the precision tool blocked WebKit's page
   pinch on the canvas (`gesture*` / two-finger `touchmove`, components/Canvas.tsx
   precision effect); with any other tool a two-finger touch on the video zoomed
   the canvas AND could zoom the whole page. The viewport had no maximum-scale.
2. *Text tool focus zoom.* The label textareas used the label's own font size
   (often < 16 px at phone scale); iOS zooms the page on focusing such a field
   and does not zoom back.
3. *Canvas zoom jump.* The canvas pinch multiplies by finger distance ratio; two
   fingers landing 10 px apart (a drawing finger plus an accidental touch)
   reached the 500% cap with a small spread (measured 10→110 px: 500%).
4. *No reachable way back.* At 375 px with the iOS "Add to Home Screen" banner
   showing, the bottom-right − and ⌂ were under the banner (measured: tap on ⌂
   did nothing).

**Fixed.** (1) every tool: two-finger `touchmove` on the canvas and `gesture*`
started on the canvas are prevented (non-passive), /analysis gets
`maximum-scale=1, user-scalable=no` (other pages unchanged) and
`touch-action: manipulation` (no double-tap zoom); (2) the textareas render with
a ≥ 16 px font scaled down to the same size; (3) pinch distances below 60 px count
as 60 px (10→110 px now gives 183%; normal pinches unchanged); (4) while the
canvas is zoomed a "⌂ Reset zoom" pill shows top-left under the top bar (one
tap, measured on top and working at 375 px). The ?vdebug=1 box now shows the page
zoom (visualViewport.scale, innerWidth / vv.width), the canvas zoom %, touch /
gesture counts and the last pointerdown target.

**Not verifiable here:** a real WebKit page pinch (Chromium's emulated pinch did
not zoom the page on either build). **Severity:** high on iPhone.

## 059 — Metrics export: the Drawings switch was dead in SNAPSHOT mode — FIXED (PR #97 round 2)

**Symptom (Vin, iPhone).** With a snapshot selected and drawn on, only Skeleton
could be switched on; Drawings did nothing.

**Root cause.** By design in round 1: in SNAPSHOT mode the switch was disabled
("The drawings on screen belong to a snapshot…"), and its 28 px switch was the
only touch target.

**Fix.** Rule: Drawings = the drawings on screen (live, or the selected
snapshot's), on every frame outside holds; Snapshots = each snapshot's own
drawings + pose in its hold. Usable whenever there are drawings; disabled only
with none, saying so; the line states what is exported. Default on in LIVE, off
in SNAPSHOT. The whole row (≥ 44 px) toggles. Measured at 375 px: SNAPSHOT +
Drawings on → the snapshot's line in 100% of frames outside and inside the hold.

## 060 — Snapshot drawings in export holds misplaced on iPhone (drawingsBox from getVideoBounds) — FIXED (PR #97 round 2)

**Found while testing 059** at 375 px, device pixel ratio 2.

**Root cause.** PR #97 stored `drawingsBox` from Canvas `getVideoBounds()`, which
is BACKING-STORE px (× devicePixelRatio) with the canvas zoom/pan applied — it
exists for `captureFrame`'s crop. Strokes live in logical, unzoomed px
(videoBoundsRef). On a 1× desktop with no zoom the two agree, which is all round
1 measured. On an iPhone (2×/3×) the box was 2–3× too big: measured at 375 px,
dpr 2: getVideoBounds (0, 634.8, 630×354.4) vs the picture (0, 317.4, 315×177.2).

**Fix.** The page takes the box from `drawExportOverlay`'s capture (the box the
canvas and the export use; `strokesBoxOf`). Measured at 375 px, dpr 2, snapshot
line drawn at video px 300–500 / y 300: old build — not in the hold frame at all;
new — x 292–507, y 292–307.

**Class of mistake:** see LESSONS_LEARNED 019. **Severity:** high (every iPhone).

## 061 — Frozen skeleton in the export (Vin, iPhone) — OPEN: panel analysis DISABLED for the release (workaround: AI Track from the toolbar)

See the PR #97 round 2 report for measurements. Code read: outside holds the
skeleton is always the baked track by media time (`lookupBakedPose`, mode-free);
only the AI Track pass writes tracks and it detects from video frames. Chromium,
snapshot selected: the exported skeleton follows the stored track (with and
without a prior AI Track). Most likely iPhone path: the page zoom of 058 hid or
covered the analysis video while it was analyzed (the 052 mechanism: iOS hands
the detector a stale frame). Now: the analysis is not started on a zoomed page
(message), 058 prevents the zoom, and ?vdebug=1 logs, during the export, each
hold's seek and `play()` result, the media time once a second, and which pose
each second draws.

**Round 3 (Vin, iPhone, plain LIVE mode, Snapshots and Drawings off).** The
guard stopped the panel's analysis with "129 poses in 4.4 s · motion 0.0% ·
repeated 100%", while the toolbar AI Track at 0.5× (the same `'fast'` pass) on
the same video and phone worked. So the snapshot and zoom paths above were not
the cause.

*Round 3 hypothesis — DISPROVED on the device.* It was that the panel lacked
the toolbar's second reader of each seeked frame (the Skeleton pose loop's
`createImageBitmap`). Round 3 turned that pose loop on for the panel's
analysis, with a 15 s model wait. On Vin's iPhone (commit 0c937011) the panel
still gave "91 poses in 3.1 s · motion 0.0% · repeated 100%". It finished
faster than real time, and the export got slower. The Chromium mock had
"reproduced" the phone's numbers only because it was built from that same
hypothesis (LESSONS_LEARNED 020), so it proved nothing about WebKit. Round 3's
override and wait are removed.

*Round 4 (this change).*
- **Same handler.** The panel's analysis calls the toolbar AI Track's own
  handler: `runAiTrackRange`, which `handlePrecisionTrack` now calls with its
  own range. It runs `'fast'` (the toolbar's 0.5×) on each untracked part of
  the trim range. Toolbar behaviour and AI Track scope are unchanged.
- **Real Skeleton switch.** If Skeleton is off, it is turned on the way the
  toolbar's Skeleton button does (`setSkeletonOverlayPaused(false)` +
  `setSkeletonOn(true)`) and left on. The analysis starts once the page has
  rendered with it on; there is no model wait.
  (`lib/exportOverlay.ts analyzeForExport`, unit-tested.)
- Progress, Cancel and the frozen-track guard are unchanged.
- **On-device log (?vdebug=1, "analysis" lines, `lib/analysisFrameLog.ts`),**
  written by the panel's call from outside the pass. Every 10th seek it logs
  the video's currentTime, the mediaTime of the next frame the browser
  presents (requestVideoFrameCallback), and the wall time. It ends with
  "analysis end: N seeks in M ms". The log keeps up to 60 of these lines
  apart from its 80 others: with ?vdebug=1, the per-seek 'seeked' event lines
  of the first-frame diagnostics would otherwise push them out.
  - currentTime advancing while mediaTime stays put: the browser is not
    presenting the seeked frames.
  - Steps much shorter than a frame decode: the seek did not wait for a frame.

*Chromium (a functional check only, not evidence about WebKit):* see the PR
#97 round 4 report.

**Needs the iPhone.** Whether the panel's export now has a moving skeleton.
If not, the "analysis" vdebug lines from that run.

**Round 4 on the iPhone — still frozen; panel analysis disabled for the release.**
With the panel calling the toolbar's own handler and Skeleton on, the panel's
analysis took ~118 s on the phone and then failed the guard: "64 poses in 2.1 s
· motion 0.0% · repeated 100%". The vdebug line read "analysis end: 0 seeks in
118357 ms": the 'seeked' event the log listens to never fired on the phone,
while the toolbar AI Track on the same phone and video works. The cause is
unknown (the log shows only that the panel's pass saw no 'seeked' on that
element).

*Workaround (release).* `PANEL_SKELETON_ANALYSIS = false`
(`lib/exportOverlay.ts`; comment "V2/Saturday: panel analysis frozen on
iPhone"). The panel never starts its own analysis:
- a baked track covers the whole export range: "Include skeleton" is available
  and on by default, and the export uses the track (unchanged);
- otherwise (none, or only part of the range): the switch is off and disabled
  with "Run AI Track from the toolbar first, then the skeleton can be
  included.", and Export is plain "Export", producing a video without skeleton.

The analysis code (`analyzeRange` wiring, `runAiTrackRange`, the frozen-track
guard, the vdebug "analysis" lines) is kept, behind the constant, for V2.

## 062 — Status messages stayed over the video for good (PC and iPhone) — FIXED (status toast lifetimes)

**What.** The top status toast (`processingStatus` in `app/analysis/page.tsx`,
about 90 `setProcessingStatus` sites) only ever cleared "Skeleton ready…".
"AI Track ready…", "Loading precision tracking model…", "AI Track found no
skeleton…", "Skeleton analysis cancelled" and the rest stayed until another
message replaced them, taking space over the video.

**Fix (`lib/statusToast.ts`, one effect, no change to what the messages say).**
- info / success (ready, cancelled, cleared, plain guidance): gone after 4 s;
- errors (failed, could not, found no skeleton, stopped…): a ✕ close button,
  and gone after 10 s;
- progress ("…", "42%"): stays while an AI Track or a recording task runs;
  with none running it goes after 8 s;
- a 0.4 s fade before removal.
The kind is read from the message text (`statusKind`), so a new message needs
no change; a message that matches neither the finished nor the progress
patterns is treated as an error (close button, 10 s), so it cannot vanish
unread.

**Not changed (own lifetime, task-bound with their own Cancel/OK):** StroMotion
processing and region-select toast, the angle-differential prompt, the
recording pill and "Processing your video" banner, the embed-capture error
(`captureError`, with Retry), the foot-line "OK" notice, the on-video
"Preparing the skeleton…" hint (disappears when the model is ready), and the
export panel's own messages.

## 063 — Slow-motion export: not checked on an iPhone — OPEN (risk)

The Speed row (METRICS_EXPORT.md, "Speed and sound") records the hidden export
video at playbackRate 0.5 / 0.25 / 0.1. Unit-tested (speed snapping, output
length, estimate, progress, sound rule, fallback order, probe rule); not run in
a browser and never on iOS. Unknown on iOS Safari: whether a detached hidden
video honors rates below 0.5 (the probe is meant to catch a clamped or ignored
rate), whether the rate survives pause/seek around holds (every `play()` sets
it again), and whether the 1.2 s probe is long enough to tell. A wrong guess
costs a fallback to a faster speed with a note, not an empty file. Also not
measured: render time at 0.1× (real time: a 10 s range takes about 100 s) and
the phone's memory for a long slow export.

## 064 — Toolbar AI Track analyzed the whole video even with a section selected — FIXED (AI Track section choice)

**What.** `handleOpenPrecisionTrack` offered the timeline section only when
`metricsTrimUserAdjusted` was set (a handle drag). A section that came from
the snapshots' default span, or any case where that flag was not set, ran on the
whole video, which is slow, while the export needs only the section.

**Fix (`lib/aiTrackScope.ts`, `components/PrecisionTrackDialog.tsx`, the page's
open/confirm handlers).** The section is the timeline's `metricsSectionStart/End`
(the same range the Metrics export panel's "Use section" and its Skeleton
coverage check use, tolerance 0.05 s). When it is shorter than the video the
AI Track dialog shows "Selected section (0:SS)" (default) and "Whole video";
with no section, or one that spans the clip, it shows "Tracking the whole video"
as before. The choice is not remembered between runs. `handlePrecisionTrack`,
`runAiTrackRange` and `runPrecisionPass` are unchanged.

**Needs the iPhone.** Dragging the handles, running AI Track on the section,
then opening Generate: the Skeleton row should read "Skeleton ready." for the
panel's "Use section" range.


## 065 — After AI Track on a section, the export panel's "Include skeleton" could not be turned on — FIXED (PR #100 follow-up)

**What (Vin, preview of PR #100).** The panel started on the whole video. A
track made for the timeline section does not cover the whole video, so with the
panel analysis switched off (KNOWN_ISSUES 061) the Skeleton row was disabled
("Run AI Track from the toolbar first…") although AI Track had just been run.
The coach had to know to press "Use section". Reproduced in Chromium: after a
section track (2.59–6.02 s of a 9 s clip) the panel read 0:00–0:09, Skeleton off
and disabled; after "Use section" it read 0:02.6–0:06.0, "Skeleton ready."

**Fix.** The panel starts on the section when AI Track covered it and not the
whole video (`defaultExportRange`, `lib/aiTrackScope.ts`); otherwise it starts
on the whole video as before. And when a track covers only part of the range,
the row says so ("AI Track covers 40% of this range. Choose “Use section” if
you tracked a section, or run AI Track on this range…") instead of asking for a
track that is already there.

**Second report, same test: "AI Track went over the beginning of the video up
to the end of the selected area".** Not reproduced with both handles moved: the
pass visited only the section. See the PR comment for the case with only the
end handle moved.

**Round 2 (Vin, PR #100 previews, iPhone): "AI Track started from the beginning
again", the live skeleton "going crazy" during the pass, and on the second
preview "the page reloaded when I tried to generate".** Not reproduced.
Chromium at 375×812 with real touch events: both trim tabs drag, the dialog
offers "Selected section (0:02)" and "Whole video", and (desktop size) the pass
visits only the section. So the section reaches the dialog and the pass; what
differs on the phone is unknown. Added for the next phone run (`?vdebug=1`,
"analysis" lines): the range the run was asked for and the timeline section the
page held ("AI Track asked: section 2.587–6.021 s (balanced; timeline section
…)"), then every 10th seek of the pass (video time, presented frame time, wall
time). The live skeleton during a pass is the live pose detector reading each
stepped frame (not changed by these PRs); the reload is unexplained (iOS reloads
a tab that runs out of memory; the Generate render itself was not changed by
PR #100).


## 068 — Generate needed an AI Track, which cannot run on clips whose paused seeks are dead (iPhone)

**Symptom.** 720×1280 clip (first-frame strategy S4): paused seeks never fire
'seeked' (5 s, before and after the prime), so AI Track and the panel analysis
cannot work; live playback does, and the export itself plays the hidden video
in real time and draws frames. Generate still required an AI Track for the
skeleton.

**Change.** `lib/exportPose.ts`: while the export plays, the frame just painted
is copied to a scratch canvas (long side ≤ 512 px) and `detectFullPoseOnBitmap`
(stateless MediaPipe full, feet included — the AI Track bake's model) runs on
it. Detection is synchronous on the main thread, so: one at a time, the next
no sooner than 3× the median detection time (≥ 30 ms), the latest pose drawn
in between (moved on by its own velocity ≤ 80 ms, dropped after 0.6 s of media
time). Smoothing is causal (One Euro), so numbers are close to, not identical
with, an AI Track's centred smoothing. Hybrid: a covering AI Track is used as is
(`Canvas.drawExportOverlay` `opts.livePose` only fills where the baked track has
nothing). Snapshot holds are unchanged (their stored pose). The model is loaded
before the render starts (20 s limit, clear message); no pose in ~4 s of
rendering stops the export with a closable message. The paint loop passes the
export video as an optional 6th argument to `drawOverlay` (`runOverlay`);
exports without an overlay (Recording Hub) call nothing, as before.
`PANEL_SKELETON_ANALYSIS` stays false, the baked-track path and the panel
analysis code are untouched.

**Not measured (iPhone only).** Detection time and main-thread duty on the
device, the output frame rate with the skeleton on, how the live pose looks at
1×/0.5×/0.25×/0.1×, MediaPipe on a canvas copy from this export, memory with the
live landmarker also loaded. At 1× the pose lags by up to the detection time
(about 2 frames); the vdebug `export pose:` lines give detections, median ms,
frames that reused the last pose and the speed. Angle numbers and the data
column are still never exported.

## 069 — In-render skeleton detection froze the exported video and lagged (iPhone) — replaced by analysis by playing

**Symptom (PR #107 first version, 720×1280 S4 clip).** At 1× the skeleton did not follow the player; at 0.1× it followed but the exported video froze and stopped very often.

**Cause (from the design, not yet measured on the phone).** MediaPipe's `detect` is synchronous on the main thread; the export paints and records on the same thread, so every detection stalled the picture, and at 1× the pose was a detection late and sparse (068).

**Change.** The in-render detection (`LIVE_EXPORT_POSE`, `lib/exportPose.ts`, `Canvas` `opts.livePose`) is kept but OFF. Where no AI Track covers the range, `EXPORT_ANALYZE_BY_PLAYBACK`: a first pass (`lib/playbackAnalysis.ts`) plays the clip muted in a hidden element at 0.25× (stepping down to 0.15×/0.1× when more than a quarter of the frames find the detector busy), detects every presented frame (stateless MediaPipe full on a ≤1024 px copy) at the frame's own media time (requestVideoFrameCallback), and stores the poses through the existing bake storage (`finishBakeCapture`: centred, zero-lag smoothing, like an AI Track). The existing self-check (`checkAnalyzedTrack`) runs on it. The export then renders as it always did, with no detection in the render. No seeks except one to the start, so it does not depend on paused seeks. The result is an AI Track section: later exports and the on-screen skeleton use it. After the analysis the panel shows "Skeleton analyzed: N poses over X s in Y s (played at R×)" and vdebug has `export pose:` lines.

**Costs and limits.** Adds about 4× the range's length (plus start-up) to Generate. The playback analysis needs the tab visible (it pauses when hidden). Cancel keeps parts already analyzed. Not measured on a phone: detection time per frame, whether 0.25× holds, quality against AI Track.

**Open (069 follow-up): the exported skeleton was FROZEN on the iPhone (S4 clip).** Measured on the mp4: the torso centre stayed at one point (±0.3 px) over 8.5 s. Candidates (read from the code, not yet decided): (1) the detector was fed the same picture each time (slow-rate playback of a hidden element presenting no new frames; the export probes its rate, the analysis does not), (2) wrong timestamps in the stored track, (3) the export's own `video.currentTime` stuck during the render. Note: the self-check `checkAnalyzedTrack` runs on the analysis path and would fail a frozen stored track as 'static'; it did not stop this export, so either it did not run or the stored track moves and the freeze is in the render.

**Diagnostic added (no fix).** Log slot `trace` (own quota of 100 lines in the vdebug box): the rate set/read and rVFC support; per analyzed sample (first 5, every 15th, last 3) index, `meta.mediaTime`, `video.currentTime`, `presentedFrames`, a hash of the 32×32 grey scratch canvas the detector gets, a hash of a direct read of the video, a hash of six landmarks, the observed playback rate; a summary (samples, first/last time, distinct times/pixel/keypoint hashes); the stored track (samples, start–end); whether the frozen-track guard ran and what it returned (ok, reason, posesPerSec, motion, repeatShare); the stored lookup of the left wrist at 5 times; in the render, once a second the export `video.currentTime`, the lookup time and the left wrist from `lookupBakedPose`; and the render-time guard's steps/verdict. The panel shows one line after the export: "trace: pixel hashes N, keypoint hashes M, stored samples K, render clock moved yes/no". How to read it: pixel hashes ≈ 1 with distinct times → frozen input (1); pixel hashes vary but keypoint hashes ≈ 1 → detector/canvas upload; both vary but the stored lookups are constant → storage/timestamps (2); render clock "no" → (3).

**069 follow-up — iOS play() permission (iPhone, PR #107 with trace).** Analysis by slow playback WORKS on the S4 clip (101 poses, 101 distinct pixel and keypoint hashes; the frozen skeleton of the earlier run was not reproduced with the trace build). The failures were iOS refusing play() outside a tap: run 1 the analysis' play() threw NotAllowedError (0 samples); run 2 the analysis ran but the export started ~15 s later without a tap (export video paused, "no frame painted in 4000 ms"); run 3 (track already stored, export started straight from the tap) worked (clock moved, 233 frames, guard ok).

**Fix.** (1) When the skeleton must be analyzed, the analysis player is created and `play()` is called as the first thing in the Export tap, before anything is awaited (`openAnalysisSession`, `lib/playbackAnalysis.ts`; it uses the page's own video URL, so no fetch comes first, and it loops until the analysis takes over, so waiting for the model does not run it to the end). It is not paused between ranges. If play() is refused (`NotAllowedError`) the button reads "Tap to start the analysis" and the next tap starts it again (no failure message). (2) After the analysis the track is stored and the panel says "Skeleton ready - tap Export."; the render starts from the next tap (the first tap only analyzes; its button reads "Analyze skeleton"). (3) If the render's play() is refused (no frame painted in 4 s), the panel shows "Tap to retry the export" and the next tap renders again instead of a failure message. Detection, smoothing, the frozen-track guard, the trace lines, runPrecisionPass, drawSkeletonOverlay, the foot line, StroMotion and the Recording Hub are unchanged.

**Not measured.** Whether iOS keeps allowing the analysis player (started inside the tap) to keep playing for the whole analysis, and whether a refused play() always shows as NotAllowedError.
