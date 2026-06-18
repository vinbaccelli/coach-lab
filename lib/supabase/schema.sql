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
