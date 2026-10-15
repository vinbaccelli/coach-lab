-- Complimentary access by email (launch, 2026-10-15).
--
-- 1. public.access_grants: one row per email that gets Pro tools without a
--    subscription. Works before the person has ever signed in (matched on the
--    email in their auth token, like academy_members). Pro only, no end date;
--    revoke by setting revoked_at. RLS on with NO policies: only the service
--    role and the security-definer function below can read it.
-- 2. my_access_grant(): the signed-in caller's own active grant tier, or null.
--    The access decision stays in lib/entitlements.server.ts.
-- 3. The two launch grants. Idempotent: safe to re-run.
--
-- A grant never creates a Stripe subscription, a subscriptions row or an
-- invoice.

create table if not exists public.access_grants (
  email text primary key check (email = lower(email)),
  tier text not null default 'pro' check (tier = 'pro'),
  note text,
  created_at timestamptz default now(),
  revoked_at timestamptz
);

alter table public.access_grants enable row level security;

create or replace function public.my_access_grant()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.tier
  from public.access_grants g
  where g.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and g.revoked_at is null
  limit 1;
$$;

revoke all on function public.my_access_grant() from public;
revoke all on function public.my_access_grant() from anon;
grant execute on function public.my_access_grant() to authenticated;

insert into public.access_grants (email, note)
values
  ('kneepkensalexander@gmail.com', 'complimentary Pro, launch'),
  ('tennisbydani@gmail.com', 'complimentary Pro, launch')
on conflict (email) do nothing;
