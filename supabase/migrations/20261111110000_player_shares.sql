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

-- Rollback: drop table public.player_shares;
