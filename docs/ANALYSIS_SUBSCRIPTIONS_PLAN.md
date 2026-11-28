# Analysis subscriptions and the coach storefront — plan (for approval, no code)

*2026-11-16. Written from the architect's decisions of the same day. Nothing here is built. Nothing changes prices,
plans, entitlements or Stripe: the app never touches the money (decision 1).*

## 1. What it is

A player (a coach's client) can subscribe to the coach's video analysis: pick **the type of analysis** (quick, in
depth, …) and **how often** (weekly, every 2 weeks, monthly), and **how to pay** for a discount:

| Payment term | Discount |
|---|---|
| Monthly, committed for 12 months | 10 % |
| 6 months paid in advance | 10 % |
| 12 months paid in advance | 20 % |

The architect's own coach profile is the **model**: every coach on the **Pro (coach) plan** gets the same public page
and can sell their own analysis the same way.

## 2. Decisions taken (architect, 2026-11-16)

1. **The coach handles payments himself** (Stripe, PayPal, bank, anything): he pastes a payment link per service. The
   app stores links and shows them; it never charges, holds or moves money.
2. **0 fees.** The public coach profile is included with the Pro subscription.
3. **Pro plan only** (`lib/entitlements.ts`: a new feature entry, enforced on the server like `players`).
4. **Delivery is each coach's own way.** In the architect's case: he sends the client the **player profile link** (the
   existing share link, where the player adds information, videos and problems); he reads it, records the analysis
   while reading, and delivers.
5. **Early cancellation: refunded without the discount.** The refund is what was paid minus the deliveries already
   received at the undiscounted price (see 5.4; the coach pays it back himself, outside the app).
6. **The coach sets his own prices, services and way of working.**

## 3. Why this is small (reuse)

* No Stripe Connect, no new Stripe configuration, no payout or tax handling inside the app: payment is a link.
* The intake form already exists: the share link with "add" permissions (PR D), and the timeline/trackers/meals/
  workouts/mental sections the player fills in.
* Each delivered analysis lands in the player's timeline (Player Database), which already exists.
* Reminders: the in-app to-do / assignments of PR H (#195) can carry "analysis due", so that PR should merge first.

## 4. Data model (one migration, owner-only RLS like every player-database table)

| Table | Purpose | Key columns |
|---|---|---|
| `coach_storefronts` | the public page | `coach_id` (unique), `slug` (unique, url-safe), `published`, `headline`, `about`, `contact_note`, `terms_note` |
| `analysis_offers` | an analysis type | `coach_id`, `title`, `description`, `price_cents` (price of ONE delivery), `currency`, `active`, `sort_order` |
| `offer_pay_links` | how to pay, per coach | `coach_id`, `service` (free text: "Stripe", "PayPal", "Bank transfer"), `url` or `instructions`, `term` (`monthly` \| `six_months` \| `yearly`), optional `offer_id` |
| `analysis_subscriptions` | one client's subscription | `coach_id`, `player_id`, `offer_id`, `frequency` (`weekly` \| `biweekly` \| `monthly`), `term`, **price snapshot** (`unit_cents`, `discount_pct`, `total_cents`, `currency`), `status` (`requested` \| `active` \| `cancelled` \| `completed`), `starts_on`, `ends_on`, `paid_marked_at`, `cancelled_at` |
| `analysis_deliveries` | one scheduled analysis | `subscription_id`, `due_on`, `status` (`planned` \| `intake_received` \| `delivered` \| `skipped`), `delivered_on`, `timeline_item_id` |

* **Prices are snapshotted** on the subscription: a later price change never changes a running subscription.
* Public read (no login) is limited to `published` storefronts, `active` offers and pay links, through a server route
  that returns an allow-listed set of columns (same pattern as the share link). Writes are owner-only; subscription
  requests from a visitor go through a rate-limited server route, never straight to the table.
* No card or bank data is ever stored. "Paid" is **marked by the coach** (`paid_marked_at`); the app does not verify it.

## 4b. Price and schedule rules (pure functions, unit-tested)

* Deliveries per month: weekly 52/12, every 2 weeks 26/12, monthly 1 (rounded per term, shown to the player).
* Term total = unit price × deliveries in the term × (1 − discount). Shown to the player before they request.
* Discounts are **configured in one place** (`lib/analysisPricing.ts`) with the three values above; a coach cannot
  grant a different discount (keeps the offer identical across coaches). Open question 2.

## 5. Flows

1. **Coach sets up** (Settings → Storefront, Pro only): profile text, offers (types and prices), payment links per
   service, publish. A **template** pre-fills the architect's own setup so a new coach starts from the model.
2. **Player requests** on `/coach/<slug>`: picks offer, frequency and term; sees the exact total and discount; the page
   shows the coach's payment links for that term; one button "I have paid / Request" creates a `requested`
   subscription and notifies the coach (in-app, plus the email the player typed).
3. **Coach confirms**: marks it paid → `active`; the app creates the schedule of `analysis_deliveries`; sends the
   player the **share link** (add permissions) so they fill in their profile, videos and problems.
4. **Each delivery**: reminder to the coach (to-do), the player's additions arrive "waiting for review" (already built),
   the coach records and attaches the analysis → it appears in the player's timeline; delivery → `delivered`.
5. **Cancel**: either side cancels; the app shows the refund calculation: *paid − (deliveries received × unit price at
   full price)*, never below 0; the coach refunds through his own channel and marks it. Deliveries after cancellation
   are removed. (Open question 3.)

## 6. Security and abuse

* Server-side checks on every route (Pro only; owner only); public routes allow-listed and rate-limited like the share
  link; honeypot/limit on the request form; no HTML in any coach text (rendered as text).
* The storefront shows only what the coach published; a draft is never reachable; a deleted offer leaves running
  subscriptions intact (price snapshot).
* Payment links are shown as links (opened in a new tab, `rel="noopener noreferrer"`), never embedded.
* Data protection: a requester's name/email is personal data of the coach's client; the privacy text needs the
  addition (the architect's lawyer), like the player profile.

## 7. Increments (each: PR, tests, phone test sheet; nothing is advertised until it works)

1. Storefront + offers + pay links (coach side, Pro gate, public page read-only).
2. Pricing/schedule library + request flow on the public page (no money involved) + coach inbox.
3. Subscriptions: confirm/mark paid, delivery schedule, to-do reminders (after #195).
4. Intake via the share link and delivery into the timeline.
5. Cancellation and refund calculator.
6. Template for new Pro coaches + onboarding text; landing/pricing copy last, after the architect's phone pass.

## 8. Open questions (small; defaults in bold, change any)

1. Frequencies offered: **weekly, every 2 weeks, monthly**; may a coach switch some off per offer? (default: yes)
2. Discounts fixed at 10 / 10 / 20 % for every coach? (default: **yes, fixed**)
3. Refund rule wording: "paid minus deliveries received at the undiscounted price, never below 0" (default: **yes**).
4. Currency: **one per offer, chosen by the coach** (the app only displays it).
5. Who may cancel and when: **either side at any time**; the 12-month monthly commitment is a coach's term, not
   enforced by the app (it only computes the refund). Anything the lawyer needs in the terms goes in `terms_note`.
6. Public URL: **`/coach/<slug>`** under the existing domain.
7. A coach who downgrades from Pro: **storefront unpublished, data kept**, running subscriptions keep their schedule
   visible to the coach.
