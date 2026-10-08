import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceSettings, settingsProblems, stampDutyFor, suggestInvoiceNumber, natureFor, invoiceDescription } from '@/lib/billing/invoicing/settings';
import { buildFatturaPA, issueProblems, splitName, type InvoiceRecord } from '@/lib/billing/invoicing/fatturaPA';

const ENV = {
  INVOICE_SELLER_FIRST_NAME: 'Vinicius', INVOICE_SELLER_LAST_NAME: 'Baccelli',
  INVOICE_SELLER_PARTITA_IVA: '12345678903', INVOICE_SELLER_CODICE_FISCALE: 'RSSMRA80A01H501U',
  INVOICE_SELLER_ADDRESS: 'Via Roma 1', INVOICE_SELLER_CAP: '20100', INVOICE_SELLER_CITY: 'Milano', INVOICE_SELLER_PROVINCE: 'MI',
  INVOICE_REGIME_WORDING_IT: 'Operazione effettuata ai sensi del regime forfettario (wording from the accountant).',
};
const S = invoiceSettings(ENV);

const itB2C: InvoiceRecord = {
  amount_cents: 29900, currency: 'EUR', plan: 'pro', billing_interval: 'year',
  period_start: '2026-10-08T10:00:00.000Z', period_end: '2027-10-08T10:00:00.000Z',
  customer_name: 'Maria Bianchi', business_name: null,
  customer_address: { line1: 'Corso Italia 5', line2: null, postal_code: '00184', city: 'Roma', state: 'RM', country: 'IT' },
  customer_country: 'IT', customer_region: 'IT', is_business: false, vat_id: null,
  codice_fiscale: 'RSSMRA80A01H501U', partita_iva: null, codice_destinatario: null, pec: null,
};

test('defaults are only what Vin confirmed: RF19, N2.2, rate 0, bollo 2.00 over 77.47, next number 65', () => {
  const d = invoiceSettings({});
  assert.equal(d.seller.regimeFiscale, 'RF19');
  assert.deepEqual(d.nature, { IT: 'N2.2', EU_B2B: 'N2.2', EU_B2C: 'N2.2', NON_EU: 'N2.2' });
  assert.equal(d.taxRate, 0);
  assert.deepEqual(d.stampDuty, { rule: 'auto', threshold: 77.47, amount: 2, natures: ['N2.2'] });
  assert.equal(suggestInvoiceNumber(d, 2026, null), 65);
  assert.equal(suggestInvoiceNumber(d, 2026, 70), 71);
  assert.equal(suggestInvoiceNumber(d, 2027, null), 1);
  // No wording and no seller data: nothing can be issued.
  assert.ok(settingsProblems(d).some((p) => p.includes('INVOICE_REGIME_WORDING_IT')));
  assert.ok(settingsProblems(d).some((p) => p.includes('INVOICE_SELLER_PARTITA_IVA')));
  assert.deepEqual(settingsProblems(S), []);
});

test('Natura per customer kind is configurable; bad codes are reported', () => {
  const s = invoiceSettings({ ...ENV, INVOICE_TAX_NATURE_EU_B2B: 'N2.1', INVOICE_TAX_NATURE_NON_EU: 'N9' });
  assert.equal(natureFor(s, 'EU', true), 'N2.1');
  assert.equal(natureFor(s, 'EU', false), 'N2.2');
  assert.ok(settingsProblems(s).some((p) => p.includes('"N9"')));
});

test('stamp duty: only over the threshold, only for listed natures, never when off', () => {
  assert.equal(stampDutyFor(S, 299, 'N2.2'), 2);
  assert.equal(stampDutyFor(S, 77.47, 'N2.2'), null);
  assert.equal(stampDutyFor(S, 34.9, 'N2.2'), null);
  assert.equal(stampDutyFor(S, 299, 'N2.1'), null);
  assert.equal(stampDutyFor(invoiceSettings({ ...ENV, INVOICE_STAMP_DUTY_RULE_IT: 'off' }), 299, 'N2.2'), null);
});

test('Italian private customer: CF, 0000000, bollo declared but NOT added to the total', () => {
  const b = buildFatturaPA(itB2C, S, { number: 65, date: '2026-10-08' });
  assert.equal(b.fileName, 'ITRSSMRA80A01H501U_26065.xml');
  assert.equal(b.stampDuty, 2);
  const x = b.xml;
  assert.match(x, /<FormatoTrasmissione>FPR12<\/FormatoTrasmissione><CodiceDestinatario>0000000<\/CodiceDestinatario>/);
  assert.match(x, /<RegimeFiscale>RF19<\/RegimeFiscale>/);
  assert.match(x, /<CessionarioCommittente><DatiAnagrafici><CodiceFiscale>RSSMRA80A01H501U<\/CodiceFiscale><Anagrafica><Nome>Maria<\/Nome><Cognome>Bianchi<\/Cognome>/);
  assert.match(x, /<Numero>65<\/Numero><DatiBollo><BolloVirtuale>SI<\/BolloVirtuale><ImportoBollo>2.00<\/ImportoBollo><\/DatiBollo><ImportoTotaleDocumento>299.00<\/ImportoTotaleDocumento>/);
  assert.match(x, /<AliquotaIVA>0.00<\/AliquotaIVA><Natura>N2.2<\/Natura><\/DettaglioLinee>/);
  assert.match(x, /<Imposta>0.00<\/Imposta>/);
  assert.match(x, /<Causale>Operazione effettuata ai sensi del regime forfettario/);
  assert.match(x, /<Descrizione>Abbonamento AngleMotion Pro annuale - periodo dal 08\/10\/2026 al 08\/10\/2027<\/Descrizione>/);
  assert.match(x, /<ModalitaPagamento>MP08<\/ModalitaPagamento><ImportoPagamento>299.00<\/ImportoPagamento>/);
  assert.match(x, /<Provincia>RM<\/Provincia><Nazione>IT<\/Nazione>/);
  // Balanced, well-formed-looking document: every opened tag is closed.
  const opens = (x.match(/<(?![/?!])[^>]*[^/]>/g) ?? []).length;
  const closes = (x.match(/<\/[^>]+>/g) ?? []).length;
  assert.equal(opens, closes);
});

test('monthly Light under the threshold: no bollo; PEC used when there is no Codice Destinatario', () => {
  const b = buildFatturaPA({ ...itB2C, amount_cents: 1290, billing_interval: 'month', pec: 'maria@pec.it' }, S, { number: 66, date: '2026-10-08' });
  assert.equal(b.stampDuty, null);
  assert.doesNotMatch(b.xml, /DatiBollo/);
  assert.match(b.xml, /<CodiceDestinatario>0000000<\/CodiceDestinatario><PECDestinatario>maria@pec.it<\/PECDestinatario>/);
});

test('Italian business: Partita IVA + Codice Destinatario, Denominazione', () => {
  const b = buildFatturaPA({ ...itB2C, is_business: true, business_name: 'Circolo Tennis & Padel', partita_iva: '12345678903', codice_fiscale: null, codice_destinatario: 'M5UXCR1' }, S, { number: 67, date: '2026-10-08' });
  assert.match(b.xml, /<CodiceDestinatario>M5UXCR1<\/CodiceDestinatario>/);
  assert.match(b.xml, /<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT<\/IdPaese><IdCodice>12345678903<\/IdCodice><\/IdFiscaleIVA><Anagrafica><Denominazione>Circolo Tennis &amp; Padel<\/Denominazione>/);
});

test('foreign customers: XXXXXXX, VAT number without country prefix, CAP 00000', () => {
  const de = buildFatturaPA({ ...itB2C, customer_region: 'EU', customer_country: 'DE', is_business: true, business_name: 'Tennis GmbH', vat_id: 'DE123456789', codice_fiscale: null, customer_address: { line1: 'Str. 1', city: 'Berlin', postal_code: '10115', country: 'DE' } }, S, { number: 68, date: '2026-10-08' });
  assert.match(de.xml, /<CodiceDestinatario>XXXXXXX<\/CodiceDestinatario>/);
  assert.match(de.xml, /<IdFiscaleIVA><IdPaese>DE<\/IdPaese><IdCodice>123456789<\/IdCodice><\/IdFiscaleIVA>/);
  assert.match(de.xml, /<CAP>00000<\/CAP><Comune>Berlin<\/Comune><Nazione>DE<\/Nazione>/);
  const us = buildFatturaPA({ ...itB2C, customer_region: 'NON_EU', customer_country: 'US', codice_fiscale: null, customer_address: { line1: '1 Main St', city: 'Austin', postal_code: '73301', country: 'US' } }, S, { number: 69, date: '2026-10-08' });
  assert.match(us.xml, /<IdPaese>US<\/IdPaese><IdCodice>99999999999<\/IdCodice>/);
});

test('what blocks issuing: Italian private without CF, no address, bad number', () => {
  assert.ok(issueProblems({ ...itB2C, codice_fiscale: null }, S).some((p) => p.includes('Codice Fiscale')));
  assert.ok(issueProblems({ ...itB2C, customer_address: null }, S).some((p) => p.includes('billing address')));
  assert.ok(issueProblems(itB2C, S, { number: 0, date: '2026-10-08' }).some((p) => p.includes('positive')));
  assert.throws(() => buildFatturaPA({ ...itB2C, codice_fiscale: null }, S, { number: 65, date: '2026-10-08' }), /Codice Fiscale/);
  assert.deepEqual(issueProblems(itB2C, S, { number: 65, date: '2026-10-08' }), []);
});

test('helpers: name split and description template', () => {
  assert.deepEqual(splitName('Anna Maria De Luca'), { nome: 'Anna Maria De', cognome: 'Luca' });
  assert.equal(invoiceDescription(S, { plan: 'light', billing_interval: 'month', period_start: '2026-10-08T00:00:00Z', period_end: '2026-11-08T00:00:00Z' }),
    'Abbonamento AngleMotion Light mensile - periodo dal 08/10/2026 al 08/11/2026');
});
