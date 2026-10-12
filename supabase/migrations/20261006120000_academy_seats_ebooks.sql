-- Academy seats + the private ebook bucket (R1e/R1f). Run once in the Supabase
-- SQL editor AFTER 20261005120000_billing_r1g.sql. Safe to re-run.
--
-- 1. academy_members: the coaches an Academy subscriber adds to their plan
--    (owner + 3). A member is identified by the email they sign in with. Each
--    coach's data stays their own — a seat only lends the plan, never access
--    to the owner's players, sessions or reports.
-- 2. academy_seat_subscriptions(): lets a signed-in coach read the
--    subscription(s) of the Academy owner(s) who added them — nothing else.
--    The access POLICY (which statuses grant) stays in lib/entitlements.ts;
--    this only returns the raw rows.
-- 3. Storage bucket "ebooks": PRIVATE, no client policies. Files are served
--    only through short-lived signed URLs created server-side (/api/ebook).

create table if not exists public.academy_members (
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  created_at timestamptz not null default now(),
  primary key (owner_user_id, email)
);

create index if not exists academy_members_email_idx on public.academy_members (email);

alter table public.academy_members enable row level security;

-- The owner may list their own seats. No insert/update/delete policies: seats
-- are added and removed only by /api/academy-members (service role), which
-- checks the owner's active Academy plan and the 3-seat limit.
drop policy if exists "academy_members_select_own" on public.academy_members;
create policy "academy_members_select_own"
  on public.academy_members for select
  using (auth.uid() = owner_user_id);

-- Hard seat limit (Academy = owner + 3), also checked by the API; this closes
-- the race between two simultaneous adds. Keep in sync with
-- ACADEMY_EXTRA_SEATS in lib/entitlements.ts.
create or replace function public.academy_members_seat_limit()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.owner_user_id::text));
  if (select count(*) from public.academy_members where owner_user_id = new.owner_user_id) >= 3 then
    raise exception 'academy seat limit reached';
  end if;
  return new;
end;
$$;

drop trigger if exists academy_members_seat_limit on public.academy_members;
create trigger academy_members_seat_limit
  before insert on public.academy_members
  for each row execute function public.academy_members_seat_limit();

create or replace function public.academy_seat_subscriptions()
returns table (
  owner_user_id uuid,
  status text,
  tier text,
  current_period_end timestamptz,
  cancel_at_period_end boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select m.owner_user_id, s.status, s.tier, s.current_period_end, s.cancel_at_period_end
  from public.academy_members m
  join public.subscriptions s on s.user_id = m.owner_user_id
  where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and m.owner_user_id <> auth.uid();
$$;

revoke all on function public.academy_seat_subscriptions() from public;
grant execute on function public.academy_seat_subscriptions() to authenticated;

-- Private bucket for the Spin Mechanics PDF. public = false and NO policies on
-- storage.objects for it, so neither anon nor signed-in clients can list or
-- download; the service role signs a URL for entitled coaches only.
insert into storage.buckets (id, name, public)
values ('ebooks', 'ebooks', false)
on conflict (id) do update set public = false;
