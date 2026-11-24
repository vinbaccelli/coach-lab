-- Player change log (2026-11-21): one row each time something on a player's profile is changed in a way that
-- overwrites the old value (the Blueprint first), so the timeline can show WHEN it changed and what.
-- Additive: a new table, nothing existing is altered or deleted. RLS: the owning coach only (the client's
-- share link does not read it). Idempotent. NOT APPLIED automatically.
-- The app works without it: until this runs, saving a Blueprint simply leaves no stamp.

create table if not exists public.player_changes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  -- The profile section the change belongs to (the timeline groups it there).
  section text not null check (section in ('technical', 'progress', 'biometrics', 'fitness', 'nutrition', 'timeline')),
  title text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  body text not null default '' check (length(body) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists idx_player_changes_player on public.player_changes (player_id, created_at desc);

alter table public.player_changes enable row level security;

drop policy if exists "player_changes_select_own" on public.player_changes;
create policy "player_changes_select_own" on public.player_changes
  for select using (auth.uid() = coach_id);
drop policy if exists "player_changes_insert_own" on public.player_changes;
create policy "player_changes_insert_own" on public.player_changes
  for insert with check (
    auth.uid() = coach_id
    and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
  );
drop policy if exists "player_changes_delete_own" on public.player_changes;
create policy "player_changes_delete_own" on public.player_changes
  for delete using (auth.uid() = coach_id);

-- Rollback: drop table public.player_changes;
