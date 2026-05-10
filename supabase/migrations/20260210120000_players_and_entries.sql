-- Run in Supabase SQL Editor if migrations CLI is not used.
-- Coach-scoped player profiles and folder entries (technique / match analysis).

create extension if not exists "pgcrypto";

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  photo_url text,
  date_of_birth date,
  nationality text,
  playing_hand text check (playing_hand in ('right', 'left', 'unknown')) default 'unknown',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_players_coach on public.players (coach_id);
create index if not exists idx_players_name on public.players (coach_id, display_name);

create table if not exists public.player_entries (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  category text not null check (category in ('technique', 'match')),
  folder_label text not null,
  body_text text not null default '',
  youtube_url text,
  opponent_name text,
  match_date date,
  screenshots jsonb not null default '[]'::jsonb,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_player_entries_player on public.player_entries (player_id);
create index if not exists idx_player_entries_created on public.player_entries (created_at desc);
create index if not exists idx_player_entries_coach on public.player_entries (coach_id);

alter table public.players enable row level security;
alter table public.player_entries enable row level security;

create policy "players_select_own" on public.players
  for select using (auth.uid() = coach_id);
create policy "players_insert_own" on public.players
  for insert with check (auth.uid() = coach_id);
create policy "players_update_own" on public.players
  for update using (auth.uid() = coach_id);
create policy "players_delete_own" on public.players
  for delete using (auth.uid() = coach_id);

create policy "entries_select_own" on public.player_entries
  for select using (auth.uid() = coach_id);
create policy "entries_insert_own" on public.player_entries
  for insert with check (auth.uid() = coach_id);
create policy "entries_update_own" on public.player_entries
  for update using (auth.uid() = coach_id);
create policy "entries_delete_own" on public.player_entries
  for delete using (auth.uid() = coach_id);

-- Optional: storage bucket "player-assets" — create in Dashboard → Storage, then:
-- insert into storage.buckets (id, name, public) values ('player-assets', 'player-assets', true);
-- RLS policies for storage.objects scoped to coach folder prefix.
