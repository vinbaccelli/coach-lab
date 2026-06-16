-- Player-centric analysis sessions (StroMotion, AI Metrics, combined, recordings).

create table if not exists public.player_sessions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,

  title text not null,
  coach_notes text not null default '',

  analysis_type text not null check (analysis_type in (
    'stromotion', 'ai_metrics', 'combined', 'recording', 'other'
  )),
  stroke_type text,
  trim_start_sec numeric,
  trim_end_sec numeric,

  video_ref jsonb not null default '{}'::jsonb,
  measurements jsonb,
  frame_markers jsonb,
  tool_config jsonb not null default '{}'::jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  external_links jsonb not null default '{}'::jsonb,

  source text not null default 'analysis',
  created_at timestamptz not null default now()
);

create index if not exists idx_player_sessions_player on public.player_sessions (player_id);
create index if not exists idx_player_sessions_coach on public.player_sessions (coach_id);
create index if not exists idx_player_sessions_created on public.player_sessions (created_at desc);

alter table public.player_sessions enable row level security;

create policy "player_sessions_select_own" on public.player_sessions
  for select using (auth.uid() = coach_id);
create policy "player_sessions_insert_own" on public.player_sessions
  for insert with check (auth.uid() = coach_id);
create policy "player_sessions_update_own" on public.player_sessions
  for update using (auth.uid() = coach_id);
create policy "player_sessions_delete_own" on public.player_sessions
  for delete using (auth.uid() = coach_id);

-- Storage bucket for session artifacts (PNG, WebM, optional source video).
insert into storage.buckets (id, name, public)
values ('player-assets', 'player-assets', true)
on conflict (id) do nothing;

-- Coach-scoped paths: {coach_id}/{player_id}/{session_id}/{filename}
create policy "player_assets_select_own" on storage.objects
  for select using (
    bucket_id = 'player-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "player_assets_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'player-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "player_assets_update_own" on storage.objects
  for update using (
    bucket_id = 'player-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "player_assets_delete_own" on storage.objects
  for delete using (
    bucket_id = 'player-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
