-- Free self-serve trial: ONE hour of full access per account, started the first
-- time a signed-in coach (with no active subscription) hits a gated page. The
-- row's existence + its started_at age IS the entitlement — see middleware.ts.
-- One row per user, immutable once created, so the hour can't be reset.

create table if not exists public.trials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  started_at timestamptz not null default now()
);

alter table public.trials enable row level security;

-- A coach may read their own trial row (to gate access + show the countdown).
drop policy if exists "trials_select_own" on public.trials;
create policy "trials_select_own"
  on public.trials for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies: the ONLY way to start a trial is the
-- SECURITY DEFINER function below, which always stamps started_at = now() for
-- the calling user. This prevents a client from backdating the clock, starting
-- a trial for another account, or resetting an expired hour.

create or replace function public.start_trial()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  ts timestamptz;
begin
  insert into public.trials (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;
  select started_at into ts from public.trials where user_id = auth.uid();
  return ts;
end;
$$;

revoke all on function public.start_trial() from public;
grant execute on function public.start_trial() to authenticated;
