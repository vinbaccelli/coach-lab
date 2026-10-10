-- Invoicing v2 (Vin's decisions D7, D9, D10 — 2026-10-08). Run once in the
-- Supabase SQL editor AFTER 20261008120000_invoicing.sql. Safe to re-run.
--
-- 1. invoice_settings: ONE row holding Vin's fiscal data and invoicing rules,
--    edited on /admin/invoices (D9). Nothing personal or fiscal lives in code
--    or in Vercel. Admin-only (service role): no client policies at all.
-- 2. billing_profiles.foreign_tax_id: the tax ID a non-Italian customer may
--    enter on /billing (T3).
-- 3. fiscal_invoices: one-off sales (payment links: coaching, ebook…) next to
--    subscriptions (D10), the customer category (six kinds), the amount
--    breakdown (D7: price, VAT, stamp duty, total), and status 'external' for
--    a past payment Vin already invoiced outside AngleMotion.

create table if not exists public.invoice_settings (
  id smallint primary key default 1 check (id = 1),

  -- Seller (cedente / prestatore)
  seller_first_name text,
  seller_last_name text,
  seller_address text,
  seller_cap text,
  seller_city text,
  seller_province text,
  seller_country text not null default 'IT',
  seller_partita_iva text,
  seller_codice_fiscale text,
  seller_regime_fiscale text not null default 'RF19',
  seller_ateco text,
  -- Vin's own SdI reception details (reference; not written into outgoing XML)
  seller_pec text,
  seller_codice_destinatario text,

  -- Wording and VAT treatment
  regime_wording text,
  nature_it_b2c text default 'N2.2',
  nature_it_b2b text default 'N2.2',
  nature_eu_b2b text default 'N2.1',
  nature_eu_b2c text,                -- PENDING (T2, OSS): no default on purpose
  nature_non_eu_b2c text default 'N2.1',
  nature_non_eu_b2b text default 'N2.1',
  -- Optional short legal reference per category (RiferimentoNormativo, ≤100)
  reference_it_b2c text,
  reference_it_b2b text,
  reference_eu_b2b text,
  reference_eu_b2c text,
  reference_non_eu_b2c text,
  reference_non_eu_b2b text,

  -- Stamp duty (D7: absorbed — declared on the invoice, never added to the total)
  stamp_duty_enabled boolean not null default true,
  stamp_duty_threshold numeric(8, 2) not null default 77.47,
  stamp_duty_amount numeric(6, 2) not null default 2.00,
  stamp_duty_natures text not null default 'N2.2', -- D8: add N2.1 once confirmed

  -- Numbering and lines
  last_issued_year integer default 2026,
  last_issued_number integer default 64,
  description_subscription text not null default 'Abbonamento AngleMotion {plan} {interval} - periodo dal {start} al {end}',
  description_one_off text not null default '{product}',
  payment_method text not null default 'MP08',
  foreign_private_id text,           -- PENDING (T3): no default on purpose

  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.invoice_settings (id) values (1) on conflict (id) do nothing;
alter table public.invoice_settings enable row level security;

alter table public.billing_profiles
  add column if not exists foreign_tax_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'billing_profiles_foreign_tax_id_check') then
    alter table public.billing_profiles
      add constraint billing_profiles_foreign_tax_id_check
      check (foreign_tax_id is null or foreign_tax_id ~ '^[A-Z0-9]{2,28}$');
  end if;
end $$;

alter table public.fiscal_invoices
  add column if not exists source text not null default 'subscription',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists product_description text,
  add column if not exists customer_category text,
  add column if not exists foreign_tax_id text,
  add column if not exists taxable_amount_cents integer,
  add column if not exists vat_amount_cents integer,
  add column if not exists stamp_duty_cents integer,
  add column if not exists invoice_total_cents integer,
  add column if not exists note text;

-- One-off sales have a Checkout Session, not always a Stripe invoice.
alter table public.fiscal_invoices alter column stripe_invoice_id drop not null;
-- A plain UNIQUE constraint (NULLs never conflict), not a partial index: the
-- webhook's insert-if-missing (ON CONFLICT) needs a constraint it can target.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fiscal_invoices_checkout_session_key') then
    alter table public.fiscal_invoices
      add constraint fiscal_invoices_checkout_session_key unique (stripe_checkout_session_id);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fiscal_invoices_source_check') then
    alter table public.fiscal_invoices
      add constraint fiscal_invoices_source_check check (source in ('subscription', 'one_off'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fiscal_invoices_stripe_ref_check') then
    alter table public.fiscal_invoices
      add constraint fiscal_invoices_stripe_ref_check
      check (stripe_invoice_id is not null or stripe_checkout_session_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fiscal_invoices_category_check') then
    alter table public.fiscal_invoices
      add constraint fiscal_invoices_category_check
      check (customer_category is null or customer_category in ('IT_B2C', 'IT_B2B', 'EU_B2C', 'EU_B2B', 'NON_EU_B2C', 'NON_EU_B2B'));
  end if;
  -- Status gains 'external': a past payment already invoiced outside AngleMotion.
  if exists (select 1 from pg_constraint where conname = 'fiscal_invoices_status_check') then
    alter table public.fiscal_invoices drop constraint fiscal_invoices_status_check;
  end if;
  alter table public.fiscal_invoices
    add constraint fiscal_invoices_status_check check (status in ('to_issue', 'issued', 'sent', 'external'));
end $$;
