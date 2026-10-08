# Italian invoicing (fattura elettronica) for AngleMotion subscriptions

How a paid subscription becomes a fiscal invoice. A Stripe receipt is **not** a
fattura elettronica. Stripe takes the payment; the fiscal invoice is issued
from AngleMotion and sent to SdI through the Agenzia delle Entrate portal.

## The workflow (Vin)

1. A coach pays. Stripe sends `invoice.paid`, and the webhook creates a row in
   `fiscal_invoices` with status **To issue**. The row holds:
   - who paid, their billing address and country;
   - business name and VAT ID, if any;
   - the amount actually paid (after any Coach Life discount);
   - plan, period, and the Stripe invoice, payment, customer and subscription IDs.

   A €0 invoice creates no row.
2. Italian customers see an **Invoice details (Italy)** card on /billing, where
   they enter:
   - Codice Fiscale (needed for private customers);
   - Partita IVA, Codice Destinatario or PEC (businesses).

   The card is shown when their Stripe billing country is IT.
3. Open **/admin/invoices** (admin accounts only). For each invoice to issue:
   - check the **number** and the **date**. The number continues your FatturAE
     sequence: the first one is **65**, because the last was 64 in 2026. If you
     issue other invoices by hand in FatturAE, change the number to the next
     free one. The same number can't be used twice in a year;
   - fix anything listed under the invoice (for example, a missing Codice
     Fiscale: ask the customer to add it on /billing);
   - press **Issue**. The FatturaPA XML is generated and frozen on the row.
4. **Download** the XML and upload it on the Agenzia delle Entrate site:
   **Fatture e Corrispettivi** → Fatturazione elettronica → Trasmissione →
   upload the file. The portal signs it and sends it to SdI.
5. Press **Mark sent**.
   - If you issued an invoice by mistake and have **not** uploaded it yet,
     **Undo** puts it back to To issue.
   - Once sent, the portal is the only place to correct it, with a nota di
     credito.

Issue within **12 days** of the payment (fattura immediata). The page shows the
deadline and marks late ones.

**Export CSV for the accountant** downloads every record.

### Why not fully automatic

FatturAE and Fatture e Corrispettivi have no public API. Sending to SdI without
the portal needs an accredited channel or a paid intermediary (Aruba, Fatture in
Cloud, A-Cube…). The XML this produces is the standard FatturaPA format, so it
can later be sent through such a provider's API without changing the records.

## What the XML contains

FatturaPA 1.2, format **FPR12** (fattura tra privati), TipoDocumento **TD01**.
Built by `lib/billing/invoicing/fatturaPA.ts`.

**Seller (you)**
- Nome and Cognome, Partita IVA, Codice Fiscale.
- RegimeFiscale **RF19** (forfettario).
- Your address.

**One line**
- The description, then the amount paid.
- AliquotaIVA **0.00**, Natura **N2.2** (configurable).

**Causale**
- Your regime wording, exactly as configured.

**DatiBollo (stamp duty)**
- BolloVirtuale SI, €2.00, when the total is over €77.47.
- It is **declared, not added**: the customer paid the clean price and you
  absorb the €2. The Agenzia bills the bolli quarterly from your e-invoices.

**Customer**

| Customer | Identifier | Delivery |
|---|---|---|
| Italian private | Codice Fiscale | Codice Destinatario `0000000` (their cassetto fiscale), or their PEC |
| Italian business | Partita IVA | Codice Destinatario, or PEC, or `0000000` |
| Foreign (EU or non-EU) | IdFiscaleIVA: country + VAT number, or `99999999999` for a private person | CodiceDestinatario `XXXXXXX`, CAP `00000` |

**DatiPagamento**
- TP02 (paid in full), MP08 (card).

Four generated samples (IT private, IT business, EU business, non-EU) validate
against the FatturaPA XSD. The checked copy was v1.2.1, with the N2.x Natura
codes added as in the current specification.

## Settings (Vercel → Environment Variables → Production)

Nothing fiscal is hardcoded. Until the required ones are set, /admin/invoices
lists what is missing and refuses to issue.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `INVOICE_SELLER_FIRST_NAME` | yes | | Your first name, as on your Partita IVA |
| `INVOICE_SELLER_LAST_NAME` | yes | | Your surname |
| `INVOICE_SELLER_PARTITA_IVA` | yes | | 11 digits |
| `INVOICE_SELLER_CODICE_FISCALE` | yes | | Your Codice Fiscale |
| `INVOICE_SELLER_ADDRESS` | yes | | Street and number of your sede |
| `INVOICE_SELLER_CAP` | yes | | 5 digits |
| `INVOICE_SELLER_CITY` | yes | | Comune |
| `INVOICE_SELLER_PROVINCE` | | | 2 letters, e.g. MI |
| `INVOICE_SELLER_REGIME_FISCALE` | | `RF19` | Forfettario |
| `INVOICE_REGIME_WORDING_IT` | **yes** | none | The legal wording your accountant gives you. Printed as Causale on every invoice |
| `INVOICE_TAX_REFERENCE_IT` | | | Short legal reference in the VAT summary (RiferimentoNormativo, ≤100 characters) |
| `INVOICE_TAX_NATURE_IT` | | `N2.2` | Natura for Italian customers |
| `INVOICE_TAX_NATURE_EU_B2B` | | = IT | Natura for EU businesses. **Ask your accountant.** |
| `INVOICE_TAX_NATURE_EU_B2C` | | = IT | Natura for EU private customers. **Ask your accountant.** |
| `INVOICE_TAX_NATURE_NON_EU` | | = IT | Natura for customers outside the EU. **Ask your accountant.** |
| `INVOICE_TAX_RATE_IT` | | `0` | Only 0 is supported (forfettario) |
| `INVOICE_STAMP_DUTY_RULE_IT` | | `auto` | `auto` = record the bollo when the rule below matches; `off` = never |
| `INVOICE_STAMP_DUTY_THRESHOLD` | | `77.47` | Bollo only above this total |
| `INVOICE_STAMP_DUTY_AMOUNT` | | `2.00` | |
| `INVOICE_STAMP_DUTY_NATURES` | | = IT Natura | Comma-separated Natura codes the bollo applies to |
| `INVOICE_LAST_ISSUED_YEAR` | | `2026` | Year of the last invoice issued outside AngleMotion |
| `INVOICE_LAST_ISSUED_NUMBER` | | `64` | Its number. The next proposed is this + 1 |
| `INVOICE_DESCRIPTION_TEMPLATE` | | `Abbonamento AngleMotion {plan} {interval} - periodo dal {start} al {end}` | Line description |
| `INVOICE_PAYMENT_METHOD` | | `MP08` | FatturaPA ModalitaPagamento (MP08 = card) |
| `INVOICE_FOREIGN_PRIVATE_ID` | | `99999999999` | IdCodice for a foreign customer with no VAT number. **Confirm with your accountant.** |

Questions for your accountant, before the first invoice:
1. The exact wording for `INVOICE_REGIME_WORDING_IT`. Should a short reference
   also go in `INVOICE_TAX_REFERENCE_IT`?
2. The Natura for EU businesses, EU private customers and non-EU customers. The
   default is N2.2 for all.
3. Is `99999999999` the identifier they want for foreign private customers?
4. The bollo: €2 over €77.47, absorbed by you. Confirm.

## Database

Created by `supabase/migrations/20261008120000_invoicing.sql` (run it once in
the SQL editor before deploying).

- `billing_profiles`, one row per coach:
  - billing country (written by the webhook);
  - Codice Fiscale, Partita IVA, Codice Destinatario, PEC (written by
    /api/billing/profile after validation, including the CF and P.IVA check
    characters).
  - Coaches can read only their own row.
- `fiscal_invoices`, one row per paid Stripe invoice: the payment snapshot plus
  the issued invoice (number, date, Natura, rate, wording, bollo, XML).
  - Admin-only (service role).
  - Unique per Stripe invoice and per (year, number).
- `subscriptions` also gains `stripe_price_id`, `current_period_start` and
  `stripe_checkout_session_id`.

## Later: EU OSS / VAT

If the accountant says VAT now applies (leaving forfettario, or EU B2C OSS):
1. Stripe Tax: add the registrations and set `STRIPE_AUTOMATIC_TAX=true`
   (`docs/STRIPE_LAUNCH_SETUP.md` §3).
2. VAT-bearing invoices (rate > 0, Imposta > 0) are not generated yet:
   `INVOICE_TAX_RATE_IT` other than 0 is refused on purpose. That change needs
   the per-invoice tax amount from Stripe on each record, and is a separate
   piece of work.
