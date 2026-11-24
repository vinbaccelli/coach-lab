-- Blueprint (the eBook's stroke definitions): one nullable jsonb column on the existing player row.
-- It holds the player's chosen variants and the technical-sheet checks marked against the Blueprint
-- (lib/players/blueprint.ts). Additive only: no data is deleted or rewritten, and the table's existing
-- owner-only policies apply.
alter table public.players
  add column if not exists blueprint jsonb;
