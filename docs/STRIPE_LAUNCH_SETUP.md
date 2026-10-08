# Stripe setup for launch pricing (Vin)

Do this in **test mode first**. Run the checklist at the bottom on a Vercel
Preview (or locally with `docs/STRIPE_TEST_WALKTHROUGH.md`), then repeat in
**live mode** and promote.

**Prices live in Stripe only.** The site shows the amount of the Stripe Price
each `STRIPE_PRICE_*` env var points at (`lib/billing/livePrices.ts`, cached for
one hour), so what is shown is what is charged. Checkout refuses a price that
is archived, not in EUR, or not recurring every 1 month/year as its plan says.
A missing or bad price shows "—" and checkout says "can't be purchased right
now"; it never charges another amount.

### Changing a price

A Stripe Price can't be edited. To change one:
1. Create a new Price on the same product. Same settings as step 1.
2. Point the env var at the new `price_…` ID in Vercel.
3. Redeploy. The site shows the new amount immediately: the cache is keyed by
   the price IDs.
4. Archive the old Price once nobody needs it.
5. Existing subscribers stay on their old price until you move them.
6. Update the portal's "Switch plans" price list (step 6).

Everything below is **dashboard configuration only**. No code changes.

## 0. Database (Supabase) — before the deploy

Supabase → **SQL editor** → paste and run
`supabase/migrations/20261005120000_billing_r1g.sql`. It's safe to run twice.

It adds:
- The subscription fields the app caches: billing interval, period end,
  cancel-at-period-end and cancelled-at.
- The `stripe_webhook_events` table, so a webhook event is never processed twice.

If the code is deployed first, webhook writes fail and Stripe keeps retrying
until the SQL has run. Nothing is lost.

Then run `supabase/migrations/20261006120000_academy_seats_ebooks.sql`, also
safe to run twice. It adds:
- The `academy_members` table: the coaches an Academy subscriber adds on
  /billing (owner + 3). Only the owner can list them; adding and removing go
  through the app, which checks the plan and the 3-seat limit (a database
  trigger enforces the limit too).
- `academy_seat_subscriptions()`: lets a coach who was added see whether their
  owner's Academy plan is active, and nothing else.
- The **private** Storage bucket `ebooks` for the Spin Mechanics PDF.

If the app is deployed before this SQL runs, seats don't work yet (members just
get their own plan or the free hour) and the ebook card says "contact us".
Nothing breaks.

Then run `supabase/migrations/20261008120000_invoicing.sql`, also safe to run
twice. It adds:
- three more subscription fields: price ID, period start, Checkout session;
- the `billing_profiles` table (Italian invoice details);
- the `fiscal_invoices` table (one record per paid invoice).

See `docs/INVOICING.md`. Deployed before this SQL, webhook writes fail and
Stripe retries until it has run; nothing is lost.

### 0b. Upload the Spin Mechanics PDF (once)

The PDF is **never** committed to the repo. Upload it in the dashboard:

1. Supabase → **Storage** → bucket **`ebooks`**. The SQL above created it;
   check that it is **not** marked Public.
2. **Upload file** → choose the PDF. The file name must be exactly
   **`spin-mechanics.pdf`**, all lowercase, at the top level of the bucket (no
   folder). Rename it on your Mac first if needed.
3. Don't add any policies to this bucket. The app signs a 2-minute download
   link on the server for yearly Pro and Academy subscribers only.

To replace the book later, upload a new `spin-mechanics.pdf` over the old one
(choose "Replace"). Until the file is there, eligible coaches see "The download
isn't ready right now. Write to vinbaccelli@gmail.com", never a broken link.

## 1. Products and prices

Dashboard → **Product catalog** → **+ Add product**. Create three products. For
every price:
- Pricing model **Standard**, type **Recurring**, currency **EUR**. This must be
  the currency in `PRICE_CURRENCY` (`lib/plans.ts`); checkout refuses any other.
- **Include tax in price: Yes** ("inclusive" tax behaviour). This can't be
  changed after the price is created.

| Product | Price | Billing period | Copy the price ID into |
|---|---|---|---|
| AngleMotion Light | €12.90 | Monthly | `STRIPE_PRICE_LIGHT_MONTHLY` |
| AngleMotion Light | €129.00 | Yearly | `STRIPE_PRICE_LIGHT_YEARLY` |
| AngleMotion Pro | €34.90 | Monthly | `STRIPE_PRICE_PRO_MONTHLY` |
| AngleMotion Pro | €299.00 | Yearly | `STRIPE_PRICE_PRO_YEARLY` |
| AngleMotion Academy | €69.90 | Monthly | `STRIPE_PRICE_ACADEMY_MONTHLY` |
| AngleMotion Academy | €599.00 | Yearly | `STRIPE_PRICE_ACADEMY_YEARLY` |

The price ID starts with `price_`. It's on the price's detail page, under "API ID".
Don't rename these env vars. The amounts in this table are the launch prices.
The site reads whatever the Stripe Price says (see "Changing a price" above).

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

## 3. Tax (read once)

**Launch position.** Vin sells as an Italian sole proprietor in the regime
forfettario, on his existing Italian VAT number (confirmed by his accountant).
No VAT is charged: a €299 plan charges €299 and the receipt shows €0 tax.

What that means in Stripe:
- **Stripe Tax stays off.** Settings → **Tax**: add **no registrations**. Don't
  set `STRIPE_AUTOMATIC_TAX` in Vercel (unset means off).
- Checkout still collects, on Stripe's own form, the customer's:
  - full name and email
  - billing address and country
  - an optional business name
  - an optional VAT / tax ID

  All of it is saved on the Stripe Customer.
- All tax behaviour is configured in one file, `lib/billing/taxConfig.ts`. The
  site's only tax wording is `PRICE_TAX_NOTE` ("Prices are final: no extra taxes
  at checkout.") in `lib/plans.ts`.

**Turning Stripe Tax on later** (for example, if the accountant says EU OSS or
B2B reverse charge now applies):
1. Settings → **Tax** → add the registrations the accountant gives you (Italy,
   OSS, …). Stripe then works out B2C VAT by country and B2B reverse charge from
   the collected address and VAT ID.
2. In Vercel, set `STRIPE_AUTOMATIC_TAX=true` and redeploy. Checkout and
   invoices then calculate tax.
3. ⚠️ The prices are **inclusive**. VAT is taken **out of** the €299, not added
   on top: the customer still pays €299, and Vin receives €299 minus the VAT.
   If tax should be added on top instead, create new prices with "exclusive"
   tax behaviour, change the copy, and only then flip the flag.

## 4. Vercel environment variables

Project → **Settings → Environment Variables**, for **Production** and
**Preview** (Preview gets the *test-mode* values):
- Set the six `STRIPE_PRICE_*` vars from step 1.
- **Delete** `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY` (legacy; the code no longer reads them).
- Keep `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`.
- Leave `STRIPE_AUTOMATIC_TAX` unset (see step 3).
- Production only: the `INVOICE_*` settings in `docs/INVOICING.md` (seller data
  and the accountant's wording). Until they are set, invoices are recorded but
  can't be issued.

## 5. Webhook

Developers → **Webhooks** → your endpoint (`https://<domain>/api/stripe/webhook`).
Select exactly these seven events:

| Event | What the app does |
|---|---|
| `checkout.session.completed` | Links the new subscription to the coach and stores the Stripe Customer ID |
| `customer.subscription.created` | Syncs the row |
| `customer.subscription.updated` | Syncs status. This is how `past_due`, `unpaid`, plan switches and cancel-at-period-end arrive |
| `customer.subscription.deleted` | Status becomes `canceled`; paid features stop; data is kept |
| `invoice.paid` | Renewal paid: re-syncs the status and the new period end |
| `invoice.paid` (also) | Money taken: records the fiscal-invoice row (`docs/INVOICING.md`) and the customer's billing country |
| `invoice.payment_failed` | Renewal failed: re-syncs, so the coach sees "Payment failed — update your card" |
| `invoice.payment_action_required` | The bank asks the customer to confirm (3-D Secure): re-syncs; /billing sends them to the portal |

Each event is processed once; Stripe's repeats are ignored. A failed run
answers 500 so Stripe retries it.

## 6. Customer portal

Settings → **Billing → Customer portal**. The app opens it from /billing and
from the "update your card" banner, always with the coach's stored Customer.
- **Customer information**: allow updating the email, billing address and tax ID.
- **Payment methods**: allow updating the payment method.
- **Invoice history**: on.
- **Cancel subscriptions**: on, mode **"At the end of the billing period"**. The
  coach keeps access until then, and /billing shows "ends on <date>".
- **Switch plans**: on. Add the three products with **only the six new
  prices**. Proration is your choice ("Prorate" is Stripe's default).
- Business information: your support email, terms and privacy links.

## 7. Payments and billing settings (dashboard only)

- **Apple Pay / Google Pay**: Settings → **Payment methods** → turn on Apple
  Pay and Google Pay. Stripe Checkout shows them automatically on supported
  devices.
  - For Apple Pay in **live** mode, add your domain under Payment methods →
    Apple Pay → "Add new domain". Stripe-hosted Checkout usually needs no
    domain file; follow the dashboard if it asks.
- **SEPA Direct Debit** (optional): if you turn it on, a first SEPA payment
  stays `incomplete` until it clears. The coach keeps the free hour meanwhile,
  and gets the plan once the payment succeeds.
- **Smart Retries**: Settings → **Billing → Subscriptions and emails** → Manage
  failed payments → **Smart Retries** on. Choose what happens after all retries
  fail: "mark the subscription as unpaid" or "cancel the subscription". Both
  stop paid features; nothing is deleted.
- **Failed-payment emails**: same page → send emails when card payments fail →
  on, with a link to the Stripe-hosted page to update the payment method.
- **Customer receipts**: Settings → **Business → Customer emails** →
  "Successful payments" on.
- **Upcoming renewal reminders**: optional, same page.

## 8. Italian invoicing

Stripe's receipts and invoices are **not** Italian electronic invoices
(*fattura elettronica* via SdI). AngleMotion records every paid invoice and
generates the FatturaPA XML. You issue it on /admin/invoices and upload it in
Fatture e Corrispettivi. The whole workflow, the settings and the questions for
your accountant are in **`docs/INVOICING.md`**.

The Stripe receipt can also carry the accountant's wording:
- Settings → **Billing → Invoices** → **Default memo** / **Default footer**.
  This text is printed on every invoice and its PDF.
- Settings → **Business → Public details**: the legal business name, address and
  VAT number (Partita IVA) that appear on invoices and receipts.

## 9. Retire the old prices

1. Subscriptions → filter by each old USD price, in **live and test**. Confirm there are none, including your own and admin test subscriptions.
2. Supabase SQL editor: `select user_id, tier, status, stripe_subscription_id from subscriptions;`. Check for anything `active` or `trialing` that isn't on a new price.
3. **Archive** (don't delete) the old USD prices.

## Test-mode checklist (Preview deploy, or locally per the walkthrough)

Card `4242 4242 4242 4242`, any future date, any CVC.
- [ ] Each of the six plan/cycle buttons on /pricing opens Checkout showing the same euro amount as the card, and **€0.00 tax**.
- [ ] Checkout asks for full name, email, billing address and country. "Business" and VAT/tax ID are optional. After paying, the Stripe **Customer** shows the name and address. A second checkout by the same coach reuses **the same Customer**.
- [ ] Temporarily blank one `STRIPE_PRICE_*` var: that button says "can't be purchased right now" and the others still work.
- [ ] Point one var at a USD (or archived) price: refused the same way. Point it at another EUR price and redeploy: /pricing and the landing page show the new amount, and Checkout charges it.
- [ ] Pay with an Italian billing address: /billing shows **Invoice details (Italy)**; a wrong Codice Fiscale is refused; /admin/invoices lists the payment as To issue with number 65 proposed; once the `INVOICE_*` settings are set, Issue → the XML downloads.
- [ ] Pro yearly shows "Add promotion code". A Coach Life code makes it €149. The same code fails a second time. Pro monthly has no code field.
- [ ] After paying, `subscriptions` has your row with `status=active`, the right `tier`, `billing_interval`, `current_period_end`, and `cancel_at_period_end=false`.
- [ ] Stripe → Webhooks: the six events show **200**. Click **Resend** on one: still 200, and nothing changes (it's a duplicate).
- [ ] Temporarily remove `SUPABASE_SERVICE_ROLE_KEY` on Preview and trigger an event: **500**, and Stripe retries. Restore the key: the retry succeeds.
- [ ] Portal → cancel: `cancel_at_period_end=true`, and /billing says "ends on <date>". Access stays until then.
- [ ] Test clock or test card `4000 0000 0000 0341` (attaches, then fails on renewal): `past_due`, the red "Payment failed — update your card" pill appears, access is kept. Fix the card: `active` again.
- [ ] SEPA test (if enabled): the row stays `incomplete` until the test payment succeeds.
- [ ] Academy yearly: /billing shows **Coaches on your plan**. Add a second Google account's email, then sign in as that coach: every Pro tool works, /billing says "You're a coach on an Academy plan", and their /players list is empty (their own data). A 4th coach is refused. Remove the coach: they're back to their own plan or the free hour.
- [ ] Pro **yearly** or Academy **yearly**: /billing shows **Spin Mechanics ebook → Download PDF**, and the PDF downloads. Pro monthly, Light and Academy seat coaches don't see the card. Before uploading the PDF, the card says "contact us" instead.
