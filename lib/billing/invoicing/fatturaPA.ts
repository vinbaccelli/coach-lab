import type Stripe from 'stripe';
import type { CustomerRegion } from '@/lib/billing/invoicing/draft';
import type { ItalianFields } from '@/lib/billing/invoicing/italianFields';
import {
  invoiceDescription, natureFor, settingsProblems, stampDutyFor, type InvoiceSettings,
} from '@/lib/billing/invoicing/settings';

/**
 * Builds the FatturaPA XML (format FPR12, "fattura tra privati") for one paid
 * subscription invoice, ready to upload in the Agenzia delle Entrate portal
 * "Fatture e Corrispettivi" (Trasmissione → upload file), which sends it to
 * SdI. Pure: rows + settings in, XML string out (tests/fatturaPA.test.ts).
 *
 * What it encodes, all from configuration (lib/billing/invoicing/settings.ts):
 *  - seller: Vin as a person (Nome/Cognome), Partita IVA, Codice Fiscale,
 *    RegimeFiscale (RF19 forfettario), Sede;
 *  - one line at the price the customer actually paid, AliquotaIVA 0.00 and
 *    the configured Natura (N2.2), the regime wording as Causale;
 *  - DatiBollo when stamp duty applies — declared, NOT added to the total
 *    (Vin absorbs it);
 *  - customer: Italian (Partita IVA and/or Codice Fiscale, Codice
 *    Destinatario or PEC, else "0000000" so it lands in their cassetto
 *    fiscale) or foreign (CodiceDestinatario "XXXXXXX", CAP "00000").
 * It does not sign or transmit anything: the portal does that.
 */

export interface InvoiceRecord extends Partial<ItalianFields> {
  amount_cents: number;
  currency: string;
  plan: string | null;
  billing_interval: string | null;
  period_start: string | null;
  period_end: string | null;
  customer_name: string | null;
  business_name: string | null;
  customer_address: Partial<Stripe.Address> | null;
  customer_country: string | null;
  customer_region: CustomerRegion | null;
  is_business: boolean;
  vat_id: string | null;
}

export interface IssueInput {
  number: number;
  /** YYYY-MM-DD */
  date: string;
}

export interface BuiltInvoice {
  xml: string;
  fileName: string;
  nature: string;
  taxRate: number;
  stampDuty: number | null;
  description: string;
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

/** Why this invoice can't be issued yet (empty = it can). Settings problems included. */
export function issueProblems(r: InvoiceRecord, s: InvoiceSettings, input?: IssueInput): string[] {
  const p = [...settingsProblems(s)];
  if (input) {
    if (!Number.isInteger(input.number) || input.number <= 0) p.push('The invoice number must be a positive whole number');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) p.push('The invoice date must be YYYY-MM-DD');
  }
  if (r.amount_cents <= 0) p.push('Nothing was paid: no invoice is needed');
  if (!r.customer_name && !r.business_name) p.push('The customer has no name in Stripe');
  const a = r.customer_address ?? {};
  if (!a.line1 || !a.city) p.push('The customer has no billing address (street and city) in Stripe');
  if (r.customer_region === 'IT') {
    if (!a.postal_code || !/^[0-9]{5}$/.test(a.postal_code)) p.push('The Italian customer\'s CAP is missing or not 5 digits');
    if (r.is_business && r.partita_iva) {
      // B2B: Partita IVA is enough; Codice Destinatario / PEC optional.
    } else if (!r.codice_fiscale) {
      p.push('Italian customer without Codice Fiscale: ask them to add it on /billing (Invoice details)');
    }
  }
  return p;
}

export function buildFatturaPA(r: InvoiceRecord, s: InvoiceSettings, input: IssueInput): BuiltInvoice {
  const problems = issueProblems(r, s, input);
  if (problems.length) throw new Error(problems.join('; '));

  const region = r.customer_region ?? 'NON_EU';
  const nature = natureFor(s, region, r.is_business);
  const amount = r.amount_cents / 100;
  const stampDuty = stampDutyFor(s, amount, nature);
  const description = invoiceDescription(s, r);
  const year = Number(input.date.slice(0, 4));
  const progressivo = input.number < 1000
    ? `${String(year).slice(2)}${String(input.number).padStart(3, '0')}`
    : (year % 100 * 100000 + input.number).toString(36).toUpperCase().slice(-5).padStart(5, '0');
  const sellerId = s.seller.codiceFiscale;

  // ── Destination ─────────────────────────────────────────────────────────
  let codiceDestinatario: string;
  let pecDestinatario = '';
  if (region === 'IT') {
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
  if (region === 'IT') {
    if (r.partita_iva) idFiscale = `<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${esc(r.partita_iva)}</IdCodice></IdFiscaleIVA>`;
    if (r.codice_fiscale) cf = tag('CodiceFiscale', r.codice_fiscale);
  } else {
    const vat = r.vat_id ? r.vat_id.replace(/\s+/g, '').toUpperCase().replace(new RegExp(`^${country}`), '') : '';
    idFiscale = `<IdFiscaleIVA><IdPaese>${esc(country)}</IdPaese><IdCodice>${esc(vat || s.foreignPrivateId)}</IdCodice></IdFiscaleIVA>`;
  }
  const useDenominazione = r.is_business && !!(r.business_name || r.customer_name);
  const anagrafica = useDenominazione
    ? tag('Denominazione', cut(r.business_name || r.customer_name!, MAX.denominazione))
    : (() => {
        const { nome, cognome } = splitName(r.customer_name || r.business_name || '');
        return tag('Nome', cut(nome, MAX.name)) + tag('Cognome', cut(cognome, MAX.name));
      })();
  const street = [a.line1, a.line2].filter(Boolean).join(', ');
  const customerSede =
    tag('Indirizzo', cut(street, MAX.indirizzo)) +
    tag('CAP', region === 'IT' ? a.postal_code! : '00000') +
    tag('Comune', cut(a.city ?? '', MAX.comune)) +
    (region === 'IT' && a.state && /^[A-Za-z]{2}$/.test(a.state) ? tag('Provincia', a.state.toUpperCase()) : '') +
    tag('Nazione', country);

  // ── Body ────────────────────────────────────────────────────────────────
  const causali = [];
  for (let i = 0; i < s.regimeWording.length; i += MAX.causale) causali.push(s.regimeWording.slice(i, i + MAX.causale));
  const bollo = stampDuty !== null
    ? `<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>${money(stampDuty)}</ImportoBollo></DatiBollo>`
    : '';
  const rate = money(s.taxRate);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
<FatturaElettronicaHeader>
<DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${esc(sellerId)}</IdCodice></IdTrasmittente><ProgressivoInvio>${progressivo}</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>${codiceDestinatario}</CodiceDestinatario>${tag('PECDestinatario', pecDestinatario)}</DatiTrasmissione>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${esc(s.seller.partitaIva)}</IdCodice></IdFiscaleIVA>${tag('CodiceFiscale', s.seller.codiceFiscale)}<Anagrafica>${tag('Nome', cut(s.seller.firstName, MAX.name))}${tag('Cognome', cut(s.seller.lastName, MAX.name))}</Anagrafica><RegimeFiscale>${esc(s.seller.regimeFiscale)}</RegimeFiscale></DatiAnagrafici><Sede>${tag('Indirizzo', cut(s.seller.address, MAX.indirizzo))}${tag('CAP', s.seller.cap)}${tag('Comune', cut(s.seller.city, MAX.comune))}${tag('Provincia', s.seller.province)}<Nazione>IT</Nazione></Sede></CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici>${idFiscale}${cf}<Anagrafica>${anagrafica}</Anagrafica></DatiAnagrafici><Sede>${customerSede}</Sede></CessionarioCommittente>
</FatturaElettronicaHeader>
<FatturaElettronicaBody>
<DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>${esc(r.currency.toUpperCase())}</Divisa><Data>${input.date}</Data><Numero>${input.number}</Numero>${bollo}<ImportoTotaleDocumento>${money(amount)}</ImportoTotaleDocumento>${causali.map((c) => tag('Causale', c)).join('')}</DatiGeneraliDocumento></DatiGenerali>
<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>${esc(cut(description, MAX.descrizione))}</Descrizione><PrezzoUnitario>${money(amount)}</PrezzoUnitario><PrezzoTotale>${money(amount)}</PrezzoTotale><AliquotaIVA>${rate}</AliquotaIVA><Natura>${esc(nature)}</Natura></DettaglioLinee><DatiRiepilogo><AliquotaIVA>${rate}</AliquotaIVA><Natura>${esc(nature)}</Natura><ImponibileImporto>${money(amount)}</ImponibileImporto><Imposta>0.00</Imposta>${tag('RiferimentoNormativo', s.taxReference)}</DatiRiepilogo></DatiBeniServizi>
<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>${esc(s.paymentMethod)}</ModalitaPagamento><ImportoPagamento>${money(amount)}</ImportoPagamento></DettaglioPagamento></DatiPagamento>
</FatturaElettronicaBody>
</p:FatturaElettronica>
`;

  return {
    xml,
    fileName: `IT${sellerId}_${progressivo}.xml`,
    nature,
    taxRate: s.taxRate,
    stampDuty,
    description,
  };
}
