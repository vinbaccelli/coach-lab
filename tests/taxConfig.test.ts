import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taxSettings, checkoutTaxParams } from '@/lib/billing/taxConfig';

test('automatic tax is OFF by default and only the literal "true" turns it on', () => {
  assert.equal(taxSettings({}).automaticTax, false);
  for (const v of ['', 'false', '1', 'yes', 'TRUE ']) assert.equal(taxSettings({ STRIPE_AUTOMATIC_TAX: v }).automaticTax, v.trim().toLowerCase() === 'true');
  assert.equal(taxSettings({ STRIPE_AUTOMATIC_TAX: 'true' }).automaticTax, true);
});

test('checkout always collects billing address, tax ID and names; automatic tax follows the flag', () => {
  const p = checkoutTaxParams({ existingCustomer: false, settings: { automaticTax: false } });
  assert.deepEqual(p.automatic_tax, { enabled: false });
  assert.equal(p.billing_address_collection, 'required');
  assert.deepEqual(p.tax_id_collection, { enabled: true });
  assert.deepEqual(p.name_collection, { individual: { enabled: true, optional: false }, business: { enabled: true, optional: true } });
  assert.equal('customer_update' in p, false);
  assert.deepEqual(checkoutTaxParams({ existingCustomer: false, settings: { automaticTax: true } }).automatic_tax, { enabled: true });
});

test('a reused Customer gets name + address written back (required with tax ID collection)', () => {
  const p = checkoutTaxParams({ existingCustomer: true, settings: { automaticTax: false } });
  assert.deepEqual((p as { customer_update?: unknown }).customer_update, { name: 'auto', address: 'auto' });
});
