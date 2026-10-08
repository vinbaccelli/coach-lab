import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidCodiceFiscale, isValidPartitaIva, parseItalianFields } from '@/lib/billing/invoicing/italianFields';

test('Codice Fiscale: check letter verified, company numeric CF accepted', () => {
  assert.equal(isValidCodiceFiscale('RSSMRA80A01H501U'), true);
  assert.equal(isValidCodiceFiscale('RSSMRA80A01H501X'), false); // wrong check letter
  assert.equal(isValidCodiceFiscale('RSSMRA80A01H50'), false);
  assert.equal(isValidCodiceFiscale('12345678903'), true); // numeric = P.IVA rules
});

test('Partita IVA: 11 digits with a valid check digit', () => {
  assert.equal(isValidPartitaIva('12345678903'), true);
  assert.equal(isValidPartitaIva('12345678901'), false);
  assert.equal(isValidPartitaIva('1234567890'), false);
});

test('parse: normalises case/spaces/IT prefix, empty → null', () => {
  const r = parseItalianFields({ codice_fiscale: ' rssmra80a01h501u ', partita_iva: 'IT 12345678903', codice_destinatario: 'm5uxcr1', pec: ' Mario@PEC.it ' });
  assert.deepEqual(r, { ok: true, value: { codice_fiscale: 'RSSMRA80A01H501U', partita_iva: '12345678903', codice_destinatario: 'M5UXCR1', pec: 'mario@pec.it' } });
  assert.deepEqual(parseItalianFields({}), { ok: true, value: { codice_fiscale: null, partita_iva: null, codice_destinatario: null, pec: null } });
});

test('parse: per-field errors', () => {
  const r = parseItalianFields({ codice_fiscale: 'XYZ', partita_iva: '123', codice_destinatario: 'AB', pec: 'not-an-email' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['codice_destinatario', 'codice_fiscale', 'partita_iva', 'pec']);
});
