-- Stripe fields + Italian invoicing data (P1). Run once in the Supabase SQL
-- editor BEFORE deploying the invoicing release. Safe to re-run.
--
-- 1. subscriptions: three more fields cached from Stripe (the webhook rewrites
--    them from the subscription it re-reads; Stripe stays the source of truth).
-- 2. billing_profiles: the Italian fiscal identifiers a coach enters on
--    /billing (Codice Fiscale, Partita IVA, Codice Destinatario, PEC) plus the
--    billing country the webhook copies from their Stripe Customer. Coaches
--    read their own row; writes go through /api/billing/profile (service role)
--    which validates every field.
-- 3. fiscal_invoices: one row per PAID Stripe invoice — the data an Italian
--    fattura elettronica needs, frozen at payment time (customer, amount,
--    period, Stripe IDs) and completed when Vin issues it (number, date, VAT
--    treatment, wording, stamp duty, the FatturaPA XML). Admin-only: no client
--    policies at all. A Stripe receipt is NOT the fiscal invoice; this is the
--    record the fiscal invoice is issued from (docs/INVOICING.md).

alter table public.subscriptions
  add column if not exists stripe_price_id text,
  add column if not exists current_period_start timestamptz,
  add column if not exists stripe_checkout_session_id text;

create table if not exists public.billing_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  billing_country text check (billing_country is null or billing_country ~ '^[A-Z]{2}$'),
  codice_fiscale text check (codice_fiscale is null or codice_fiscale ~ '^([A-Z0-9]{16}|[0-9]{11})$'),
  partita_iva text check (partita_iva is null or partita_iva ~ '^[0-9]{11}$'),
  codice_destinatario text check (codice_destinatario is null or codice_destinatario ~ '^[A-Z0-9]{7}$'),
  pec text check (pec is null or position('@' in pec) > 1),
  updated_at timestamptz not null default now()
);

alter table public.billing_profiles enable row level security;

drop policy if exists "billing_profiles_select_own" on public.billing_profiles;
create policy "billing_profiles_select_own"
  on public.billing_profiles for select
  using (auth.uid() = user_id);
-- No insert/update/delete policies: writes go through the service role.

create table if not exists public.fiscal_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,

  -- Stripe references
  stripe_invoice_id text not null unique,
  stripe_invoice_number text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_payment_intent_id text,

  -- What was paid (frozen at payment)
  paid_at timestamptz not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  plan text,
  billing_interval text,
  period_start timestamptz,
  period_end timestamptz,

  -- Customer as Stripe held it at payment
  customer_name text,
  customer_email text,
  business_name text,
  customer_address jsonb,
  customer_country text,
  customer_region text check (customer_region is null or customer_region in ('IT', 'EU', 'NON_EU')),
  is_business boolean not null default false,
  vat_id text,
  vat_id_type text,

  -- Italian identifiers, copied from billing_profiles when the invoice is issued
  codice_fiscale text,
  partita_iva text,
  codice_destinatario text,
  pec text,

  -- The fiscal invoice (set when Vin issues it)
  description text,
  tax_nature text,
  tax_rate numeric(5, 2),
  regime_wording text,
  stamp_duty_amount numeric(6, 2),
  invoice_year integer,
  invoice_number integer check (invoice_number is null or invoice_number > 0),
  invoice_date date,
  xml text,
  xml_file_name text,
  status text not null default 'to_issue' check (status in ('to_issue', 'issued', 'sent')),
  issued_at timestamptz,
  sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One invoice number per year, ever (the fiscal sequence).
create unique index if not exists fiscal_invoices_year_number_idx
  on public.fiscal_invoices (invoice_year, invoice_number)
  where invoice_number is not null;
create index if not exists fiscal_invoices_status_idx on public.fiscal_invoices (status, paid_at);
create index if not exists fiscal_invoices_user_idx on public.fiscal_invoices (user_id);

-- Admin-only (service role). No policies = no client access.
alter table public.fiscal_invoices enable row level security;
