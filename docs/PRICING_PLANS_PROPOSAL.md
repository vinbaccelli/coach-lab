# Pricing & plan gating: investigation and proposal

Branch `claude/pricing-plans`, cut from `main` at `cfbd0d04`. **Proposal only.** Nothing in billing,
plans or middleware is changed on this branch. Every `file:line` below is on `main` unless it is
marked **#60** (`claude/landing-screenshots`, which reworks the landing page and shifts its lines).

## Launch pricing being planned for

| Plan | Monthly | Yearly | Coaches | Ebook bonus |
|---|---|---|---|---|
| Light | EUR 12.90 | EUR 129 | 1 | no |
| Pro | EUR 34.90 | EUR 299 | 1 | yes |
| Academy | EUR 69.90 | EUR 599 | up to 4 | yes |
| Pro for Coach Life members | — | EUR 149 (regular EUR 299) | 1 | yes |

- **Trial:** unchanged, one hour of every tool.
- **Existing customers:** there are none on the old prices (Vin, 2026-10-03), so no grandfathering is needed.
- **Annual saving:**
  - Light: 12.90×12 = 154.80 → 129, **16.7 %**. This is exactly 2 months free.
  - Pro: 418.80 → 299, **28.6 %**.
  - Academy: 838.80 → 599, **28.6 %**.
- **Yearly price per month:** 10.75, 24.92 and 49.92.

---

## B1. Inventory: every place prices, plans, features, seats, the ebook or currency appear

### Source of truth and Stripe

| # | file:line | What it says or does today | Needs to change for launch |
|---|---|---|---|
| 1 | `lib/plans.ts:7-20` | Header: founding pricing, $10/$20/$40, Light-is-$5-in-Stripe warning | rewrite |
| 2 | `lib/plans.ts:47-48` | `FOUNDING_NOTE` "Founding pricing — locked for as long as you're a member…" | remove (B8) |
| 3 | `lib/plans.ts:51-55` | `PRICING_HEADLINE` "Three plans. No storage caps…", `PRICING_SUBHEAD`, `PRICING_FOOTNOTE` "free hour on any plan" | headline/sub OK; footnote OK |
| 4 | `lib/plans.ts:62-63` | Light 10 / 100 | 12.90 / 129 |
| 5 | `lib/plans.ts:65-72` | Light features, incl. **"AI angle detection — 13+ angles"** (AI Detect yields ≤ 12 items) and "AngleMotion Academy" | rewrite to Vin's list; drop "13+" |
| 6 | `lib/plans.ts:78-79` | Pro 20 / 200 | 34.90 / 299 |
| 7 | `lib/plans.ts:82-92` | Pro features (Motion Layer, match tracking, Match Decoder, reports, player DB, Recording Hub, coach profile, WhatsApp support) | rewrite to Vin's list (B4 decides the unnamed ones) |
| 8 | `lib/plans.ts:93-96` | Pro `annualBonus` "Go annual and I'll send you my ebook — a €30 value…" (comment: "The subscription stays USD") | Pro **and** Academy; wording per B7 |
| 9 | `lib/plans.ts:102-104` | Academy 40 / 400, `seats: 5` | 69.90 / 599, `seats: 4` |
| 10 | `lib/plans.ts:105-109` | Academy features "Up to 5 coach seats" | "Up to 4 coaches" |
| 11 | `lib/plans.ts:110-115` | Academy `note` "OnForm charges $599.99 a year for one coach. This is five." | remove (no competitor prices) |
| 12 | `lib/plans.ts:123-129` | `DEMO` "Test it free for an hour" / "every tool free for one hour" | unchanged |
| 13 | `lib/plans.ts:140-142` | `yearlyPerMonth()` rounds to cents, so the number renders as `24.92` with no currency | format with EUR (see note below) |
| 14 | `lib/stripe.ts:12-23` | `PRICES` from 6 env vars; Pro **falls back to legacy** `STRIPE_PRICE_MONTHLY/YEARLY`; back-compat aliases `monthly`/`yearly` | drop the fallbacks and aliases (B2) |
| 15 | `lib/stripe.ts:26-38` | `priceIdFor()`, `tierForPriceId()` | add the Coach Life price if that route is chosen (B6) |
| 16 | `app/api/stripe/checkout/route.ts:12-18` | Back-compat `{ plan: 'monthly' \| 'yearly' }` means Pro | remove |
| 17 | `app/api/stripe/checkout/route.ts:33-42` | Checkout session: `customer_email`, no `currency`, no `automatic_tax`, no `allow_promotion_codes`, metadata `{userId, plan, cycle, seats}` | B2, B3, B6, B8 (VAT) |
| 18 | `app/api/stripe/webhook/route.ts:22-66` | Writes `subscriptions`; falls back to tier `'pro'`; ignores DB errors | B3 |
| 19 | `app/api/stripe/portal/route.ts:26-29` | Stripe billing portal (plan switching is whatever the portal is configured to allow in the Stripe dashboard) | Vin: portal config (B9) |
| 20 | `app/api/stripe/subscription/route.ts:9-26` | Returns `status, tier, seats` | add a member/seat source (B5) |
| 21 | `.env.example:9-16` | 6 `STRIPE_PRICE_*` with comments `$5/mo`, `$50/yr`, `$20`, `$200`, `$40 (5 seats)`, `$400 (5 seats)` | EUR amounts, 4 coaches, Coach Life var |
| 22 | `supabase/migrations/20260709120000_subscription_tier.sql:5-17` | `tier text not null default 'pro'`, `seats integer default 1`, CHECK `light/pro/academy` | keep the CHECK. The `'pro'` default is a silent fallback, see B3 |
| 23 | `middleware.ts:70-116` | Gates `/analysis` and `/academy` on `status in (active, trialing)` OR an unexpired trial; **no tier check**; admins bypass; fails open | B4 |
| 24 | `app/api/trial/status/route.ts:14-38` | Trial countdown; "subscribed" for active/trialing/admin | unchanged |

### Surfaces that show prices or plans

| # | file:line | Text | Change |
|---|---|---|---|
| 25 | `app/pricing/page.tsx:39-41` | Yearly is the default "the only cycle that carries the Pro ebook" | per B7 decision |
| 26 | `app/pricing/page.tsx:109` | "Video Analysis requires an active plan — pick one below to unlock it." | fine; add the locked-feature variant (B4) |
| 27 | `app/pricing/page.tsx:123-132` | Founding promise banner (`FOUNDING_NOTE`) | remove (B8) |
| 28 | `app/pricing/page.tsx:141-145` | Toggle "Yearly · **2 months free**" | "Save up to 29 %" (B8) |
| 29 | `app/pricing/page.tsx:181-182` | "up to {seats} coaches" | follows `seats: 4` |
| 30 | `app/pricing/page.tsx:192-194` | Label **"FOUNDING PRICE"** | remove |
| 31 | `app/pricing/page.tsx:196-204` | `${price}` and `` `$${yearlyPerMonth}/mo · two months free` `` (hard-coded `$`) | EUR formatter; per-plan saving |
| 32 | `app/pricing/page.tsx:232-242` | `annualBonus` shown only when yearly is selected | B7 |
| 33 | `app/pricing/page.tsx:244-251` | `plan.note`, which renders the OnForm line | remove with #11 |
| 34 | `components/LandingPage.tsx:338-366` (#60 :299-327) | Competitor table. Row **"Price (Pro tier, annual)": `$200/yr`, `$499/yr`, `~€480/yr`, `$599/yr`** | remove the price row (B8) |
| 35 | `components/LandingPage.tsx:374` (#60 :335) | FAQ "Go yearly (**$200/yr — 2 months free** vs monthly) and we include our tennis biomechanics eBook…" | B8 |
| 36 | `components/LandingPage.tsx:550-552` (#60 :586) | Academy "Included with every plan." | true under the new plans (Light includes Academy) |
| 37 | `components/LandingPage.tsx:596-597` (#60 :628) | Toggle "Yearly · 2 months free" | as #28 |
| 38 | `components/LandingPage.tsx:605-611` (#60 :637-642) | `$` + price, `$… billed yearly`, "· {seats} coach seats" | EUR formatter; "4 coaches" |
| 39 | `components/LandingPage.tsx:613-616` | Renders `plan.features` (same list as /pricing) | follows plans.ts |
| 40 | `components/LandingPage.tsx:625-627` (#60 :657) | "**Go yearly and get our tennis biomechanics eBook**", which implies Light too | B7 |
| 41 | #60 `lib/plans.ts:84-87` | "Motion Layer, **on every plan**" (true today; false once Pro-gated) | replaced by the new Pro list in the same release |
| 42 | `app/billing/page.tsx:83` | Falls back to label **"Pro"** when `tier` is null | show "—" or "No plan" |
| 43 | `app/billing/page.tsx:91` | "plans from **$5/mo (Light) to $40/mo (Academy)**" | derive from `PLANS` + EUR formatter |
| 44 | `components/ControlPanelHome.tsx:152-156` | "Light, Pro and Academy. Yearly billing runs **two months cheaper** than monthly." | "Yearly saves up to 29 %." |
| 45 | `app/login/LoginClient.tsx:19,80,95` | "every tool is open for one hour"; "See pricing" link | unchanged |
| 46 | `components/WorkspaceChrome.tsx:165-168` | "Pricing" nav link | unchanged |
| 47 | `app/privacy/page.tsx:65` | "subscriptions are processed by Stripe… we only store your subscription status" | unchanged; also true for seat members |
| 48 | `app/layout.tsx:9-12`, `app/analysis/layout.tsx:4-7` | SEO title/description: **no prices or plan names** | none |
| 49 | `app/layout.tsx:53` | Design contract "starts the free trial hour" | none |

**Not found anywhere:**
- An email system or transactional email templates. `package.json` has no mail library, and no route sends mail.
- Hard-coded Stripe price IDs in code, seeds or fixtures.
- A test runner or test data.
- Pricing in `public/sw.js`, the manifest, `app/terms`, or the `/coaches` and `/catalog` pages.

### Docs

| file:line | Text |
|---|---|
| `docs/ARCHITECT_HANDOFF.md:19,124` | "3 tiers + a free 1-hour trial"; "Light $5/$50, Pro $20/$200, Academy $40/$400" |
| `docs/KNOWN_ISSUES.md:256-293` (007) | Light advertises $10, Stripe charges $5. Becomes moot when the EUR prices replace both; close it in the launch release |
| `docs/KNOWN_ISSUES.md:295-337` (008) | Academy entitlement widened to every tier; Academy had **0 resources** in production on 2026-09-08 |
| `PRODUCT.md:143,153` | "Pricing that fits how you coach."; "three pricing tiers" |
| `.impeccable/surfaces/components-controlpanelhome-tsx.md:95` | "same nine cards to every tier" |
| `lib/coach/curated/vinbaccelli.ts:88-99,169-190` | Coach profile: the ebook is "**Spin Mechanics**", sold for €30 via a Stripe Payment Link (`buy.stripe.com/14A00jgsN4j2cnu7o27kc02`); "Join Coach Life… get eBook for free" (`coachlife.com/?ref=VBC`) |

**Currency.** Every visible price is `$`, either hard-coded in JSX (#31, #38, #43) or in copy strings (#11, #34, #35). `priceMonthly: 12.9` would currently render as **"$12.9"**. Add one formatter, `formatPrice(n) = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })`, and use it at #13, #31, #38 and #43.

---

## B2. Stripe wiring

**How the tier is derived today:**
- **Checkout** (`app/api/stripe/checkout/route.ts:24`): `priceIdFor(plan, cycle)` reads one of six env vars. The tier and seat count also travel in the session metadata (`:41`).
- **Checkout completed** (`webhook/route.ts:22-47`): the tier is taken from `session.metadata.plan`. If that is missing or invalid, it is **silently set to `'pro'`** (`:28`). Seats come from metadata, else `getPlan(tier).seats`. Status is written as `'active'` unconditionally.
- **Subscription updated or deleted** (`:50-66`): the tier is `tierForPriceId(items[0].price.id)`, a reverse lookup over the six env values. An unknown price gives `null` and the tier is left unchanged. Status is copied from Stripe. The row is matched by `stripe_subscription_id`.

**What `subscriptions` stores** (one row per user, primary key `user_id`): `stripe_customer_id`, `stripe_subscription_id`, `status`, `tier` (default `'pro'`, CHECK light/pro/academy), `seats` (default 1), `updated_at`. Coaches can only read their own row; only the service role writes.

**What the trial grants:** `middleware.ts:100-105` calls `start_trial()`, which creates one row per user, immutable, with `started_at = now()`. Access is allowed while that is under 60 minutes old. The trial grants **every tool**, because nothing checks the tier, and it applies only to `/analysis` and `/academy`.

**What must change for six EUR prices plus Coach Life:**
1. **Vin creates them in Stripe** (B9). Point the **existing** six names at the EUR prices: `STRIPE_PRICE_{LIGHT,PRO,ACADEMY}_{MONTHLY,YEARLY}`. If the separate-price route is chosen, add `STRIPE_PRICE_PRO_COACHLIFE_YEARLY` (B6).
2. **`lib/stripe.ts:15-22`:** remove the `STRIPE_PRICE_MONTHLY/YEARLY` fallback and the `monthly`/`yearly` aliases. ⚠️ KNOWN_ISSUES 007 shows that **Pro is currently wired through those legacy names**, so `STRIPE_PRICE_PRO_*` must be set in the same release, or Pro checkout returns 400 "not configured".
3. **`checkout/route.ts:12-18`:** remove the `{ plan: 'monthly' | 'yearly' }` back-compat. Its only caller is `/pricing`, and that already sends `{ plan, cycle }` (`app/pricing/page.tsx:56`).
4. **`lib/plans.ts`:** the new numbers, `seats: 4`, and EUR in the header comment.
5. **Webhook:** the B3 fixes, which also remove the `'pro'` fallback.

**Removing the old price IDs cleanly:**
- **The code holds no price IDs.** Repointing the env vars removes every old mapping in one step.
- **What happens to a subscription still on an old ID:** after the repoint, `tierForPriceId(oldId)` returns `null`. Such a subscription would keep its stored tier, and its status would still update. That is harmless, but it is also why Vin should confirm there are none:
  1. Stripe Dashboard → Subscriptions, filtered by each old price, in both **live** and **test** mode. Vin's and the admin accounts' own subscriptions count.
  2. In Supabase: `select user_id, tier, status, stripe_subscription_id from subscriptions;` Any row with an `active` or `trialing` status is on an old price.
  3. Then **archive** (not delete) the six old USD prices and the legacy `STRIPE_PRICE_MONTHLY/YEARLY` prices, and remove those two env vars from Vercel (production **and** preview).
- **What I checked from code:** no test, seed or fixture references a price ID; there is no test runner. I can't see the live database or Stripe from this sandbox, so steps 1–2 are Vin's.
- **Currency:** checkout passes `customer_email` and no `customer`, so every checkout creates a fresh Stripe customer. A USD→EUR clash on one customer can't happen through this flow. The portal looks up the customer by stored id or by email (`portal/route.ts:9-21`).

---

## B3. Webhook prerequisite: fix before any gating ships

**Defect, verified in code:** `supabase-js` `.upsert()` and `.update()` **return** `{ error }`; they don't throw. `webhook/route.ts:37-45` and `:62-64` never read the result. Their `try/catch` only catches a missing service key, and even that is logged and then answered `200` (`:68`). Effects:
- A failed write is invisible. Stripe sees 200 and never retries, so a paying coach stays locked out. Once gating ships, a write failure becomes **lost entitlement**.
- If the first upsert failed, every later `subscription.updated` matches **zero rows** by `stripe_subscription_id`, also silently.
- `checkout.session.completed` always writes `status: 'active'`. A delayed payment method such as **SEPA Direct Debit**, likely once prices are in EUR, completes checkout with `payment_status: 'unpaid'`.
- Missing or invalid metadata produces a `'pro'` tier.

**Proposed fix:**
1. Read `{ error }` from every write. On error, `console.error` with the event id, type and user id, and **return 500** so Stripe retries. Writes are idempotent because the upsert is keyed on `user_id`.
2. Return 500 when `createSupabaseServiceClient()` is null (misconfiguration should not be acknowledged as success).
3. Checkout: also set `client_reference_id: userId` and `subscription_data.metadata: { userId }`. The subscription then carries the user, and `customer.subscription.updated/created` can **upsert by `user_id`** instead of updating by subscription id.
4. Derive the tier from the price: retrieve the subscription in `checkout.session.completed` and call `tierForPriceId`. Fall back to metadata. If neither resolves, log and return 500. Never default to `'pro'`.
5. Status: write the subscription's real `status` (`active`, `trialing`, `incomplete`, `past_due`…) rather than a hard-coded `'active'`. Middleware already allows only `active` and `trialing`.
6. Handle `customer.subscription.created` with the same code path as `updated`.
7. Verify with the Stripe CLI (`stripe listen --forward-to localhost:3000/api/stripe/webhook`, then `stripe trigger checkout.session.completed`), once with a good key and once with the service key unset (expect 500 and a retry).

**Files:** `app/api/stripe/webhook/route.ts`, `app/api/stripe/checkout/route.ts`. No schema change.

---

## B4. Feature matrix and enforcement

**Legend:**
- **C** = client-only. The code runs in the browser on local files and can be bypassed by anyone who edits the bundle; the UI lock is a courtesy.
- **S** = server-backed. An API route does the work, so a check there is real.

| Feature | Where it runs | Proposed tier | Enforce at | Vin decides? |
|---|---|---|---|---|
| Drawing tools (pen, line, arrow, angle, angle arrow, shapes, text) | `components/Canvas.tsx` | Light | C | named |
| Skeleton (live pose) | Canvas + `lib/mediapipePose.ts`, local models | Light | C | named |
| Angle detection = **"AI Detect Angles"** (`onAutoDetectMeasurements`, `app/analysis/page.tsx:6664`). This *is* the "AI auto-detect" in your list. | client | Light | C | named |
| Screenshots: download | `app/analysis/page.tsx:3233` | Light | C | named |
| Screenshots: **save to a player** | `/api/players` | Pro (player DB) | S | flag |
| AngleMotion Academy | `/academy` page + `/api/academy` | Light | S (middleware + route) | named |
| Recording Hub (screen/webcam capture) | `components/RecordingHub.tsx`, local MediaRecorder | Pro | C | named |
| YouTube upload / connect | `/api/youtube/*` | Pro | **S** | named |
| Motion Layer (StroMotion) | `hooks/useStroMotion.ts`, local | Pro | C | named |
| Player database | `/players`, `/api/players/*`, `/api/sessions/*` | Pro | **S** | named |
| Ruler | Canvas | **Light**: it is a drawing/measurement tool under Draw | C | flag |
| Joint chain | Canvas | **Light**, same reason | C | flag |
| Angle differential | Canvas + page | **Light**: an angle tool; the landing page's first entry sells it | C | flag |
| Data column | page + Canvas | **Light, required**: AI Detect writes into it (`page.tsx:6826-6829`); locking it would break Light's angle detection | C | flag |
| Snapshots | page | **Light for the snapshot AI Detect creates** (`createSnapshotFromLive`, `page.tsx:6814`); the multi-phase Snapshot/Phases workflow is **Pro** as "the complete analysis workflow" | C | flag |
| AI Track (Precision AI Track) | page, local | **Pro**: it feeds Generate and Motion Layer; Light's skeleton works without it | C | flag |
| Generate (phase capture + slow-mo MP4) | `components/metrics/GenerateWorkspace.tsx`, ffmpeg.wasm | **Pro**: "complete analysis workflow" | C (+ S when it saves to `/api/players`) | flag |
| Manual match analyzer (`/match-report`) | `components/MatchReportClient.tsx`, `ManualMatchRecorder.tsx` | **Pro**: it was "Live point-by-point match tracking" in today's Pro list | C (export is S via `/api/google/*`, `/api/players`) | flag |
| Match Decoder (`/decoder`) | `MatchDecoderClient`, local OCR (`lib/matchDecoder`) | **Pro**: it is in today's Pro list | C (save is S via `/api/players`) | flag |
| Google Docs / PDF export | `/api/google/create-document`, `/report`, `/upload-image` | **Pro**: "Charted reports" is in today's Pro list | **S** | flag |
| Coach public profile + directory listing | `/profile`, `/api/coach-profile`, `/api/coach-settings`; public `/coach/[slug]`, `/coaches` | **Pro**: in today's Pro list; it is a business feature | **S** (writes) | flag |
| WhatsApp support from Vin | not a feature in code | not in your new Pro list; drop it or keep it as copy | — | flag |

**"The complete analysis workflow"** isn't a named thing in code. I read it as AI Track + the Snapshot/Phases flow + Generate + saving to a player + report export. Please confirm.

**Gaps that exist today (pre-existing, independent of pricing):**
- **G1.** `middleware.ts:82` gates only `/analysis` and `/academy`. `/players`, `/decoder`, `/match-report`, `/dashboard` and `/profile` need only a login, so an expired-trial account with no subscription can use them.
- **G2.** `/api/*` is excluded from middleware entirely (`middleware.ts:21,134`). Every API route checks login only, never subscription.
- **G3.** `app/api/gemini/decode-match` is **unreferenced** (`app/decoder/page.tsx:7-10`) but still deployed: any signed-in user can POST to it and spend the Gemini key. Delete it or make it admin-only.

**Proposed mechanism:**
- **`lib/entitlements.ts`** (shared, no server-only imports):
  ```ts
  export type Feature = 'draw' | 'skeleton' | 'aiDetect' | 'screenshot' | 'academy' | 'recordingHub'
    | 'motionLayer' | 'youtube' | 'players' | 'aiTrack' | 'generate' | 'matchTracking'
    | 'matchDecoder' | 'docsExport' | 'coachProfile' /* … */;
  const MIN_PLAN: Record<Feature, PlanId> = { draw: 'light', motionLayer: 'pro', /* … */ };
  const RANK = { light: 1, pro: 2, academy: 3 } as const;
  export type Entitlement = { plan: PlanId | null; trial: boolean; admin: boolean };
  export function canUse(f: Feature, e: Entitlement): boolean {
    if (e.admin || e.trial) return true;            // trial keeps every tool
    return e.plan != null && RANK[e.plan] >= RANK[MIN_PLAN[f]];
  }
  ```
- **`lib/entitlements.server.ts`:** `getEntitlement(supabase, user)` reads `subscriptions` (and academy membership, B5) plus `trials` in one place. Middleware, the API routes and `/api/stripe/subscription` all use it.
- **Server checks:** a guard `requireFeature(f)` at the top of `/api/players/*`, `/api/sessions/*`, `/api/youtube/*`, `/api/google/*`, `/api/coach-profile` (write methods), `/api/coach-settings`. It returns **403 `{ error: 'plan_required', feature, required: 'pro' }`**. Middleware sends `/players`, `/decoder`, `/match-report` and `/profile` to `/pricing?required=pro&feature=…` for under-tier users.
- **Client:** a `useEntitlement()` hook fed by `/api/stripe/subscription` (extended to return `{ plan, trial, admin }`). Locked tools stay **visible**: the toolbar row shows a small lock and a "Pro" chip, and pressing it opens a sheet ("Motion Layer is part of Pro") with "See plans" linking to `/pricing?highlight=pro`. Hiding tools would hurt discovery and the guided tours.
- **Trial:** every tool, unchanged (`canUse` returns true).
- **Downgrade or lapse:** propose that the user **keeps read access to everything they made**:
  - Players, sessions and saved reports: GET stays allowed for any signed-in user; create and update need Pro.
  - Google Docs and YouTube videos live in the coach's own Google account and are never touched.
  - Local drawings and snapshots stay in the browser.
  - The public coach profile stays published but read-only. **Vin decides** whether to unlist it from `/coaches` instead.
  - Nothing is deleted.
- **Fail-open:** `middleware.ts:113-115` fails open on a DB error. Keep that for `/analysis` (a lockout is worse than a free hour). The API guards should also fail open on a read error, logged, so an outage never blocks paying coaches.

**Protected-behaviour note (CLAUDE.md §6):** the middleware and API guards add **one Supabase read per gated request**, the same read middleware already does for `/analysis`. That needs Vin's approval as a live-query change. Caching the entitlement in a short-lived signed cookie is possible but not proposed for launch.

---

## B5. Academy seats

**Today:** there is no team concept. `seats` is just a number stored on the owner's row (`subscription_tier.sql:7`, webhook `:43,58`) and displayed (`/billing:84`, `/pricing:181`, landing `:611`). Nothing lets a second coach in, and every data table is per-user.

**Smallest launch approach ("up to 4 coaches", meaning the owner plus 3):**
1. A migration adding `academy_members (owner_user_id uuid, email citext, member_user_id uuid null, created_at)`, unique on `(owner_user_id, email)`. RLS: the owner selects their rows. Writes go only through a server route.
2. `POST/DELETE /api/academy-members`: owner-only, requires an active `academy` tier, and refuses to add more than `seats − 1` members (3).
3. `getEntitlement`: if a user has no own subscription, look up a row whose `email` equals the signed-in Google email and whose owner has `status in (active, trialing)` and `tier = 'academy'`. That grants plan `academy`. `member_user_id` is filled on first sign-in.
4. `/billing`: a "Coaches on your plan" list with add and remove by email.
5. **Data stays per coach.** Members don't see the owner's players. A shared player database is a separate, larger project; say so in the copy if needed ("4 coach logins", not "shared workspace").

**Files:** one migration, `app/api/academy-members/route.ts`, `lib/entitlements.server.ts`, `app/billing/page.tsx`.

---

## B6. Coach Life: Pro at EUR 149/yr

| | A. Separate price | B. Coupon + promotion code |
|---|---|---|
| Stripe | Price EUR 149/yr on the Pro product | Coupon EUR 150 off, `duration: forever`, `applies_to` the Pro product; promotion codes with **`minimum_amount` EUR 299** so it can't be applied to Pro monthly (34.90; without that, 150 off would make every month free) |
| Code | `STRIPE_PRICE_PRO_COACHLIFE_YEARLY` + a mapping in `tierForPriceId` → `pro`; checkout accepts `variant: 'coachlife'` **and must verify eligibility server-side** | `allow_promotion_codes: true` in checkout (1 line), or apply the code server-side via `discounts` |
| Renewal | stays EUR 149 automatically | stays EUR 149 with `forever` |
| Who qualifies | our server decides (needs a verification source) | whoever holds a valid code |
| Reporting | separate price line in Stripe | discount line on the Pro price |

**Verifying membership:** Coach Life is an outside service (`coachlife.com`). The repo's only link to it is Vin's referral **out** to it (`?ref=VBC`, `vinbaccelli.ts:182`). There is no API or data we can check. Realistic options:
1. **Unique single-use promotion codes** that Vin, or Coach Life, hands to each member. Stripe can bulk-create codes for one coupon and limit each to one redemption.
2. A **manual allow-list** of member emails that Vin maintains, which the server checks before offering option A.
3. A shared code, which leaks.

**Recommendation:** B with unique single-use codes (1). It needs no new eligibility code, renews correctly, and avoids a public field: send members to `/pricing?coachlife=1`, which shows the code box, rather than enabling the box for everyone. Vin decides.

---

## B7. Ebook bonus

- **How it is delivered today:** **manually, by copy only.**
  - The only mechanism is the sentence "Go annual and **I'll send you** my ebook" (`lib/plans.ts:95-96`), shown on yearly Pro cards (`app/pricing/page.tsx:234`).
  - Nothing in the webhook, database, Academy or email flags or sends it, and the repo has **no email system**.
  - The coach profile sells the ebook separately through a Stripe **Payment Link**. What happens after that purchase is configured in Stripe, not in this repo.
- **Inconsistent today:**
  - **Which plans:** the landing page says "Go yearly and get our tennis biomechanics eBook" (`LandingPage.tsx:626`), implying every plan including Light. The FAQ ties it to "$200/yr" (`:374`). `/pricing` gives it to Pro yearly only. Academy has no `annualBonus`.
  - **Which book:** "Spin Mechanics" (€30, coach profile) vs "tennis biomechanics eBook — the coach's guide to reading every stroke" (landing). Are these the same book?
- **Proposed delivery** (smallest that isn't manual): the ebook PDF goes in a **private** Supabase storage bucket. `/billing` shows "Download your ebook" when `canUse('ebook', ent)`, where ebook needs Pro, i.e. Pro or Academy. A server route checks the entitlement and returns a short-lived signed URL. No email needed, and it works for Coach Life subscribers automatically (they are Pro).
- **Places to align:** `lib/plans.ts:93-96`, `app/pricing/page.tsx:39-41` and `:232-242`, `components/LandingPage.tsx:374` and `:625-627` (#60 :335, :657).
- **Vin decides:**
  - Is the ebook **yearly-only** (as today) or for **monthly** Pro/Academy too? Your list doesn't say yearly.
  - Which title and wording?

---

## B8. Copy rules check

- **Numbers:** only the table at the top.
- **Saving:** "Save 17 %" (Light) and "Save 29 %" (Pro, Academy), or a toggle "Yearly · save up to 29 %". "2 months free" is accurate for Light only, so drop it.
- **No competitor prices.** Remove:
  - the landing compare row "Price (Pro tier, annual)" (`LandingPage.tsx:353`, #60 :314),
  - the OnForm note (`lib/plans.ts:110-115`), which `/pricing:244-251` renders,
  - the competitor-price notes in comments (`LandingPage.tsx:338-349`, `lib/plans.ts:110-114`).

  The feature rows of the compare table make no price claims; keeping them is Vin's call.
- **No "future Pro features" promise:** none found in code.
- **Founding framing to retire, with proposed replacements (not applied):**

  | Where | Today | Proposed |
  |---|---|---|
  | `lib/plans.ts:47-48`, `/pricing:123-132` | "Founding pricing — locked for as long as you're a member, whatever we charge new subscribers later." | remove the banner, or, if Vin wants a promise: "Your price stays the same for as long as you stay subscribed." (only if he will honour it) |
  | `/pricing:192-194` | "FOUNDING PRICE" | remove |
  | `/pricing:141-145`, landing `:597` | "Yearly · 2 months free" | "Yearly · save up to 29 %" |
  | `/pricing:202-204` | "$X/mo · two months free" | "€24.92/mo billed yearly · save 29 %" (per plan) |
  | `lib/plans.ts:115` | OnForm comparison | remove |
  | `LandingPage.tsx:374` | FAQ "$200/yr — 2 months free … eBook" | "Pro and Academy include [ebook title]. Yearly billing saves up to 29 %." |
  | `LandingPage.tsx:626` | "Go yearly and get our tennis biomechanics eBook…" | "Pro and Academy include [ebook title]." |
  | `ControlPanelHome.tsx:155` | "…two months cheaper than monthly." | "Light, Pro and Academy. Yearly saves up to 29 %." |
  | `app/billing/page.tsx:91` | "$5/mo (Light) to $40/mo (Academy)" | "from €12.90/mo (Light) to €69.90/mo (Academy)", derived from `PLANS` |

- **Academy content:**
  - KNOWN_ISSUES 008 recorded **0 rows** in `academy_resources` (production, 2026-09-08). I can't query production from here.
  - If it is still empty, "a growing library of eBooks, guides and drill breakdowns" (`LandingPage.tsx:544`) and "AngleMotion Academy" as a Light feature describe something that has no content yet.
  - Proposal: keep it in the feature list only once it has items; until then, "AngleMotion Academy (opening soon)", or drop it. **Vin to check the row count.**
- **VAT-inclusive display: not configured.**
  - Checkout sets no `automatic_tax`, `tax_id_collection` or `billing_address_collection` (`checkout/route.ts:33-42`), and the pages never say "incl. VAT".
  - EU consumer prices must be shown VAT-inclusive.
  - **Vin must decide before creating the prices:** each price's `tax_behavior` (inclusive vs exclusive) is fixed once set. The likely setup is Stripe Tax on, prices **inclusive**, and checkout `automatic_tax: { enabled: true }` plus "Prices include VAT" on both pricing surfaces.
- **Also:** the Light feature "13+ angles" is not true (AI Detect produces at most 12 items, and fewer without the foot line or head direction). Replace it with plain "Angle detection".

---

## B9. Phased plan

**R0: now, independent of pricing**
- R0a. Webhook hardening (B3). Files: `app/api/stripe/webhook/route.ts`, `app/api/stripe/checkout/route.ts`. Risk: low; it only turns silent failures into retries. Verify with the Stripe CLI.
- R0b. Delete or admin-gate the unreferenced Gemini route (G3).

**R1: the launch release.** Displayed prices, Stripe IDs, gating and seats all go live together.
- R1a. `lib/plans.ts`: EUR numbers, `seats: 4`, the new feature lists, ebook on Pro and Academy, the founding/OnForm copy removed, and `formatPrice()`.
- R1b. Surfaces: `app/pricing/page.tsx`, `components/LandingPage.tsx` (rebased on #60), `app/billing/page.tsx`, `components/ControlPanelHome.tsx`. EUR, savings, VAT line.
- R1c. `lib/stripe.ts` (no legacy fallbacks), `checkout/route.ts` (no back-compat, `automatic_tax`, promotion codes per B6, metadata per B3).
- R1d. `lib/entitlements.ts` + `.server.ts`, API guards, middleware route list, toolbar lock UI (`components/ToolPalette.tsx`, `app/analysis/page.tsx` handlers) and the upgrade sheet.
- R1e. Academy seats (B5): migration + route + `/billing` section.
- R1f. Ebook download (B7): private bucket + route + `/billing` link.
- R1g. Docs: `.env.example`, `docs/ARCHITECT_HANDOFF.md:124`, KNOWN_ISSUES 007 closed, G1–G3 recorded.

**Vin's actions in Stripe before R1 deploys:**
1. Turn on Stripe Tax if prices are VAT-inclusive, and decide `tax_behavior` before creating any price.
2. Products **Light**, **Pro** and **Academy**, each with two **EUR recurring** prices:

   | Env var | Amount |
   |---|---|
   | `STRIPE_PRICE_LIGHT_MONTHLY` | EUR 12.90 / month |
   | `STRIPE_PRICE_LIGHT_YEARLY` | EUR 129 / year |
   | `STRIPE_PRICE_PRO_MONTHLY` | EUR 34.90 / month |
   | `STRIPE_PRICE_PRO_YEARLY` | EUR 299 / year |
   | `STRIPE_PRICE_ACADEMY_MONTHLY` | EUR 69.90 / month |
   | `STRIPE_PRICE_ACADEMY_YEARLY` | EUR 599 / year |

3. Coach Life, depending on the B6 choice:
   - (B, recommended) Coupon EUR 150 off, forever, applies to Pro, plus promotion codes with min amount EUR 299. No env var needed.
   - Or (A) price EUR 149/yr on Pro → `STRIPE_PRICE_PRO_COACHLIFE_YEARLY`.
4. Set the six (or seven) env vars in Vercel **Production and Preview**. **Remove** `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`.
5. Billing portal (Dashboard → Settings → Billing → Customer portal): list only the new prices for plan switching, or turn switching off for launch.
6. Confirm no live or test subscriptions sit on the old prices (B2), then archive the old prices.
7. If SEPA or other delayed methods are enabled, the B3 status fix must already be live.

**Release order rule:**
- R1's code, which shows EUR and maps the new IDs, and the env-var repoint must reach production **in the same deploy**.
- Setting the env vars first would charge EUR while the page shows dollars.
- Deploying the code first would show EUR prices backed by the old USD IDs.
- Safest: set the vars on a Preview deployment, run one test-mode checkout per price there, then promote.

**Risks:**
- Client-only gating (C rows) is bypassable by a determined user; it is a courtesy, not security.
- Gating adds a DB read per gated API request (needs approval, CLAUDE.md §6).
- Seats are logins only, not a shared database.
- Repointing env vars is irreversible for in-flight checkouts. Deploy at a quiet time.
- Academy content may be empty (B8).
- Ebook delivery needs the file uploaded to private storage.
- **Decisions open for Vin:**
  - every "flag" row in B4,
  - "complete analysis workflow",
  - ebook yearly-only, and its title,
  - Coach Life option,
  - VAT-inclusive,
  - the coach profile on downgrade,
  - whether to keep the competitor feature rows.
