# Known issues

Defects found while working on something else. Recorded whether or not they were
fixed, and whether or not they are pre-existing — undocumented ≠ doesn't exist.

Format: symptom → verified root cause → fault assessment → proposed fix → severity.

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

## 007 — Light advertises $10 but Stripe charges $5

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
