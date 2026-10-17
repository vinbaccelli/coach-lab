# Affiliates

A small affiliate system: an influencer shares a link, coaches who sign in
through it become their referrals, and paid invoices of those coaches earn a
commission that Vin pays outside the app.

## How it works
1. **Link.** An influencer shares `https://www.anglemotion.com/r/<code>`. For an *active* affiliate, the route `app/r/[code]/route.ts`:
   - records a click;
   - sets the first-party cookie `am_ref=<code>` (60 days, SameSite=Lax, Secure, HttpOnly). It holds only the code.

   It always redirects to `/`, even on an unknown code or an error.
2. **Sign-in.** After a successful sign-in, `app/auth/callback/route.ts` turns the cookie into a row in `affiliate_referrals`. The **first link wins**: a coach is never moved to another affiliate. Only a **new account** counts: one created in the last 15 minutes (the auth user's `created_at`). An existing coach who uses a link and signs in again never becomes a referral. This is best effort and can never block sign-in.
3. **Payment.** On `invoice.paid`, the Stripe webhook runs a separate best-effort step after its normal handling. It never changes the webhook's answer, and `lib/billing/webhookSync.ts` is untouched. A commission is recorded when all of these hold:
   - the payer is a referral;
   - the affiliate is active;
   - the invoice is the first payment (`billing_reason = subscription_create`), or the affiliate is *recurring*;
   - the amount is above 0.

   The payer is found from the subscription's `userId` metadata, or else from the `subscriptions` row. Each Stripe invoice gives at most one commission (unique `stripe_invoice_id`).
4. **Base.** The base is what the coach paid after discounts and without tax. It is the invoice's `total_excluding_tax`, capped at `amount_paid` so an applied account credit can't inflate it. If `total_excluding_tax` is empty, it falls back to `amount_paid` minus `total_taxes`. The affiliate's % is copied onto the commission, so later changes don't rewrite past commissions.
5. **Admin.** `/admin/affiliates` lets Vin:
   - create affiliates;
   - edit their %, recurring switch and active flag;
   - copy their link and their private-page link;
   - see clicks, signups, buyers, and pending and paid euros;
   - mark each commission paid or void.

   It uses the same admin gate as `/admin/invoices`.
6. **Influencer page.** `/affiliate/<view_token>` is public, read-only and noindex. It shows the influencer's link, totals and commissions (date, amount and status only). It never shows who the referred coaches are.

"Buyers" counts distinct coaches with at least one commission that is not void.

## Data
- **Migration:** `supabase/migrations/20261016120000_affiliates.sql`.
- **Tables:** `affiliates`, `affiliate_clicks`, `affiliate_referrals`, `affiliate_commissions`.
- **Access:** RLS is on with no policies, so only the service role can read or write.
- **Rules:** `lib/affiliates.ts`. **Database code:** `lib/affiliates.server.ts`. **Tests:** `tests/affiliates.test.ts`.

## Not built
- No refund handling. Void the commission by hand.
- No payouts.
- No emails.
