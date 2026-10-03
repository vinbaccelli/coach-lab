# Stripe setup for launch pricing (Vin)

Do this in **test mode first**, run the checklist at the bottom on a Vercel
Preview, then repeat in **live mode** and promote. The displayed prices and the
Stripe price IDs go live in the **same deploy**: the code already refuses to
sell any plan whose Stripe price doesn't match the site (currency, amount,
interval), so a half-configured release fails safe (checkout says "can't be
purchased right now") rather than charging the wrong amount.

## 1. Products and prices

Dashboard → **Product catalog** → **+ Add product**. Create three products. For
every price:
- Pricing model **Standard**, type **Recurring**, currency **EUR**.
- **Include tax in price: Yes** ("inclusive"). This can't be changed after the
  price is created.
- Do **not** turn on Stripe Tax / automatic tax. The site says prices are final
  and nothing is added at checkout.

| Product | Price | Billing period | Copy the price ID into |
|---|---|---|---|
| AngleMotion Light | €12.90 | Monthly | `STRIPE_PRICE_LIGHT_MONTHLY` |
| AngleMotion Light | €129.00 | Yearly | `STRIPE_PRICE_LIGHT_YEARLY` |
| AngleMotion Pro | €34.90 | Monthly | `STRIPE_PRICE_PRO_MONTHLY` |
| AngleMotion Pro | €299.00 | Yearly | `STRIPE_PRICE_PRO_YEARLY` |
| AngleMotion Academy | €69.90 | Monthly | `STRIPE_PRICE_ACADEMY_MONTHLY` |
| AngleMotion Academy | €599.00 | Yearly | `STRIPE_PRICE_ACADEMY_YEARLY` |

The price ID starts with `price_`. It's on the price's detail page, under "API ID".

## 2. Coach Life coupon and promotion codes

1. **Product catalog → Coupons → + New**:
   - Name: `Coach Life — Pro yearly`
   - Type: **Fixed amount**, **€150.00**, currency EUR
   - Duration: **Forever** (renewals stay at €149)
   - **Apply to specific products → AngleMotion Pro**
2. On the coupon, go to **Promotion codes → + Create**. Create one code per member:
   - **Limit to first-time customers:** on
   - **Limit the number of times this code can be redeemed:** 1
   - **Require minimum order value:** **€299.00**. Without this, the €150 would apply to Pro monthly (€34.90) too.

   For many codes at once, use the API or a CSV import. Every code points at the same coupon.
3. Nothing to set in Vercel for this. Checkout shows the "Add promotion code"
   field on **Pro yearly only**.

Result: Pro yearly €299 − €150 = **€149/year**, renewing at €149.

## 3. Vercel environment variables

Project → **Settings → Environment Variables**, for **Production** and
**Preview** (Preview with the *test-mode* IDs):
- Set the six `STRIPE_PRICE_*` vars from step 1.
- **Delete** `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY` (legacy; the code no longer reads them).
- Keep `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Webhook

Developers → **Webhooks** → your endpoint (`https://<domain>/api/stripe/webhook`).
It must send these four events:
`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`.

## 5. Customer portal

Settings → **Billing → Customer portal**:
- Allow switching only between the six new prices, or turn plan switching off for launch.
- Allow cancellation.

## 6. Retire the old prices

1. Subscriptions → filter by each old USD price, in **live and test**. Confirm there are none, including your own and admin test subscriptions.
2. Supabase SQL editor: `select user_id, tier, status, stripe_subscription_id from subscriptions;`. Check for anything `active` or `trialing` that isn't on a new price.
3. **Archive** (don't delete) the old USD prices.

## Test-mode checklist (Preview deploy with test keys)

Card `4242 4242 4242 4242`, any future date, any CVC.
- [ ] Each of the six plan/cycle buttons on /pricing opens Checkout showing the same euro amount as the card.
- [ ] Temporarily blank one `STRIPE_PRICE_*` var → that button shows "can't be purchased right now", others still work.
- [ ] Point one var at a price with a different amount → refused the same way.
- [ ] Pro yearly shows "Add promotion code"; a Coach Life code makes it €149; the same code fails a second time; Pro monthly has no code field.
- [ ] After paying: `subscriptions` has your row with `status=active` and the right `tier` (light/pro/academy).
- [ ] Stripe → Webhooks → the events show **200**. Then temporarily remove `SUPABASE_SERVICE_ROLE_KEY` on Preview, trigger an event (e.g. cancel in the portal) → it shows **500** and Stripe retries; restore the key → the retry succeeds.
- [ ] Cancel in the portal → `status` becomes `canceled`; /analysis falls back to the trial / pricing redirect.
- [ ] SEPA test (if SEPA is enabled): the row stays `incomplete` until the test payment succeeds.
