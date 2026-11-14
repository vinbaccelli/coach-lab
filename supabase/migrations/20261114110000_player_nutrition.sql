-- Nutrition (2026-11-14): versioned nutrition plans and a meal diary per player.
--
--   player_nutrition_plans  a plan for a period (starts_on .. ends_on, open-ended when null) with
--                           daily targets (calories, protein, carbs, fat + custom targets), meal
--                           recommendations and notes. A new version is a NEW row (previous_id points
--                           at the plan it replaces, whose period is closed): history is never
--                           overwritten. A plan whose period has ended is read-only (enforced by the
--                           API); it can be duplicated into a new plan.
--   player_meal_logs        what was eaten: date, time, category, description, calories and macros
--                           (calories can be calculated from macros by the page), custom values,
--                           an optional photo (player-assets bucket) and a note. Logged by the coach
--                           (approved) or by the player through the share link (author = 'link',
--                           status 'submitted' until the coach approves it or asks for a fix).
--
-- RLS: owning coach only (share-link writes go through the server, scoped to the link's player).
-- Idempotent. NOT APPLIED automatically.

create table if not exists public.player_nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  starts_on date not null,
  ends_on date check (ends_on is null or ends_on >= starts_on),
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  targets jsonb not null default '{}'::jsonb check (jsonb_typeof(targets) = 'object'),
  meals jsonb not null default '[]'::jsonb check (jsonb_typeof(meals) = 'array'),
  notes text not null default '' check (length(notes) <= 4000),
  previous_id uuid references public.player_nutrition_plans (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_nutrition_plans_player on public.player_nutrition_plans (player_id, starts_on desc);
create index if not exists idx_nutrition_plans_coach on public.player_nutrition_plans (coach_id);

create table if not exists public.player_meal_logs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  eaten_on date not null,
  eaten_at time,
  category text not null default 'other'
    check (category in ('breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout', 'other')),
  description text not null default '' check (length(description) <= 1000),
  calories numeric check (calories is null or (calories >= 0 and calories <= 20000)),
  protein_g numeric check (protein_g is null or (protein_g >= 0 and protein_g <= 2000)),
  carbs_g numeric check (carbs_g is null or (carbs_g >= 0 and carbs_g <= 2000)),
  fat_g numeric check (fat_g is null or (fat_g >= 0 and fat_g <= 2000)),
  extras jsonb not null default '{}'::jsonb check (jsonb_typeof(extras) = 'object'),
  photo_url text check (photo_url is null or length(photo_url) <= 1000),
  note text not null default '' check (length(note) <= 1000),
  author text not null default 'coach' check (author in ('coach', 'link')),
  status text not null default 'approved' check (status in ('submitted', 'approved', 'needs_revision')),
  review_note text check (review_note is null or length(review_note) <= 1000),
  reviewed_at timestamptz,
  client_ref uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_meal_logs_player on public.player_meal_logs (player_id, eaten_on desc);
create index if not exists idx_meal_logs_coach on public.player_meal_logs (coach_id);
create unique index if not exists uq_meal_logs_client_ref on public.player_meal_logs (player_id, client_ref) where client_ref is not null;
create index if not exists idx_meal_logs_pending on public.player_meal_logs (player_id) where status <> 'approved';

alter table public.player_nutrition_plans enable row level security;
alter table public.player_meal_logs enable row level security;

drop policy if exists "nutrition_plans_select_own" on public.player_nutrition_plans;
create policy "nutrition_plans_select_own" on public.player_nutrition_plans for select using (auth.uid() = coach_id);
drop policy if exists "nutrition_plans_insert_own" on public.player_nutrition_plans;
create policy "nutrition_plans_insert_own" on public.player_nutrition_plans for insert with check (
  auth.uid() = coach_id and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
);
drop policy if exists "nutrition_plans_update_own" on public.player_nutrition_plans;
create policy "nutrition_plans_update_own" on public.player_nutrition_plans for update using (auth.uid() = coach_id) with check (
  auth.uid() = coach_id and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
);
drop policy if exists "nutrition_plans_delete_own" on public.player_nutrition_plans;
create policy "nutrition_plans_delete_own" on public.player_nutrition_plans for delete using (auth.uid() = coach_id);

drop policy if exists "meal_logs_select_own" on public.player_meal_logs;
create policy "meal_logs_select_own" on public.player_meal_logs for select using (auth.uid() = coach_id);
drop policy if exists "meal_logs_insert_own" on public.player_meal_logs;
create policy "meal_logs_insert_own" on public.player_meal_logs for insert with check (
  auth.uid() = coach_id and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
);
drop policy if exists "meal_logs_update_own" on public.player_meal_logs;
create policy "meal_logs_update_own" on public.player_meal_logs for update using (auth.uid() = coach_id) with check (
  auth.uid() = coach_id and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
);
drop policy if exists "meal_logs_delete_own" on public.player_meal_logs;
create policy "meal_logs_delete_own" on public.player_meal_logs for delete using (auth.uid() = coach_id);

-- Rollback: drop table if exists public.player_meal_logs; drop table if exists public.player_nutrition_plans;
