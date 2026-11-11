-- AngleMotion: player database setup (run once, in order). Safe to re-run.
-- 1) progress tracking, 2) timeline, 3) share link (same content as the three migration files, in one paste)

-- ===== 20261111090000_player_metrics =====
-- Player tracked metrics (2026-11-11): values that change over time and are graphed
-- (weight, fat %, UTR, 5 km time ... whatever the coach or player decides to track).
-- One row = one measurement. The metric is identified by its name (+ unit) per player,
-- so there is no separate "metric definition" table.
-- RLS: the owning coach only (same rule as players / player_entries). Idempotent.
-- NOT APPLIED automatically: run it (or have it applied) before using the feature.

create table if not exists public.player_metrics (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  unit text not null default '' check (length(unit) <= 16),
  value numeric not null,
  recorded_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_player_metrics_player on public.player_metrics (player_id, name, recorded_on);
create index if not exists idx_player_metrics_coach on public.player_metrics (coach_id);

alter table public.player_metrics enable row level security;

drop policy if exists "player_metrics_select_own" on public.player_metrics;
create policy "player_metrics_select_own" on public.player_metrics
  for select using (auth.uid() = coach_id);
drop policy if exists "player_metrics_insert_own" on public.player_metrics;
create policy "player_metrics_insert_own" on public.player_metrics
  for insert with check (
    auth.uid() = coach_id
    and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
  );
drop policy if exists "player_metrics_update_own" on public.player_metrics;
create policy "player_metrics_update_own" on public.player_metrics
  for update using (auth.uid() = coach_id);
drop policy if exists "player_metrics_delete_own" on public.player_metrics;
create policy "player_metrics_delete_own" on public.player_metrics
  for delete using (auth.uid() = coach_id);

-- Who added the row: the coach, or someone using the share link.
alter table public.player_metrics add column if not exists author text not null default 'coach' check (author in ('coach', 'link'));


-- ===== 20261111100000_player_timeline_items =====
-- Player timeline items (2026-11-11): comments, pictures and videos added straight from the
-- player profile. A video is an UNLISTED YouTube video stored only as its id (we embed it);
-- a picture is a small image in the existing public `player-assets` bucket (path
-- {coach_id}/{player_id}/timeline/...), so the existing storage policies already cover it.
-- RLS: owning coach only. Idempotent. NOT APPLIED automatically.

create table if not exists public.player_timeline_items (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  kind text not null check (kind in ('note', 'picture', 'video')),
  body text not null default '' check (length(body) <= 4000),
  media_url text,
  youtube_id text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  created_at timestamptz not null default now(),
  check (
    (kind = 'note' and length(btrim(body)) > 0)
    or (kind = 'picture' and media_url is not null)
    or (kind = 'video' and youtube_id is not null)
  )
);

create index if not exists idx_player_timeline_player on public.player_timeline_items (player_id, created_at desc);
create index if not exists idx_player_timeline_coach on public.player_timeline_items (coach_id);

alter table public.player_timeline_items enable row level security;

drop policy if exists "player_timeline_select_own" on public.player_timeline_items;
create policy "player_timeline_select_own" on public.player_timeline_items
  for select using (auth.uid() = coach_id);
drop policy if exists "player_timeline_insert_own" on public.player_timeline_items;
create policy "player_timeline_insert_own" on public.player_timeline_items
  for insert with check (
    auth.uid() = coach_id
    and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
  );
drop policy if exists "player_timeline_delete_own" on public.player_timeline_items;
create policy "player_timeline_delete_own" on public.player_timeline_items
  for delete using (auth.uid() = coach_id);

-- Who added the row: the coach, or someone using the share link.
alter table public.player_timeline_items add column if not exists author text not null default 'coach' check (author in ('coach', 'link'));


-- ===== 20261111110000_player_shares =====
-- Player share link (2026-11-11): one link per player. The coach chooses view-only or "can add",
-- and optionally an email the visitor must type. The link token is never stored in clear:
-- token_hash (sha256) is used for lookup, token_enc (AES-GCM, key YOUTUBE_TOKEN_ENC_KEY, the
-- same key the app already uses for YouTube tokens) lets the coach copy the link again.
-- Visitors never touch this table: the share routes run on the server with the service role.
-- RLS: owning coach only. Idempotent. NOT APPLIED automatically.

create table if not exists public.player_shares (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null unique references public.players (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_enc text not null,
  mode text not null default 'view' check (mode in ('view', 'edit')),
  allowed_email text check (allowed_email is null or length(allowed_email) <= 254),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_player_shares_coach on public.player_shares (coach_id);

alter table public.player_shares enable row level security;

drop policy if exists "player_shares_select_own" on public.player_shares;
create policy "player_shares_select_own" on public.player_shares for select using (auth.uid() = coach_id);
drop policy if exists "player_shares_insert_own" on public.player_shares;
create policy "player_shares_insert_own" on public.player_shares for insert with check (
  auth.uid() = coach_id
  and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
);
drop policy if exists "player_shares_update_own" on public.player_shares;
create policy "player_shares_update_own" on public.player_shares for update using (auth.uid() = coach_id);
drop policy if exists "player_shares_delete_own" on public.player_shares;
create policy "player_shares_delete_own" on public.player_shares for delete using (auth.uid() = coach_id);
