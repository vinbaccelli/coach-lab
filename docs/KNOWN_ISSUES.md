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
(Numbered 022: 021 is taken on the guided-tours branch.)

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
(Numbered 024: 023 is on `claude/youtube-connect-fix`, 021 on the tours branch.)

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
