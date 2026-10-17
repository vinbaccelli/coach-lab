-- Simple affiliate system (2026-10-16).
--
-- 1. affiliates: one row per influencer. `code` is the public link part
--    (/r/<code>), `view_token` the secret part of their read-only page
--    (/affiliate/<token>). commission_pct is a percentage; `recurring` pays on
--    every paid invoice, otherwise only on the first (subscription_create).
-- 2. affiliate_clicks: one row per visit to an active affiliate's link.
-- 3. affiliate_referrals: who brought each coach. The user id is the primary
--    key, so the FIRST link wins and is never overwritten.
-- 4. affiliate_commissions: one row per paid Stripe invoice (unique), with the
--    percentage snapshotted at the time.
--
-- RLS on with NO policies on all four: only the service role (server routes,
-- the Stripe webhook) reads or writes them. Idempotent: safe to re-run.

create table if not exists public.affiliates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique check (code ~ '^[a-z0-9-]+$'),
  view_token text not null unique check (length(view_token) >= 32),
  commission_pct numeric not null check (commission_pct >= 0 and commission_pct <= 100),
  recurring boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_clicks_affiliate_idx on public.affiliate_clicks (affiliate_id);

create table if not exists public.affiliate_referrals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  signed_up_at timestamptz not null default now()
);
create index if not exists affiliate_referrals_affiliate_idx on public.affiliate_referrals (affiliate_id);

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  user_id uuid not null,
  stripe_invoice_id text not null unique,
  base_cents integer not null check (base_cents >= 0),
  pct numeric not null check (pct >= 0 and pct <= 100),
  commission_cents integer not null check (commission_cents >= 0),
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_commissions_affiliate_idx on public.affiliate_commissions (affiliate_id);

alter table public.affiliates enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.affiliate_commissions enable row level security;
