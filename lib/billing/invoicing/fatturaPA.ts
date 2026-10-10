import type Stripe from 'stripe';
import type { CustomerCategory, CustomerRegion } from '@/lib/billing/invoicing/draft';
import { customerCategory } from '@/lib/billing/invoicing/draft';
import type { ItalianFields } from '@/lib/billing/invoicing/italianFields';
import {
  categoryLabel, invoiceAmounts, invoiceDescription, natureFor, settingsProblems, type InvoiceSettings,
} from '@/lib/billing/invoicing/settings';

/**
 * Builds the FatturaPA XML (format FPR12, "fattura tra privati") for one paid
 * sale — a subscription payment or a one-off sale — ready to upload in the
 * Agenzia delle Entrate portal "Fatture e Corrispettivi" (Trasmissione →
 * upload file), which sends it to SdI. Pure: record + settings in, XML out
 * (tests/fatturaPA.test.ts).
 *
 * All fiscal choices come from the settings row (lib/billing/invoicing/settings.ts):
 *  - seller: Vin as a person (Nome/Cognome), Partita IVA, Codice Fiscale,
 *    RegimeFiscale (RF19), Sede;
 *  - one line at the price actually paid, AliquotaIVA 0.00 and the Natura of
 *    the customer's category (N2.2 Italy, N2.1 abroad; EU private pending);
 *  - the forfettario wording as Causale; an optional legal reference per
 *    category in the VAT summary;
 *  - DatiBollo when stamp duty applies — DECLARED, NOT ADDED: the document
 *    total stays the amount paid through Stripe (D7);
 *  - customer: Italian (Partita IVA and/or Codice Fiscale; Codice Destinatario
 *    or PEC, else "0000000") or foreign (CodiceDestinatario "XXXXXXX",
 *    IdFiscaleIVA = country + VAT/tax ID, CAP "00000").
 * It does not sign or transmit anything: the portal does that.
 */

export interface InvoiceRecord extends Partial<ItalianFields> {
  source?: 'subscription' | 'one_off' | string | null;
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
  /** Entered by a non-Italian customer on /billing. */
  foreign_tax_id?: string | null;
}

export interface IssueInput {
  number: number;
  /** YYYY-MM-DD */
  date: string;
}

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

const MAX = { name: 60, denominazione: 80, indirizzo: 60, comune: 60, descrizione: 1000, causale: 200 };

function esc(v: string): string {
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
const cut = (v: string, n: number) => v.trim().slice(0, n);
const money = (n: number) => n.toFixed(2);
const tag = (name: string, value: string | null | undefined) => (value ? `<${name}>${esc(value)}</${name}>` : '');

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

/** Why this invoice can't be issued yet (empty = it can). Settings problems included. */
export function issueProblems(r: InvoiceRecord, x: InvoiceSettings, input?: IssueInput): string[] {
  const p = [...settingsProblems(x)];
  if (input) {
    if (!Number.isInteger(input.number) || input.number <= 0) p.push('The invoice number must be a positive whole number');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) p.push('The invoice date must be YYYY-MM-DD');
  }
  if (r.amount_cents <= 0) p.push('Nothing was paid: no invoice is needed');
  if (!r.customer_name && !r.business_name) p.push('The customer has no name in Stripe');
  const a = r.customer_address ?? {};
  if (!a.line1 || !a.city) p.push('The customer has no billing address (street and city) in Stripe');

  const category = recordCategory(r);
  if (!natureFor(x, category)) {
    p.push(`The VAT treatment (Natura) for ${categoryLabel(category)} is not set yet — waiting for your accountant`
      + (category === 'EU_B2C' ? ' (OSS question)' : ''));
  }
  if (category === 'IT_B2C' || category === 'IT_B2B') {
    if (!a.postal_code || !/^[0-9]{5}$/.test(a.postal_code)) p.push('The Italian customer\'s CAP is missing or not 5 digits');
    if (category === 'IT_B2C' && !r.codice_fiscale) {
      p.push('Italian private customer without Codice Fiscale: ask them to add it on /billing (Invoice details)');
    }
  } else if (!r.vat_id && !r.foreign_tax_id && !x.foreignPrivateId) {
    p.push('Foreign private customer without a tax ID: the identifier to use is not set yet — waiting for your accountant (T3)');
  }
  return p;
}

export function buildFatturaPA(r: InvoiceRecord, x: InvoiceSettings, input: IssueInput): BuiltInvoice {
  const problems = issueProblems(r, x, input);
  if (problems.length) throw new Error(problems.join('; '));

  const category = recordCategory(r);
  const italian = category === 'IT_B2C' || category === 'IT_B2B';
  const nature = natureFor(x, category)!;
  const amounts = invoiceAmounts(x, r.amount_cents, nature);
  const stampDuty = amounts.stamp_duty_cents ? amounts.stamp_duty_cents / 100 : null;
  const total = amounts.invoice_total_cents / 100;
  const description = invoiceDescription(x, r);
  const year = Number(input.date.slice(0, 4));
  const progressivo = input.number < 1000
    ? `${String(year).slice(2)}${String(input.number).padStart(3, '0')}`
    : (year % 100 * 100000 + input.number).toString(36).toUpperCase().slice(-5).padStart(5, '0');
  const sellerId = x.seller.codiceFiscale;

  // ── Destination ─────────────────────────────────────────────────────────
  let codiceDestinatario: string;
  let pecDestinatario = '';
  if (italian) {
    codiceDestinatario = r.codice_destinatario || '0000000';
    if (!r.codice_destinatario && r.pec) pecDestinatario = r.pec;
  } else {
    codiceDestinatario = 'XXXXXXX';
  }

  // ── Customer ────────────────────────────────────────────────────────────
  const a = r.customer_address ?? {};
  const country = (r.customer_country || a.country || 'IT').toUpperCase();
  let idFiscale = '';
  let cf = '';
  if (italian) {
    const piva = r.partita_iva || (r.vat_id ? r.vat_id.replace(/\s+/g, '').toUpperCase().replace(/^IT/, '') : '');
    if (piva) idFiscale = `<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${esc(piva)}</IdCodice></IdFiscaleIVA>`;
    if (r.codice_fiscale) cf = tag('CodiceFiscale', r.codice_fiscale);
  } else {
    const strip = (v: string) => v.replace(/\s+/g, '').toUpperCase().replace(new RegExp(`^${country}`), '');
    const id = r.vat_id ? strip(r.vat_id) : r.foreign_tax_id ? strip(r.foreign_tax_id) : x.foreignPrivateId!;
    idFiscale = `<IdFiscaleIVA><IdPaese>${esc(country)}</IdPaese><IdCodice>${esc(id)}</IdCodice></IdFiscaleIVA>`;
  }
  const useDenominazione = category.endsWith('B2B') && !!(r.business_name || r.customer_name);
  const anagrafica = useDenominazione
    ? tag('Denominazione', cut(r.business_name || r.customer_name!, MAX.denominazione))
    : (() => {
        const { nome, cognome } = splitName(r.customer_name || r.business_name || '');
        return tag('Nome', cut(nome, MAX.name)) + tag('Cognome', cut(cognome, MAX.name));
      })();
  const street = [a.line1, a.line2].filter(Boolean).join(', ');
  const customerSede =
    tag('Indirizzo', cut(street, MAX.indirizzo)) +
    tag('CAP', italian ? a.postal_code! : '00000') +
    tag('Comune', cut(a.city ?? '', MAX.comune)) +
    (italian && a.state && /^[A-Za-z]{2}$/.test(a.state) ? tag('Provincia', a.state.toUpperCase()) : '') +
    tag('Nazione', country);

  // ── Body ────────────────────────────────────────────────────────────────
  const causali = [];
  for (let i = 0; i < x.regimeWording.length; i += MAX.causale) causali.push(x.regimeWording.slice(i, i + MAX.causale));
  const bollo = stampDuty !== null
    ? `<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>${money(stampDuty)}</ImportoBollo></DatiBollo>`
    : '';
  const rate = money(x.taxRate);
  const seller = x.seller;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
<FatturaElettronicaHeader>
<DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${esc(sellerId)}</IdCodice></IdTrasmittente><ProgressivoInvio>${progressivo}</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>${codiceDestinatario}</CodiceDestinatario>${tag('PECDestinatario', pecDestinatario)}</DatiTrasmissione>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${esc(seller.partitaIva)}</IdCodice></IdFiscaleIVA>${tag('CodiceFiscale', seller.codiceFiscale)}<Anagrafica>${tag('Nome', cut(seller.firstName, MAX.name))}${tag('Cognome', cut(seller.lastName, MAX.name))}</Anagrafica><RegimeFiscale>${esc(seller.regimeFiscale)}</RegimeFiscale></DatiAnagrafici><Sede>${tag('Indirizzo', cut(seller.address, MAX.indirizzo))}${tag('CAP', seller.cap)}${tag('Comune', cut(seller.city, MAX.comune))}${tag('Provincia', seller.province)}<Nazione>IT</Nazione></Sede></CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici>${idFiscale}${cf}<Anagrafica>${anagrafica}</Anagrafica></DatiAnagrafici><Sede>${customerSede}</Sede></CessionarioCommittente>
</FatturaElettronicaHeader>
<FatturaElettronicaBody>
<DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>${esc(r.currency.toUpperCase())}</Divisa><Data>${input.date}</Data><Numero>${input.number}</Numero>${bollo}<ImportoTotaleDocumento>${money(total)}</ImportoTotaleDocumento>${causali.map((c) => tag('Causale', c)).join('')}</DatiGeneraliDocumento></DatiGenerali>
<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>${esc(cut(description, MAX.descrizione))}</Descrizione><PrezzoUnitario>${money(amounts.taxable_amount_cents / 100)}</PrezzoUnitario><PrezzoTotale>${money(amounts.taxable_amount_cents / 100)}</PrezzoTotale><AliquotaIVA>${rate}</AliquotaIVA><Natura>${esc(nature)}</Natura></DettaglioLinee><DatiRiepilogo><AliquotaIVA>${rate}</AliquotaIVA><Natura>${esc(nature)}</Natura><ImponibileImporto>${money(amounts.taxable_amount_cents / 100)}</ImponibileImporto><Imposta>${money(amounts.vat_amount_cents / 100)}</Imposta>${tag('RiferimentoNormativo', x.reference[category])}</DatiRiepilogo></DatiBeniServizi>
<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>${esc(x.paymentMethod)}</ModalitaPagamento><ImportoPagamento>${money(total)}</ImportoPagamento></DettaglioPagamento></DatiPagamento>
</FatturaElettronicaBody>
</p:FatturaElettronica>
`;

  return {
    xml,
    fileName: `IT${sellerId}_${progressivo}.xml`,
    category,
    nature,
    taxRate: x.taxRate,
    stampDuty,
    description,
    amounts,
  };
}
