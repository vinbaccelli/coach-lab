-- YouTube upload authorization — stored SEPARATELY from the Supabase Google
-- session, on purpose.
--
-- Google refuses to issue one grant covering both `youtube.upload` and
-- `drive.file` ("scopes that cannot be requested together"), and the Supabase
-- session carries exactly ONE Google token (provider_token / refresh), which the
-- Docs+Drive export owns. So YouTube gets its own consent, its own refresh token,
-- and its own home here — the two grants never meet.
--
-- The refresh token is a long-lived credential to a coach's YouTube channel.
-- It is stored ENCRYPTED (AES-256-GCM, key in YOUTUBE_TOKEN_ENC_KEY, which lives
-- in the environment and never in the database) so that a leaked backup or a
-- leaked service-role key is not by itself enough to post videos as a coach.

create table if not exists public.youtube_connections (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  -- AES-256-GCM payload, "iv:tag:ciphertext" base64 — see lib/crypto/secretBox.ts.
  refresh_token_enc text not null,
  connected_at      timestamptz not null default now(),
  last_used_at      timestamptz,
  -- Display only ("Connected as <channel>"); never used for authorization.
  channel_title     text
);

alter table public.youtube_connections enable row level security;

-- DELIBERATELY ZERO POLICIES.
--
-- With RLS enabled and no policy granting anything, the anon and authenticated
-- roles can neither read nor write this table — PostgREST returns empty for a
-- select and refuses a write, so the ciphertext is unreachable from a browser
-- even by someone who knows the table name. This is stricter than the usual
-- "select your own row" policy, and correct here: no client ever has a reason to
-- see this data. Whether a coach is connected is answered by a server route
-- returning a boolean, not by reading this table.
--
-- The ONLY access path is the service-role client (lib/supabase/service.ts),
-- server-side, exactly as the Stripe webhook does. Service role bypasses RLS by
-- design, so no policy is needed for it.
