-- Session lifecycle: draft (in progress) vs saved (complete report).

alter table public.player_sessions
  add column if not exists status text not null default 'saved'
  check (status in ('draft', 'saved'));

alter table public.player_sessions
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_player_sessions_status on public.player_sessions (player_id, status);

create or replace function public.player_sessions_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists player_sessions_updated_at on public.player_sessions;
create trigger player_sessions_updated_at
  before update on public.player_sessions
  for each row execute function public.player_sessions_set_updated_at();

-- Existing rows are treated as saved reports.
update public.player_sessions set status = 'saved' where status is null;
