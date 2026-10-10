-- Invoicing v3 (Vin's definitive requirements, 2026-10-10). Run once in the
-- Supabase SQL editor AFTER 20261009120000_invoicing_v2.sql. Safe to re-run.
-- Never overwrites a value Vin has already saved.
--
-- 1. invoice_settings
--    - tax_rules: VAT treatment per PRODUCT TYPE × CUSTOMER CATEGORY, each with
--      a confirmation status ('confirmed' | 'pending'). Supersedes the six
--      nature_* / reference_* columns of v2 (left in place, no longer read).
--    - wording_status: per product type, whether the forfettario wording is
--      confirmed for it.
--    - stamp_duty_rules: per Natura, 'applies' | 'not_applicable' | 'pending'.
--    - foreign_private_id_status.
--    - The exact forfettario wording from Vin's existing invoices, and the
--      foreign-private identifier OO99999999999 (confirmed by the
--      commercialista) — set ONLY where still empty.
-- 2. fiscal_invoices: product type, Stripe product IDs, test vs live, the
--    historical review queue ('review'), void, refunds, SdI reference, errors.
-- 3. invoice_product_types: which product type each Stripe product is
--    (remembered once Vin classifies a one-off product).
-- 4. billing_event_errors: webhook events that failed (visible on
--    /admin/invoices until Stripe's retry succeeds).

alter table public.invoice_settings
  add column if not exists tax_rules jsonb,
  add column if not exists wording_status jsonb,
  add column if not exists stamp_duty_rules jsonb,
  add column if not exists foreign_private_id_status text not null default 'confirmed';

update public.invoice_settings set tax_rules = '{
  "software_subscription": {
    "IT_B2C":     {"nature": "N2.2", "status": "pending"},
    "IT_B2B":     {"nature": "N2.2", "status": "pending"},
    "EU_B2C":     {"nature": null,   "status": "pending"},
    "EU_B2B":     {"nature": "N2.1", "status": "pending"},
    "NON_EU_B2C": {"nature": "N2.1", "status": "pending"},
    "NON_EU_B2B": {"nature": "N2.1", "status": "pending"}
  },
  "coaching_service": {
    "IT_B2C":     {"nature": "N2.2", "status": "confirmed"},
    "IT_B2B":     {"nature": "N2.2", "status": "pending"},
    "EU_B2C":     {"nature": "N2.1", "status": "pending"},
    "EU_B2B":     {"nature": "N2.1", "status": "pending"},
    "NON_EU_B2C": {"nature": "N2.1", "status": "pending"},
    "NON_EU_B2B": {"nature": "N2.1", "status": "pending"}
  },
  "digital_product": {
    "IT_B2C":     {"nature": "N2.2", "status": "pending"},
    "IT_B2B":     {"nature": "N2.2", "status": "pending"},
    "EU_B2C":     {"nature": null,   "status": "pending"},
    "EU_B2B":     {"nature": "N2.1", "status": "pending"},
    "NON_EU_B2C": {"nature": "N2.1", "status": "pending"},
    "NON_EU_B2B": {"nature": "N2.1", "status": "pending"}
  },
  "other": {
    "IT_B2C":     {"nature": "N2.2", "status": "pending"},
    "IT_B2B":     {"nature": "N2.2", "status": "pending"},
    "EU_B2C":     {"nature": null,   "status": "pending"},
    "EU_B2B":     {"nature": null,   "status": "pending"},
    "NON_EU_B2C": {"nature": null,   "status": "pending"},
    "NON_EU_B2B": {"nature": null,   "status": "pending"}
  }
}'::jsonb where id = 1 and tax_rules is null;

update public.invoice_settings set wording_status = '{
  "software_subscription": "pending",
  "coaching_service": "confirmed",
  "digital_product": "pending",
  "other": "pending"
}'::jsonb where id = 1 and wording_status is null;

update public.invoice_settings set stamp_duty_rules = '{
  "N2.2": "applies",
  "N2.1": "pending"
}'::jsonb where id = 1 and stamp_duty_rules is null;

update public.invoice_settings
  set regime_wording = 'Operazione effettuata ai sensi dell’articolo 1, commi da 54 a 89, della Legge n. 190/2014 e successive modificazioni e integrazioni. Regime forfetario. Si richiede la non applicazione della ritenuta d’acconto ai sensi dell’articolo 1, comma 59, della Legge n. 190/2014.'
  where id = 1 and (regime_wording is null or regime_wording = '');

update public.invoice_settings
  set foreign_private_id = 'OO99999999999'
  where id = 1 and (foreign_private_id is null or foreign_private_id = '');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_settings_foreign_id_status_check') then
    alter table public.invoice_settings
      add constraint invoice_settings_foreign_id_status_check
      check (foreign_private_id_status in ('confirmed', 'pending'));
  end if;
end $$;

alter table public.fiscal_invoices
  add column if not exists product_type text,
  add column if not exists stripe_product_ids text[],
  add column if not exists livemode boolean not null default true,
  add column if not exists refunded_amount_cents integer not null default 0,
  add column if not exists refunded_at timestamptz,
  add column if not exists sdi_id text,
  add column if not exists external_reference text,
  add column if not exists void_reason text,
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fiscal_invoices_product_type_check') then
    alter table public.fiscal_invoices
      add constraint fiscal_invoices_product_type_check
      check (product_type is null or product_type in ('software_subscription', 'coaching_service', 'digital_product', 'other'));
  end if;
  -- Status: 'review' = historical payment awaiting Vin's reconciliation;
  -- 'void' = not to be invoiced (test, refunded before invoicing, not a sale).
  if exists (select 1 from pg_constraint where conname = 'fiscal_invoices_status_check') then
    alter table public.fiscal_invoices drop constraint fiscal_invoices_status_check;
  end if;
  alter table public.fiscal_invoices
    add constraint fiscal_invoices_status_check
    check (status in ('to_issue', 'review', 'issued', 'sent', 'external', 'void'));
end $$;

-- Subscriptions are always the software product.
update public.fiscal_invoices set product_type = 'software_subscription'
  where product_type is null and source = 'subscription';

create index if not exists fiscal_invoices_payment_intent_idx on public.fiscal_invoices (stripe_payment_intent_id);

create table if not exists public.invoice_product_types (
  stripe_product_id text primary key,
  product_type text not null check (product_type in ('software_subscription', 'coaching_service', 'digital_product', 'other')),
  label text,
  updated_at timestamptz not null default now()
);
alter table public.invoice_product_types enable row level security;

create table if not exists public.billing_event_errors (
  event_id text primary key,
  event_type text not null,
  livemode boolean,
  error text not null,
  attempts integer not null default 1,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.billing_event_errors enable row level security;
