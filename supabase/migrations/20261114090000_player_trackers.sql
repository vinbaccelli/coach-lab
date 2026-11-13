-- Structured progress trackers (2026-11-14): the tracking engine behind the Progress,
-- Biometrics and Fitness sections of a player profile. Sport-agnostic on purpose: presets
-- (Biometrics, Fitness exercises) live in code (lib/players/trackerPresets.ts) and only
-- produce a tracker definition; the database never knows about "squats" or "forehands".
--
--   player_trackers         one row per tracker of one player: name, category, mode
--                           ('single' = one value per measurement per entry, 'sets' = values
--                           per set) and `fields` (jsonb array of measurement definitions with
--                           STABLE ids, so renaming a field never breaks history).
--   player_tracker_entries  one dated record: `measurements` {fieldId: number} for 'single',
--                           `sets` [{fieldId: number}] for 'sets', an optional note, who added
--                           it (coach / share link) and a review status for player submissions.
--
-- Legacy `player_metrics` rows are COPIED into trackers (one tracker per name+unit, field kind
-- 'number' with the original unit, values unchanged). player_metrics itself is not modified or
-- dropped. The copy is idempotent (legacy_key / legacy_metric_id), so this file can be re-run.
--
-- RLS: owning coach only. Share-link (player) writes go through the server with the service
-- role, scoped to the one player of the link. Idempotent. NOT APPLIED automatically.

create table if not exists public.player_trackers (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 1000),
  category text not null default 'progress'
    check (category in ('progress', 'biometrics', 'fitness', 'technical', 'mental', 'nutrition', 'other')),
  preset text check (preset is null or length(preset) <= 60),
  mode text not null default 'single' check (mode in ('single', 'sets')),
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  position integer not null default 0,
  legacy_key text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_player_trackers_player on public.player_trackers (player_id, category, position);
create index if not exists idx_player_trackers_coach on public.player_trackers (coach_id);
create unique index if not exists uq_player_trackers_legacy on public.player_trackers (player_id, legacy_key) where legacy_key is not null;

create table if not exists public.player_tracker_entries (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  tracker_id uuid not null references public.player_trackers (id) on delete cascade,
  entry_date date not null,
  measurements jsonb not null default '{}'::jsonb check (jsonb_typeof(measurements) = 'object'),
  sets jsonb check (sets is null or jsonb_typeof(sets) = 'array'),
  note text not null default '' check (length(note) <= 2000),
  author text not null default 'coach' check (author in ('coach', 'link')),
  status text not null default 'approved' check (status in ('approved', 'submitted', 'needs_revision')),
  review_note text check (review_note is null or length(review_note) <= 1000),
  reviewed_at timestamptz,
  -- Idempotency key sent by the page: a double tap or a retried request cannot add the entry twice.
  client_ref uuid,
  legacy_metric_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tracker_entries_tracker on public.player_tracker_entries (tracker_id, entry_date desc);
create index if not exists idx_tracker_entries_player on public.player_tracker_entries (player_id, entry_date desc);
create index if not exists idx_tracker_entries_coach on public.player_tracker_entries (coach_id);
create index if not exists idx_tracker_entries_review on public.player_tracker_entries (coach_id, status) where status <> 'approved';
create unique index if not exists uq_tracker_entries_client_ref on public.player_tracker_entries (tracker_id, client_ref) where client_ref is not null;
create unique index if not exists uq_tracker_entries_legacy on public.player_tracker_entries (legacy_metric_id) where legacy_metric_id is not null;

alter table public.player_trackers enable row level security;
alter table public.player_tracker_entries enable row level security;

drop policy if exists "player_trackers_select_own" on public.player_trackers;
create policy "player_trackers_select_own" on public.player_trackers
  for select using (auth.uid() = coach_id);
drop policy if exists "player_trackers_insert_own" on public.player_trackers;
create policy "player_trackers_insert_own" on public.player_trackers
  for insert with check (
    auth.uid() = coach_id
    and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
  );
drop policy if exists "player_trackers_update_own" on public.player_trackers;
create policy "player_trackers_update_own" on public.player_trackers
  for update using (auth.uid() = coach_id)
  with check (
    auth.uid() = coach_id
    and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
  );
drop policy if exists "player_trackers_delete_own" on public.player_trackers;
create policy "player_trackers_delete_own" on public.player_trackers
  for delete using (auth.uid() = coach_id);

drop policy if exists "tracker_entries_select_own" on public.player_tracker_entries;
create policy "tracker_entries_select_own" on public.player_tracker_entries
  for select using (auth.uid() = coach_id);
drop policy if exists "tracker_entries_insert_own" on public.player_tracker_entries;
create policy "tracker_entries_insert_own" on public.player_tracker_entries
  for insert with check (
    auth.uid() = coach_id
    and exists (
      select 1 from public.player_trackers t
      where t.id = tracker_id and t.player_id = player_id and t.coach_id = auth.uid()
    )
  );
drop policy if exists "tracker_entries_update_own" on public.player_tracker_entries;
create policy "tracker_entries_update_own" on public.player_tracker_entries
  for update using (auth.uid() = coach_id)
  with check (
    auth.uid() = coach_id
    and exists (
      select 1 from public.player_trackers t
      where t.id = tracker_id and t.player_id = player_id and t.coach_id = auth.uid()
    )
  );
drop policy if exists "tracker_entries_delete_own" on public.player_tracker_entries;
create policy "tracker_entries_delete_own" on public.player_tracker_entries
  for delete using (auth.uid() = coach_id);

-- ── Copy legacy progress values (player_metrics) into trackers ─────────────────────────────
-- One tracker per player + name + unit; one entry per value. Nothing is converted.
do $$
begin
  if to_regclass('public.player_metrics') is null then
    return;
  end if;

  insert into public.player_trackers (coach_id, player_id, name, category, mode, fields, legacy_key, created_at, updated_at)
  select g.coach_id, g.player_id, g.name, 'progress', 'single',
         jsonb_build_array(jsonb_build_object('id', 'value', 'label', g.name, 'kind', 'number', 'unit', g.unit)),
         g.legacy_key, g.first_at, g.first_at
  from (
    select m.coach_id, m.player_id,
           (array_agg(btrim(m.name) order by m.created_at))[1] as name,
           (array_agg(btrim(m.unit) order by m.created_at))[1] as unit,
           lower(btrim(m.name)) || '|' || lower(btrim(m.unit)) as legacy_key,
           min(m.created_at) as first_at
    from public.player_metrics m
    group by m.coach_id, m.player_id, lower(btrim(m.name)) || '|' || lower(btrim(m.unit))
  ) g
  on conflict (player_id, legacy_key) where legacy_key is not null do nothing;

  insert into public.player_tracker_entries
    (coach_id, player_id, tracker_id, entry_date, measurements, note, author, status, legacy_metric_id, created_at, updated_at)
  select m.coach_id, m.player_id, t.id, m.recorded_on, jsonb_build_object('value', m.value),
         coalesce(m.note, ''), coalesce(m.author, 'coach'), 'approved', m.id, m.created_at, m.created_at
  from public.player_metrics m
  join public.player_trackers t
    on t.player_id = m.player_id
   and t.legacy_key = lower(btrim(m.name)) || '|' || lower(btrim(m.unit))
  on conflict (legacy_metric_id) where legacy_metric_id is not null do nothing;
end $$;

-- Rollback (drops trackers and their entries; player_metrics is untouched):
--   drop table if exists public.player_tracker_entries; drop table if exists public.player_trackers;
