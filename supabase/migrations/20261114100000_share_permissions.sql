-- Share link permissions (2026-11-14): what the player may see and add, section by section
-- (lib/players/sharePermissions.ts). NULL = the defaults of the link's mode, so existing links
-- keep working exactly as before. Enforced by the share routes on the server.
-- Idempotent. NOT APPLIED automatically.
alter table public.player_shares add column if not exists permissions jsonb
  check (permissions is null or jsonb_typeof(permissions) = 'object');

-- Rollback: alter table public.player_shares drop column if exists permissions;
