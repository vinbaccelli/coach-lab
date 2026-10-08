import type { CustomerRegion } from '@/lib/billing/invoicing/draft';

/**
 * Invoice / fiscal settings for the Italian fattura elettronica — the ONLY
 * place they are read (P4). Everything legal or fiscal is configuration, set in
 * Vercel as confirmed by Vin's accountant; nothing here invents a tax rule.
 * Pure (env in, settings out), unit-tested (tests/invoiceSettings.test.ts).
 * The full list with meanings is in docs/INVOICING.md.
 *
 * Defaults are only the values Vin has already confirmed:
 *  - regime forfettario → RegimeFiscale RF19, no VAT: rate 0, Natura N2.2;
 *  - stamp duty absorbed by Vin (never added to the price), recorded on
 *    invoices over €77.47 with a listed Natura (D5, 2026-10-07);
 *  - his last paper-trail invoice was n. 64 of 2026, so the next is 65 (D3).
 * The regime wording has NO default: an invoice is not issued until it is set.
 */

export interface SellerSettings {
  firstName: string;
  lastName: string;
  partitaIva: string;
  codiceFiscale: string;
  address: string;
  cap: string;
  city: string;
  province: string;
  /** RF19 = regime forfettario. */
  regimeFiscale: string;
}

export interface InvoiceSettings {
  seller: SellerSettings;
  /** VAT treatment ("Natura") per customer kind. All default to INVOICE_TAX_NATURE_IT. */
  nature: { IT: string; EU_B2B: string; EU_B2C: string; NON_EU: string };
  taxRate: number;
  /** Printed on every invoice (Causale), e.g. the forfettario legal wording. Required. */
  regimeWording: string;
  /** Short legal reference in the VAT summary (RiferimentoNormativo, ≤100 chars). Optional. */
  taxReference: string;
  stampDuty: { rule: 'auto' | 'off'; threshold: number; amount: number; natures: string[] };
  /** The last invoice Vin issued outside this system, so numbering continues from it. */
  lastIssued: { year: number | null; number: number | null };
  /** {plan} {interval} {start} {end} are filled in. */
  descriptionTemplate: string;
  /** FatturaPA ModalitaPagamento; MP08 = carta di pagamento (Stripe card payments). */
  paymentMethod: string;
  /** IdCodice used for a foreign customer with no VAT number. */
  foreignPrivateId: string;
}

const NATURE = /^(N1|N2\.[12]|N3\.[1-6]|N4|N5|N6\.[1-9]|N7)$/;
const num = (v: string | undefined, d: number) => {
  const n = Number((v ?? '').trim().replace(',', '.'));
  return (v ?? '').trim() !== '' && Number.isFinite(n) ? n : d;
};
const int = (v: string | undefined) => {
  const n = Number((v ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};
const str = (v: string | undefined, d = '') => (v ?? '').trim() || d;

export function invoiceSettings(env: Record<string, string | undefined> = process.env): InvoiceSettings {
  const natureIT = str(env.INVOICE_TAX_NATURE_IT, 'N2.2').toUpperCase();
  return {
    seller: {
      firstName: str(env.INVOICE_SELLER_FIRST_NAME),
      lastName: str(env.INVOICE_SELLER_LAST_NAME),
      partitaIva: str(env.INVOICE_SELLER_PARTITA_IVA).replace(/^IT/i, ''),
      codiceFiscale: str(env.INVOICE_SELLER_CODICE_FISCALE).toUpperCase(),
      address: str(env.INVOICE_SELLER_ADDRESS),
      cap: str(env.INVOICE_SELLER_CAP),
      city: str(env.INVOICE_SELLER_CITY),
      province: str(env.INVOICE_SELLER_PROVINCE).toUpperCase(),
      regimeFiscale: str(env.INVOICE_SELLER_REGIME_FISCALE, 'RF19').toUpperCase(),
    },
    nature: {
      IT: natureIT,
      EU_B2B: str(env.INVOICE_TAX_NATURE_EU_B2B, natureIT).toUpperCase(),
      EU_B2C: str(env.INVOICE_TAX_NATURE_EU_B2C, natureIT).toUpperCase(),
      NON_EU: str(env.INVOICE_TAX_NATURE_NON_EU, natureIT).toUpperCase(),
    },
    taxRate: num(env.INVOICE_TAX_RATE_IT, 0),
    regimeWording: str(env.INVOICE_REGIME_WORDING_IT),
    taxReference: str(env.INVOICE_TAX_REFERENCE_IT),
    stampDuty: {
      rule: str(env.INVOICE_STAMP_DUTY_RULE_IT, 'auto').toLowerCase() === 'off' ? 'off' : 'auto',
      threshold: num(env.INVOICE_STAMP_DUTY_THRESHOLD, 77.47),
      amount: num(env.INVOICE_STAMP_DUTY_AMOUNT, 2),
      natures: str(env.INVOICE_STAMP_DUTY_NATURES, natureIT).toUpperCase().split(',').map((s) => s.trim()).filter(Boolean),
    },
    lastIssued: {
      year: int(env.INVOICE_LAST_ISSUED_YEAR) ?? 2026,
      number: env.INVOICE_LAST_ISSUED_NUMBER === undefined ? 64 : int(env.INVOICE_LAST_ISSUED_NUMBER),
    },
    descriptionTemplate: str(
      env.INVOICE_DESCRIPTION_TEMPLATE,
      'Abbonamento AngleMotion {plan} {interval} - periodo dal {start} al {end}',
    ),
    paymentMethod: str(env.INVOICE_PAYMENT_METHOD, 'MP08').toUpperCase(),
    foreignPrivateId: str(env.INVOICE_FOREIGN_PRIVATE_ID, '99999999999'),
  };
}

/** What is missing or invalid in the configuration; issuing is refused until this is empty. */
export function settingsProblems(s: InvoiceSettings): string[] {
  const p: string[] = [];
  const need: Array<[keyof SellerSettings, string]> = [
    ['firstName', 'INVOICE_SELLER_FIRST_NAME'], ['lastName', 'INVOICE_SELLER_LAST_NAME'],
    ['address', 'INVOICE_SELLER_ADDRESS'], ['city', 'INVOICE_SELLER_CITY'],
  ];
  for (const [k, env] of need) if (!s.seller[k]) p.push(`${env} is not set`);
  if (!/^[0-9]{11}$/.test(s.seller.partitaIva)) p.push('INVOICE_SELLER_PARTITA_IVA must be 11 digits');
  if (!/^([A-Z0-9]{16}|[0-9]{11})$/.test(s.seller.codiceFiscale)) p.push('INVOICE_SELLER_CODICE_FISCALE must be 16 characters (or 11 digits)');
  if (!/^[0-9]{5}$/.test(s.seller.cap)) p.push('INVOICE_SELLER_CAP must be 5 digits');
  if (s.seller.province && !/^[A-Z]{2}$/.test(s.seller.province)) p.push('INVOICE_SELLER_PROVINCE must be 2 letters (e.g. MI)');
  if (!/^RF[0-9]{2}$/.test(s.seller.regimeFiscale)) p.push('INVOICE_SELLER_REGIME_FISCALE must look like RF19');
  for (const [k, v] of Object.entries(s.nature)) if (!NATURE.test(v)) p.push(`Natura for ${k} ("${v}") is not a FatturaPA Natura code`);
  if (s.taxRate !== 0) p.push('INVOICE_TAX_RATE_IT other than 0 is not supported: VAT invoices need Stripe Tax first (docs/INVOICING.md)');
  if (!s.regimeWording) p.push('INVOICE_REGIME_WORDING_IT is not set (the wording your accountant gave you)');
  if (s.taxReference.length > 100) p.push('INVOICE_TAX_REFERENCE_IT is longer than 100 characters');
  if (!/^MP[0-9]{2}$/.test(s.paymentMethod)) p.push('INVOICE_PAYMENT_METHOD must look like MP08');
  return p;
}

export function natureFor(s: InvoiceSettings, region: CustomerRegion, isBusiness: boolean): string {
  if (region === 'IT') return s.nature.IT;
  if (region === 'EU') return isBusiness ? s.nature.EU_B2B : s.nature.EU_B2C;
  return s.nature.NON_EU;
}

/**
 * The stamp duty (imposta di bollo) to record on this invoice, or null. It is
 * NEVER added to what the customer paid: Vin absorbs it (D5), and the invoice
 * only declares it (BolloVirtuale) so it is settled with the Agenzia.
 */
export function stampDutyFor(s: InvoiceSettings, amount: number, nature: string): number | null {
  if (s.stampDuty.rule === 'off') return null;
  if (!s.stampDuty.natures.includes(nature)) return null;
  return amount > s.stampDuty.threshold ? s.stampDuty.amount : null;
}

/**
 * The number to propose for the next invoice of `year`: one after the highest
 * of (the last number issued here this year, the last one Vin issued
 * elsewhere this year). A new year starts again at 1. Vin can override it on
 * /admin/invoices — it must match his FatturAE sequence.
 */
export function suggestInvoiceNumber(s: InvoiceSettings, year: number, lastHere: number | null): number {
  const outside = s.lastIssued.year === year ? s.lastIssued.number ?? 0 : 0;
  return Math.max(outside, lastHere ?? 0) + 1;
}

const itDate = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export function invoiceDescription(
  s: InvoiceSettings,
  r: { plan: string | null; billing_interval: string | null; period_start: string | null; period_end: string | null },
): string {
  const plan = r.plan ? r.plan.charAt(0).toUpperCase() + r.plan.slice(1) : '';
  const interval = r.billing_interval === 'year' ? 'annuale' : r.billing_interval === 'month' ? 'mensile' : '';
  return s.descriptionTemplate
    .replace('{plan}', plan)
    .replace('{interval}', interval)
    .replace('{start}', itDate(r.period_start))
    .replace('{end}', itDate(r.period_end))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Today's date in Italy (YYYY-MM-DD) — the invoice date default. */
export function romeToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
