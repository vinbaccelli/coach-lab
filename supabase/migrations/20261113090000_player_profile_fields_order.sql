-- Player profile (2026-11-13): extra profile rows (name/value pairs, like the technical sheet)
-- and the coach's manual timeline order (list of item keys). Both optional; null = default behaviour.
-- Idempotent. NOT APPLIED automatically (run it in the Supabase SQL editor).
alter table public.players add column if not exists profile_fields jsonb;
alter table public.players add column if not exists timeline_order jsonb;

-- Rollback: alter table public.players drop column if exists profile_fields, drop column if exists timeline_order;
