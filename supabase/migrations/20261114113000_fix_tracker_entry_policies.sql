-- Fix (2026-11-14, KNOWN_ISSUES 079): the tracker-entry policies of 20261114090000_player_trackers.sql
-- compared the tracker's player with itself — inside a policy's subquery an unqualified column
-- resolves to the subquery's table first, so `t.player_id = player_id` was always true — and an entry
-- could be filed under another player than its tracker's. Re-create both policies with the row's own
-- columns written with the table name. Nothing else changes. Idempotent; correct whether or not the
-- trackers file was already run (it now carries the same corrected text).

drop policy if exists "tracker_entries_insert_own" on public.player_tracker_entries;
create policy "tracker_entries_insert_own" on public.player_tracker_entries
  for insert with check (
    auth.uid() = coach_id
    and exists (
      select 1 from public.player_trackers t
      where t.id = player_tracker_entries.tracker_id
        and t.player_id = player_tracker_entries.player_id
        and t.coach_id = auth.uid()
    )
  );

drop policy if exists "tracker_entries_update_own" on public.player_tracker_entries;
create policy "tracker_entries_update_own" on public.player_tracker_entries
  for update using (auth.uid() = coach_id)
  with check (
    auth.uid() = coach_id
    and exists (
      select 1 from public.player_trackers t
      where t.id = player_tracker_entries.tracker_id
        and t.player_id = player_tracker_entries.player_id
        and t.coach_id = auth.uid()
    )
  );
