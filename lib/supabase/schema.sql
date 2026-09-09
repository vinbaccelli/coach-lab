-- CoachLab V1 — Supabase schema
-- Run this in the Supabase SQL editor to create all required tables.

-- ── Coach profiles ────────────────────────────────────────────────────────
-- Stores each coach's public profile data (the linktree-style page).

create table if not exists coach_profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  slug         text unique not null,              -- URL slug: /coach/vinbaccelli
  name         text not null,
  tagline      text,
  bio          text,
  avatar_url   text,                              -- Supabase Storage path
  accent_color text default '#007AFF',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- NOTE: for an existing project, use the re-runnable MIGRATION block at the
-- end of this file instead — it adds NOT NULL, indexes and idempotent policies.
create table if not exists coach_services (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references coach_profiles(id) on delete cascade,
  title        text not null,
  description  text,
  price        text,
  cta_label    text default 'Book Now',
  cta_url      text,
  sort_order   int default 0,
  created_at   timestamptz default now()
);

create table if not exists coach_links (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references coach_profiles(id) on delete cascade,
  label        text not null,
  url          text not null,
  icon         text,                             -- 'instagram' | 'youtube' | 'globe' | 'mail' | 'external'
  sort_order   int default 0,
  created_at   timestamptz default now()
);

-- ── Frame Metrics sessions ────────────────────────────────────────────────
-- One row per Frame Metrics analysis session.

create table if not exists frame_metrics_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  player_id    uuid,                             -- references players table if applicable
  title        text,
  video_url    text,                             -- Supabase Storage path or external URL
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── Frame Metrics captures ────────────────────────────────────────────────
-- One row per captured annotated frame within a session.

create table if not exists frame_metrics_captures (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references frame_metrics_sessions(id) on delete cascade,
  frame_index     int not null,
  time_sec        float not null,
  label           text,
  image_path      text,                          -- Supabase Storage path (frame screenshot)
  notes           text,                          -- User's measurement notes
  measurements    jsonb,                         -- { angles: [], distances: [], keypoints: [] }
  created_at      timestamptz default now()
);

-- ── Video analysis screenshots ────────────────────────────────────────────
-- Quick screenshots saved from Video Analysis (the "Save screenshot" button).

create table if not exists analysis_screenshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  player_id    uuid,
  image_path   text not null,                    -- Supabase Storage path
  caption      text,
  tags         text[],
  created_at   timestamptz default now()
);

-- ── Coach profile reviews ─────────────────────────────────────────────────
-- Reviews left on a coach's public profile.

create table if not exists coach_reviews (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references coach_profiles(id) on delete cascade,
  reviewer_name text not null,
  reviewer_role text,
  body         text not null,
  stars        int check (stars between 1 and 5) default 5,
  approved     boolean default false,            -- coach approves before display
  created_at   timestamptz default now()
);

-- ── Row-level security ────────────────────────────────────────────────────
-- Public: coach profiles are readable by anyone.

alter table coach_profiles enable row level security;
create policy "Coach profiles are public" on coach_profiles for select using (true);
create policy "Coaches manage own profile" on coach_profiles for all using (auth.uid() = user_id);

alter table coach_services enable row level security;
create policy "Services are public" on coach_services for select using (true);
create policy "Coaches manage own services" on coach_services for all
  using (profile_id in (select id from coach_profiles where user_id = auth.uid()));

alter table coach_links enable row level security;
create policy "Links are public" on coach_links for select using (true);
create policy "Coaches manage own links" on coach_links for all
  using (profile_id in (select id from coach_profiles where user_id = auth.uid()));

alter table frame_metrics_sessions enable row level security;
create policy "Users manage own sessions" on frame_metrics_sessions for all using (auth.uid() = user_id);

alter table frame_metrics_captures enable row level security;
create policy "Users manage own captures" on frame_metrics_captures for all
  using (session_id in (select id from frame_metrics_sessions where user_id = auth.uid()));

alter table analysis_screenshots enable row level security;
create policy "Users manage own screenshots" on analysis_screenshots for all using (auth.uid() = user_id);

alter table coach_reviews enable row level security;
create policy "Approved reviews are public" on coach_reviews for select using (approved = true);
create policy "Anyone can submit a review" on coach_reviews for insert with check (true);
create policy "Coaches manage reviews on own profile" on coach_reviews for all
  using (profile_id in (select id from coach_profiles where user_id = auth.uid()));

-- ── Storage buckets (run separately in Supabase dashboard) ───────────────
-- Create these buckets in Storage > Buckets:
--   - frame-metrics-captures  (private)
--   - analysis-screenshots    (private)
--   - coach-avatars           (public)

-- ── Storage RLS policies ─────────────────────────────────────────────────
-- Buckets alone are not enough: `storage.objects` has RLS enabled, so an
-- upload with no matching policy is rejected with
-- "new row violates row-level security policy".
--
-- Verified against production on 2026-09-06: policies exist for
-- frame-metrics-captures and analysis-screenshots, but NONE for coach-avatars,
-- which is why coach profile photo uploads fail. See docs/KNOWN_ISSUES.md 006.
--
-- The convention throughout is that an object's FIRST path segment is the
-- owner's user id, so a coach may only write inside their own folder.
--
-- NOT YET APPLIED TO PRODUCTION — run in the Supabase SQL editor.

create policy "Coaches upload own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'coach-avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- Needed because the client uploads with `upsert: true`, which updates an
-- existing object rather than inserting when the path already exists.
-- USING gates which existing rows may be updated; WITH CHECK gates what they
-- may be updated INTO, so a coach cannot move an object into someone else's
-- folder. Postgres would default WITH CHECK to USING here; it is spelled out
-- because relying on that default is how these policies drift.
create policy "Coaches replace own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'coach-avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  )
  with check (
    bucket_id = 'coach-avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "Coaches delete own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'coach-avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- A public read policy. The bucket being public already lets a browser fetch an
-- avatar by its public URL, so this is NOT what makes the photo render. What it
-- adds is client-side SELECT on storage.objects: `list()` and metadata reads go
-- through RLS even for a public bucket, and without this they return empty.
create policy "Public can read avatars"
  on storage.objects for select to public
  using (bucket_id = 'coach-avatars');

-- Verify (expect 4 rows: INSERT, UPDATE, DELETE, SELECT):
--   select policyname, cmd, roles::text
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and (qual like '%coach-avatars%' or with_check like '%coach-avatars%');

-- ── MIGRATION: coach_services + coach_links ──────────────────────────────
-- For an EXISTING project whose schema was never fully applied. Verified live
-- against production on 2026-09-06: `coach_profiles` exists, `coach_services`
-- and `coach_links` do NOT. See docs/KNOWN_ISSUES.md 004.
--
-- SCOPE — these two tables are the COACH'S OWN PUBLIC PROFILE:
--   the services a coach sells and the social/payment links shown on
--   /coach/[slug]. They hang off coach_profiles and are public content.
--
-- They are NOT the per-player feature. Private coaching records live in
-- `player_entries` and `player_sessions`, which are keyed on (coach_id,
-- player_id), are reached only through /api/players/..., and are never public.
-- `player_sessions.external_links` is the per-player link store; it is a jsonb
-- column on a session row, not a table, and nothing here touches it.
--
-- Two different ownership expressions, both resolving to auth.uid():
--   players.coach_id            = auth.uid()   (per-player data, already live)
--   coach_profiles.user_id      = auth.uid()   (profile content, below)
--
-- Ownership is written INLINE rather than behind a helper function so the full
-- expression is visible in pg_policies for auditing.
--
-- Idempotent — safe to re-run.
--
-- STATUS 2026-09-09: APPLIED. Both tables now exist in production with RLS and
-- correct owner-scoped policies (verified live). The applied migration used
-- different policy names and a single FOR ALL policy instead of the split
-- INSERT/UPDATE/DELETE below — functionally equivalent, no action needed.
-- It did, however, create coach_services with different COLUMN names; see the
-- rename block at the end of this file.

-- ── Tables ───────────────────────────────────────────────────────────────

create table if not exists coach_services (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references coach_profiles(id) on delete cascade,
  title        text not null,
  description  text,
  price        text,        -- FREE TEXT, not numeric: "€20", "$249 / month"
  cta_label    text default 'Book Now',
  cta_url      text,        -- Stripe, WhatsApp, coachlife.com — any destination
  sort_order   int default 0,
  created_at   timestamptz default now()
);

create table if not exists coach_links (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references coach_profiles(id) on delete cascade,
  label        text not null,
  url          text not null,
  icon         text,        -- 'instagram' | 'youtube' | 'globe' | 'mail' | 'whatsapp' | 'trustpilot' | 'google' | 'external'
  sort_order   int default 0,
  created_at   timestamptz default now()
);

-- Every query filters by profile_id and orders by sort_order.
create index if not exists coach_services_profile_sort_idx on coach_services (profile_id, sort_order);
create index if not exists coach_links_profile_sort_idx    on coach_links    (profile_id, sort_order);

-- ── Row level security ───────────────────────────────────────────────────

alter table coach_services enable row level security;
alter table coach_links    enable row level security;

drop policy if exists "Services are public"         on coach_services;
drop policy if exists "Coaches manage own services" on coach_services;
drop policy if exists "Coaches insert own services" on coach_services;
drop policy if exists "Coaches update own services" on coach_services;
drop policy if exists "Coaches delete own services" on coach_services;
drop policy if exists "Links are public"            on coach_links;
drop policy if exists "Coaches manage own links"    on coach_links;
drop policy if exists "Coaches insert own links"    on coach_links;
drop policy if exists "Coaches update own links"    on coach_links;
drop policy if exists "Coaches delete own links"    on coach_links;

-- Removes the helper from an earlier draft of this migration, if it was run.
-- Must come after the policy drops, since policies could reference it.
drop function if exists public.coach_owns_profile(uuid);

-- PUBLIC READ — required, not optional. /coach/[slug] is in the middleware's
-- public allowlist and is rendered for anonymous visitors, so the anon role
-- must be able to read a coach's services and links. Without this the profile
-- page silently shows no services and no links.
create policy "Services are public"
  on coach_services for select
  using (true);

create policy "Links are public"
  on coach_links for select
  using (true);

-- WRITES — a coach may only touch rows on a profile they own. The API writes
-- with the caller's own cookie-bound client (lib/auth/routeSession.ts), never a
-- service-role key, so RLS is the only thing enforcing ownership here.
-- Split per command, and written inline, so each rule is legible in pg_policies.

create policy "Coaches insert own services"
  on coach_services for insert
  with check (profile_id in (select id from coach_profiles where user_id = auth.uid()));

create policy "Coaches update own services"
  on coach_services for update
  using      (profile_id in (select id from coach_profiles where user_id = auth.uid()))
  with check (profile_id in (select id from coach_profiles where user_id = auth.uid()));

create policy "Coaches delete own services"
  on coach_services for delete
  using (profile_id in (select id from coach_profiles where user_id = auth.uid()));

create policy "Coaches insert own links"
  on coach_links for insert
  with check (profile_id in (select id from coach_profiles where user_id = auth.uid()));

create policy "Coaches update own links"
  on coach_links for update
  using      (profile_id in (select id from coach_profiles where user_id = auth.uid()))
  with check (profile_id in (select id from coach_profiles where user_id = auth.uid()));

create policy "Coaches delete own links"
  on coach_links for delete
  using (profile_id in (select id from coach_profiles where user_id = auth.uid()));

-- ── MIGRATION: align coach_services column names with the application ────
-- The applied migration created coach_services with a different column
-- vocabulary than every consumer reads and writes. Verified live 2026-09-09:
--
--   live column    code expects   used at
--   name        →  title          app/api/coach-profile/route.ts, app/coach/[slug]/page.tsx
--   price_label →  price          app/api/coach-profile/route.ts
--   stripe_url  →  cta_url        app/api/coach-profile/route.ts
--   (absent)    →  cta_label      app/api/coach-profile/route.ts
--
-- Reproduced through PostgREST:
--   select=title  → 42703 "column coach_services.title does not exist"
--   select=name   → succeeds
--
-- `cta_url` rather than `stripe_url` is deliberate: that column also holds
-- WhatsApp and coachlife.com destinations, so the Stripe-specific name would be
-- wrong even if the code were changed to match it. coach_links already matches
-- and is NOT touched here.
--
-- Both tables are EMPTY (0 rows, verified), so these renames are data-safe.
--
-- NOT YET APPLIED TO PRODUCTION — run in the Supabase SQL editor.

alter table coach_services rename column name        to title;
alter table coach_services rename column price_label to price;
alter table coach_services rename column stripe_url  to cta_url;
alter table coach_services add column if not exists cta_label text default 'Book Now';

-- Verify (expect: title, price, cta_url, cta_label all present):
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'coach_services'
--   order by ordinal_position;
