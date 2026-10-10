import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settingsFromRow, settingsProblems, suggestInvoiceNumber, invoiceDescription, invoiceAmounts, settingsPatchFromForm,
  decideTreatment, sequenceProblems, pendingRules, unsupportedChars,
  DEFAULT_SETTINGS_ROW, DEFAULT_TAX_RULES, EXISTING_FORFETTARIO_WORDING, type TaxRules,
} from '@/lib/billing/invoicing/settings';
import {
  buildFatturaPA, issueProblems, prepareInvoice, recordCategory, recordProductType, splitName, type InvoiceRecord,
} from '@/lib/billing/invoicing/fatturaPA';
import { productTypeFor } from '@/lib/billing/invoicing/draft';

// A filled-in settings row, as Vin saves it on /admin/invoices (test values
// with valid check digits — not the real data). Wording: the existing text
// with the typographic apostrophes replaced (the SdI rejects ’).
const SDI_WORDING = EXISTING_FORFETTARIO_WORDING.replace(/’/g, "'");
const ROW = {
  ...DEFAULT_SETTINGS_ROW,
  seller_first_name: 'Mario', seller_last_name: 'Rossi', seller_partita_iva: '12345678903',
  seller_codice_fiscale: 'RSSMRA80A01H501U', seller_address: 'Via Roma 1', seller_cap: '20100', seller_city: 'Milano',
  seller_province: 'MI', regime_wording: SDI_WORDING,
};
const S = settingsFromRow(ROW);

/** Every rule confirmed — what the settings look like once the commercialista has answered. */
function confirmedAll(over: Partial<Record<string, string | null>> = {}): TaxRules {
  const r = JSON.parse(JSON.stringify(DEFAULT_TAX_RULES)) as TaxRules;
  for (const pt of Object.keys(r) as Array<keyof TaxRules>) {
    for (const c of Object.keys(r[pt]) as Array<keyof TaxRules[typeof pt]>) {
      r[pt][c] = { nature: over[c] !== undefined ? over[c] : r[pt][c].nature ?? 'N2.1', status: 'confirmed' };
    }
  }
  return r;
}
const ALL = settingsFromRow({
  ...ROW, tax_rules: confirmedAll(),
  wording_status: { software_subscription: 'confirmed', coaching_service: 'confirmed', digital_product: 'confirmed', other: 'confirmed' },
  stamp_duty_rules: { 'N2.2': 'applies', 'N2.1': 'not_applicable' },
});

const coachingIT: InvoiceRecord = {
  source: 'one_off', product_type: 'coaching_service', livemode: true, amount_cents: 20000, currency: 'EUR',
  plan: null, billing_interval: null, period_start: null, period_end: null, product_description: 'Lezione di tennis',
  customer_name: 'Maria Bianchi', business_name: null,
  customer_address: { line1: 'Corso Italia 5', line2: null, postal_code: '00184', city: 'Roma', state: 'RM', country: 'IT' },
  customer_country: 'IT', customer_region: 'IT', is_business: false, vat_id: null,
  codice_fiscale: 'RSSMRA80A01H501U', partita_iva: null, codice_destinatario: null, pec: null,
};
const subscriptionIT: InvoiceRecord = {
  ...coachingIT, source: 'subscription', product_type: null, amount_cents: 29900, plan: 'pro', billing_interval: 'year',
  period_start: '2026-10-08T10:00:00.000Z', period_end: '2027-10-08T10:00:00.000Z', product_description: null,
};
const ukPrivate: InvoiceRecord = {
  ...coachingIT, customer_name: 'Jon Moore', codice_fiscale: null, customer_country: 'GB', customer_region: 'NON_EU',
  customer_address: { line1: '10 Downing Street', line2: null, postal_code: 'SW1A 2AA', city: 'London', state: null, country: 'GB' },
};
const IN = { number: 65, date: '2026-10-10' };

test('starting configuration: only what Vin confirmed is confirmed', () => {
  const d = settingsFromRow(null);
  assert.equal(d.seller.regimeFiscale, 'RF19');
  assert.equal(d.taxRate, 0);
  assert.equal(d.wording, EXISTING_FORFETTARIO_WORDING); // exact, untouched
  assert.equal(d.foreignPrivateId, 'OO99999999999');
  assert.equal(d.foreignPrivateIdStatus, 'confirmed');
  assert.deepEqual(d.taxRules.coaching_service.IT_B2C, { nature: 'N2.2', reference: null, status: 'confirmed' });
  assert.equal(d.taxRules.software_subscription.IT_B2C.status, 'pending');
  assert.equal(d.taxRules.software_subscription.EU_B2C.nature, null); // OSS: no default
  assert.equal(d.taxRules.other.NON_EU_B2C.nature, null); // N2.1 not assumed for every foreign sale
  assert.deepEqual(d.stampDuty, { enabled: true, threshold: 77.47, amount: 2, rules: { 'N2.2': 'applies', 'N2.1': 'pending' } });
  assert.equal(d.wordingStatus.coaching_service, 'confirmed');
  assert.equal(d.wordingStatus.software_subscription, 'pending');
  assert.equal(suggestInvoiceNumber(d, 2026, null), 65);
  assert.equal(suggestInvoiceNumber(d, 2026, 70), 71);
  assert.equal(suggestInvoiceNumber(d, 2027, null), 1);
  // Missing fiscal identifiers are reported, never invented.
  assert.ok(settingsProblems(d).some((p) => p.includes('Partita IVA')));
  assert.ok(settingsProblems(d).some((p) => p.includes('Codice Fiscale')));
  assert.deepEqual(settingsProblems(S), []);
  const pending = pendingRules(d);
  assert.ok(pending.some((p) => p.includes('Anglemotion subscription') && p.includes('EU private') && p.includes('not decided')));
  assert.ok(pending.some((p) => p.includes('Stamp duty on N2.1')));
  assert.ok(!pending.some((p) => p.includes('Coaching / video analysis → Italian private')));
});

test('the exact wording is flagged (not rewritten) when it has characters the SdI rejects', () => {
  assert.deepEqual(unsupportedChars(EXISTING_FORFETTARIO_WORDING), ['’']);
  const d = settingsFromRow({ ...ROW, regime_wording: EXISTING_FORFETTARIO_WORDING });
  assert.equal(d.wording, EXISTING_FORFETTARIO_WORDING);
  assert.ok(settingsProblems(d).some((p) => p.includes('’') && p.includes('U+2019')));
  // The form keeps it exactly as typed.
  assert.equal(settingsPatchFromForm({ regime_wording: `  ${EXISTING_FORFETTARIO_WORDING}\n` }).regime_wording, EXISTING_FORFETTARIO_WORDING);
});

test('six categories: B2B only with a business tax ID; product type from source or record', () => {
  const f = (country: string, region: 'EU' | 'NON_EU', over: Partial<InvoiceRecord> = {}) => ({ ...ukPrivate, customer_country: country, customer_region: region, ...over });
  assert.equal(recordCategory(coachingIT), 'IT_B2C');
  assert.equal(recordCategory({ ...coachingIT, partita_iva: '12345678903' }), 'IT_B2B');
  assert.equal(recordCategory(f('DE', 'EU')), 'EU_B2C');
  assert.equal(recordCategory(f('DE', 'EU', { vat_id: 'DE123456789' })), 'EU_B2B');
  assert.equal(recordCategory(f('GB', 'NON_EU')), 'NON_EU_B2C');
  assert.equal(recordCategory(f('US', 'NON_EU', { vat_id: '12-3456789' })), 'NON_EU_B2B');
  assert.equal(recordCategory(f('DE', 'EU', { business_name: 'Tennis GmbH', is_business: false })), 'EU_B2C');
  assert.equal(recordProductType(subscriptionIT), 'software_subscription');
  assert.equal(recordProductType({ ...coachingIT, product_type: null }), null);
  assert.equal(recordProductType({ ...coachingIT, product_type: 'bogus' }), null);
});

test('VAT treatment per product × category; pending rules block issuing with the reason', () => {
  assert.deepEqual(decideTreatment(S, 'coaching_service', 'IT_B2C', 20000), { nature: 'N2.2', reference: '', stampDuty: 2, problems: [] });
  assert.ok(decideTreatment(S, 'software_subscription', 'IT_B2C', 29900).problems.some((p) => p.includes('awaiting')));
  assert.ok(decideTreatment(S, 'software_subscription', 'EU_B2C', 2000).problems.some((p) => p.includes('OSS')));
  assert.ok(decideTreatment(S, null, 'IT_B2C', 2000).problems.some((p) => p.includes('product type')));
  // Wording not confirmed for the product type blocks too.
  const t = decideTreatment(settingsFromRow({ ...ROW, tax_rules: confirmedAll() }), 'digital_product', 'IT_B2C', 3000);
  assert.ok(t.problems.some((p) => p.includes('wording')));
});

test('stamp duty (D7/D8): over €77.47 only, per-Natura rule, pending N2.1 blocks', () => {
  assert.equal(decideTreatment(S, 'coaching_service', 'IT_B2C', 7747).stampDuty, null);
  assert.equal(decideTreatment(S, 'coaching_service', 'IT_B2C', 7748).stampDuty, 2);
  const n21 = decideTreatment(settingsFromRow({ ...ROW, tax_rules: confirmedAll(), wording_status: { coaching_service: 'confirmed' } as never }), 'coaching_service', 'NON_EU_B2C', 20000);
  assert.equal(n21.nature, 'N2.1');
  assert.ok(n21.problems.some((p) => p.includes('stamp duty') && p.includes('N2.1')));
  assert.deepEqual(decideTreatment(ALL, 'coaching_service', 'NON_EU_B2C', 20000).problems, []);
  assert.equal(decideTreatment(ALL, 'coaching_service', 'NON_EU_B2C', 20000).stampDuty, null);
  assert.equal(decideTreatment(settingsFromRow({ ...ROW, stamp_duty_enabled: false }), 'coaching_service', 'IT_B2C', 20000).stampDuty, null);
});

test('amounts kept apart (D7): €200 paid → taxable 200, VAT 0, stamp duty 2, total 200 (absorbed)', () => {
  assert.deepEqual(invoiceAmounts(20000, 2), { taxable_amount_cents: 20000, vat_amount_cents: 0, stamp_duty_cents: 200, invoice_total_cents: 20000 });
  assert.deepEqual(invoiceAmounts(3490, null), { taxable_amount_cents: 3490, vat_amount_cents: 0, stamp_duty_cents: 0, invoice_total_cents: 3490 });
});

test('Italian private coaching €200: CF, 0000000, bollo declared, total 200, wording as Causale', () => {
  const b = buildFatturaPA(coachingIT, S, IN);
  assert.equal(b.fileName, 'ITRSSMRA80A01H501U_26065.xml');
  assert.equal(b.category, 'IT_B2C');
  assert.equal(b.nature, 'N2.2');
  assert.deepEqual(b.amounts, { taxable_amount_cents: 20000, vat_amount_cents: 0, stamp_duty_cents: 200, invoice_total_cents: 20000 });
  const x = b.xml;
  assert.match(x, /<FormatoTrasmissione>FPR12<\/FormatoTrasmissione><CodiceDestinatario>0000000<\/CodiceDestinatario><\/DatiTrasmissione>/);
  assert.match(x, /<RegimeFiscale>RF19<\/RegimeFiscale>/);
  assert.match(x, /<CessionarioCommittente><DatiAnagrafici><CodiceFiscale>RSSMRA80A01H501U<\/CodiceFiscale><Anagrafica><Nome>Maria<\/Nome><Cognome>Bianchi<\/Cognome>/);
  assert.match(x, /<CAP>00184<\/CAP><Comune>Roma<\/Comune><Provincia>RM<\/Provincia><Nazione>IT<\/Nazione>/);
  assert.match(x, /<TipoDocumento>TD01<\/TipoDocumento><Divisa>EUR<\/Divisa><Data>2026-10-10<\/Data><Numero>65<\/Numero><DatiBollo><BolloVirtuale>SI<\/BolloVirtuale><ImportoBollo>2.00<\/ImportoBollo><\/DatiBollo><ImportoTotaleDocumento>200.00<\/ImportoTotaleDocumento>/);
  assert.match(x, /<AliquotaIVA>0.00<\/AliquotaIVA><Natura>N2.2<\/Natura><\/DettaglioLinee>/);
  assert.match(x, /<ImponibileImporto>200.00<\/ImponibileImporto><Imposta>0.00<\/Imposta>/);
  assert.match(x, /<ImportoPagamento>200.00<\/ImportoPagamento>/);
  assert.doesNotMatch(x, /202\.00/);
  const causale = [...x.matchAll(/<Causale>([^<]*)<\/Causale>/g)].map((m) => m[1].replace(/&apos;/g, "'")).join('');
  assert.equal(causale, SDI_WORDING);
  const opens = (x.match(/<(?![/?!])[^>]*[^/]>/g) ?? []).length;
  const closes = (x.match(/<\/[^>]+>/g) ?? []).length;
  assert.equal(opens, closes);
  // The checklist reads the XML back and agrees.
  const prep = prepareInvoice(coachingIT, S, IN);
  assert.ok(prep.checks.every((c) => c.ok), JSON.stringify(prep.checks.filter((c) => !c.ok)));
});

test('foreign private (UK): OO99999999999, XXXXXXX, no CF, no PEC, real address and postcode kept', () => {
  const b = buildFatturaPA(ukPrivate, ALL, IN);
  assert.equal(b.category, 'NON_EU_B2C');
  const x = b.xml;
  assert.match(x, /<CodiceDestinatario>XXXXXXX<\/CodiceDestinatario><\/DatiTrasmissione>/);
  assert.match(x, /<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>OO<\/IdPaese><IdCodice>99999999999<\/IdCodice><\/IdFiscaleIVA><Anagrafica><Nome>Jon<\/Nome><Cognome>Moore<\/Cognome>/);
  assert.match(x, /<Indirizzo>10 Downing Street - SW1A 2AA<\/Indirizzo><CAP>00000<\/CAP><Comune>London<\/Comune><Nazione>GB<\/Nazione>/);
  assert.doesNotMatch(x.split('<CessionarioCommittente>')[1], /<CodiceFiscale>/);
  assert.doesNotMatch(x, /PECDestinatario/);
  assert.match(x, /<Natura>N2.1<\/Natura>/);
  // A 5-digit foreign postcode fits the CAP field as it is.
  const de = buildFatturaPA({ ...ukPrivate, customer_country: 'DE', customer_region: 'EU', customer_address: { line1: 'Str. 1', city: 'Berlin', postal_code: '10115', country: 'DE' } }, ALL, IN);
  assert.match(de.xml, /<Indirizzo>Str. 1<\/Indirizzo><CAP>10115<\/CAP>/);
  // A foreign business: its VAT number.
  const deB2B = buildFatturaPA({ ...ukPrivate, business_name: 'Tennis GmbH', vat_id: 'DE123456789', customer_country: 'DE', customer_region: 'EU' }, ALL, IN);
  assert.match(deB2B.xml, /<IdFiscaleIVA><IdPaese>DE<\/IdPaese><IdCodice>123456789<\/IdCodice><\/IdFiscaleIVA><Anagrafica><Denominazione>Tennis GmbH<\/Denominazione>/);
  // A pending foreign identifier blocks.
  assert.ok(issueProblems(ukPrivate, settingsFromRow({ ...ROW, tax_rules: confirmedAll(), foreign_private_id_status: 'pending' }), IN).some((p) => p.includes('OO99999999999')));
});

test('pending rules: XML still previewable, issuing refused', () => {
  const p = prepareInvoice(ukPrivate, S, IN); // coaching → NON_EU_B2C is N2.1 pending
  assert.ok(p.built, 'preview XML is built');
  assert.ok(p.problems.some((m) => m.includes('awaiting')));
  assert.equal(p.checks.find((c) => c.label === 'Ready to issue')?.ok, false);
  assert.throws(() => buildFatturaPA(ukPrivate, S, IN), /awaiting/);
  // No Natura at all (EU private software / OSS): nothing to preview.
  const eu = prepareInvoice({ ...subscriptionIT, codice_fiscale: null, customer_country: 'FR', customer_region: 'EU' }, S, IN);
  assert.equal(eu.built, null);
  assert.ok(eu.problems.some((m) => m.includes('OSS')));
});

test('test-mode, refunded, unclassified and incomplete sales are never issuable', () => {
  assert.ok(issueProblems({ ...coachingIT, livemode: false }, S, IN).some((p) => p.includes('Test-mode')));
  assert.ok(prepareInvoice({ ...coachingIT, livemode: false }, S, IN).built, 'test payments can be previewed');
  assert.ok(issueProblems({ ...coachingIT, refunded_amount_cents: 20000 }, S, IN).some((p) => p.includes('refunded')));
  assert.ok(issueProblems({ ...coachingIT, product_type: null }, S, IN).some((p) => p.includes('product type')));
  assert.ok(issueProblems({ ...coachingIT, codice_fiscale: null }, S, IN).some((p) => p.includes('Codice Fiscale')));
  assert.ok(issueProblems({ ...coachingIT, customer_address: null }, S, IN).some((p) => p.includes('billing address')));
  assert.ok(issueProblems({ ...coachingIT, customer_name: 'Zoë Ørsted' }, S, IN).length === 0); // Latin-1 is fine
  assert.ok(issueProblems({ ...coachingIT, customer_name: 'Łukasz Nowak' }, S, IN).some((p) => p.includes('SdI does not accept')));
  assert.ok(issueProblems(coachingIT, S, { number: 0, date: '2026-10-10' }).some((p) => p.includes('positive')));
  assert.deepEqual(issueProblems(coachingIT, S, IN), []);
});

test('numbering: sequential, no going back, a skipped number needs confirmation', () => {
  const last = { number: null, date: null };
  assert.deepEqual(sequenceProblems(S, IN, last), { problems: [], gapFrom: null });
  assert.ok(sequenceProblems(S, { number: 64, date: '2026-10-10' }, last).problems[0].includes('next is 65'));
  const gap = sequenceProblems(S, { number: 67, date: '2026-10-10' }, last);
  assert.equal(gap.gapFrom, 65);
  assert.ok(gap.problems[0].includes('65–66'));
  assert.deepEqual(sequenceProblems(S, { number: 67, date: '2026-10-10', confirmGap: true }, last).problems, []);
  assert.ok(sequenceProblems(S, { number: 71, date: '2026-10-01' }, { number: 70, date: '2026-10-05' }).problems.some((p) => p.includes('before')));
  assert.deepEqual(sequenceProblems(S, { number: 1, date: '2027-01-02' }, { number: null, date: null }).problems, []);
});

test('subscription line description and name split', () => {
  assert.deepEqual(splitName('Anna Maria De Luca'), { nome: 'Anna Maria De', cognome: 'Luca' });
  assert.equal(invoiceDescription(S, { plan: 'light', billing_interval: 'month', period_start: '2026-10-08T00:00:00Z', period_end: '2026-11-08T00:00:00Z' }),
    'Abbonamento Anglemotion Light mensile - periodo dal 08/10/2026 al 08/11/2026');
  const b = buildFatturaPA(subscriptionIT, ALL, IN);
  assert.match(b.xml, /<Descrizione>Abbonamento Anglemotion Pro annuale - periodo dal 08\/10\/2026 al 08\/10\/2027<\/Descrizione>/);
  assert.equal(b.stampDuty, 2);
});

test('settings form: known columns only, rules normalised, NOT NULL columns keep their value', () => {
  const p = settingsPatchFromForm({
    seller_province: ' mi ', stamp_duty_threshold: '77,47', stamp_duty_enabled: 'false',
    last_issued_number: '64', payment_method: '', evil_column: 'x', seller_ateco: '85.51.01; 62.01.00',
    stamp_duty_rules: { 'n2.1': 'applies', bogus: 'applies', 'N2.2': 'maybe' },
    tax_rules: { coaching_service: { EU_B2C: { nature: 'n2.1', status: 'confirmed', reference: ' art. 7-ter ' } } },
    foreign_private_id: ' oo99999999999 ', foreign_private_id_status: 'nonsense',
  });
  assert.equal(p.seller_province, 'MI');
  assert.equal(p.stamp_duty_threshold, 77.47);
  assert.equal(p.stamp_duty_enabled, false);
  assert.equal(p.last_issued_number, 64);
  assert.equal('payment_method' in p, false);
  assert.equal('evil_column' in p, false);
  assert.equal(p.seller_ateco, '85.51.01; 62.01.00');
  assert.deepEqual(p.stamp_duty_rules, { 'N2.1': 'applies' });
  assert.deepEqual(p.tax_rules!.coaching_service.EU_B2C, { nature: 'N2.1', reference: 'art. 7-ter', status: 'confirmed' });
  assert.deepEqual(p.tax_rules!.coaching_service.IT_B2C, DEFAULT_TAX_RULES.coaching_service.IT_B2C);
  assert.equal(p.foreign_private_id, 'OO99999999999');
  assert.equal(p.foreign_private_id_status, 'pending');
});

test('one-off product type: only from a complete, agreeing mapping', () => {
  const m = new Map([['prod_a', 'coaching_service' as const], ['prod_b', 'digital_product' as const]]);
  assert.equal(productTypeFor(['prod_a'], m), 'coaching_service');
  assert.equal(productTypeFor(['prod_a', 'prod_b'], m), null);
  assert.equal(productTypeFor(['prod_a', 'prod_x'], m), null);
  assert.equal(productTypeFor([], m), null);
});
