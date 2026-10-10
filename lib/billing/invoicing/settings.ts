import { CUSTOMER_CATEGORIES, type CustomerCategory } from '@/lib/billing/invoicing/draft';

/**
 * Invoice / fiscal settings for the Italian fattura elettronica (D9). They live
 * in ONE database row (`invoice_settings`, admin-only) that Vin edits on
 * /admin/invoices. Nothing personal or fiscal is in code or in Vercel.
 * Pure: row in, settings out (tests/fatturaPA.test.ts).
 *
 * Defaults (in SQL and below) are only what Vin has confirmed:
 *  - forfettario: RegimeFiscale RF19, 0% VAT; Natura N2.2 for Italian
 *    customers, N2.1 for foreign customers outside Italian VAT territory;
 *  - EU private customers: NO Natura until the accountant answers (T2, OSS);
 *  - stamp duty (D7): €2 over €77.47, absorbed — declared, never added to
 *    the total; applies to N2.2 only until the accountant answers for N2.1 (D8);
 *  - foreign private customer without a tax ID: NO placeholder until the
 *    accountant answers (T3);
 *  - numbering continues from his last invoice, n. 64 of 2026.
 * The regime wording has no default: nothing is issued until it is set.
 */

export interface InvoiceSettingsRow {
  seller_first_name: string | null;
  seller_last_name: string | null;
  seller_address: string | null;
  seller_cap: string | null;
  seller_city: string | null;
  seller_province: string | null;
  seller_country: string;
  seller_partita_iva: string | null;
  seller_codice_fiscale: string | null;
  seller_regime_fiscale: string;
  seller_ateco: string | null;
  seller_pec: string | null;
  seller_codice_destinatario: string | null;
  regime_wording: string | null;
  nature_it_b2c: string | null;
  nature_it_b2b: string | null;
  nature_eu_b2b: string | null;
  nature_eu_b2c: string | null;
  nature_non_eu_b2c: string | null;
  nature_non_eu_b2b: string | null;
  reference_it_b2c: string | null;
  reference_it_b2b: string | null;
  reference_eu_b2b: string | null;
  reference_eu_b2c: string | null;
  reference_non_eu_b2c: string | null;
  reference_non_eu_b2b: string | null;
  stamp_duty_enabled: boolean;
  stamp_duty_threshold: number | string;
  stamp_duty_amount: number | string;
  stamp_duty_natures: string;
  last_issued_year: number | null;
  last_issued_number: number | null;
  description_subscription: string;
  description_one_off: string;
  payment_method: string;
  foreign_private_id: string | null;
}

/** The SQL defaults (supabase/migrations/20261009120000_invoicing_v2.sql). */
export const DEFAULT_SETTINGS_ROW: InvoiceSettingsRow = {
  seller_first_name: null, seller_last_name: null, seller_address: null, seller_cap: null, seller_city: null,
  seller_province: null, seller_country: 'IT', seller_partita_iva: null, seller_codice_fiscale: null,
  seller_regime_fiscale: 'RF19', seller_ateco: null, seller_pec: null, seller_codice_destinatario: null,
  regime_wording: null,
  nature_it_b2c: 'N2.2', nature_it_b2b: 'N2.2', nature_eu_b2b: 'N2.1', nature_eu_b2c: null,
  nature_non_eu_b2c: 'N2.1', nature_non_eu_b2b: 'N2.1',
  reference_it_b2c: null, reference_it_b2b: null, reference_eu_b2b: null, reference_eu_b2c: null,
  reference_non_eu_b2c: null, reference_non_eu_b2b: null,
  stamp_duty_enabled: true, stamp_duty_threshold: 77.47, stamp_duty_amount: 2, stamp_duty_natures: 'N2.2',
  last_issued_year: 2026, last_issued_number: 64,
  description_subscription: 'Abbonamento AngleMotion {plan} {interval} - periodo dal {start} al {end}',
  description_one_off: '{product}',
  payment_method: 'MP08',
  foreign_private_id: null,
};

/** The columns /admin/invoices may edit (everything in the row). */
export const SETTINGS_COLUMNS = Object.keys(DEFAULT_SETTINGS_ROW) as Array<keyof InvoiceSettingsRow>;

export interface InvoiceSettings {
  seller: {
    firstName: string; lastName: string; address: string; cap: string; city: string; province: string;
    country: string; partitaIva: string; codiceFiscale: string; regimeFiscale: string; ateco: string;
  };
  /** Natura per customer category; null = not decided yet (issuing blocked for that category). */
  nature: Record<CustomerCategory, string | null>;
  /** Optional RiferimentoNormativo per category (≤100 chars). */
  reference: Record<CustomerCategory, string>;
  regimeWording: string;
  /** Forfettario: always 0. VAT invoices need Stripe Tax first (docs/INVOICING.md). */
  taxRate: 0;
  stampDuty: { enabled: boolean; threshold: number; amount: number; natures: string[] };
  lastIssued: { year: number | null; number: number | null };
  descriptions: { subscription: string; oneOff: string };
  paymentMethod: string;
  /** IdCodice for a foreign private customer with no tax ID; null = pending (T3). */
  foreignPrivateId: string | null;
}

const NATURE = /^(N1|N2\.[12]|N3\.[1-6]|N4|N5|N6\.[1-9]|N7)$/;
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());
const upper = (v: unknown) => s(v).toUpperCase();
const n = (v: unknown, d: number) => {
  const x = Number(s(v).replace(',', '.'));
  return s(v) !== '' && Number.isFinite(x) ? x : d;
};
const key = (c: CustomerCategory) => c.toLowerCase() as Lowercase<CustomerCategory>;

export function settingsFromRow(input: Partial<InvoiceSettingsRow> | null | undefined): InvoiceSettings {
  const r = { ...DEFAULT_SETTINGS_ROW, ...(input ?? {}) };
  const nature = {} as Record<CustomerCategory, string | null>;
  const reference = {} as Record<CustomerCategory, string>;
  for (const c of CUSTOMER_CATEGORIES) {
    nature[c] = upper(r[`nature_${key(c)}` as keyof InvoiceSettingsRow]) || null;
    reference[c] = s(r[`reference_${key(c)}` as keyof InvoiceSettingsRow]);
  }
  return {
    seller: {
      firstName: s(r.seller_first_name), lastName: s(r.seller_last_name), address: s(r.seller_address),
      cap: s(r.seller_cap), city: s(r.seller_city), province: upper(r.seller_province),
      country: upper(r.seller_country) || 'IT', partitaIva: upper(r.seller_partita_iva).replace(/^IT/, ''),
      codiceFiscale: upper(r.seller_codice_fiscale), regimeFiscale: upper(r.seller_regime_fiscale) || 'RF19',
      ateco: s(r.seller_ateco),
    },
    nature,
    reference,
    regimeWording: s(r.regime_wording),
    taxRate: 0,
    stampDuty: {
      enabled: r.stamp_duty_enabled !== false,
      threshold: n(r.stamp_duty_threshold, 77.47),
      amount: n(r.stamp_duty_amount, 2),
      natures: upper(r.stamp_duty_natures).split(',').map((x) => x.trim()).filter(Boolean),
    },
    lastIssued: { year: r.last_issued_year ?? null, number: r.last_issued_number ?? null },
    descriptions: { subscription: s(r.description_subscription), oneOff: s(r.description_one_off) || '{product}' },
    paymentMethod: upper(r.payment_method) || 'MP08',
    foreignPrivateId: s(r.foreign_private_id) || null,
  };
}

/** What is missing or invalid for ANY invoice; issuing is refused until this is empty. */
export function settingsProblems(x: InvoiceSettings): string[] {
  const p: string[] = [];
  const need: Array<[string, string]> = [
    [x.seller.firstName, 'First name'], [x.seller.lastName, 'Last name'],
    [x.seller.address, 'Address'], [x.seller.city, 'City'],
  ];
  for (const [v, label] of need) if (!v) p.push(`${label} is not set`);
  if (!/^[0-9]{11}$/.test(x.seller.partitaIva)) p.push('Partita IVA must be 11 digits');
  if (!/^([A-Z0-9]{16}|[0-9]{11})$/.test(x.seller.codiceFiscale)) p.push('Codice Fiscale must be 16 characters (or 11 digits)');
  if (!/^[0-9]{5}$/.test(x.seller.cap)) p.push('CAP must be 5 digits');
  if (x.seller.province && !/^[A-Z]{2}$/.test(x.seller.province)) p.push('Province must be 2 letters (e.g. MI)');
  if (x.seller.country !== 'IT') p.push('Seller country must be IT');
  if (!/^RF[0-9]{2}$/.test(x.seller.regimeFiscale)) p.push('Regime fiscale must look like RF19');
  for (const c of CUSTOMER_CATEGORIES) {
    const v = x.nature[c];
    if (v && !NATURE.test(v)) p.push(`Natura for ${c} ("${v}") is not a FatturaPA Natura code`);
    if (x.reference[c].length > 100) p.push(`Legal reference for ${c} is longer than 100 characters`);
  }
  for (const v of x.stampDuty.natures) if (!NATURE.test(v)) p.push(`Stamp duty Natura "${v}" is not a FatturaPA Natura code`);
  if (!x.regimeWording) p.push('Forfettario invoice wording is not set (the wording your accountant gives you)');
  if (!/^MP[0-9]{2}$/.test(x.paymentMethod)) p.push('Payment method must look like MP08');
  return p;
}

const CATEGORY_LABEL: Record<CustomerCategory, string> = {
  IT_B2C: 'Italian private customers', IT_B2B: 'Italian businesses', EU_B2C: 'EU private customers',
  EU_B2B: 'EU businesses', NON_EU_B2C: 'non-EU private customers', NON_EU_B2B: 'non-EU businesses',
};
export const categoryLabel = (c: CustomerCategory) => CATEGORY_LABEL[c];

/** The Natura for this category, or null when it is still pending. */
export function natureFor(x: InvoiceSettings, category: CustomerCategory): string | null {
  return x.nature[category];
}

/**
 * The stamp duty (imposta di bollo) to declare on this invoice, or null. It is
 * NEVER added to what the customer paid (D7): Vin absorbs it, and the invoice
 * only declares it (BolloVirtuale) so it is settled with the Agenzia.
 */
export function stampDutyFor(x: InvoiceSettings, amount: number, nature: string): number | null {
  if (!x.stampDuty.enabled || !x.stampDuty.natures.includes(nature)) return null;
  return amount > x.stampDuty.threshold ? x.stampDuty.amount : null;
}

/**
 * The amounts on the invoice, kept apart (D7). The total is always what was
 * paid through Stripe: the stamp duty is declared beside it, not added to it.
 */
export function invoiceAmounts(x: InvoiceSettings, amountCents: number, nature: string) {
  const stamp = stampDutyFor(x, amountCents / 100, nature);
  return {
    taxable_amount_cents: amountCents,
    vat_amount_cents: 0,
    stamp_duty_cents: stamp === null ? 0 : Math.round(stamp * 100),
    invoice_total_cents: amountCents,
  };
}

/**
 * The number to propose for the next invoice of `year`: one after the highest
 * of (the last number issued here this year, the last one Vin issued
 * elsewhere this year). A new year starts again at 1. Vin can override it.
 */
export function suggestInvoiceNumber(x: InvoiceSettings, year: number, lastHere: number | null): number {
  const outside = x.lastIssued.year === year ? x.lastIssued.number ?? 0 : 0;
  return Math.max(outside, lastHere ?? 0) + 1;
}

const itDate = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export function invoiceDescription(
  x: InvoiceSettings,
  r: { source?: string | null; plan: string | null; billing_interval: string | null; period_start: string | null; period_end: string | null; product_description?: string | null },
): string {
  if (r.source === 'one_off') {
    return x.descriptions.oneOff.replace('{product}', r.product_description || 'Servizio').replace(/\s{2,}/g, ' ').trim();
  }
  const plan = r.plan ? r.plan.charAt(0).toUpperCase() + r.plan.slice(1) : '';
  const interval = r.billing_interval === 'year' ? 'annuale' : r.billing_interval === 'month' ? 'mensile' : '';
  return x.descriptions.subscription
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

/**
 * Clean what the settings form sent into a row patch. Only known columns, each
 * normalised; empty text → null. Format problems are reported by
 * settingsProblems on the saved result (a half-filled form can still be saved).
 */
export function settingsPatchFromForm(input: Record<string, unknown>): Partial<InvoiceSettingsRow> {
  const out: Record<string, unknown> = {};
  for (const col of SETTINGS_COLUMNS) {
    if (!(col in input)) continue;
    const v = input[col];
    if (col === 'stamp_duty_enabled') out[col] = v === true || v === 'true';
    else if (col === 'last_issued_year' || col === 'last_issued_number') {
      const x = Number(v);
      out[col] = Number.isInteger(x) && x > 0 ? x : null;
    } else if (col === 'stamp_duty_threshold' || col === 'stamp_duty_amount') {
      const x = Number(String(v ?? '').replace(',', '.'));
      if (Number.isFinite(x) && x >= 0) out[col] = x;
    } else {
      const text = typeof v === 'string' ? v.trim().slice(0, 2000) : '';
      const upperCols = /^(seller_(province|country|partita_iva|codice_fiscale|regime_fiscale|codice_destinatario)|nature_|stamp_duty_natures|payment_method)/;
      const val = upperCols.test(col) ? text.toUpperCase() : text;
      if (col === 'seller_country' || col === 'seller_regime_fiscale' || col === 'payment_method'
        || col === 'description_subscription' || col === 'description_one_off' || col === 'stamp_duty_natures') {
        if (val) out[col] = val; // NOT NULL columns keep their value when left empty
      } else {
        out[col] = val || null;
      }
    }
  }
  return out as Partial<InvoiceSettingsRow>;
}
