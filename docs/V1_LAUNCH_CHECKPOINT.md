# AngleMotion V1 launch checkpoint — 2026-10-15

**Tag:** `v1.0` (annotated, "AngleMotion V1 launch day, 2026-10-15") on main at
`7cef44001dc774edb947c813cfad7301078b12ba` — "Tours: turn the guided tours on for
everyone (#87)".

**Production:** the latest Vercel production deployment of `anglemotion-v1`
(GitHub deployment 7075613044, 2026-10-14 19:49 UTC, state `success`) is that
same commit.

This is a snapshot, written from the code at the tag. It changes nothing.

---

## What is live at the tag

| Area | What ships | Where |
|---|---|---|
| Billing and checkout | Light, Pro and Academy at six EUR prices (monthly and yearly); checkout fails closed on a missing, archived, non-EUR or wrong-interval price; the site shows the Stripe price's own amount; the webhook re-reads the subscription and retries on a failed write. | `app/api/stripe/checkout/route.ts`, `app/api/stripe/webhook/route.ts`, `lib/billing/checkoutGuard.ts`, `lib/billing/livePrices.ts`, `lib/billing/webhookSync.ts` |
| Plan gating | Features gated by plan through `canUse()`; Academy seats (owner + 3) through `academy_seat_subscriptions()`. | `lib/entitlements*.ts`, `lib/useEntitlement.ts`, `supabase/migrations/20261006120000_academy_seats_ebooks.sql` |
| Invoicing | Italian e-invoice (FatturaPA) records for payments, the regime forfettario wording, `/admin/invoices` with preview, checklist and issue; refunds tracked. | `lib/billing/invoicing/`, `docs/INVOICING.md`, migrations `20261008…`, `20261009…`, `20261011…` |
| Guided tours | On for everyone (`TOURS_ENABLED_FOR_ALL = true`): welcome card on `/analysis`, the ? on every tour screen. | `lib/toursSwitch.ts`, `components/GuidedTour.tsx` (#66, #87) |
| Timeline stage 1 | Time ruler readable at every zoom, zoom (pinch, Ctrl/⌘-wheel), scroll (trackpad, ruler drag, overview bar), follow-the-playhead; the Motion Layer ball drag fix. | `lib/timelineView.ts`, `lib/timelinePress.ts`, `components/PreciseTimeline.tsx` (#86) |
| Trustpilot | Review Collector widget on the landing page, with a plain link fallback; one profile (`trustpilot.com/review/anglemotion.com`). | `components/TrustpilotReviewCollector.tsx`, `lib/trustpilot.ts` (#84, #85 privacy note) |
| Coach Life code | The "Add promotion code" field on Pro yearly and Academy yearly only. In Stripe (live, checked read-only 2026-10-15): coupon "Coach Life 50% — Pro & Academy yearly" (50%, once, Pro and Academy products) with the shared code `COACHLIFE50` (first-time customers, €299 minimum). **Still active and not yet deactivated:** the older single-use `COACHLIFE-001` (€150 off Pro yearly, forever). | `lib/billing/promoCodes.ts` (#88), `docs/STRIPE_LAUNCH_SETUP.md` §2 |

---

## Open known issues (`docs/KNOWN_ISSUES.md`)

One line each. **V2** = keep and schedule after launch; **won't fix** = leave as is.

| # | Issue | Call |
|---|---|---|
| 001 | `--cl-accent` used as text fails WCAG AA contrast | V2 |
| 002 | `--cl-text-muted` fails WCAG AA at body and label sizes | V2 |
| 003 | Production `vinbaccelli` profile row still holds a pasted HTML bio (not rendered; replaced on next save) | won't fix |
| 009 | Production `coach_services` column names differ from the code; saving services fails (SQL in the entry, not applied; production not re-checked from here) | V2 |
| 010 | Saved annotations are stored in canvas pixels, so a snapshot restored at another panel width is misaligned (live symptom fixed) | V2 |
| 013 | The foot-line notice blames the device for a model-load failure | V2 |
| 014 | `@ffmpeg/core` is loaded from a third-party CDN at runtime | V2 |
| 015 | MP4 conversion fix verified only through Generate; screen-record, crop-export and tab-capture paths not re-verified | V2 |
| 017 | Video-slot pills cover the ruler panel's header and close button | V2 |
| 019 | Recorded PiP position is proportional, not pixel-exact, in tab/window share | won't fix |
| 022 | Recording painter runs in the page, so a hidden tab freezes the recording without the floating window | V2 |
| 028 | Forfettario wording contains `’` (U+2019), which SdI rejects — **needs Vin's decision before the first Italian e-invoice is sent** | V2 |
| 031 | The live MediaPipe skeleton ignores the player lock | V2 |
| 033 | Site-wide COEP blocks third-party iframes (mitigated for Trustpilot; any new embed needs the same treatment) | V2 |
| 034 | Landing header wraps "Sign in" / "Start free" onto two lines at 390 px | V2 |
| 035 | Save Report has no button; the session save modal is unreachable | V2 |
| 036 | Tour steps that wait on slow work show no progress (fixed for Getting started step 7 only) | V2 |
| 039 | Dragging one frame stop shoves or crosses its neighbours | V2 |
| 040 | Racket detector preload: unhandled "Failed to fetch" and no retry when the model cannot download | V2 |

Not counted as open:
- 011, 012, 016 are fixed and await a device test.
- 023 and 024 carry no status in their headings, but their code fixes are on main. See `lib/supabase/service.ts:33` and `app/api/youtube/upload-session/route.ts:45`. For 023, the Vercel production key value was not re-checked from here.

---

## Open pull requests

None closed by this checkpoint.

| PR | What it is | Recommendation |
|---|---|---|
| #48 | `[PROBE]` temporary `console.warn` diagnostics for the post-AI-Track skeleton and text-tool reports; marked "DO NOT MERGE"; its Generate change was moved to #50. Conflicts with main. | **Close** |
| #49 | Point both Trustpilot links on the landing page at the merged anglemotion.com profile. | **Already fixed** — main links only `trustpilot.com/review/anglemotion.com` (`components/LandingPage.tsx:311`); the coach page keeps the older URL on purpose (`lib/coach/curated/vinbaccelli.ts:30`). Close. |
| #50 | Generate: an AI-tracked section is enough on its own (no snapshot required). | **Keep for V2** — not on main (`app/analysis/page.tsx:1289` still says "Create a snapshot first"); the branch is a month old against a heavily changed `page.tsx`, so it needs a fresh runtime check before merging. |
| #63 | Pricing and plan-gating investigation and proposal (docs only). | **Close (superseded)** — what it proposed shipped: EUR prices, webhook write checks, `canUse()` gating, Academy seats, the Coach Life coupon. |
| #83 | Timeline V1 plan (docs only). | **Keep for V2** — stage 1 shipped in #86; IN/OUT (T4), file export and the V2 list remain. |

---

## Frozen systems (unchanged, from `docs/V1_FREEZE.md`)

| Subsystem | Where it lives | Frozen at |
|-----------|----------------|-----------|
| ✅ Worker Recovery | `lib/poseWorker.ts` (per-inference timeout, context-loss detection, bounded backoff + WASM fallback) | `9cff403` |
| ✅ Pose Worker Architecture | `lib/poseWorker.ts`, `lib/poseWorkerBridge.ts` (single-in-flight bridge, result routing) | `9cff403` |
| ✅ Foot Line | `components/Canvas.tsx` foot-line render (real toe → ankle→toe, else `estimateFootVector`) | `9cff403` |
| ✅ Shared `estimateFootVector` | `lib/biomechanics/measurements.ts` (single canonical algorithm) | `9cff403` |
| ✅ Skeleton ↔ AI Measurement consistency | Canvas foot line + `computeFootDirection` share geometry + data source | `9cff403` |
| ✅ StroMotion Auto Detect architecture | `app/analysis/page.tsx` (`autoSelectAllObjectFrames`, `buildPlayerFrameSpec`) | `9cff403` |
| ✅ Atomic Auto Detect commit | `hooks/useStroMotion.ts` `autoProcessFrames` (build-all → single `setDraft`) | `9cff403` |
| ✅ Manual StroMotion workflow | `hooks/useStroMotion.ts` `selectAreaForFrame`, `finishStroRegionSelect` | `9cff403` |
| ✅ Auto Detect editor workflow | `FrameMaskEditor` gate + committed frame `{sourceFrame, selectionBox, aiSnapshot, working, readyMask, status:'ready'}` | `9cff403` |
| ✅ Generate pipeline architecture | `lib/stroMotionDraft/exportDraft.ts`, `compositeFromDraft.ts`, `frameMask.ts` (reads the committed draft) | `9cff403` |
| ✅ Recording PiP subsystem | `contexts/RecordingContext.tsx`, `lib/pipRecorderSurface.ts`, `components/Canvas.tsx` webcam-PiP block (Source A suppression) | `2026-07-19` |
| ✅ Skeleton persistent on/off gate (Family B) | `app/analysis/page.tsx` (`skeletonEnabled` formula, StroMotion checkbox → `setSkeletonOn` mirror, `resetMetrics()`, `handleMarkupClear()`) | `2026-07-19` |

The architecture contract in `CLAUDE.md` stays in force as well. It covers one analysis mode per canvas, pose provenance gating, and data-column mode isolation.
