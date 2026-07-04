-- Two-doc player layout + in-app Technical Sheet.
--
-- google_match_doc_id: the player's Match Analysis Google Doc (match decoder /
-- manual match reports). google_doc_id (existing) remains the Technical
-- Analysis doc. technical_sheet: per-player editable rows shown in the profile.
-- coach_settings.technical_sheet_template: the coach's default rows applied to
-- NEW players (editing rows updates the template; existing players keep theirs).

alter table public.players
  add column if not exists google_match_doc_id text,
  add column if not exists technical_sheet jsonb;

create table if not exists public.coach_settings (
  coach_id uuid primary key references auth.users (id) on delete cascade,
  technical_sheet_template jsonb,
  updated_at timestamptz not null default now()
);

alter table public.coach_settings enable row level security;

drop policy if exists "coach_settings_select_own" on public.coach_settings;
create policy "coach_settings_select_own"
  on public.coach_settings for select using (auth.uid() = coach_id);

drop policy if exists "coach_settings_insert_own" on public.coach_settings;
create policy "coach_settings_insert_own"
  on public.coach_settings for insert with check (auth.uid() = coach_id);

drop policy if exists "coach_settings_update_own" on public.coach_settings;
create policy "coach_settings_update_own"
  on public.coach_settings for update using (auth.uid() = coach_id);
