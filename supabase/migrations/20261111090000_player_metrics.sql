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

-- Rollback: drop table public.player_metrics;
