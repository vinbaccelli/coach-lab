/**
 * Tax and customer-detail configuration for Stripe Checkout — the ONLY place
 * tax behaviour is decided. The frontend never computes or displays tax logic;
 * it shows PRICE_TAX_NOTE (lib/plans.ts) and nothing else.
 *
 * Launch position (Vin, 2026-10-05, confirmed with his accountant):
 *  - Vin sells as an Italian sole proprietor in the regime forfettario, on his
 *    existing Italian VAT number. No VAT is charged: a €299 plan charges €299.
 *  - Stripe automatic tax is therefore OFF (STRIPE_AUTOMATIC_TAX unset/false).
 *  - Prices are created with tax behaviour "inclusive". If automatic tax is
 *    ever switched on, any VAT Stripe calculates comes OUT of the displayed
 *    price — the customer still pays €299 and Vin receives less. It is never
 *    added on top. Change prices, not this flag, if that is not wanted.
 *
 * What IS collected at checkout regardless of tax (Stripe-hosted fields, saved
 * to the Stripe Customer so invoices, the portal and any future tax engine have
 * them): full name, email, billing address with country, an optional business
 * name, and an optional VAT / tax ID for business customers.
 *
 * Future rules go here, not in routes or UI — e.g. EU OSS registration once
 * cross-border B2C thresholds apply, or B2B reverse charge: both are handled by
 * Stripe Tax from the collected address + tax ID once registrations exist in
 * the Stripe dashboard and STRIPE_AUTOMATIC_TAX=true. See
 * docs/STRIPE_LAUNCH_SETUP.md "Turning Stripe Tax on later".
 */

export interface TaxSettings {
  /** Stripe Tax computes tax on checkout and invoices. Launch: false. */
  automaticTax: boolean;
}

/** Read once per request from the environment. Only the literal "true" enables tax. */
export function taxSettings(env: Record<string, string | undefined> = process.env): TaxSettings {
  return { automaticTax: (env.STRIPE_AUTOMATIC_TAX ?? '').trim().toLowerCase() === 'true' };
}

/**
 * The tax / customer-detail fields for stripe.checkout.sessions.create().
 * `existingCustomer` = a stored Stripe Customer ID is being reused; Stripe then
 * requires customer_update so the details typed at checkout are written back
 * to that Customer (and tax ID collection needs name:'auto').
 */
export function checkoutTaxParams(opts: { existingCustomer: boolean; settings?: TaxSettings }) {
  const settings = opts.settings ?? taxSettings();
  return {
    automatic_tax: { enabled: settings.automaticTax },
    billing_address_collection: 'required' as const,
    tax_id_collection: { enabled: true },
    name_collection: {
      individual: { enabled: true, optional: false },
      business: { enabled: true, optional: true },
    },
    ...(opts.existingCustomer
      ? { customer_update: { name: 'auto' as const, address: 'auto' as const } }
      : {}),
  };
}
