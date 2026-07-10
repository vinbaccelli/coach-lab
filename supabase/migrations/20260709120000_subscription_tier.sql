-- Add tier + seats to subscriptions so the app can tell Light / Pro / Academy
-- apart (single-tier before). Existing rows are treated as 'pro' (the original
-- single product) with 1 seat. Written by the Stripe webhook.

alter table public.subscriptions
  add column if not exists tier text not null default 'pro',
  add column if not exists seats integer not null default 1;

-- Constrain to the known tiers.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_tier_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_tier_check
      check (tier in ('light', 'pro', 'academy'));
  end if;
end $$;
