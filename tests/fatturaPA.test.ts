import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settingsFromRow, settingsProblems, stampDutyFor, suggestInvoiceNumber, natureFor, invoiceDescription,
  invoiceAmounts, settingsPatchFromForm, DEFAULT_SETTINGS_ROW,
} from '@/lib/billing/invoicing/settings';
import { buildFatturaPA, issueProblems, recordCategory, splitName, type InvoiceRecord } from '@/lib/billing/invoicing/fatturaPA';

// A filled-in settings row, as Vin saves it on /admin/invoices (test values,
// valid check digits; not his real data).
const ROW = {
  ...DEFAULT_SETTINGS_ROW,
  seller_first_name: 'Mario', seller_last_name: 'Rossi', seller_partita_iva: '12345678903',
  seller_codice_fiscale: 'RSSMRA80A01H501U', seller_address: 'Via Roma 1', seller_cap: '20100', seller_city: 'Milano',
  seller_province: 'MI', regime_wording: 'Operazione effettuata ai sensi del regime forfettario (wording from the accountant).',
};
const S = settingsFromRow(ROW);

const itB2C: InvoiceRecord = {
  source: 'subscription', amount_cents: 29900, currency: 'EUR', plan: 'pro', billing_interval: 'year',
  period_start: '2026-10-08T10:00:00.000Z', period_end: '2027-10-08T10:00:00.000Z',
  customer_name: 'Maria Bianchi', business_name: null,
  customer_address: { line1: 'Corso Italia 5', line2: null, postal_code: '00184', city: 'Roma', state: 'RM', country: 'IT' },
  customer_country: 'IT', customer_region: 'IT', is_business: false, vat_id: null,
  codice_fiscale: 'RSSMRA80A01H501U', partita_iva: null, codice_destinatario: null, pec: null,
};
const foreign = (country: string, region: 'EU' | 'NON_EU', over: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  ...itB2C, customer_region: region, customer_country: country, codice_fiscale: null,
  customer_address: { line1: 'Street 1', city: 'City', postal_code: '10115', country }, ...over,
});

test('defaults are only what Vin confirmed; pending items have none', () => {
  const d = settingsFromRow(null);
  assert.equal(d.seller.regimeFiscale, 'RF19');
  assert.deepEqual(d.nature, { IT_B2C: 'N2.2', IT_B2B: 'N2.2', EU_B2B: 'N2.1', EU_B2C: null, NON_EU_B2C: 'N2.1', NON_EU_B2B: 'N2.1' });
  assert.equal(d.taxRate, 0);
  assert.deepEqual(d.stampDuty, { enabled: true, threshold: 77.47, amount: 2, natures: ['N2.2'] }); // D8: N2.1 not assumed
  assert.equal(d.foreignPrivateId, null); // T3 pending
  assert.equal(suggestInvoiceNumber(d, 2026, null), 65);
  assert.equal(suggestInvoiceNumber(d, 2026, 70), 71);
  assert.equal(suggestInvoiceNumber(d, 2027, null), 1);
  assert.ok(settingsProblems(d).some((p) => p.includes('wording')));
  assert.ok(settingsProblems(d).some((p) => p.includes('Partita IVA')));
  assert.deepEqual(settingsProblems(S), []);
});

test('six categories: B2B only with a business tax ID', () => {
  assert.equal(recordCategory(itB2C), 'IT_B2C');
  assert.equal(recordCategory({ ...itB2C, partita_iva: '12345678903' }), 'IT_B2B');
  assert.equal(recordCategory(foreign('DE', 'EU')), 'EU_B2C');
  assert.equal(recordCategory(foreign('DE', 'EU', { vat_id: 'DE123456789' })), 'EU_B2B');
  assert.equal(recordCategory(foreign('US', 'NON_EU')), 'NON_EU_B2C');
  assert.equal(recordCategory(foreign('US', 'NON_EU', { vat_id: '12-3456789' })), 'NON_EU_B2B');
  // A business NAME without a tax ID is not B2B.
  assert.equal(recordCategory(foreign('DE', 'EU', { business_name: 'Tennis GmbH', is_business: false })), 'EU_B2C');
});

test('pending answers block only their own invoices, with the reason', () => {
  // T2: EU private customers wait for the OSS answer.
  assert.ok(issueProblems(foreign('DE', 'EU', { foreign_tax_id: 'X1' }), S).some((p) => p.includes('EU private customers') && p.includes('OSS')));
  // T3: a foreign private customer with no tax ID waits for the identifier.
  assert.ok(issueProblems(foreign('US', 'NON_EU'), S).some((p) => p.includes('T3')));
  // …but with their own tax ID they can be issued.
  assert.deepEqual(issueProblems(foreign('US', 'NON_EU', { foreign_tax_id: '123456789' }), S, { number: 70, date: '2026-10-08' }), []);
  // Once the accountant answers, the settings unblock them.
  const answered = settingsFromRow({ ...ROW, nature_eu_b2c: 'N2.2', foreign_private_id: '99999999999' });
  assert.deepEqual(issueProblems(foreign('DE', 'EU'), answered, { number: 70, date: '2026-10-08' }), []);
});

test('stamp duty (D7/D8): over the threshold, listed natures only, configurable', () => {
  assert.equal(stampDutyFor(S, 299, 'N2.2'), 2);
  assert.equal(stampDutyFor(S, 77.47, 'N2.2'), null);
  assert.equal(stampDutyFor(S, 299, 'N2.1'), null); // D8 pending: not assumed
  assert.equal(stampDutyFor(settingsFromRow({ ...ROW, stamp_duty_natures: 'N2.1,N2.2' }), 299, 'N2.1'), 2);
  assert.equal(stampDutyFor(settingsFromRow({ ...ROW, stamp_duty_enabled: false }), 299, 'N2.2'), null);
});

test('amounts kept apart (D7): €200 paid → taxable 200, VAT 0, stamp duty 2, total 200', () => {
  assert.deepEqual(invoiceAmounts(S, 20000, 'N2.2'), { taxable_amount_cents: 20000, vat_amount_cents: 0, stamp_duty_cents: 200, invoice_total_cents: 20000 });
  assert.deepEqual(invoiceAmounts(S, 3490, 'N2.2'), { taxable_amount_cents: 3490, vat_amount_cents: 0, stamp_duty_cents: 0, invoice_total_cents: 3490 });
});

test('Italian private customer: CF, 0000000, bollo declared but NOT added to the total', () => {
  const b = buildFatturaPA(itB2C, S, { number: 65, date: '2026-10-08' });
  assert.equal(b.fileName, 'ITRSSMRA80A01H501U_26065.xml');
  assert.equal(b.category, 'IT_B2C');
  assert.equal(b.stampDuty, 2);
  assert.deepEqual(b.amounts, { taxable_amount_cents: 29900, vat_amount_cents: 0, stamp_duty_cents: 200, invoice_total_cents: 29900 });
  const x = b.xml;
  assert.match(x, /<CodiceDestinatario>0000000<\/CodiceDestinatario>/);
  assert.match(x, /<RegimeFiscale>RF19<\/RegimeFiscale>/);
  assert.match(x, /<CessionarioCommittente><DatiAnagrafici><CodiceFiscale>RSSMRA80A01H501U<\/CodiceFiscale><Anagrafica><Nome>Maria<\/Nome><Cognome>Bianchi<\/Cognome>/);
  assert.match(x, /<Numero>65<\/Numero><DatiBollo><BolloVirtuale>SI<\/BolloVirtuale><ImportoBollo>2.00<\/ImportoBollo><\/DatiBollo><ImportoTotaleDocumento>299.00<\/ImportoTotaleDocumento>/);
  assert.match(x, /<AliquotaIVA>0.00<\/AliquotaIVA><Natura>N2.2<\/Natura><\/DettaglioLinee>/);
  assert.match(x, /<Imposta>0.00<\/Imposta>/);
  assert.match(x, /<ImportoPagamento>299.00<\/ImportoPagamento>/);
  assert.match(x, /<Descrizione>Abbonamento AngleMotion Pro annuale - periodo dal 08\/10\/2026 al 08\/10\/2027<\/Descrizione>/);
  const opens = (x.match(/<(?![/?!])[^>]*[^/]>/g) ?? []).length;
  const closes = (x.match(/<\/[^>]+>/g) ?? []).length;
  assert.equal(opens, closes);
});

test('Italian business via Partita IVA added on /billing: IdFiscaleIVA, Codice Destinatario, Denominazione', () => {
  const b = buildFatturaPA({ ...itB2C, business_name: 'Circolo Tennis & Padel', partita_iva: '12345678903', codice_fiscale: null, codice_destinatario: 'M5UXCR1' }, S, { number: 67, date: '2026-10-08' });
  assert.equal(b.category, 'IT_B2B');
  assert.match(b.xml, /<CodiceDestinatario>M5UXCR1<\/CodiceDestinatario>/);
  assert.match(b.xml, /<IdFiscaleIVA><IdPaese>IT<\/IdPaese><IdCodice>12345678903<\/IdCodice><\/IdFiscaleIVA><Anagrafica><Denominazione>Circolo Tennis &amp; Padel<\/Denominazione>/);
});

test('foreign customers: XXXXXXX, N2.1, VAT ID or their own tax ID, CAP 00000, no bollo while D8 pending', () => {
  const de = buildFatturaPA(foreign('DE', 'EU', { business_name: 'Tennis GmbH', vat_id: 'DE123456789' }), S, { number: 68, date: '2026-10-08' });
  assert.equal(de.category, 'EU_B2B');
  assert.equal(de.nature, 'N2.1');
  assert.equal(de.stampDuty, null);
  assert.match(de.xml, /<CodiceDestinatario>XXXXXXX<\/CodiceDestinatario>/);
  assert.match(de.xml, /<IdFiscaleIVA><IdPaese>DE<\/IdPaese><IdCodice>123456789<\/IdCodice><\/IdFiscaleIVA>/);
  assert.match(de.xml, /<CAP>00000<\/CAP><Comune>City<\/Comune><Nazione>DE<\/Nazione>/);
  const us = buildFatturaPA(foreign('US', 'NON_EU', { foreign_tax_id: '123-45-6789' }), S, { number: 69, date: '2026-10-08' });
  assert.match(us.xml, /<IdPaese>US<\/IdPaese><IdCodice>123-45-6789<\/IdCodice>/);
  assert.match(us.xml, /<Natura>N2.1<\/Natura>/);
});

test('one-off sale: the product is the line description', () => {
  const b = buildFatturaPA({ ...itB2C, source: 'one_off', plan: null, billing_interval: null, period_start: null, period_end: null, product_description: 'Spin Mechanics ebook', amount_cents: 3000 }, S, { number: 70, date: '2026-10-08' });
  assert.match(b.xml, /<Descrizione>Spin Mechanics ebook<\/Descrizione>/);
  assert.equal(b.stampDuty, null);
});

test('what blocks issuing: Italian private without CF, no address, bad number', () => {
  assert.ok(issueProblems({ ...itB2C, codice_fiscale: null }, S).some((p) => p.includes('Codice Fiscale')));
  assert.ok(issueProblems({ ...itB2C, customer_address: null }, S).some((p) => p.includes('billing address')));
  assert.ok(issueProblems(itB2C, S, { number: 0, date: '2026-10-08' }).some((p) => p.includes('positive')));
  assert.throws(() => buildFatturaPA({ ...itB2C, codice_fiscale: null }, S, { number: 65, date: '2026-10-08' }), /Codice Fiscale/);
  assert.deepEqual(issueProblems(itB2C, S, { number: 65, date: '2026-10-08' }), []);
});

test('settings form: known columns only, normalised, NOT NULL columns keep their value', () => {
  const p = settingsPatchFromForm({
    seller_province: ' mi ', nature_eu_b2c: 'n2.2', stamp_duty_threshold: '77,47', stamp_duty_enabled: 'false',
    last_issued_number: '64', payment_method: '', evil_column: 'x', seller_ateco: '855101',
  });
  assert.deepEqual(p, {
    seller_province: 'MI', nature_eu_b2c: 'N2.2', stamp_duty_threshold: 77.47, stamp_duty_enabled: false,
    last_issued_number: 64, seller_ateco: '855101',
  });
  assert.equal(natureFor(settingsFromRow({ ...ROW, ...p }), 'EU_B2C'), 'N2.2');
});

test('helpers: name split and description templates', () => {
  assert.deepEqual(splitName('Anna Maria De Luca'), { nome: 'Anna Maria De', cognome: 'Luca' });
  assert.equal(invoiceDescription(S, { plan: 'light', billing_interval: 'month', period_start: '2026-10-08T00:00:00Z', period_end: '2026-11-08T00:00:00Z' }),
    'Abbonamento AngleMotion Light mensile - periodo dal 08/10/2026 al 08/11/2026');
});
