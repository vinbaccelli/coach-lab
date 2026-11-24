-- Analysis subscriptions on the coach profile, increment 1 (docs/ANALYSIS_SUBSCRIPTIONS_PLAN.md).
-- Additive only: one nullable column on the existing coach_profiles row. No data is deleted or
-- rewritten, and the table's existing RLS policies (owner writes, public read of the profile) apply.
-- The app never handles money: the JSON holds the coach's offers and pasted payment links.
alter table public.coach_profiles
  add column if not exists subscription_offer jsonb;
