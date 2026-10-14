import type { BillingCycle, PlanId } from '@/lib/plans';

/**
 * Which checkouts show Stripe's "Add promotion code" field.
 *
 * The Coach Life 50% coupon is restricted in Stripe to the Pro and Academy
 * products, and its promotion code to a €299 minimum (so a monthly price can
 * never qualify). The checkout only offers the field on the yearly prices of
 * those two plans, so a monthly or Light buyer never sees a field that could
 * only reject their code.
 */
export function promoCodesAllowed(plan: PlanId, cycle: BillingCycle): boolean {
  return (plan === 'pro' || plan === 'academy') && cycle === 'yearly';
}
