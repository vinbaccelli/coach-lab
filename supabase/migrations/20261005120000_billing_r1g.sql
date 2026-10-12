-- Launch billing (R1g). Run once in the Supabase SQL editor BEFORE deploying
-- claude/pricing-launch. Safe to re-run (IF NOT EXISTS everywhere).
--
-- 1. subscriptions: the remaining fields cached from Stripe. Stripe stays the
--    source of truth — the webhook rewrites these from the subscription it
--    re-reads on every event. The plan keeps living in the existing `tier`
--    column (light | pro | academy); it is not renamed.
-- 2. stripe_webhook_events: event-level idempotency for the webhook. An event
--    id is inserted only after its processing succeeded, so a failed run is
--    retried by Stripe; a duplicate delivery of a processed id is a no-op.

alter table public.subscriptions
  add column if not exists billing_interval text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists canceled_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_billing_interval_check') then
    alter table public.subscriptions
      add constraint subscriptions_billing_interval_check
      check (billing_interval is null or billing_interval in ('month', 'year'));
  end if;
end $$;

-- Customer reuse: checkout reads the stored stripe_customer_id for the
-- signed-in coach (RLS "subscriptions_select_own" already allows that read).
create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

-- Service role only (the webhook). No policies = no client access at all.
alter table public.stripe_webhook_events enable row level security;
