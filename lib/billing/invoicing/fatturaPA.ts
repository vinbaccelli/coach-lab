import type Stripe from 'stripe';
import type { CustomerCategory, CustomerRegion } from '@/lib/billing/invoicing/draft';
import { customerCategory } from '@/lib/billing/invoicing/draft';
import type { ItalianFields } from '@/lib/billing/invoicing/italianFields';
import {
  decideTreatment, invoiceAmounts, invoiceDescription, settingsProblems, unsupportedChars,
  type InvoiceSettings, type ProductType,
} from '@/lib/billing/invoicing/settings';

/**
 * Builds and validates the FatturaPA XML (format FPR12, "fattura tra
 * privati", TipoDocumento TD01) for one paid sale — an Anglemotion
 * subscription payment or a one-off sale (coaching, video analysis, ebook…).
 * Pure: record + settings in, XML + checks out (tests/fatturaPA.test.ts).
 *
 * The XML is ready to upload in the Agenzia delle Entrate portal "Fatture e
 * Corrispettivi" (Trasmissione → upload file), which signs it and sends it to
 * SdI. Generating it is NOT issuing or transmitting it: an invoice counts as
 * sent only once Vin uploads it and marks it sent (with the SdI reference).
 *
 * Customer identification (separate from the VAT treatment):
 *  - Italian private: Nome/Cognome + Codice Fiscale; CodiceDestinatario
 *    "0000000" (or their PEC / code);
 *  - Italian business: Partita IVA (+ Codice Destinatario or PEC);
 *  - foreign business: IdFiscaleIVA = country + VAT number; "XXXXXXX";
 *  - foreign private: IdFiscaleIVA = the configured identifier, by default
 *    OO99999999999 (IdPaese "OO", IdCodice "99999999999" — Vin's existing,
 *    commercialista-confirmed workflow); "XXXXXXX". No Italian CF is asked for.
 *  Real addresses are kept: a foreign postcode that is not 5 digits (the
 *  FatturaPA CAP format) is written into the address line and CAP is "00000".
 */

export interface InvoiceRecord extends Partial<ItalianFields> {
  source?: 'subscription' | 'one_off' | string | null;
  product_type?: ProductType | string | null;
  livemode?: boolean | null;
  refunded_amount_cents?: number | null;
  amount_cents: number;
  currency: string;
  plan: string | null;
  billing_interval: string | null;
  period_start: string | null;
  period_end: string | null;
  product_description?: string | null;
  customer_name: string | null;
  business_name: string | null;
  customer_address: Partial<Stripe.Address> | null;
  customer_country: string | null;
  customer_region: CustomerRegion | null;
  is_business: boolean;
  vat_id: string | null;
  /** Entered by a non-Italian customer on /billing (kept for the records). */
  foreign_tax_id?: string | null;
}

export interface IssueInput {
  number: number;
  /** YYYY-MM-DD */
  date: string;
}

export interface Check { label: string; ok: boolean; detail?: string }

export interface BuiltInvoice {
  xml: string;
  fileName: string;
  category: CustomerCategory;
  nature: string;
  taxRate: number;
  stampDuty: number | null;
  description: string;
  amounts: { taxable_amount_cents: number; vat_amount_cents: number; stamp_duty_cents: number; invoice_total_cents: number };
}

export interface PreparedInvoice {
  category: CustomerCategory;
  /** Why it can't be issued for real (empty = it can). */
  problems: string[];
  /** The XML, built whenever a Natura is known — also while rules are pending, for preview. */
  built: BuiltInvoice | null;
  /** The pre-issue checklist shown on the preview. */
  checks: Check[];
}

const MAX = { name: 60, denominazione: 80, indirizzo: 60, comune: 60, descrizione: 1000, causale: 200 };

function esc(v: string): string {
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
const cut = (v: string, n: number) => v.trim().slice(0, n);
const money = (n: number) => n.toFixed(2);
const tag = (name: string, value: string | null | undefined) => (value ? `<${name}>${esc(value)}</${name}>` : '');
const PRODUCT_TYPES = new Set(['software_subscription', 'coaching_service', 'digital_product', 'other']);

/** Split "Mario Rossi" → Nome "Mario", Cognome "Rossi" (last word is the surname). */
export function splitName(full: string): { nome: string; cognome: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { nome: parts[0] ?? '', cognome: parts[0] ?? '' };
  return { nome: parts.slice(0, -1).join(' '), cognome: parts[parts.length - 1] };
}

/**
 * The customer's category at ISSUE time — an Italian customer may add their
 * Partita IVA on /billing after paying, which makes the sale B2B.
 */
export function recordCategory(r: InvoiceRecord): CustomerCategory {
  const region = r.customer_region ?? 'NON_EU';
  const businessTaxId = region === 'IT' ? !!(r.partita_iva || r.vat_id) : !!r.vat_id;
  return customerCategory(region, businessTaxId);
}

export function recordProductType(r: InvoiceRecord): ProductType | null {
  if (r.source === 'subscription') return 'software_subscription';
  return r.product_type && PRODUCT_TYPES.has(r.product_type) ? (r.product_type as ProductType) : null;
}

/** Why this invoice can't be issued yet (empty = it can). Settings problems included. */
export function issueProblems(r: InvoiceRecord, x: InvoiceSettings, input?: IssueInput): string[] {
  return prepareInvoice(r, x, input).problems;
}

/** Everything about issuing this record: problems, the XML (when buildable) and the checklist. */
export function prepareInvoice(r: InvoiceRecord, x: InvoiceSettings, input?: IssueInput): PreparedInvoice {
  const p = [...settingsProblems(x)];
  if (input) {
    if (!Number.isInteger(input.number) || input.number <= 0) p.push('The invoice number must be a positive whole number');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) p.push('The invoice date must be YYYY-MM-DD');
  }
  if (r.livemode === false) p.push('Test-mode payment: it can be previewed, never issued');
  if ((r.refunded_amount_cents ?? 0) > 0) {
    p.push(`€${((r.refunded_amount_cents ?? 0) / 100).toFixed(2)} of this payment was refunded: decide with your commercialista, then void it or issue it (with a credit note in the portal)`);
  }
  if (r.amount_cents <= 0) p.push('Nothing was paid: no invoice is needed');
  if (!r.customer_name && !r.business_name) p.push('The customer has no name in Stripe');
  const a = r.customer_address ?? {};
  if (!a.line1 || !a.city) p.push('The customer has no billing address (street and city) in Stripe');

  const category = recordCategory(r);
  const italian = category === 'IT_B2C' || category === 'IT_B2B';
  const productType = recordProductType(r);
  const treatment = decideTreatment(x, productType, category, r.amount_cents);
  p.push(...treatment.problems);

  if (italian) {
    if (!a.postal_code || !/^[0-9]{5}$/.test(a.postal_code)) p.push('The Italian customer\'s CAP is missing or not 5 digits');
    if (category === 'IT_B2C' && !r.codice_fiscale) {
      p.push('Italian private customer without Codice Fiscale: ask them to add it on /billing (Invoice details)');
    }
  } else if (!r.vat_id) {
    if (!x.foreignPrivateId) p.push('The identifier for foreign private customers is not set (Invoice settings)');
    else if (x.foreignPrivateIdStatus !== 'confirmed') p.push(`The foreign private customer identifier ${x.foreignPrivateId} is awaiting confirmation`);
  }

  const description = invoiceDescription(x, r);
  const texts: Array<[string, string]> = [
    ['Customer name', r.business_name || r.customer_name || ''], ['Customer address', `${a.line1 ?? ''} ${a.line2 ?? ''}`],
    ['Customer city', a.city ?? ''], ['Description', description],
  ];
  for (const [label, text] of texts) {
    const bad = unsupportedChars(text);
    if (bad.length) p.push(`${label} contains characters the SdI does not accept (${bad.join(' ')})`);
  }

  const problems = [...new Set(p)];
  const canBuild = !!treatment.nature && !!input && /^\d{4}-\d{2}-\d{2}$/.test(input.date) && Number.isInteger(input.number) && input.number > 0;
  const built = canBuild ? buildXml(r, x, input!, category, treatment.nature!, treatment.reference, treatment.stampDuty, description) : null;
  return { category, problems, built, checks: checksFor(r, x, built, problems, category) };
}

/** Build the XML for issuing — throws unless every requirement is met. */
export function buildFatturaPA(r: InvoiceRecord, x: InvoiceSettings, input: IssueInput): BuiltInvoice {
  const prepared = prepareInvoice(r, x, input);
  if (prepared.problems.length || !prepared.built) throw new Error(prepared.problems.join('; ') || 'Invoice could not be built');
  return prepared.built;
}

function buildXml(
  r: InvoiceRecord, x: InvoiceSettings, input: IssueInput, category: CustomerCategory,
  nature: string, reference: string, stampDuty: number | null, description: string,
): BuiltInvoice {
  const italian = category === 'IT_B2C' || category === 'IT_B2B';
  const amounts = invoiceAmounts(r.amount_cents, stampDuty);
  const total = amounts.invoice_total_cents / 100;
  const year = Number(input.date.slice(0, 4));
  const progressivo = input.number < 1000
    ? `${String(year).slice(2)}${String(input.number).padStart(3, '0')}`
    : (year % 100 * 100000 + input.number).toString(36).toUpperCase().slice(-5).padStart(5, '0');
  const sellerId = x.seller.codiceFiscale || 'XXXXXXXXXXXXXXXX';

  // ── Destination ─────────────────────────────────────────────────────────
  let codiceDestinatario: string;
  let pecDestinatario = '';
  if (italian) {
    codiceDestinatario = r.codice_destinatario || '0000000';
    if (!r.codice_destinatario && r.pec) pecDestinatario = r.pec;
  } else {
    codiceDestinatario = 'XXXXXXX';
  }

  // ── Customer identification ─────────────────────────────────────────────
  const a = r.customer_address ?? {};
  const country = (r.customer_country || a.country || 'IT').toUpperCase();
  let idFiscale = '';
  let cf = '';
  if (italian) {
    const piva = r.partita_iva || (r.vat_id ? r.vat_id.replace(/\s+/g, '').toUpperCase().replace(/^IT/, '') : '');
    if (piva) idFiscale = `<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${esc(piva)}</IdCodice></IdFiscaleIVA>`;
    if (r.codice_fiscale) cf = tag('CodiceFiscale', r.codice_fiscale);
  } else if (r.vat_id) {
    const vat = r.vat_id.replace(/\s+/g, '').toUpperCase().replace(new RegExp(`^${country}`), '');
    idFiscale = `<IdFiscaleIVA><IdPaese>${esc(country)}</IdPaese><IdCodice>${esc(vat)}</IdCodice></IdFiscaleIVA>`;
  } else {
    const id = x.foreignPrivateId || 'OO99999999999';
    idFiscale = `<IdFiscaleIVA><IdPaese>${esc(id.slice(0, 2))}</IdPaese><IdCodice>${esc(id.slice(2))}</IdCodice></IdFiscaleIVA>`;
  }
  const useDenominazione = category.endsWith('B2B') && !!(r.business_name || r.customer_name);
  const anagrafica = useDenominazione
    ? tag('Denominazione', cut(r.business_name || r.customer_name!, MAX.denominazione))
    : (() => {
        const { nome, cognome } = splitName(r.customer_name || r.business_name || '');
        return tag('Nome', cut(nome, MAX.name)) + tag('Cognome', cut(cognome, MAX.name));
      })();
  const street = [a.line1, a.line2].filter(Boolean).join(', ');
  const postal = (a.postal_code ?? '').trim();
  const fiveDigit = /^[0-9]{5}$/.test(postal);
  // Foreign postcode the CAP field can't hold: keep it, in the address line.
  const indirizzo = !italian && postal && !fiveDigit ? `${street} - ${postal}` : street;
  const customerSede =
    tag('Indirizzo', cut(indirizzo, MAX.indirizzo)) +
    tag('CAP', fiveDigit ? postal : '00000') +
    tag('Comune', cut(a.city ?? '', MAX.comune)) +
    (italian && a.state && /^[A-Za-z]{2}$/.test(a.state) ? tag('Provincia', a.state.toUpperCase()) : '') +
    tag('Nazione', country);

  // ── Body ────────────────────────────────────────────────────────────────
  const causali = [];
  for (let i = 0; i < x.wording.length; i += MAX.causale) causali.push(x.wording.slice(i, i + MAX.causale));
  const bollo = stampDuty !== null
    ? `<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>${money(stampDuty)}</ImportoBollo></DatiBollo>`
    : '';
  const rate = money(x.taxRate);
  const seller = x.seller;
  const taxable = money(amounts.taxable_amount_cents / 100);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
<FatturaElettronicaHeader>
<DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${esc(sellerId)}</IdCodice></IdTrasmittente><ProgressivoInvio>${progressivo}</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>${codiceDestinatario}</CodiceDestinatario>${tag('PECDestinatario', pecDestinatario)}</DatiTrasmissione>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${esc(seller.partitaIva)}</IdCodice></IdFiscaleIVA>${tag('CodiceFiscale', seller.codiceFiscale)}<Anagrafica>${tag('Nome', cut(seller.firstName, MAX.name))}${tag('Cognome', cut(seller.lastName, MAX.name))}</Anagrafica><RegimeFiscale>${esc(seller.regimeFiscale)}</RegimeFiscale></DatiAnagrafici><Sede>${tag('Indirizzo', cut(seller.address, MAX.indirizzo))}${tag('CAP', seller.cap)}${tag('Comune', cut(seller.city, MAX.comune))}${tag('Provincia', seller.province)}<Nazione>IT</Nazione></Sede></CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici>${idFiscale}${cf}<Anagrafica>${anagrafica}</Anagrafica></DatiAnagrafici><Sede>${customerSede}</Sede></CessionarioCommittente>
</FatturaElettronicaHeader>
<FatturaElettronicaBody>
<DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>${esc(r.currency.toUpperCase())}</Divisa><Data>${input.date}</Data><Numero>${input.number}</Numero>${bollo}<ImportoTotaleDocumento>${money(total)}</ImportoTotaleDocumento>${causali.map((c) => tag('Causale', c)).join('')}</DatiGeneraliDocumento></DatiGenerali>
<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>${esc(cut(description, MAX.descrizione))}</Descrizione><PrezzoUnitario>${taxable}</PrezzoUnitario><PrezzoTotale>${taxable}</PrezzoTotale><AliquotaIVA>${rate}</AliquotaIVA><Natura>${esc(nature)}</Natura></DettaglioLinee><DatiRiepilogo><AliquotaIVA>${rate}</AliquotaIVA><Natura>${esc(nature)}</Natura><ImponibileImporto>${taxable}</ImponibileImporto><Imposta>${money(amounts.vat_amount_cents / 100)}</Imposta>${tag('RiferimentoNormativo', reference)}</DatiRiepilogo></DatiBeniServizi>
<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>${esc(x.paymentMethod)}</ModalitaPagamento><ImportoPagamento>${money(total)}</ImportoPagamento></DettaglioPagamento></DatiPagamento>
</FatturaElettronicaBody>
</p:FatturaElettronica>
`;

  return { xml, fileName: `IT${sellerId}_${progressivo}.xml`, category, nature, taxRate: x.taxRate, stampDuty, description, amounts };
}

const val = (xml: string, t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1] ?? null;

/** The pre-issue checklist, read back from the generated XML where possible. */
function checksFor(r: InvoiceRecord, x: InvoiceSettings, built: BuiltInvoice | null, problems: string[], category: CustomerCategory): Check[] {
  const italian = category === 'IT_B2C' || category === 'IT_B2B';
  const supplierOk = settingsProblems(x).filter((m) => !m.includes('wording')).length === 0;
  const c: Check[] = [
    { label: 'Supplier details complete (name, address, Partita IVA, Codice Fiscale, RF19)', ok: supplierOk },
    { label: 'Invoice wording set and SdI-compatible', ok: !!x.wording && unsupportedChars(x.wording).length === 0 },
  ];
  if (!built) {
    c.push({ label: 'XML generated', ok: false, detail: 'Not buildable yet: no VAT treatment (Natura) for this sale' });
    c.push({ label: 'Ready to issue', ok: false, detail: `${problems.length} problem(s) to resolve` });
    return c;
  }
  const xml = built.xml;
  const paid = money(r.amount_cents / 100);
  const total = val(xml, 'ImportoTotaleDocumento');
  const line = val(xml, 'PrezzoTotale');
  const imponibile = val(xml, 'ImponibileImporto');
  const bollo = val(xml, 'ImportoBollo');
  const dest = val(xml, 'CodiceDestinatario');
  c.push(
    { label: 'Document type TD01 (fattura), currency, format FPR12', ok: val(xml, 'TipoDocumento') === 'TD01' && val(xml, 'FormatoTrasmissione') === 'FPR12' },
    { label: `VAT: Natura ${built.nature}, rate 0.00%, VAT €0.00`, ok: val(xml, 'Natura') === built.nature && val(xml, 'AliquotaIVA') === '0.00' && val(xml, 'Imposta') === '0.00' },
    { label: `Total €${total} = Stripe payment €${paid} = line €${line} = taxable €${imponibile}`, ok: total === paid && line === paid && imponibile === paid },
    {
      label: bollo ? `Stamp duty €${bollo} declared (BolloVirtuale SI), absorbed — not in the total` : 'No stamp duty on this invoice',
      ok: bollo ? total === paid : true,
    },
    italian
      ? { label: `Italian customer: recipient ${dest}${r.pec && dest === '0000000' ? ' + PEC' : ''}, ${category === 'IT_B2C' ? 'Codice Fiscale' : 'Partita IVA'}`, ok: (category === 'IT_B2C' ? !!r.codice_fiscale : !!r.partita_iva || !!r.vat_id) && !!dest }
      : { label: `Foreign customer: recipient XXXXXXX, identifier ${r.vat_id ? 'VAT number' : x.foreignPrivateId}`, ok: dest === 'XXXXXXX' },
    { label: 'Ready to issue', ok: problems.length === 0, detail: problems.length ? `${problems.length} problem(s) to resolve` : undefined },
  );
  return c;
}
