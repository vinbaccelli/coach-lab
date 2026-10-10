import { CUSTOMER_CATEGORIES, type CustomerCategory } from '@/lib/billing/invoicing/draft';

/**
 * Invoice / fiscal settings for the Italian fattura elettronica. They live in
 * ONE database row (`invoice_settings`, admin-only) that Vin edits on
 * /admin/invoices — never in code or Vercel. Pure: row in, settings out
 * (tests/fatturaPA.test.ts).
 *
 * Every fiscal rule carries a confirmation status. A rule that is 'pending'
 * (awaiting Vin's commercialista) can be PREVIEWED but never ISSUED: the
 * invoice is listed with the reason. Nothing is guessed. Confirmed at the
 * start (Vin, 2026-10-10):
 *  - coaching to Italian private customers: N2.2, 0% (Vin's existing invoices);
 *  - the forfettario wording, for coaching (the existing invoices);
 *  - stamp duty €2 over €77.47 on N2.2 invoices, absorbed (D7);
 *  - foreign private customers identified as OO99999999999, recipient XXXXXXX.
 * Everything else — Anglemotion software, ebooks, foreign treatments, EU
 * private customers (OSS), stamp duty on N2.1 — starts as 'pending'.
 */

export type ProductType = 'software_subscription' | 'coaching_service' | 'digital_product' | 'other';
export const PRODUCT_TYPES: ProductType[] = ['software_subscription', 'coaching_service', 'digital_product', 'other'];
export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  software_subscription: 'Anglemotion subscription',
  coaching_service: 'Coaching / video analysis',
  digital_product: 'Ebook / digital product',
  other: 'Other one-off sale',
};

export type RuleStatus = 'confirmed' | 'pending';
export interface TaxRule { nature: string | null; reference?: string | null; status: RuleStatus }
export type TaxRules = Record<ProductType, Record<CustomerCategory, TaxRule>>;
export type StampRule = 'applies' | 'not_applicable' | 'pending';

const P = (nature: string | null, status: RuleStatus = 'pending'): TaxRule => ({ nature, reference: null, status });
export const DEFAULT_TAX_RULES: TaxRules = {
  software_subscription: { IT_B2C: P('N2.2'), IT_B2B: P('N2.2'), EU_B2C: P(null), EU_B2B: P('N2.1'), NON_EU_B2C: P('N2.1'), NON_EU_B2B: P('N2.1') },
  coaching_service: { IT_B2C: P('N2.2', 'confirmed'), IT_B2B: P('N2.2'), EU_B2C: P('N2.1'), EU_B2B: P('N2.1'), NON_EU_B2C: P('N2.1'), NON_EU_B2B: P('N2.1') },
  digital_product: { IT_B2C: P('N2.2'), IT_B2B: P('N2.2'), EU_B2C: P(null), EU_B2B: P('N2.1'), NON_EU_B2C: P('N2.1'), NON_EU_B2B: P('N2.1') },
  other: { IT_B2C: P('N2.2'), IT_B2B: P('N2.2'), EU_B2C: P(null), EU_B2B: P(null), NON_EU_B2C: P(null), NON_EU_B2B: P(null) },
};
export const DEFAULT_WORDING_STATUS: Record<ProductType, RuleStatus> = {
  software_subscription: 'pending', coaching_service: 'confirmed', digital_product: 'pending', other: 'pending',
};
export const DEFAULT_STAMP_RULES: Record<string, StampRule> = { 'N2.2': 'applies', 'N2.1': 'pending' };

/** Vin's existing wording, verbatim (2026-10-10). Never rewritten by code. */
export const EXISTING_FORFETTARIO_WORDING =
  'Operazione effettuata ai sensi dell’articolo 1, commi da 54 a 89, della Legge n. 190/2014 e successive modificazioni e integrazioni. Regime forfetario. Si richiede la non applicazione della ritenuta d’acconto ai sensi dell’articolo 1, comma 59, della Legge n. 190/2014.';

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
  tax_rules: TaxRules | null;
  wording_status: Record<ProductType, RuleStatus> | null;
  stamp_duty_enabled: boolean;
  stamp_duty_threshold: number | string;
  stamp_duty_amount: number | string;
  stamp_duty_rules: Record<string, StampRule> | null;
  last_issued_year: number | null;
  last_issued_number: number | null;
  description_subscription: string;
  description_one_off: string;
  payment_method: string;
  foreign_private_id: string | null;
  foreign_private_id_status: RuleStatus;
}

/** The SQL defaults (migrations v2 + v3). */
export const DEFAULT_SETTINGS_ROW: InvoiceSettingsRow = {
  seller_first_name: null, seller_last_name: null, seller_address: null, seller_cap: null, seller_city: null,
  seller_province: null, seller_country: 'IT', seller_partita_iva: null, seller_codice_fiscale: null,
  seller_regime_fiscale: 'RF19', seller_ateco: null, seller_pec: null, seller_codice_destinatario: null,
  regime_wording: EXISTING_FORFETTARIO_WORDING,
  tax_rules: DEFAULT_TAX_RULES,
  wording_status: DEFAULT_WORDING_STATUS,
  stamp_duty_enabled: true, stamp_duty_threshold: 77.47, stamp_duty_amount: 2, stamp_duty_rules: DEFAULT_STAMP_RULES,
  last_issued_year: 2026, last_issued_number: 64,
  description_subscription: 'Abbonamento Anglemotion {plan} {interval} - periodo dal {start} al {end}',
  description_one_off: '{product}',
  payment_method: 'MP08',
  foreign_private_id: 'OO99999999999',
  foreign_private_id_status: 'confirmed',
};

/** The columns /admin/invoices may edit. */
export const SETTINGS_COLUMNS = Object.keys(DEFAULT_SETTINGS_ROW) as Array<keyof InvoiceSettingsRow>;

export interface InvoiceSettings {
  seller: {
    firstName: string; lastName: string; address: string; cap: string; city: string; province: string;
    country: string; partitaIva: string; codiceFiscale: string; regimeFiscale: string; ateco: string;
  };
  taxRules: TaxRules;
  wording: string;
  wordingStatus: Record<ProductType, RuleStatus>;
  /** Forfettario: always 0. VAT invoices need Stripe Tax first (docs/INVOICING.md). */
  taxRate: 0;
  stampDuty: { enabled: boolean; threshold: number; amount: number; rules: Record<string, StampRule> };
  lastIssued: { year: number | null; number: number | null };
  descriptions: { subscription: string; oneOff: string };
  paymentMethod: string;
  /** Foreign private customer with no VAT ID: country code + code, e.g. "OO99999999999". */
  foreignPrivateId: string;
  foreignPrivateIdStatus: RuleStatus;
}

export const NATURE = /^(N1|N2\.[12]|N3\.[1-6]|N4|N5|N6\.[1-9]|N7)$/;
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());
const upper = (v: unknown) => s(v).toUpperCase();
const n = (v: unknown, d: number) => {
  const x = Number(s(v).replace(',', '.'));
  return s(v) !== '' && Number.isFinite(x) ? x : d;
};
const status = (v: unknown, d: RuleStatus): RuleStatus => (v === 'confirmed' || v === 'pending' ? v : d);

function cleanRules(input: unknown): TaxRules {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, Record<string, Partial<TaxRule>>>;
  const out = {} as TaxRules;
  for (const pt of PRODUCT_TYPES) {
    out[pt] = {} as Record<CustomerCategory, TaxRule>;
    for (const c of CUSTOMER_CATEGORIES) {
      const r = src[pt]?.[c];
      const d = DEFAULT_TAX_RULES[pt][c];
      out[pt][c] = r
        ? { nature: upper(r.nature) || null, reference: s(r.reference) || null, status: status(r.status, 'pending') }
        : { ...d };
    }
  }
  return out;
}

function cleanWordingStatus(input: unknown): Record<ProductType, RuleStatus> {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return Object.fromEntries(PRODUCT_TYPES.map((pt) => [pt, status(src[pt], DEFAULT_WORDING_STATUS[pt])])) as Record<ProductType, RuleStatus>;
}

function cleanStampRules(input: unknown): Record<string, StampRule> {
  const src = (input && typeof input === 'object' ? input : DEFAULT_STAMP_RULES) as Record<string, unknown>;
  const out: Record<string, StampRule> = {};
  for (const [k, v] of Object.entries(src)) {
    const key = upper(k);
    if (NATURE.test(key) && (v === 'applies' || v === 'not_applicable' || v === 'pending')) out[key] = v;
  }
  return out;
}

export function settingsFromRow(input: Partial<InvoiceSettingsRow> | null | undefined): InvoiceSettings {
  const r = { ...DEFAULT_SETTINGS_ROW, ...(input ?? {}) };
  return {
    seller: {
      firstName: s(r.seller_first_name), lastName: s(r.seller_last_name), address: s(r.seller_address),
      cap: s(r.seller_cap), city: s(r.seller_city), province: upper(r.seller_province),
      country: upper(r.seller_country) || 'IT', partitaIva: upper(r.seller_partita_iva).replace(/^IT/, ''),
      codiceFiscale: upper(r.seller_codice_fiscale), regimeFiscale: upper(r.seller_regime_fiscale) || 'RF19',
      ateco: s(r.seller_ateco),
    },
    taxRules: cleanRules(r.tax_rules),
    // The wording is used exactly as saved (trailing whitespace aside).
    wording: typeof r.regime_wording === 'string' ? r.regime_wording.trim() : '',
    wordingStatus: cleanWordingStatus(r.wording_status),
    taxRate: 0,
    stampDuty: {
      enabled: r.stamp_duty_enabled !== false,
      threshold: n(r.stamp_duty_threshold, 77.47),
      amount: n(r.stamp_duty_amount, 2),
      rules: cleanStampRules(r.stamp_duty_rules),
    },
    lastIssued: { year: r.last_issued_year ?? null, number: r.last_issued_number ?? null },
    descriptions: { subscription: s(r.description_subscription), oneOff: s(r.description_one_off) || '{product}' },
    paymentMethod: upper(r.payment_method) || 'MP08',
    foreignPrivateId: upper(r.foreign_private_id),
    foreignPrivateIdStatus: status(r.foreign_private_id_status, 'pending'),
  };
}

/**
 * Characters the SdI does not accept. The FatturaPA technical rules admit
 * only Basic Latin and Latin-1 Supplement characters; e.g. the typographic
 * apostrophe ’ (U+2019) is outside them. Returned so the admin page can name
 * them — the text is never rewritten silently.
 */
export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const ok = c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff);
    if (!ok) bad.add(ch);
  }
  return [...bad];
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
  for (const pt of PRODUCT_TYPES) {
    for (const c of CUSTOMER_CATEGORIES) {
      const r = x.taxRules[pt][c];
      if (r.nature && !NATURE.test(r.nature)) p.push(`${PRODUCT_TYPE_LABEL[pt]} × ${categoryLabel(c)}: "${r.nature}" is not a FatturaPA Natura code`);
      if ((r.reference ?? '').length > 100) p.push(`${PRODUCT_TYPE_LABEL[pt]} × ${categoryLabel(c)}: legal reference longer than 100 characters`);
    }
  }
  if (!x.wording) p.push('Invoice wording is not set');
  const badWording = unsupportedChars(x.wording);
  if (badWording.length) {
    p.push(`The invoice wording contains characters the SdI does not accept: ${badWording.map((c) => `“${c}” (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`).join(', ')}. Replace them in Invoice settings (e.g. ’ with ').`);
  }
  for (const [v, label] of [[x.seller.firstName, 'First name'], [x.seller.lastName, 'Last name'], [x.seller.address, 'Address'], [x.seller.city, 'City']] as const) {
    if (unsupportedChars(v).length) p.push(`${label} contains characters the SdI does not accept`);
  }
  if (!/^MP[0-9]{2}$/.test(x.paymentMethod)) p.push('Payment method must look like MP08');
  if (x.foreignPrivateId && !/^[A-Z]{2}[A-Z0-9]{1,28}$/.test(x.foreignPrivateId)) {
    p.push('Foreign private customer identifier must be a 2-letter country code followed by the code, e.g. OO99999999999');
  }
  return p;
}

/**
 * Every rule still awaiting the commercialista — the "pending" list on
 * /admin/invoices. A sale that depends on one of them can be previewed, not issued.
 */
export function pendingRules(x: InvoiceSettings): string[] {
  const out: string[] = [];
  for (const pt of PRODUCT_TYPES) {
    for (const c of CUSTOMER_CATEGORIES) {
      const r = x.taxRules[pt][c];
      if (!r.nature) out.push(`VAT treatment: ${PRODUCT_TYPE_LABEL[pt]} → ${categoryLabel(c)} — not decided`);
      else if (r.status !== 'confirmed') out.push(`VAT treatment: ${PRODUCT_TYPE_LABEL[pt]} → ${categoryLabel(c)} — ${r.nature}, to confirm`);
    }
    if (x.wordingStatus[pt] !== 'confirmed') out.push(`Invoice wording for ${PRODUCT_TYPE_LABEL[pt]} — to confirm`);
  }
  const natures = new Set(PRODUCT_TYPES.flatMap((pt) => CUSTOMER_CATEGORIES.map((c) => x.taxRules[pt][c].nature)).filter((v): v is string => !!v));
  for (const nat of natures) {
    if ((x.stampDuty.rules[nat] ?? 'pending') === 'pending') out.push(`Stamp duty on ${nat} invoices over €${x.stampDuty.threshold.toFixed(2)} — to confirm`);
  }
  if (x.foreignPrivateIdStatus !== 'confirmed') out.push(`Foreign private customer identifier ${x.foreignPrivateId || '(not set)'} — to confirm`);
  return out;
}

const CATEGORY_LABEL: Record<CustomerCategory, string> = {
  IT_B2C: 'Italian private', IT_B2B: 'Italian business', EU_B2C: 'EU private',
  EU_B2B: 'EU business', NON_EU_B2C: 'non-EU private', NON_EU_B2B: 'non-EU business',
};
export const categoryLabel = (c: CustomerCategory) => CATEGORY_LABEL[c];

export interface Treatment {
  nature: string | null;
  reference: string;
  /** Stamp duty to DECLARE (absorbed, never added), or null. */
  stampDuty: number | null;
  /** Why this sale can't be issued yet under the current rules (empty = it can). */
  problems: string[];
}

/**
 * The VAT treatment of one sale: the rule for (product type × customer
 * category), whether it and the wording are confirmed, and the stamp duty.
 */
export function decideTreatment(
  x: InvoiceSettings, productType: ProductType | null, category: CustomerCategory, amountCents: number,
): Treatment {
  const problems: string[] = [];
  if (!productType) {
    return { nature: null, reference: '', stampDuty: null, problems: ['Choose the product type of this sale (coaching, ebook, …)'] };
  }
  const rule = x.taxRules[productType][category];
  const where = `${PRODUCT_TYPE_LABEL[productType]} sold to ${categoryLabel(category)} customers`;
  if (!rule.nature) {
    problems.push(`No VAT treatment (Natura) is set for ${where}${category === 'EU_B2C' ? ' — EU private customers / OSS, waiting for your commercialista' : ''}`);
  } else if (rule.status !== 'confirmed') {
    problems.push(`The VAT treatment ${rule.nature} for ${where} is awaiting your commercialista's confirmation`);
  }
  if (x.wordingStatus[productType] !== 'confirmed') {
    problems.push(`The invoice wording for ${PRODUCT_TYPE_LABEL[productType]} is awaiting your commercialista's confirmation`);
  }
  let stampDuty: number | null = null;
  if (rule.nature && x.stampDuty.enabled && amountCents / 100 > x.stampDuty.threshold) {
    const st = x.stampDuty.rules[rule.nature] ?? 'pending';
    if (st === 'applies') stampDuty = x.stampDuty.amount;
    else if (st === 'pending') {
      problems.push(`Whether the €${x.stampDuty.amount.toFixed(2)} stamp duty applies to ${rule.nature} invoices over €${x.stampDuty.threshold.toFixed(2)} is awaiting your commercialista's confirmation`);
    }
  }
  return { nature: rule.nature, reference: rule.reference ?? '', stampDuty, problems };
}

/**
 * The amounts on the invoice, kept apart (D7). The total is always what was
 * paid through Stripe: the stamp duty is declared beside it, not added to it.
 */
export function invoiceAmounts(amountCents: number, stampDuty: number | null) {
  return {
    taxable_amount_cents: amountCents,
    vat_amount_cents: 0,
    stamp_duty_cents: stampDuty === null ? 0 : Math.round(stampDuty * 100),
    invoice_total_cents: amountCents,
  };
}

/**
 * The number to propose for the next invoice of `year`: one after the highest
 * of (the last number issued here this year, the last one Vin issued
 * elsewhere this year). A new year starts again at 1.
 */
export function suggestInvoiceNumber(x: InvoiceSettings, year: number, lastHere: number | null): number {
  const outside = x.lastIssued.year === year ? x.lastIssued.number ?? 0 : 0;
  return Math.max(outside, lastHere ?? 0) + 1;
}

/**
 * Sequence checks for issuing number/date in a year (Italian rules: numbers
 * progressive per year, dates not going backwards).
 *  - number must be > every number already used this year (here or elsewhere);
 *  - date must not be before the latest invoice date already issued here this year;
 *  - a number that skips ahead (a gap) needs explicit confirmation.
 */
export function sequenceProblems(
  x: InvoiceSettings,
  input: { number: number; date: string; confirmGap?: boolean },
  lastHere: { number: number | null; date: string | null },
): { problems: string[]; gapFrom: number | null } {
  const year = Number(input.date.slice(0, 4));
  const expected = suggestInvoiceNumber(x, year, lastHere.number);
  const problems: string[] = [];
  let gapFrom: number | null = null;
  if (input.number < expected) {
    problems.push(`Number ${input.number}/${year} is not after the last one used (${expected - 1}). The next is ${expected}.`);
  } else if (input.number > expected) {
    gapFrom = expected;
    if (!input.confirmGap) problems.push(`Number ${input.number} skips ${expected}${input.number - expected > 1 ? `–${input.number - 1}` : ''}. Confirm the gap only if those numbers were used elsewhere (e.g. in FatturAE).`);
  }
  if (lastHere.date && input.date < lastHere.date) {
    problems.push(`The date ${input.date} is before your last invoice's date (${lastHere.date}).`);
  }
  return { problems, gapFrom };
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
 * Clean what the settings form sent into a row patch. Only known columns;
 * structured rules are normalised; the wording is kept EXACTLY as typed
 * (only surrounding whitespace dropped). Empty text → null.
 */
export function settingsPatchFromForm(input: Record<string, unknown>): Partial<InvoiceSettingsRow> {
  const out: Record<string, unknown> = {};
  for (const col of SETTINGS_COLUMNS) {
    if (!(col in input)) continue;
    const v = input[col];
    switch (col) {
      case 'tax_rules': out[col] = cleanRules(v); break;
      case 'wording_status': out[col] = cleanWordingStatus(v); break;
      case 'stamp_duty_rules': out[col] = cleanStampRules(v); break;
      case 'stamp_duty_enabled': out[col] = v === true || v === 'true'; break;
      case 'foreign_private_id_status': out[col] = status(v, 'pending'); break;
      case 'last_issued_year':
      case 'last_issued_number': {
        const x = Number(v);
        out[col] = Number.isInteger(x) && x > 0 ? x : null;
        break;
      }
      case 'stamp_duty_threshold':
      case 'stamp_duty_amount': {
        const x = Number(String(v ?? '').replace(',', '.'));
        if (Number.isFinite(x) && x >= 0) out[col] = x;
        break;
      }
      case 'regime_wording': {
        const text = typeof v === 'string' ? v.trim().slice(0, 4000) : '';
        out[col] = text || null;
        break;
      }
      default: {
        const text = typeof v === 'string' ? v.trim().slice(0, 2000) : '';
        const upperCols = /^(seller_(province|country|partita_iva|codice_fiscale|regime_fiscale|codice_destinatario)|payment_method|foreign_private_id)$/;
        const val = upperCols.test(col) ? text.toUpperCase() : text;
        if (col === 'seller_country' || col === 'seller_regime_fiscale' || col === 'payment_method'
          || col === 'description_subscription' || col === 'description_one_off') {
          if (val) out[col] = val; // NOT NULL columns keep their value when left empty
        } else {
          out[col] = val || null;
        }
      }
    }
  }
  return out as Partial<InvoiceSettingsRow>;
}
