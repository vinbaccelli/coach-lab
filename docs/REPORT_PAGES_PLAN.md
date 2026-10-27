# In-app report pages and full player profile: investigation and plan

Status: **investigation only**. No source, database or migration was changed. Google Docs saving stays exactly as it is until the new page is confirmed.

Legend: every claim cites a file (path:lines) or a table. **unverified** = not confirmed from code or from the live system (reason given).

## 0. What I could and could not check

- Code: read in this repository at `origin/main` (7711e7f).
- Supabase project `kgifsczgikzgeayueede`: **not reachable**. The Supabase tools returned "You do not have permission to perform this action" for `list_tables`, `execute_sql` (a read-only `pg_policies` select) and `get_project`. Nothing was written. Everything about tables, RLS and buckets below comes from `supabase/migrations/*.sql` and `lib/supabase/schema.sql`, so the **live state is unverified** (it may have drifted from the migrations).
- Google Cloud project and YouTube quota: not visible from code (only env var names). **unverified.**

## 1. Findings

### 1.1 Current player profile (task 1)

Routes
- `/players` → `app/players/page.tsx:1-14` → `components/players/PlayersHomeClient.tsx` (list, `fetch('/api/players')` at :30, create at :101).
- `/players/[id]` → `app/players/[id]/page.tsx:1-15` → `components/players/PlayerProfileClient.tsx` (729 lines, client component).
- `/players/[id]/sessions/[sessionId]` → `app/players/[id]/sessions/[sessionId]/page.tsx:1-50` (server component, reads `player_sessions`) → `components/players/PlayerSessionDetailClient.tsx` (139 lines). This is an existing read-only, in-app "report-like" page and a good precedent.

`PlayerProfileClient.tsx` sections (line ranges)
- Types and state: :1-60 (`Player`, `Entry`), :60-216 (load via `GET /api/players/[id]` then `GET /api/players/[id]/sessions`).
- Profile card (photo URL, date of birth, nationality, playing hand, coach notes, Save): :247-325.
- Technical Sheet (editable label/value rows): :326-440. Logic in `lib/players/technicalSheet.ts` (defaults: Age, Height, Weight, Dominant Hand, Backhand, Strengths, Weaknesses, Level).
- Analysis Sessions + "start session": :440-472 (`components/players/PlayerSessionTimeline.tsx`, 28 lines).
- **Reports** (Google Doc links, search, Technical/Match tabs, entry list): :474-650. The "match report" click is the entry `onClick` at about :581-592: it `window.open`s `entry.metadata.doc_url`, else the player's Match/Technical Doc.
- Statistics (measurements across entries): :651-729.

Data source
- `GET /api/players/[id]` (`app/api/players/[id]/route.ts:5-26`): `players` row (`select *`) and all `player_entries` for that player. `PATCH` (:28-56) updates profile fields, gated by `requireFeature(..., 'players')` (Pro, `lib/entitlements.ts:126`). Sessions: `app/api/players/[id]/sessions/route.ts`.
- `public.players` (`supabase/migrations/20260210120000_players_and_entries.sql:6-17`): id, coach_id, display_name, photo_url, date_of_birth, nationality, playing_hand, notes, created_at, updated_at. Added later: `google_doc_id`, `google_folder_id` (`20260626120000_player_google_doc.sql`), `google_match_doc_id`, `technical_sheet jsonb` (`20260704090000_player_docs_and_technical_sheet.sql:179-181`).
- `public.player_entries` (`20260210120000...sql:22-36`): id, coach_id, player_id, `category` check in ('technique','match'), folder_label, body_text, youtube_url, opponent_name, match_date, `screenshots jsonb` (array of URLs), source, `metadata jsonb`, created_at.
- `public.player_sessions` (`20260615140000_player_sessions.sql:68-92`, `20260616120000...sql`): title, coach_notes, analysis_type, stroke_type, trim, `video_ref jsonb`, `measurements jsonb`, `frame_markers jsonb`, `tool_config jsonb`, `artifacts jsonb`, `external_links jsonb`, status draft/saved.
- `public.coach_settings` (`20260704090000...sql:183-187`): `technical_sheet_template jsonb` (default rows for NEW players; `app/api/players/route.ts` applies it).
- What is stored per player: the profile fields above; a free-form label/value sheet; entries (text, YouTube URL, screenshot URLs, structured `metadata`); sessions; Doc ids.
- Not stored today: height/weight/UTR/diet/exercise plan as fields (they can only live as free-form Technical Sheet rows), report types beyond `technique`/`match`, any block structure.

### 1.2 "Save to Google Docs" flow, end to end (task 2)

UI triggers
- Match decoder: `lib/matchAnalysis/exportToDocs.ts:208-260` (`saveReportToPlayers`) posts to `POST /api/players/[id]/entries` with `category: 'match'`, `sections`.
- Manual match recorder: `components/ManualMatchRecorder.tsx` (button "Save & Export to Google Doc" at ~:1002; uploads image via `/api/google/upload-image` :387; passes `matchMetadata` :1060) → `components/shared/SaveReportModal.tsx:198,276` → `/api/players/[id]/entries`.
- Screenshot from the analysis page: `app/analysis/page.tsx:3480-3590` (`handleScreenshotSaveToPlayer`): `/api/google/upload-image` (:3505), then `/api/players/[id]/entries` (:3539), then `/api/players/[id]/google-doc` (:3560).
- Metrics/Generate report: `lib/export/exportService.ts:137,166-176` → `/api/google/report`.
- Standalone doc: `components/decoder/AiMatchDecoderClient.tsx:188` → `/api/google/create-document`.

API routes
- `app/api/players/[id]/entries/route.ts:39-154`: inserts the `player_entries` row first (:78-96), then, for `category === 'match'` only, writes the Match Analysis Doc (`ensurePlayerDoc` + `insertSessionAtTop`, :103-150). A Docs failure never fails the save; it is returned as `doc: {ok:false, reason}`. `maxDuration = 60`.
- `app/api/players/[id]/google-doc/route.ts:24-105`: appends one screenshot to the Technical Analysis Doc; gated by `docsExport` (Pro). Handles Drive-full as HTTP 507 (:93-101).
- `app/api/google/report/route.ts:42-...`: inserts a session block into the Technical doc and a `player_entries` row (`category: 'technique'`, `metadata.doc_url`, `metadata.measurements`).
- `app/api/google/upload-image/route.ts`: puts the image in the coach's own Drive (`AngleMotion/...`), anyone-with-link read so Docs can fetch it.
- `app/api/google/create-document/route.ts:29-48`: standalone doc; **sets `role: 'writer', type: 'anyone'` on the new doc** (:45-48), i.e. anyone with the link can edit it.

OAuth scopes and tokens
- Sign-in scopes: `documents` and `drive.file` (`lib/featureFlags.ts:50-51`; requested in `app/login/LoginClient.tsx:41-52`, `components/WorkspaceChrome.tsx:50-58`, `hooks/useAuth.ts`), with `access_type: offline, prompt: consent`. `ENABLE_GOOGLE_EXPORTS = true` (`lib/featureFlags.ts:48`).
- Token: the Supabase session's `provider_token`/`provider_refresh_token`; `lib/auth/routeSession.ts:12-80` refreshes it into `session.googleAccessToken` per request. A session created before the scopes were granted has no token (routes answer 403 "sign out and sign in again").

What is written into the Doc (`lib/google/playerDocs.ts`)
- Two Docs per player (header = player name): Technical Analysis (`players.google_doc_id`) and Match Analysis (`players.google_match_doc_id`) (:1-20).
- Each save = one session block inserted at the top, newest first (`insertSessionAtTop`, :327): "Session — <date & time>" Heading 2 (or an override), optional title, sections (heading h2/h3, bullet lines, one image each, notes), "Video" link, "Notes". Drive folder chain `AngleMotion/Players/<Name>` via `lib/google/drive.ts`.
- Link storage: Doc ids in `players.google_doc_id` / `google_match_doc_id` / `google_folder_id`; per-entry link in `player_entries.metadata.doc_url` (technique entries from `/api/google/report`); `player_sessions.external_links.googleDocUrl` (`lib/sessions/types.ts:47-50`). Match entries rely on the player's Match Doc id.

### 1.3 Where snapshots and YouTube links live (task 3)

- **Snapshots** (Metrics) are in-memory only: `lib/snapshots.ts:34-69` (`Snapshot`: time, label, column, drawingsJson, screenshot, skeleton, jointAngles…) and `DECISIONS.md:316-325` states reload discards the session by design; "Google Drive is the archive of record."
- What is persisted from them:
  - screenshots → image URL (Drive, else Supabase `player-assets` public URL: `app/analysis/page.tsx:3498-3530`) stored in `player_entries.screenshots` (array of URL strings);
  - measurements → `player_entries.metadata.measurements` (read by Statistics, `PlayerProfileClient.tsx:136-150`);
  - session artifacts/frame markers/measurements → `player_sessions` (`lib/sessions/types.ts`, bucket `player-assets`, path `{coach}/{player}/{session}/{artifact}` `lib/sessions/storagePaths.ts`).
- **YouTube links**: `player_entries.youtube_url` (single URL, set by `SaveReportModal` :205 and `/api/google/report`) and `player_sessions.video_ref` (`kind: 'youtube'`, `lib/sessions/types.ts:12-19`). A parser exists: `lib/youtubeId.ts` (`extractYoutubeVideoId`), embed component `components/YouTubeEmbed.tsx`.
- **Match reports**: the manual recorder stores structured data in `player_entries.metadata.manualMatch` (version 2: points, stats, notes: `components/ManualMatchRecorder.tsx:262-300`). The match decoder's section structure (headings/lines) is sent to Docs only (`entries/route.ts:128-135`) and is **not** stored in the database (the insert at :78-92 saves `body_text`, `screenshots`, `metadata` only).
- **Is it readable by a report page today?** Mostly yes for a read-only first page: dated entries, text, YouTube URL, screenshot URLs, measurements, manual-match data. **Gaps:** (a) match-decoder sections exist only in the Doc (the entry has a summary `body_text` and sometimes a full-report image); (b) one video and a flat image list per entry, no block order, no comments; (c) no report type beyond the two categories; (d) screenshot URLs are Google Drive "anyone with link" or public Supabase URLs, no expiry or access control.

### 1.4 YouTube upload flow (task 4)

- Flow: `hooks/useYouTubeConnection.ts` (status via `/api/youtube/status`), consent `app/api/youtube/connect` + `/connect/callback`, upload `app/api/youtube/upload-session/route.ts:36-123`: server mints a resumable session, the browser PUTs chunks straight to Google (`lib/export/youtubeResumableUpload.ts`). Gated by `requireFeature(..., 'youtube')` (Pro).
- Scope: only `https://www.googleapis.com/auth/youtube.upload` (`lib/youtube/oauth.ts:12`), a separate grant from the Docs/Drive sign-in because Google refuses both together (`lib/featureFlags.ts:11-38`).
- Google project: the OAuth client comes from env `YOUTUBE_OAUTH_CLIENT_ID/SECRET` (`lib/youtube/oauth.ts:49-54`). Which Google Cloud project owns it: **unverified** (not in code or docs).
- Token storage: `public.youtube_connections` (`supabase/migrations/20260728120000_youtube_connections.sql`): refresh token AES-256-GCM encrypted (`lib/crypto/secretBox.ts`, key `YOUTUBE_TOKEN_ENC_KEY`), RLS on with **zero policies** (service role only); access token minted per upload in `lib/youtube/connection.ts` (`getYouTubeAccessToken`).
- **`quotaExceeded` is not handled.** `grep -rn quotaExceeded` finds nothing in the app. At `upload-session/route.ts:99-113` any init failure with HTTP 401 or **403** is reported as "YouTube authorization was rejected — reconnect YouTube" with `needsConnect: true`. A quota error from the YouTube Data API is a 403 (reason `quotaExceeded`: from YouTube API docs, **unverified here**), so a project-wide quota exhaustion would show up as a reconnect prompt that cannot fix it. In the browser step, a 4xx PUT becomes "YouTube rejected the upload (403)…" (`youtubeResumableUpload.ts:113-117`). Drive-full is handled separately (`isGoogleQuotaError`, `lib/google/playerDocs.ts:75`), YouTube quota is not.
- Quota size: the Data API quota is per Google Cloud project (all coaches share it), and `videos.insert` costs 1,600 units against a default 10,000/day (from YouTube docs, **unverified**). `ARCHITECTURE.md:300` ("uses the user's own YouTube + Drive quota") is true for storage, but **not** for API quota: that claim should be checked.

### 1.5 Supabase (task 5): from migrations only, live state unverified

Tables relevant to profile/reports (all with RLS enabled in their migrations):
- `players`, `player_entries`, `player_sessions`, `coach_settings`: policies `select/insert/update/delete` where `auth.uid() = coach_id` (`20260210120000...sql:45-61`, `20260615140000...sql:100-107`, `20260704090000...sql:191-201`). No policy allows another user or anonymous read.
- `youtube_connections`: RLS on, no policies (service role only).
- `coach_profiles`, `coach_services`, `coach_links` (public coach pages, `app/coach/[slug]/page.tsx:44-52`) are **not in `supabase/migrations`**; they appear only in `lib/supabase/schema.sql` (so migrations and live DB may differ; **unverified**).
- Storage: bucket `player-assets`, created `public = true` (`20260615140000...sql:110-112`). `storage.objects` policies (:115-137) restrict select/insert/update/delete to authenticated users whose uid is the first path segment, but **because the bucket is public, any object URL is readable by anyone who has it** (that is how `getPublicUrl` works, and why the screenshot fallback works for Docs, `app/analysis/page.tsx:3512-3523`). No other bucket is created by a migration (`analysis-screenshots` is named in a comment as non-existent).
- Middleware lets `/coach/`, `/coaches`, `/r/`, `/pricing`… be public (`middleware.ts:19-34`); `/players/*` requires login.

### 1.6 The `impeccable` skill (task 6)

- Location: `.agents/skills/impeccable/SKILL.md` (v4.1.2), symlinked at `.claude/skills/impeccable`; lock entry in `skills-lock.json` (source `pbakaus/impeccable`). Not run (this step is read-only). In this session's skill list it did not appear, so availability here is **unverified**; it loads from the repo when a session starts in this folder.
- Invoke: `/impeccable <command> [target]` (or `$impeccable ...`). With no argument it shows a menu and runs nothing. First it runs `node .agents/skills/impeccable/scripts/context.mjs`; it reads `PRODUCT.md` and `DESIGN.md`, both present in this repo (PRODUCT.md: coach-to-player report/timeline is the product; DESIGN.md: tokens in `styles/tokens.css`).
- Commands that apply:
  - Profile page (an "Operate" surface): `shape` (plan UX first), `layout`, `typeset`, `adapt` (phone), `clarify` (labels, empty states), `harden` (errors, long text), `audit`, `polish`.
  - Report page (a "Read" surface): `shape`, then build, `layout`, `typeset`, `adapt`, `polish`, `audit`; `onboard` for the empty state.
- Fit: framework-neutral. One mismatch to manage: the app's UI is mostly **inline styles with CSS variables** (`var(--cl-*)` from `styles/tokens.css`, e.g. `PlayerProfileClient.tsx:236-325`), not Tailwind classes; Tailwind 3.4 is installed (`package.json`, `tailwind.config.js` says tokens are the single source of truth) but barely used for these screens. New screens should follow `DESIGN.md` tokens (and Tailwind classes only where already used) so they look like the rest of the app.

## 2. Proposed data model (smallest possible; task 7)

Principle: reuse `players` and `player_entries`; add tables only when a phase needs them. Anything marked **MIGRATION** is not needed for Phase 1.

Profile fields
- Existing columns, no change: `display_name`, `photo_url`, `date_of_birth` (age is derived), `nationality`, `playing_hand`, `notes`.
- Free-form facts (height, weight, UTR, diet, exercise plan, strengths…): keep using `players.technical_sheet jsonb` rows (`label`, `value`) and extend the defaults in `lib/players/technicalSheet.ts` (applies to new players only; no DB change). Group them in the UI by label (Body, Game, Training, Health) with a convention, not a schema.
- **MIGRATION (optional, later):** `players.profile jsonb` with sections `[{title, rows:[{label,value,kind}]}]`, only if grouped/typed fields (numbers, UTR history) are needed.

Report types
- Built in, no table: `technique` → "Technical analysis", `match` → "Match analysis" (the existing `player_entries.category`).
- **MIGRATION (Phase 3):** `report_types(id uuid pk, coach_id → auth.users, name text, slug text, sort_order int, archived bool)` with RLS `auth.uid() = coach_id`, and `player_entries.report_type_id uuid null → report_types`. The `category` check constraint stays as it is for existing rows.

Report entries by date
- Existing: one `player_entries` row = one entry, dated by `match_date` else `created_at`; label = `folder_label`; opponent = `opponent_name`.

Blocks (text, video embed, screenshot, comment)
- Phase 1: **derived at read time**, no storage: `body_text` → text block; `youtube_url` → video block; each `screenshots[]` URL → image block; `metadata.measurements` → measurement table; `metadata.manualMatch` → match stats block.
- **MIGRATION (Phase 4):** `report_blocks(id uuid pk, coach_id, entry_id → player_entries on delete cascade, position int, type text check in ('text','video','image','comment'), data jsonb, created_at, updated_at)` with the same RLS. `data` holds text, a video URL, or an image URL (never image bytes). Existing entries without blocks keep rendering from the derived blocks.

Sharing (not before Phase 6)
- **MIGRATION:** `report_shares(id, entry_id, token_hash, expires_at, revoked_at)` read only through a server route with the service role. No public-read RLS on the data tables.

## 3. Phased build plan (task 8)

Each phase is one small PR, testable on a phone, and none changes the current Docs flow.

1. **Phase 1 (proposed first): read-only report page.** Index of dates and a report view from data that already exists. No migration, no API change. Docs button/links stay; the in-app view is an additional link. Details in section 5.
2. **Phase 2: profile layout.** Full profile layout on the existing columns and `technical_sheet` (age from date of birth, grouped facts, new default rows for new players). Editing still goes through the existing `PATCH`.
3. **Phase 3: report types.** Two built-in types plus "new report type" (needs the `report_types` migration). Index filters by type.
4. **Phase 4: edit blocks in the app.** Add/reorder text, video, image and comment blocks on an entry (needs `report_blocks`). Image upload reuses `/api/google/upload-image` (Drive) with the Supabase fallback as today.
5. **Phase 5: save from the analysis tools into the in-app report** in addition to the Doc (both written; Docs unchanged). Match-decoder sections get stored (closes gap 1.3a).
6. **Phase 6: share link and PDF** (token table; no public bucket reads).
7. **Phase 7: retire the Google Doc buttons** only after you confirm the page on your phone and in real use; behind a flag, reversible.
- Independent small fix, any time: YouTube `quotaExceeded` handling in `upload-session/route.ts:99-113` and `youtubeResumableUpload.ts:113-117` (distinct message, no "reconnect" prompt).

## 4. Risks (task 9)

- **Mobile layout:** reports mix tall full-page captures (`imageObjectSizePt`, portrait), wide tables and embedded video. Needs a single-column reading layout, 16:9 video that scales, tables that scroll inside their own box, and testing at 390 px (`impeccable adapt`). The global COEP header `credentialless` (`next.config.js:55-61`) is applied to every page: the existing YouTube embed works on `/analysis`, but an iframe on the new route is **unverified** until tested on a phone.
- **Storage size:** keep image bytes out of jsonb; store URLs only. `body_text` is plain text today; set a length cap before block editing. Supabase free tier counts only if images move to Supabase (today Drive first; Supabase `player-assets` is the fallback). Drive-full already surfaces a clear error.
- **ADR conflict:** `DECISIONS.md:316-325` says the app stores nothing durable and "Google Drive is the archive of record". In-app reports persist text/blocks in Supabase. That needs an explicit decision from you (what is the record, and what happens if a coach disconnects Google).
- **Privacy of player data:** diet, weight, health and photos of players (possibly minors) become profile data. Needs a line in the privacy policy (`app/privacy/page.tsx`), no leakage into Sentry events (existing scrubbing: `lib/sentryConfig.ts`), and no player-identifying data in URLs. `player-assets` is a public bucket (objects readable by anyone with the URL), and `create-document` makes the Doc editable by anyone with the link (`app/api/google/create-document/route.ts:45-48`): both are existing exposures, not caused by this plan.
- **Sharing links:** PRODUCT.md notes there is no role system and players are records, not accounts. A share link must be a random token, expiring and revocable, resolved server-side; never a public RLS policy or the public bucket.
- **YouTube upload limit:** the project-wide daily API quota is shared by all coaches (1,600 units per upload; **unverified** numbers). `quotaExceeded` is shown as a reconnect prompt today (1.4). The report page itself only embeds existing links (no quota use), so embeds are unaffected.
- **Docs flow regression:** every phase must leave `entries`, `google-doc`, `report`, `upload-image` and `create-document` routes and the Doc links unchanged; Phase 5 adds a second write, so a failure in either must not fail the other (the existing `doc: {ok:false}` pattern).
- **Live schema drift:** migrations may not match the live database (`coach_profiles` is not in migrations; live access was denied). Before any migration phase, someone with project access should confirm the live tables and policies.

## 5. Phase 1, ready to approve

Goal: a coach opens a player, sees an index of report dates, and opens a clean in-app report built from data that already exists. Read-only.

Scope (new files and one small change)
- `app/players/[id]/reports/page.tsx`: index of dates (newest first, grouped by month; type chip "Technical analysis" / "Match analysis"; search reusing the profile's text filter).
- `app/players/[id]/reports/[entryId]/page.tsx`: the report view: title, date, opponent; blocks derived from the entry (text, embedded YouTube via `lib/youtubeId.ts`, screenshots, measurements table, manual-match stats from `metadata.manualMatch`); "Open Google Doc ↗" kept when `metadata.doc_url` or the player's Doc exists.
- `lib/reports/deriveBlocks.ts` (+ `tests/deriveBlocks.test.ts`): pure function entry → blocks; handles missing fields and legacy v1 match data.
- `components/reports/*` for the list and the blocks, using `styles/tokens.css`; designed with `impeccable shape` then `layout`/`typeset`/`adapt`.
- One change in `components/players/PlayerProfileClient.tsx` (Reports section, ~:474-650): add an "Open report" link on each entry card; the existing card click (opens the Doc) stays as it is.

Not in Phase 1: no migration, no API route changes, no writes, no change to the Docs/Drive/YouTube code, no profile redesign.

Data: `GET /api/players/[id]` already returns the player and all entries (`app/api/players/[id]/route.ts:5-26`); the page reads through the same session client, so RLS applies.

Acceptance (phone, 390 px)
- Index shows all existing entries with correct dates and types; empty state when none.
- A match report, a technical entry with screenshots and a YouTube link all render; long text and tall images do not overflow sideways.
- YouTube embed plays (or shows a plain link fallback if the iframe is blocked).
- Without the Pro plan the page stays readable (as the profile does today); no 5xx when fields are missing.
- The Google Doc link/click on the profile behaves exactly as before.
- `tsc` and `npm test` pass; unit tests cover `deriveBlocks`.

Decisions needed from you before Phase 1: (1) the ADR question in section 4 (is Supabase allowed to hold report text, as `player_entries.body_text` already does?); (2) the name of the page in the UI ("Reports"?); (3) whether the in-app view should open by default instead of the Doc (recommended: not yet, keep the Doc as default until you confirm).
