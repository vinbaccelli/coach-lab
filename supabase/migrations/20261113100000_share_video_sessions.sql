-- Player share link: videos uploaded by players to the coach's YouTube channel (2026-11-13).
-- One row per upload session STARTED (starting one spends YouTube quota), used only to enforce
-- daily limits per link and per coach. Written/read by the server (service role) only: RLS on, no policies.
-- Idempotent. NOT APPLIED automatically.
create table if not exists public.share_video_sessions (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.player_shares (id) on delete cascade,
  coach_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_share_video_sessions_share on public.share_video_sessions (share_id, created_at desc);
create index if not exists idx_share_video_sessions_coach on public.share_video_sessions (coach_id, created_at desc);
alter table public.share_video_sessions enable row level security;

-- Rollback: drop table public.share_video_sessions;
