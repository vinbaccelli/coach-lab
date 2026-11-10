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

-- Rollback: drop table public.player_timeline_items;
