# Italian invoicing (fattura elettronica) for AngleMotion sales

How a paid sale becomes a fiscal invoice. A Stripe receipt is **not** a
fattura elettronica. Stripe takes the payment and stays the source of truth for
it. The fiscal invoice is issued from AngleMotion and sent to SdI through the
Agenzia delle Entrate portal.

Two kinds of sale go through the same workflow (D10):
- **Subscriptions**: AngleMotion Light, Pro and Academy. Each paid renewal is a sale.
- **One-off sales**: payment links for coaching, the ebook, analyses and
  anything else sold through a Stripe Checkout.

## The workflow (Vin)

1. **A customer pays.** The Stripe webhook creates a record with status **To issue**:
   - subscriptions on `invoice.paid`;
   - one-off sales on `checkout.session.completed`, or on
     `checkout.session.async_payment_succeeded` for payments that confirm later.

   The record holds:
   - who paid, their address, country and VAT/tax ID;
   - what they bought (plan and period, or the product name);
   - the amount actually paid;
   - the Stripe IDs (invoice or Checkout Session, payment, customer, subscription).

   A €0 sale creates no record.
2. **Customers add their tax details** in an **Invoice details** card on
   /billing, once the webhook has recorded their billing country:
   - Italian customers: Codice Fiscale (private customers), or Partita IVA,
     Codice Destinatario or PEC (businesses);
   - everyone else: their own tax ID, optional.
3. **Open /admin/invoices** (admin accounts only).
   - The first time, open **Invoice settings** and fill in your data
     (see Settings below).
   - For each record to issue:
     - check the **number** (it continues your FatturAE sequence: first **65**)
       and the **date**;
     - fix anything listed under it;
     - press **Issue**.
4. **Download** the XML and upload it on the Agenzia delle Entrate site:
   **Fatture e Corrispettivi** → Fatturazione elettronica → Trasmissione →
   upload the file.
5. **Press Mark sent.** "Undo" works only for an invoice that was never
   uploaded. After that, corrections go through a nota di credito in the portal.

Issue within **12 days** of the payment. The page shows the deadline.

**Past payments without an invoice.** The **Find payments without an
invoice** panel lists paid Stripe sales since a date you pick that have no
record. Nothing is created automatically. For each payment you choose:
- **Add to invoicing**: it becomes "To issue".
- **Already invoiced elsewhere**: you invoiced it by hand in FatturAE. It is
  recorded as *external*, never invoiced twice, and no longer listed.

**Export CSV for the accountant** downloads every record with its amounts.

### Why not fully automatic

FatturAE and Fatture e Corrispettivi have no public API. Sending straight to
SdI needs an accredited channel or a paid intermediary. The XML is standard
FatturaPA, so it could be sent through such a provider later without
changing the records.

## Customer categories and VAT treatment

Every invoice is classified into one of six categories.

**B2B** means the customer gave a business tax number: Partita IVA, EU VAT ID
or a foreign business tax ID. A company *name* alone is B2C.

| Category | Natura (default) | Status |
|---|---|---|
| Italian private (IT_B2C) | N2.2 | confirmed (forfettario) |
| Italian business (IT_B2B) | N2.2 | confirmed |
| EU business (EU_B2B) | N2.1 | outside Italian VAT (art. 7-ter) |
| **EU private (EU_B2C)** | **none** | **pending: T2 (OSS), ask the accountant** |
| Non-EU private (NON_EU_B2C) | N2.1 | outside Italian VAT |
| Non-EU business (NON_EU_B2B) | N2.1 | outside Italian VAT |

Each category's Natura and optional legal reference (RiferimentoNormativo)
are set in Invoice settings. If a category has no Natura, its invoices are
listed with the reason and cannot be issued. Nothing is guessed.

/admin/invoices shows this year's running total of EU private-customer sales,
for the OSS question.

## Amounts (D7)

Every invoice keeps four amounts apart: subscription/product price, VAT,
stamp duty, invoice total.

- **VAT** is always €0 (forfettario).
- **Stamp duty** is €2 above €77.47 for the listed Natura codes. It is
  **absorbed by you**: declared on the invoice (DatiBollo, BolloVirtuale SI)
  and **never added to the total**.
- **Example:** Stripe payment €200 → taxable €200, VAT €0, stamp duty €2,
  invoice total €200.
- **D8, pending:** stamp duty applies to **N2.2 only** until your accountant
  confirms N2.1. To extend it, add `N2.1` to "For Natura codes" in Invoice
  settings.

## What the XML contains

FatturaPA 1.2, format **FPR12**, TipoDocumento **TD01**. Built by
`lib/billing/invoicing/fatturaPA.ts`.

**Seller (you):** Nome, Cognome, Partita IVA, Codice Fiscale, RegimeFiscale
(RF19) and address, all from Invoice settings.

**One line:** the description (subscription template, or the product name for
one-off sales), the amount paid, AliquotaIVA 0.00 and the category's Natura.

**Causale:** your forfettario wording.

**Customer:**

| Customer | Identifier | Delivery |
|---|---|---|
| Italian private | Codice Fiscale | `0000000` (cassetto fiscale), or PEC |
| Italian business | Partita IVA | Codice Destinatario, or PEC, or `0000000` |
| Foreign | country + VAT ID, or their own tax ID | **`XXXXXXX`**, CAP `00000` |
| Foreign private without any tax ID | **pending: T3** | blocked until you set the identifier your accountant confirms |

The generated samples validate against the FatturaPA XSD (v1.2.1, with the
N2.x Natura codes added as in the current specification).

## Settings (Invoice settings on /admin/invoices) — D9

Stored in the database (`invoice_settings`, admin-only). **Not** in code and
**not** in Vercel. Until the required ones are filled in, the page lists what
is missing and nothing can be issued.

**Seller (all required unless noted):**
- first name, last name;
- address, CAP, city (Comune), province (optional);
- Partita IVA, Codice Fiscale;
- regime fiscale (RF19);
- ATECO (for your records only; it doesn't appear on the XML).

**Your SdI reception details (PEC, Codice Destinatario):** for reference only.

**Forfettario wording (required):** the exact text from your accountant.

**Natura and legal reference** for each of the six categories (see above).

**Foreign private customer identifier:** pending T3.

**Stamp duty:** on/off, threshold, amount, Natura codes.

**Numbering:** the last invoice you issued elsewhere (2026 / 64 by default),
so the next proposed number is 65.

**Line descriptions:**
- Subscription: `{plan} {interval} {start} {end}`.
- One-off: `{product}`.

**Payment method code:** MP08 (card).

**ATECO.** Your current code is 85.51.01. Selling software may need another
code, and it can change your forfettario coefficient. Nothing in the app
depends on it, so update the field whenever your accountant confirms.

## Pending — answers from the accountant

- **T2:** VAT treatment of SaaS sold to EU private customers, and whether
  OSS registration is required. Set it as the "EU private" Natura.
- **D8:** whether the €2 stamp duty also applies to N2.1 invoices over €77.47.
  If yes, add `N2.1` to the stamp-duty Natura codes.
- **T3:** the identifier for a foreign private customer with no tax ID.
- **Forfettario wording** and **ATECO.**

## Database

**`supabase/migrations/20261008120000_invoicing.sql`**
- `billing_profiles`;
- `fiscal_invoices`;
- the subscription price, period-start and Checkout-session fields.

**`supabase/migrations/20261009120000_invoicing_v2.sql`**
- `invoice_settings`: one row, admin-only;
- `billing_profiles.foreign_tax_id`;
- on `fiscal_invoices`:
  - `source` (subscription / one-off);
  - `stripe_checkout_session_id` (unique) for one-off sales;
  - `product_description`;
  - `customer_category`;
  - `foreign_tax_id`;
  - the four amount columns (`taxable_amount_cents`, `vat_amount_cents`,
    `stamp_duty_cents`, `invoice_total_cents`);
  - `note`;
  - the status `external`.

**Run both, in order, in the Supabase SQL editor.**

## Later: VAT

If VAT ever applies (leaving forfettario, or OSS), Stripe Tax is switched on
(`docs/STRIPE_LAUNCH_SETUP.md` §3). VAT-bearing invoices (rate > 0) are not
generated by this code yet. The VAT amount column is already there for when
they are.
