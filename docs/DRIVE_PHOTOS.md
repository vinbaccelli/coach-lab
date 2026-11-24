# Player pictures in the coach's Google Drive — investigation and architecture

*2026-11-14 · player database PR I · status: designed, not built (needs one decision and one
coach consent per coach, below). Derived from the code cited.*

## What was asked

Pictures a player sends through the share link (timeline pictures, meal photos) should also land in
the coach's Google Drive, without exposing private Drive files publicly.

## How things work today (verified in the code)

* **Pictures** are stored by the server in the public Supabase bucket `player-assets`
  (`{coach}/{player}/timeline/…`, `{coach}/{player}/meals/…`, unguessable UUID paths;
  `app/api/share/[token]/route.ts`, `lib/players/mealPhotos.ts`). KNOWN_ISSUES 078 covers the
  "public URL" property.
* **Google Drive** access exists only inside the coach's signed-in browser session: Supabase keeps
  one Google grant (`provider_token` / `provider_refresh_token`, scope `drive.file`) in the session
  cookie and refreshes it per request (`lib/auth/routeSession.ts`). It is **not stored on the
  server**. Docs and Drive exports therefore run only while the coach is signed in
  (`lib/google/drive.ts`, `lib/google/playerDocs.ts`).
* **YouTube** solved the same problem for player uploads (#187): a separate consent with its own
  refresh token, stored **encrypted** (AES-256-GCM, key `YOUTUBE_TOKEN_ENC_KEY`) in
  `youtube_connections`, a table with RLS on and **zero policies**, read only by the service role
  (`supabase/migrations/20260728120000_youtube_connections.sql`, `lib/youtube/connection.ts`).

**Conclusion:** when a player uploads through the link, no coach is signed in, so the server has no
Drive credential. Copying to Drive needs a server-held Drive grant per coach, built like YouTube's.

## Proposed architecture

1. **`drive_connections`** (new table, same pattern as `youtube_connections`): `user_id` (coach),
   `refresh_token_enc` (encrypted with the existing secret box), `folder_id` (the coach's
   "AngleMotion" root the app created), `connected_at`, `last_used_at`. RLS on, zero policies.
2. **Connect once**: a "Save player pictures to my Drive" switch in the coach's settings runs a
   Google consent for `drive.file` with `access_type=offline` and stores the refresh token. The scope
   is the one the app already uses: `drive.file` only reaches files the app itself creates, never the
   rest of the coach's Drive.
3. **Copy on upload, never instead of it**: the share routes keep storing the picture as today (the
   player and coach pages display that copy), then hand a small job to a background step
   (`after()` in the route, or a queue table drained by a cron route) that uploads the same bytes
   into `AngleMotion/<Player>/Pictures` with the coach's grant. A Drive failure never fails the
   player's upload; the timeline item records `drive_file_id` or the last error.
4. **Never public**: files are created private (no `permissions.create` with `anyone`); the app
   stores the Drive file id, not a sharing link, and shows "Open in Drive" only to the signed-in
   coach.
5. **Revocation**: disconnecting deletes the stored token and calls Google's revoke endpoint;
   deleting a player keeps the coach's Drive files (they are the coach's), as Docs exports do today.

## What needs you

* **Decision**: copy every player picture to Drive automatically once a coach connects, or only
  when the coach taps "Save to Drive" on an item? (Recommended: automatic after connecting, with the
  switch per coach.)
* **Each coach** clicks "Connect" once (Google consent screen). No new Google Cloud credentials are
  needed: the existing OAuth client and its `drive.file` scope are reused.
* **Google verification**: `drive.file` is not a restricted scope, so no extra verification is
  expected; confirm on the Google Cloud console that the consent screen lists it (it already does
  for sign-in).

## Not done

No code for this yet: an OAuth consent flow cannot be exercised end to end in the local test stack,
and shipping it untested would break the "verified before deploy" rule. Estimated work once the
decision above is made: one migration, connect / callback / disconnect routes, the background copy
step, a settings switch, unit and database tests, and a check on a real Google account.
