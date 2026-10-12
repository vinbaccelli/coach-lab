# Testing payments locally with the Stripe CLI (macOS)

A step-by-step for someone who has never used the Stripe CLI. Everything here
is **test mode**: no real money moves, and nothing touches live customers. It
covers:
- **R0**, the webhook: signature check, retries, idempotency.
- **R1c**, launch checkout: six EUR prices, fail-closed, Coach Life promo codes.

You need three Terminal windows:
- **A** runs the app,
- **B** runs `stripe listen`,
- **C** is for one-off commands.

Commands go after the `$` prompt. Don't type the `$`.

> **Which database?** Checkout needs you signed in, so the app needs Supabase
> keys. If you can, create a separate free Supabase project for testing and
> run all `supabase/migrations/*.sql` in it. If you use the production
> project, the test subscription row is written there. Delete it afterwards
> with the SQL at the end.

---

## 1. Install the Stripe CLI

```
$ brew install stripe/stripe-cli/stripe
$ stripe version
```
**Terminal:** something like `stripe version 1.x.y`. If `brew` is missing, install
Homebrew first from https://brew.sh.

## 2. Log in

```
$ stripe login
```
**Terminal:**
```
Your pairing code is: word-word-word-word
Press Enter to open the browser or visit https://dashboard.stripe.com/stripecli/confirm_auth?t=…
```
Press Enter. Check that the browser shows the **same pairing code**, then click **Allow access**.

**Terminal afterwards:** `> Done! The Stripe CLI is configured for <your account> with account id acct_…`

The login lasts 90 days.

## 3. Create the test prices and the promo code (Dashboard, test mode)

At https://dashboard.stripe.com, turn the **Test mode** toggle on (top right).
Then follow `docs/STRIPE_LAUNCH_SETUP.md`:
- **step 1:** the six EUR prices, with "Include tax in price: Yes";
- **step 2:** the Coach Life coupon, plus one promotion code. Call it `COACHLIFE-TEST1`: single use, minimum €299, Pro only.

Copy the six `price_…` IDs.

## 4. Put the keys in `.env.local`

In the project folder, create or edit `.env.local`. Nothing in it is committed.
```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

STRIPE_SECRET_KEY=sk_test_…              # Dashboard → Developers → API keys (test mode)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…            # filled in at step 6

STRIPE_PRICE_LIGHT_MONTHLY=price_…
STRIPE_PRICE_LIGHT_YEARLY=price_…
STRIPE_PRICE_PRO_MONTHLY=price_…
STRIPE_PRICE_PRO_YEARLY=price_…
STRIPE_PRICE_ACADEMY_MONTHLY=price_…
STRIPE_PRICE_ACADEMY_YEARLY=price_…
```
Leave `STRIPE_AUTOMATIC_TAX` out: tax stays off.

In the Supabase SQL editor, run `supabase/migrations/20261005120000_billing_r1g.sql` once.

## 5. Start the app (Terminal A)

```
$ npm ci          # first time only
$ npm run dev
```
**Terminal:**
```
▲ Next.js 15.x
- Local:        http://localhost:3000
✓ Ready in …
```

## 6. Forward webhooks (Terminal B)

```
$ stripe listen --forward-to localhost:3000/api/stripe/webhook
```
**Terminal:**
```
> Ready! You are using Stripe API Version [2026-05-27.dahlia]. Your webhook signing secret is whsec_abc123… (^C to quit)
```
1. Copy that `whsec_…` into `STRIPE_WEBHOOK_SECRET` in `.env.local`.
2. In Terminal A, stop the app with Ctrl+C and run `npm run dev` again, so it picks up the secret.

Leave Terminal B running. Every event Stripe sends shows up here.

## 7. A normal checkout (card)

1. Open http://localhost:3000, sign in with Google, and go to **/pricing**.
2. Pick **Pro → Yearly → Choose Pro**. Stripe Checkout opens and should show:
   - **€299.00** and **Tax €0.00**;
   - fields for email, full name, billing address and country;
   - optional fields for business name and VAT/tax ID;
   - the **Add promotion code** link (Pro yearly only).
3. Pay with card `4242 4242 4242 4242`, any future expiry, any CVC.
4. You land back on /analysis.

**Terminal B:**
```
--> checkout.session.completed [evt_…]
<--  [200] POST http://localhost:3000/api/stripe/webhook [evt_…]
--> customer.subscription.created [evt_…]
<--  [200] POST http://localhost:3000/api/stripe/webhook [evt_…]
--> invoice.paid [evt_…]
<--  [200] POST http://localhost:3000/api/stripe/webhook [evt_…]
```
Other event types appear too; the app ignores them and still answers 200.

**Dashboard → Customers:** one new customer with your name, email and address,
and an **active** Pro subscription at €299/year.

**Supabase SQL editor:**
```sql
select user_id, tier, status, billing_interval, current_period_end,
       cancel_at_period_end, stripe_customer_id
from subscriptions order by updated_at desc limit 5;
```
→ your row: `tier=pro`, `status=active`, `billing_interval=year`, a
`current_period_end` one year out, and `cancel_at_period_end=false`.
```sql
select * from stripe_webhook_events order by processed_at desc limit 10;
```
→ one row per processed event id.

**Same Customer is reused:** cancel the plan in the portal (/billing → Manage
billing), then subscribe again. Dashboard → Customers should still show **one**
customer for you, with two subscriptions.

## 8. Fail-closed checkout

1. In `.env.local`, put a `#` in front of `STRIPE_PRICE_LIGHT_MONTHLY` and restart the app.
2. /pricing → Monthly → **Choose Light**.

**Browser:** "Light (monthly) can't be purchased right now. Please contact us — you have not been charged."

**Terminal A:** `[stripe/checkout] refusing light monthly: STRIPE_PRICE_LIGHT_MONTHLY is not set`

Also point it at a wrong price, for example the Pro monthly ID. The log says `price … is 3490, site shows 1290`.

Undo both changes and restart.

## 9. Promo code on Pro yearly (Coach Life)

1. /pricing → Yearly → Choose Pro → **Add promotion code** → `COACHLIFE-TEST1`.

   **Checkout:** the total becomes **€149.00**.
2. Pay with 4242…

   **Dashboard → the subscription:** it shows the coupon "Coach Life — Pro yearly", forever.
3. Try the same code again with another test account: Stripe rejects it.
4. Pro monthly has no promotion-code field.

## 10. SEPA delayed payment

1. In test mode, enable **SEPA Direct Debit** under Settings → Payment methods.
2. Check out any plan, choose **SEPA Direct Debit**, and use a test IBAN from
   Stripe's "Testing — SEPA Direct Debit" page. At the time of writing,
   `AT611904300234573201` succeeds after a short delay; there are also numbers
   that fail.

**Terminal B, first:** `checkout.session.completed` → 200, then `customer.subscription.created` → 200.

**Supabase:** `status=incomplete`. No plan yet; the coach still has the free hour.

**When the payment clears** (seconds to minutes in test mode), Terminal B shows
`invoice.paid` and `customer.subscription.updated`, both 200.

**Supabase:** `status=active`. The plan is on.

## 11. A failed event, and replaying it

1. In Terminal A, stop the app (Ctrl+C) and start it again **without** the
   service key:
   ```
   $ SUPABASE_SERVICE_ROLE_KEY= npm run dev
   ```
2. Cause an event in the browser: /billing → Manage billing → change anything
   (for example, cancel at period end).

   **Terminal B:**
   ```
   --> customer.subscription.updated [evt_123…]
   <--  [500] POST http://localhost:3000/api/stripe/webhook [evt_123…]
   ```
   **Terminal A:**
   ```
   [stripe/webhook] SUPABASE_SERVICE_ROLE_KEY not configured; event evt_123… will be retried
   ```
   **Supabase:** unchanged, and evt_123 is **not** in `stripe_webhook_events`.
3. Restart the app normally (`npm run dev`), then replay that event (Terminal C):
   ```
   $ stripe events resend evt_123…
   ```
   **Terminal B:** `<--  [200] POST … [evt_123…]`. The row is now updated, and evt_123 is recorded.

   If the resend doesn't show up in Terminal B, use Dashboard →
   **Developers → Events** → evt_123 → **Resend**. A production endpoint
   doesn't need this step: Stripe retries 500s automatically for up to three
   days.
4. Run the same resend again.

   **Terminal B:** 200. **Terminal A:** nothing happens. It's a duplicate, so nothing is re-done.

## 12. Clean up

- Cancel test subscriptions in the dashboard (test mode).
- If you used the production Supabase project:
  ```sql
  delete from subscriptions where stripe_subscription_id like 'sub_%' and user_id = '<your user id>';
  ```
  Check the row first. Live subscription IDs look the same.
- Ctrl+C in Terminals A and B.
