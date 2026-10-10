# Italian invoicing (fattura elettronica) for Anglemotion sales

How a paid Stripe sale becomes an Italian fiscal invoice. Code is the source of
truth; this page is derived from it:
- rules and settings: `lib/billing/invoicing/settings.ts`;
- the XML and its checks: `lib/billing/invoicing/fatturaPA.ts`;
- the Stripe snapshot: `lib/billing/invoicing/draft.ts` and `lib/billing/webhookSync.ts`;
- the admin page: `app/admin/invoices/`; its APIs: `app/api/admin/invoices/`.

**A Stripe receipt is not a fattura elettronica.** Stripe takes the payment and
stays the source of truth for it. The fiscal invoice is generated here as a
FatturaPA XML file and **transmitted by you**, by uploading it in the Agenzia
delle Entrate portal. Generating the XML is not issuing it to SdI: an invoice
counts as transmitted only once you upload it and mark it sent.

## What is sold (product types)

The VAT treatment depends on WHAT was sold and TO WHOM. Four product types:

| Product type | Covers | How it is known |
|---|---|---|
| `software_subscription` | Anglemotion Light, Pro, Academy (the six plans) | every subscription payment |
| `coaching_service` | tennis coaching, video analysis | one-off sale, you pick it |
| `digital_product` | ebooks, other digital one-off products | one-off sale, you pick it |
| `other` | anything else sold by payment link | one-off sale, you pick it |

A one-off sale's type is **never guessed**. The first time a Stripe product is
sold, the record says "Choose the product type". Your choice is remembered for
that Stripe product (`invoice_product_types`), so its later sales arrive
classified, and it is applied to the other open records for the same product.

## Six customer categories

**B2B** means the customer gave a business tax number: Partita IVA, EU VAT ID,
or a foreign business tax ID collected by Stripe. A company *name* alone is B2C.

`IT_B2C` Italian private · `IT_B2B` Italian business · `EU_B2C` EU private ·
`EU_B2B` EU business · `NON_EU_B2C` non-EU private · `NON_EU_B2B` non-EU business.

The category is re-computed when you issue, because an Italian customer may add
their Partita IVA on /billing after paying.

## VAT treatment: product type × category, each with a status

Every combination has a **Natura** code (or none) and a status:
**confirmed** or **pending** (awaiting your commercialista). Starting
configuration (`DEFAULT_TAX_RULES`, seeded by the v3 migration):

| | IT private | IT business | EU private | EU business | non-EU private | non-EU business |
|---|---|---|---|---|---|---|
| Subscriptions (software) | N2.2 pending | N2.2 pending | **none** pending (OSS) | N2.1 pending | N2.1 pending | N2.1 pending |
| Coaching / video analysis | **N2.2 confirmed** | N2.2 pending | N2.1 pending | N2.1 pending | N2.1 pending | N2.1 pending |
| Ebooks / digital | N2.2 pending | N2.2 pending | **none** pending (OSS) | N2.1 pending | N2.1 pending | N2.1 pending |
| Other | N2.2 pending | N2.2 pending | none pending | none pending | none pending | none pending |

Rate is always 0% and VAT €0 (forfettario). Only domestic coaching is confirmed,
because that is what your existing invoices do. N2.2 is not applied to
everything, and N2.1 is not applied to every foreign sale: each starts pending
until you confirm it. An optional legal reference (RiferimentoNormativo,
≤100 characters) can be set per combination.

**Pending = preview yes, issue no.** A sale whose rule is pending (or has no
Natura) is listed with the reason; its XML can be previewed when a Natura is
set; the Issue button stays blocked until the rule is confirmed.

## Standard wording (Causale)

Initial text, exactly as on your existing invoices (`EXISTING_FORFETTARIO_WORDING`):

> Operazione effettuata ai sensi dell’articolo 1, commi da 54 a 89, della Legge
> n. 190/2014 e successive modificazioni e integrazioni. Regime forfetario. Si
> richiede la non applicazione della ritenuta d’acconto ai sensi dell’articolo 1,
> comma 59, della Legge n. 190/2014.

- It is stored and written **exactly as saved** (only surrounding spaces are
  trimmed), split into 200-character Causale blocks.
- Whether it fits each product type has its own status: confirmed for coaching,
  pending for the others.
- ⚠️ **It contains the typographic apostrophe ’ (U+2019).** SdI and the
  official XSD accept only Latin-1 characters; the XSD rejects this text
  (verified with xmllint). The settings page flags it and blocks issuing. It
  does **not** change it: press "Replace ’ with '" and Save when you decide to.

## Customer identification (separate from VAT treatment)

| Customer | Identifier in the XML | CodiceDestinatario |
|---|---|---|
| Italian private | first + last name, **Codice Fiscale** (asked on /billing), no Partita IVA | `0000000`, or their PEC (optional) |
| Italian business | Partita IVA (+ CF if given), Denominazione | their code, or PEC, or `0000000` |
| Foreign business | country + VAT number (IdFiscaleIVA) | `XXXXXXX` |
| Foreign private | **`OO99999999999`** (IdPaese `OO`, IdCodice `99999999999`) — confirmed by your commercialista | `XXXXXXX` |

- Foreign private customers are **never** asked for an Italian Codice Fiscale.
  No PEC is written for foreign customers.
- **Real address kept.** The customer's actual street, city and country are
  written. A postcode that is 5 digits goes in CAP. A postcode the CAP field
  cannot hold (UK `SW1A 2AA`, Australian `2517`) is kept in the address line
  ("10 Downing Street - SW1A 2AA") and CAP is `00000`. Nothing is invented.
- The identifier and its status are in Invoice settings. If set to pending,
  foreign private invoices are blocked.

## Amounts and stamp duty (D7: absorbed)

Four amounts are stored apart: price (taxable), VAT, stamp duty, total.
- **Total = what the customer paid in Stripe.** Never more, never less.
- **Stamp duty** €2 when the invoice is over €77.47: declared (DatiBollo,
  BolloVirtuale SI, ImportoBollo 2.00) and **not added** to the total. You pay
  it to the State; the customer's total is unchanged.
- Example: Stripe €200 → taxable €200, VAT €0, stamp duty €2 declared, total
  **€200** (never €202, never €198). Reconciles 1:1 with Stripe.
- Per Natura: N2.2 **applies** (confirmed); **N2.1 pending** — an N2.1 invoice
  over €77.47 is blocked until you set "applies" or "does not apply".

## Numbering and dates

- Document TD01 (fattura), format FPR12, currency as paid (EUR), date = the
  issue date (today in Italy by default, editable, never before the payment).
- Next number = highest of (your last number issued elsewhere this year — 2026
  / 64 by default — and the highest issued here) + 1. A new year starts at 1.
- **No duplicates, even when several are issued at once.** (year, number) is
  unique in the database: of two issues racing for the same number, one fails
  with "already used — reload". A record can be issued only once (the update
  is conditional on status "to issue").
- A number below the next one, or a date before your last invoice's date, is
  refused. A number that skips ahead needs you to tick "those numbers were
  used elsewhere" (the gap is noted on the record).
- Numbers are proposed only to records that can be issued now, in payment
  order, so a blocked record never leaves a gap.

## The workflow

1. **A customer pays.** The Stripe webhook (signature-checked) records the
   sale as **To issue**:
   - subscriptions on `invoice.paid` (amount > 0);
   - one-off sales on `checkout.session.completed`, or
     `checkout.session.async_payment_succeeded` for methods that confirm later.

   The record holds the Stripe customer ID, invoice / Checkout Session /
   PaymentIntent IDs, product type and Stripe product IDs, amount and
   currency, name, billing address, country, category, tax ID, and whether it
   was **live or test**. No card details are stored — Stripe keeps them.
   A retried or repeated event never creates a second record (event-level and
   record-level idempotency).
2. **Customers add their tax details** on /billing (Invoice details): Italian
   customers their Codice Fiscale, or Partita IVA / Codice Destinatario / PEC;
   others an optional tax ID.
3. **Open /admin/invoices** (administrators only — anyone else gets a 404, and
   every API checks again). For each record:
   - choose the product type if asked;
   - fix anything listed under it;
   - press **Preview**: the XML and a checklist (supplier, customer,
     numbering, Natura and rate, total vs the Stripe payment, stamp duty,
     foreign identification, not already invoiced);
   - press **Issue n. X**.
4. **Download the XML** and upload it: Fatture e Corrispettivi → Fatturazione
   elettronica → Trasmissione → upload. The portal signs and sends it to SdI.
5. **Mark sent** (optionally with the SdI identifier). "Undo" works only before
   upload; after that, corrections go through a nota di credito in the portal.

Issue within **12 days** of the payment; the page shows the deadline.

**Void** (with a reason) is for a record that needs no invoice (a refunded test,
a payment that wasn't a sale). Voided and externally-invoiced records can be
sent back to review.

**Refunds.** `charge.refunded` records the refunded amount on the sale (matched
by PaymentIntent). A refunded record is blocked from issuing until you decide
(void it, or issue and handle the credit note with your commercialista).

**Webhook errors.** A failed event is logged (`billing_event_errors`, with the
attempt count) and shown on /admin/invoices until Stripe's retry succeeds.

**Export CSV for the accountant** downloads every record with its amounts.

## Past payments (historical: Italy, UK, Australia payment links)

Stripe data cannot prove that an Italian invoice was issued, so **nothing is
invoiced automatically**. In the Review queue:
1. **Find Stripe payments with no record** (since a date) — subscriptions and
   payment links.
2. **Import for review** (one, or up to 50 at once): they enter the **review**
   queue. Each payment can get only one record.
3. For each one, decide:
   - **Needs an invoice → To issue** (then preview/issue as usual);
   - **Already invoiced elsewhere**, with the reference (e.g. "FatturAE
     63/2026") — recorded as external and never invoiced again;
   - **Void**, with the reason.

The page therefore separates: issued here / invoiced elsewhere (confirmed),
in review (unknown), and Stripe payments with no record (missing).

## Test mode

Test-mode payments are recorded with `livemode = false`, shown under
**Test-mode payments** with a TEST badge, previewable, and **never issuable**:
they never take a number. The webhook refuses (500, logged) an event whose mode
doesn't match the deployment's `STRIPE_SECRET_KEY` (a test event on a live key).

### How to test without creating a production invoice

**Subscription (test mode, on a Preview deploy):**
1. On Vercel **Preview** set `STRIPE_SECRET_KEY` = your `sk_test_…`, the six
   test `STRIPE_PRICE_*` IDs, and `STRIPE_WEBHOOK_SECRET` = the **test**
   endpoint's secret; point the test endpoint at that Preview URL
   (`/api/stripe/webhook`).
2. Subscribe with card `4242 4242 4242 4242` and an Italian address.
3. Expect: Stripe → Webhooks shows 200; /admin/invoices (on the Preview) shows
   the payment under Test-mode payments; Preview shows the XML and checklist;
   Issue is impossible.
4. Resend the event in Stripe: still one record.

**One-off (test mode):** create a test payment link for a test product, pay it,
then pick the product type on the record. Preview it; nothing is issued.

**Live check without a fiscal invoice:** buy the cheapest one-off with your own
card, refund it in Stripe. The record shows REFUNDED and is blocked; void it
("own test, refunded"). No number is used. This is also the first real proof
that the live webhook secret works — until then it is **unverified**.

## Transmission: what is and isn't integrated

- **Integrated:** recording sales from Stripe, rules, numbering, XML
  generation, validation (checklist + the same structure as the official
  FatturaPA 1.2.1 XSD; samples for IT private, IT business with PEC, DE
  business, UK and AU private with `OO99999999999`, and a subscription all
  validate), download, status tracking.
- **Not integrated:** transmission to SdI. FatturAE / Fatture e Corrispettivi
  have no public API. Automatic sending needs an **accredited intermediary**
  (a paid e-invoicing provider with an SdI channel, e.g. via their API), or
  your own accredited SdI channel. The XML is standard FatturaPA, so a provider
  can be added later without changing the records; the provider would also
  return the SdI receipts (ricevute) that today you check in the portal.

## Settings (Invoice settings on /admin/invoices) — D9

Stored in the database (`invoice_settings`, one row, admin-only). **Not** in
code and **not** in Vercel. Missing fiscal identifiers are listed, never
invented; until they are filled in, nothing can be issued.

- **Business identity:** first/last name, address, CAP, city, province,
  Partita IVA, Codice Fiscale, regime fiscale (RF19), payment method (MP08).
- **ATECO code(s):** free text for your records (e.g. 85.51.01 and your
  software code). Not written on the XML; nothing depends on it.
- **Your SdI reception details** (PEC, Codice Destinatario): reference only.
- **Numbering and document:** last number issued elsewhere (year + number),
  line templates (`{plan} {interval} {start} {end}`; `{product}`).
- **Standard wording** + its status per product type.
- **VAT treatment** per product type × category: Natura, status, reference.
- **Stamp duty:** on/off, threshold, amount, and a rule per Natura.
- **Foreign customer identification:** `OO99999999999` + status.
- **Awaiting your commercialista:** the list of everything still pending.

## Waiting for your commercialista

- Subscriptions (software), ebooks/digital, other sales: Natura per category.
- **EU private customers (OSS)** for software and digital products: no Natura
  yet. The page shows this year's EU-private total.
- Coaching to Italian businesses and to foreign customers.
- Stamp duty on N2.1 invoices over €77.47.
- Whether the forfettario wording applies to the software, ebook and other
  product types (confirmed for coaching).
- ATECO: no change assumed.

## Database (run in order in the Supabase SQL editor; each is safe to re-run)

1. `supabase/migrations/20261008120000_invoicing.sql` — `billing_profiles`,
   `fiscal_invoices`, subscription fields.
2. `supabase/migrations/20261009120000_invoicing_v2.sql` — `invoice_settings`,
   one-off sales, categories, amount columns, status `external`.
3. `supabase/migrations/20261011120000_invoicing_v3.sql` — the rule matrix and
   statuses, wording status, stamp-duty rules, foreign identifier status;
   on `fiscal_invoices`: `product_type`, `stripe_product_ids`, `livemode`,
   refunds, `sdi_id`, `external_reference`, `void_reason`, errors, statuses
   `review` and `void`; tables `invoice_product_types` and
   `billing_event_errors`. It fills the wording and `OO99999999999` only where
   still empty, and never overwrites a saved value.

## Later: VAT

If VAT ever applies (leaving forfettario, or OSS), Stripe Tax is switched on
(`docs/STRIPE_LAUNCH_SETUP.md` §3). VAT-bearing invoices (rate > 0) are not
generated by this code yet; the VAT amount column is already there.
