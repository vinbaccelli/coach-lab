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

**Not fixed here.** Tokens were explicitly out of scope for the coach-profile
work. Three links on `components/coach/CoachPublicProfile.tsx` still carry the
accent as text ("See how it works", "Read on Trustpilot", "Read on Google"), left
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

## 004 — `coach_services` and `coach_links` do not exist in the production database

**Found:** 2026-09-05, same query.

**Symptom.** Every coach profile driven by the database renders with no services
and no links, silently.

**Verified root cause.** PostgREST returns
`PGRST205 — Could not find the table 'public.coach_services' in the schema cache`
for both tables. `lib/supabase/schema.sql` defines them, but that schema was
never fully applied to the production project. `app/coach/[slug]/page.tsx` reads
`servicesRes.data ?? []`, so a missing table degrades to an empty list with no
error surfaced anywhere.

**Fault assessment.** Environment/provisioning gap, made invisible by defensive
null-coalescing. The `PUT` handler in `app/api/coach-profile/route.ts` is also
affected: it deletes from `coach_services` without checking the returned error,
then inserts — so saving a profile that has any services should return a 500,
while a profile with none appears to save fine. **This means the profile editor's
save path is probably broken in production and nobody would have seen why.**

**Partially fixed (2026-09-06).** The `PUT` handler no longer swallows the
delete errors: a failure on `coach_services` or `coach_links` now returns a
descriptive message instead of an opaque 500, and `CoachProfileEditor` renders
it — previously `handleSave` had no `else` branch at all, so a failed save left
the button reading "Save" and told the coach nothing. The handler also validates
name, slug, tagline, bio and avatar URL lengths up front, and rejects a `data:`
URL in `avatar_url` (a raw image pushed into a text column, the classic silent
oversized-payload 500).

**Still outstanding.** The tables themselves are still missing from production.
Applying schema is Vin's call.

**Severity:** high — a shipped editor feature likely does not work.

---

## 005 — The static `PROFILES` map shipped fabricated Stripe URLs

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

## 006 — Coach profile photo upload fails silently

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

**Outstanding — needs a production migration, Vin's call.** The three policies
are written out at the end of `lib/supabase/schema.sql` under "Storage RLS
policies" and are **not applied**. Until they run, uploads still fail — but now
with a clear on-screen explanation instead of silence.

**Severity:** high — a shipped user-facing feature has never worked.
