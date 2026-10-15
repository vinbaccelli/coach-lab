# Complimentary access grants

Gives a coach **Pro tools by email**, with no subscription, no trial timer and no
end date. It works before the person has ever signed in: access is matched on
the email in their sign-in token.

- **Table:** `public.access_grants`, created by `supabase/migrations/20261015120000_access_grants.sql`.
  - One row per lowercase email.
  - `tier` is always `'pro'`.
  - `revoked_at` switches the grant off.
  - RLS is on with no policies, so only the service role and `my_access_grant()` can read it.
- **Check:** `getEntitlement` in `lib/entitlements.server.ts` calls `my_access_grant()`. The order is:
  1. The coach's own Pro or Academy subscription wins.
  2. Then the grant.
  3. Then an Academy seat.
  4. Then the free hour.

  A lookup error counts as no grant and is logged.
- **Not billing:** a grant never creates a Stripe subscription, a `subscriptions` row or an invoice. It gives no ebook download, which stays with yearly subscribers.

## Add a grant (Supabase SQL editor)

```sql
insert into public.access_grants (email, note)
values (lower('coach@example.com'), 'why')
on conflict (email) do update set revoked_at = null;
```

## Revoke a grant

```sql
update public.access_grants set revoked_at = now() where email = lower('coach@example.com');
```

It takes effect on the coach's next page load.

## Launch grants (2026-10-15)

`kneepkensalexander@gmail.com` and `tennisbydani@gmail.com`, note "complimentary Pro, launch".
