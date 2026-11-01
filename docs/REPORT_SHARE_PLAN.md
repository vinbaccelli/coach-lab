# Read-only share link for player reports — design and security plan

Status: **plan only.** No code changed, no migration applied, no Supabase or Drive setting touched.
Written 2026-11-01 on branch `docs/report-share-plan`. Every claim about the current code carries a
`file:line` from a file read for this document; things I did not verify say so.

Note: this plan was requested for Opus 5.5 at high effort; the session that wrote it ran Sonnet 5.5.
Worth a second read of sections 2, 3 and 5 by whoever builds it.

---

## 0. Recommendation in one paragraph

Build **one link per report** (not per player): a random 256-bit token, stored only as a SHA-256 hash,
valid for 30 days by default (7/30/90 days, never longer), revocable at any time, resolved **server-side
through an allow-list projection** (never the coach's `/api/players/[id]` response). The viewer lands on
`/share/<token>`, a page with no coach navigation and no login, `noindex`, `no-referrer`, `no-store`.
Written notes are **off by default**; diet, health, UTR and every other profile field are **never** part of
a report link in v1. Images go through a token-scoped proxy so "revoke" really cuts access. The first
phone-testable slice is 5 small PRs; the migration is needed from step 2 on.

---

## 1. What exists today

### 1a. How the in-app report pages get their data

- `app/players/[id]/reports/page.tsx:4-13` and `app/players/[id]/reports/[entryId]/page.tsx:4-13` are thin
  server components: `WorkspaceChrome` + a client component. **No data fetching and no auth check in them.**
- The client hook fetches `GET /api/players/${playerId}` with `cache: 'no-store'`
  (`components/reports/usePlayerReports.ts:25`) and keeps `display_name` and every entry
  (`usePlayerReports.ts:41-42`).
- That route authenticates with `getRouteSession()` → `401` if signed out
  (`app/api/players/[id]/route.ts:13-14`), then reads through the **coach's session client**, so RLS
  (`auth.uid() = coach_id`) is the data boundary: `players` with `select('*')` (`route.ts:17-20`) and
  `player_entries` with `select('*')` (`route.ts:24-28`). `getRouteSession` verifies the JWT with
  `getUser()` (`lib/auth/routeSession.ts:46-50`).
- Signed-out visitors never reach those pages: `middleware.ts:13-38` lists the public prefixes
  (`/`, `/pricing`, `/privacy`, `/terms`, `/coaches`, `/coach/`, `/r/`, `/affiliate/`, `/login`, `/api`, …);
  anything else goes to `/login` (`middleware.ts:63-68`). With no Supabase env vars it fails open
  (`middleware.ts:43`).
- `REPORTS_IN_APP = true` (`lib/featureFlags.ts:56`): reports are read from Supabase `player_entries`;
  the Google Doc write is skipped (`app/api/players/[id]/entries/route.ts:105-107`, `!REPORTS_IN_APP`).
- Blocks are derived in the browser from entries by the pure `lib/reports/deriveBlocks.ts`
  (`deriveBlocks` at `:366`). Technique entries of the same local day merge into one report; each match
  entry is its own (`buildReport`, `:374-`). The grouping is **computed, not stored** — there is no
  report id.

### 1b. How Drive screenshots are shared today

- `app/api/google/upload-image/route.ts:125-127` sets `permissions.create({ role: 'reader', type: 'anyone' })`
  on every uploaded screenshot, i.e. "anyone with the link can view". Stored as
  `https://drive.google.com/uc?export=view&id=<fileId>`.
- If the Drive upload fails, the image is stored in the **public** Supabase bucket `player-assets` at a
  path `<uid>/screenshots/<timestamp>.png` (`deriveBlocks.ts:142` recognises these URLs).
- The browser loads those URLs straight from Google (`components/reports/DriveImage.tsx:20-23`: stored URL →
  `lh3.googleusercontent.com/d/<id>=w1600` → Supabase fallback → "Image unavailable" tile).
  Revoking an app-level share link therefore does **not** revoke a Drive URL a viewer already saw (see 2).

### 1c. Every field a viewer would see **today** if we naively reused the coach page

The coach page *downloads* the full rows, even where it does not render them. A share page must be built
so none of the right-hand column can reach the viewer's browser.

| Source | Rendered on the coach report page | Downloaded but not rendered (must NOT reach a viewer) |
|---|---|---|
| `players` row | player name (`PlayerNav`, `ReportViewClient.tsx:33`; `PlayerNav.tsx:44`) | `photo_url`, `date_of_birth`, `nationality`, `playing_hand`, `notes`, `google_doc_id`, `google_match_doc_id`, `google_folder_id`, `technical_sheet` (age, height, weight, strengths, weaknesses, level, and any coach rows such as diet/health/UTR), `coach_id` |
| `player_entries` row | `category` (chip, `ReportViewClient.tsx:72`), `folder_label` (title, `:74`), date, `opponent_name` (`:78`), `body_text` (technique notes; or the match report text), `youtube_url` (video block), `screenshots` (images), `metadata.measurements`, `metadata.sections`, `metadata.manualMatch`, `metadata.decoderReport` (`deriveBlocks.ts:168-269`) | `coach_id`, `source`, every other `metadata` key (e.g. a `doc_url`, `deriveBlocks` ignores unknown keys but they are in the payload), `created_at` of unrelated entries, **all other entries of the player** |
| Block text a coach typed | technique `Notes` block (`deriveBlocks.ts:320-325`), manual-match `gameNotes` (`:78`, `:221`), section `notes` (`ReportBlocks.tsx:109`) | — (these *are* rendered; they are the "coach notes" of point 4) |

Blocks the page can render: `text`, `video`, `screenshots`, `measurements`, `sections`, `manualMatch`,
`decoderReport` (`ReportBlocks.tsx:30-122`).

Two more things a share page inherits unless handled:

- `app/layout.tsx:68-80` (root layout) renders `ServiceWorkerRegistration`, `InstallPrompt`,
  `PersistentWebcamOverlay`, `FloatingRecordingIndicator` and **`ReportProblemButton`** on **every** route.
  A viewer would see a "report a problem" button (it hooks Sentry feedback) and an install banner.
- `lib/sentryConfig.ts:51-54` `scrubUrl` strips query strings and fragments but **not path segments**, so a
  `/share/<token>` URL would be sent to Sentry in `request.url`/transactions. (The existing
  `/affiliate/<token>` page has the same gap; recorded as a known issue, see 11.)

---

## 2. Threat model

| Question | Answer / design response |
|---|---|
| What does a leaked link expose? | Exactly the entries the coach attached to that link, in the allow-listed form (3d), until expiry or revoke. Not other reports, not the profile, not the coach's account. Players are often juniors, so even "a report" is personal data. |
| Guessability | Token = 32 bytes from `crypto.randomBytes` (256 bits, 43 base64url chars). Online guessing is infeasible; rate limiting protects cost/abuse, not secrecy. Malformed tokens are rejected before any DB query. |
| Lifetime | `expires_at` is mandatory, default 30 days, hard cap 90 days (DB `check`, 5). No "never" in v1. |
| Revoking | `revoked_at` set → next request is refused (the page is `no-store`, the DB is checked on every request, no CDN/ISR cache). Coach can also *replace* a link. |
| Search engines | `X-Robots-Tag: noindex, nofollow, noarchive` header **and** `<meta robots>`; the link appears nowhere on the site. We deliberately do **not** `Disallow` it in robots.txt (a disallowed URL can still be listed, and a crawler that cannot fetch the page never sees `noindex`). Same pattern as `app/affiliate/[token]/page.tsx:16-19`. |
| Referrer leakage | `Referrer-Policy: no-referrer` header + `metadata.referrer` (as `affiliate/[token]/page.tsx:19`); `DriveImage` already sends `referrerPolicy="no-referrer"` (`:49`); outgoing links use `rel="noopener noreferrer"`. A token in the path would otherwise travel in `Referer` to YouTube/Drive. |
| Other players / coach data | No. Server query is pinned to `share.coach_id` **and** `share.player_id` **and** `id = any(share.entry_ids)`; it selects an explicit column list, never `*`. |
| Link previews / scanners | WhatsApp/iMessage/email scanners GET the URL. The page is read-only and a GET never changes state (view counter aside). Open-Graph tags are generic ("A report from your coach") — no name or image in the preview. |
| Forwarding | By design possible: anyone with the link sees it. That is the product; the controls are expiry, revoke and the per-link include toggles. |
| Revoke vs. things the viewer already fetched | **Gap, real:** Drive images are "anyone with link" (1b) and unlisted YouTube URLs work for anyone. If the page used those URLs directly, revoking the share link would not kill them (and the page HTML exposes Drive file ids). Mitigation: serve images through a token-scoped proxy (3f). YouTube stays a link/embed; if the coach needs the video private they set it Private on YouTube (then the embed shows "unavailable", 6). |
| Token in logs/telemetry | Sentry: scrub `/share/<token>` (3g). Vercel request logs contain the path — treat logs as sensitive; tokens are hashed at rest so a database leak does not yield working links. |
| Database leak | Only `token_hash` is stored; SHA-256 is sufficient because the input has 256 bits of entropy (no password-style salting/slow hash needed). |
| Coach-side abuse | Cap active links per coach (default 50); only the coach who owns the player can create; creation is plan-gated (6d). |

---

## 3. Design

### 3a. Granularity: one link per **report** (recommended)

- A report = the set of entries the in-app list already shows as one row (a match entry; or a day's technique
  entries). The link stores `entry_ids` (snapshot, ≤50).
- **Why per report, not per player:** smallest blast radius (a parent gets the match they care about, not the
  whole history); a per-player link would silently expose every *future* report, including one the coach writes
  at 11 pm with a sensitive note; revoking a per-report link does not disturb other recipients; the existing
  report grouping is already per report in the UI so "Share" sits naturally on the report page.
- Cost: a coach sharing five reports makes five links. A "share these N reports" multi-select is a v2 on top
  of the same table (`entry_ids` already holds a list).
- Behaviour to state plainly in the UI: the link shows the *current* content of those entries (edits
  propagate), but entries added to the report later are **not** included, and deleted entries disappear.

### 3b. Token

- `generateShareToken()`: `randomBytes(32).toString('base64url')` → 43 chars `[A-Za-z0-9_-]`.
- `hashShareToken(t)`: `sha256` hex (64 chars). Only the hash is stored (`token_hash`, unique).
- `isWellFormedToken(t)`: `/^[A-Za-z0-9_-]{43}$/`; anything else → generic "not available" without a DB call.
- The raw token exists only in the creation response. **Consequence:** the coach can copy/share it right after
  creating it, but cannot re-copy it later (it is not recoverable). The report page then shows "Link active until
  28 Nov · viewed 3 times" with **Replace link** and **Revoke**. (Alternative — encrypting the token so it can be
  re-shown — adds a key to manage; not recommended for v1. Question Q5.)

### 3c. Route, headers, no coach UI

- New public route `app/share/[token]/page.tsx` (`dynamic = 'force-dynamic'`), server-rendered. Adds `/share/`
  to the public list in `middleware.ts:13-38`.
- It must **not** use `WorkspaceChrome`, `PlayerNav`, `/players/...` links or the back-link in
  `ReportViewClient.tsx:83`. It has its own minimal layout: title block + `ReportBlocks` (the same renderer, fed
  already-filtered blocks as props) + a footer line "Shared by your coach · link expires 28 Nov".
- Headers on `/share/:path*` via `next.config.js` (alongside the existing COOP/COEP block at `:59-62`):
  `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`.
  COEP `credentialless` stays; same-origin proxied images are unaffected, the YouTube iframe already uses the
  `credentialless` attribute (`VideoBlock.tsx:17-19`) — still needs one phone check on this route (the
  `REPORT_PAGES_PLAN.md` risk list says the embed under COEP is unverified on new routes).
- Root-layout extras are hidden on `/share/`: a `usePathname()` guard in `ReportProblemButton` and `InstallPrompt`
  (and no recording providers matter: they render nothing until used). Changing `app/layout.tsx` itself is
  avoided on purpose (hot, global file).
- `DriveImage` gets a `shareMode` prop: no outer `<a href=rawDriveUrl>` and no "Open image ↗" link
  (`DriveImage.tsx:33,41`) — both would hand the viewer a raw Drive URL.

### 3d. What the viewer sees — allow-list per block

The server builds a DTO; unknown fields and unknown block types are **dropped** (allow-list, so a block type
added next year stays hidden until someone adds it on purpose).

| Item | Default | Notes |
|---|---|---|
| Report title (`folder_label`), kind chip, date, opponent | shown | They are the report's identity. |
| Player name | **first name only** (Q3) | `display_name` up to the first space. No photo, DOB, nationality, hand, profile notes, technical sheet, Drive ids, coach id/email. |
| `video` | shown, coach can switch off | Link + embed. |
| `screenshots` | shown, coach can switch off | via proxy (3f). |
| `measurements` | shown, coach can switch off | |
| `manualMatch` / `decoderReport` / `sections` (the match report itself) | shown | Without them a match report is empty. |
| **Written notes** (technique `Notes` text block, manual-match `gameNotes`, section `notes`) | **hidden**, coach opts in with "Include my written notes" | These are the free-text fields where a coach might write health, behaviour or family details. Old match rows whose only content is `body_text` (`id: 'body'`, `deriveBlocks.ts:351-354`) are the report itself and stay. |
| **Diet, health, UTR, weight, height, strengths/weaknesses, goals** (the technical sheet / profile) | **never in v1** | They are not in reports, so they cannot leak unless the share code reads `players.technical_sheet` — it must not. A v2 opt-in could offer *individual rows*, each unchecked, with a warning for rows whose label looks like diet/health/injury. Recommended to skip until a coach asks. |
| `coach_id`, `source`, other `metadata` keys, other entries | never | |

How the coach opts in (phone): in the share sheet (7a) a short "Include" list with toggles — Video, Screenshots,
Measurements on; "My written notes" off with the helper "May contain private details. Off unless you turn it on."
Choices are stored on the link (`include` jsonb) so the viewer page and the coach's summary agree.

### 3e. Expiry and revoke

- Expiry choice 7 / 30 (default) / 90 days; `expires_at` mandatory; DB `check` caps it at 90 days.
- Revoke = set `revoked_at`; instant; kept for audit (no hard delete in v1). **Replace link** = revoke + create.
- `last_viewed_at` + `view_count` (updated best-effort by the page, at most one write per minute per link) so the
  coach can see "viewed 3 times" and notice an unexpected spike. No IP or user agent stored.

### 3f. Image proxy (so revoke really revokes)

- `app/share/[token]/img/[n]/route.ts` re-resolves the token, takes image number `n` from the **server-built**
  list for that link, and streams it. The page HTML contains `/share/<token>/img/3`, never a Drive id.
- SSRF-safe: the server reconstructs the upstream URL from a Drive file id (`https://lh3.googleusercontent.com/d/<id>=w1600`,
  same shape as `DriveImage.tsx:22`) or accepts only `…/storage/v1/object/public/player-assets/…` on the project's
  own Supabase host. It never fetches an arbitrary stored URL.
- `Cache-Control: private, no-store`, size cap, 8 s timeout, uniform 404 on any failure.
- Cost: images pass through our Vercel function (bandwidth/time). Acceptable at this scale; if it ever hurts,
  Drive direct links can be switched on per deployment. (Q7.)
- Not solved by the proxy: the Drive file itself stays "anyone with link" (existing behaviour,
  `upload-image/route.ts:127`; recorded as a known defect since P2). A later change to private Drive files +
  server-side fetch with the coach's token is out of scope here.

### 3g. Hardening list

- **Rate limiting:** the repo has no limiter (search for rate-limit code found nothing outside an unrelated
  `lib/poseWorker.ts`). Serverless instances do not share memory, so an in-process limiter is only a speed bump.
  Recommended: (1) a **Vercel Firewall rate-limit rule** on `/share/*` (e.g. 60 req/min/IP) — a dashboard
  setting that only Vin can make, and plan availability should be checked (I did not verify it); (2) a
  best-effort in-process limiter in code as a second layer; (3) the proof that matters is the 256-bit token.
- **Uniform failure:** unknown, malformed, revoked, expired and "player deleted" all return the same page
  and status (404) so the response does not tell an attacker which tokens ever existed.
- **Sentry:** extend `scrubUrl`/`scrubString` to replace `/share/<43 chars>` with `/share/[token]`
  (`lib/sentryConfig.ts:51-54`); add the same for `/affiliate/` while there.
- **Management API:** `POST/GET /api/players/[id]/shares`, `DELETE …/shares/[shareId]` use `getRouteSession()`
  and verify through the **session (RLS) client** that the player and every entry belong to the coach and to that
  player, *then* write with the service client (`lib/supabase/service.ts:70`), because clients get no insert policy
  (5).
- **GET never mutates** beyond the view counter.
- **Feature flag** `REPORT_SHARE_ENABLED` in `lib/featureFlags.ts`, default off until phone-tested; with it off
  the sheet is hidden and `/share/*` returns 404.

---

## 4. Flow summary

```
Coach (phone)                      Server                               Viewer
Share → options → Create  ─POST→   verify ownership (RLS client)
                                   token=random(32); store sha256(token)
        ←{ url, expires_at }─      (token never stored, shown once)
Copy link / Share… sheet  ───────────────────────────────────────────→  opens /share/<token>
                                   isWellFormed? → hash → lookup by hash
                                   ok & not revoked & not expired & player exists?
                                   → load allow-listed columns → project → render
                                   else → same 404 page for every failure
```

---

## 5. Schema — migration SQL (**NOT applied**)

File to add in the build step: `supabase/migrations/20261101120000_report_shares.sql` (the latest existing
migration is `20261016120000_affiliates.sql`; follow its style: idempotent, RLS on).

```sql
-- Read-only share links for player reports.
-- A row = one link to a set of a player's entries. Only the SHA-256 hash of the
-- token is stored. Clients may READ their own rows (not the hash); every write
-- goes through server routes using the service role after an ownership check.
-- Idempotent: safe to re-run.

create table if not exists public.report_shares (
  id             uuid primary key default gen_random_uuid(),
  coach_id       uuid not null references auth.users (id) on delete cascade,
  player_id      uuid not null references public.players (id) on delete cascade,
  entry_ids      uuid[] not null check (cardinality(entry_ids) between 1 and 50),
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  include        jsonb not null
                 default '{"video":true,"screenshots":true,"measurements":true,"notes":false}'::jsonb
                 check (jsonb_typeof(include) = 'object'),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  last_viewed_at timestamptz,
  view_count     integer not null default 0 check (view_count >= 0),
  constraint report_shares_expiry_range
    check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);

create index if not exists report_shares_player_idx on public.report_shares (player_id);
create index if not exists report_shares_coach_idx  on public.report_shares (coach_id);

alter table public.report_shares enable row level security;

-- A coach may read their own links (to list them and show "active until …").
drop policy if exists "report_shares_select_own" on public.report_shares;
create policy "report_shares_select_own" on public.report_shares
  for select to authenticated
  using (auth.uid() = coach_id);

-- Deliberately NO insert / update / delete policy for clients:
--   * insert: the token hash must come from the server, and the server must check
--     that player_id and every entry id belong to this coach (an RLS check on
--     coach_id alone would not verify that).
--   * update / delete: revoke and replace go through the server too.
-- anon gets nothing at all: the public viewer page reads with the service role.

revoke all on public.report_shares from anon, authenticated;
-- Column-level read: the coach's browser can never select token_hash.
grant select (id, coach_id, player_id, entry_ids, include, created_at, expires_at,
              revoked_at, last_viewed_at, view_count)
  on public.report_shares to authenticated;
```

Notes:

- `player_id … on delete cascade`: deleting a player (`lib/players/deletePlayer.ts`, step 4 "delete the database
  rows") removes every link in the same statement; deleting the coach's account removes them via `coach_id`.
- `entry_ids` is an array, so entries have no foreign key; deleted entries simply stop matching, and a link whose
  entries are all gone shows the uniform 404 (6c).
- **Not** a public RLS policy and **not** the public `player-assets` bucket (`REPORT_PAGES_PLAN.md:144`).
- Live drift risk (`REPORT_PAGES_PLAN.md:147`): before applying, someone with project access confirms `players`
  and `player_entries` in the live database match the migration files.

**Applying it:** on a Supabase **preview branch / non-production copy first**, with Vin's explicit go; then
production. I will not apply it from this plan.

**Rollback:**

```sql
drop table if exists public.report_shares;   -- kills every share link; nothing else references it
```

Code rollback: set `REPORT_SHARE_ENABLED = false` (links return 404 immediately, the table can stay), or revert
the PRs. The table is additive, so leaving it in place after a code rollback is harmless.

---

## 6. Failure cases

| Case | Behaviour |
|---|---|
| **Player deleted** | `on delete cascade` removes the share rows with the player (5). The link then resolves to "not found" → uniform 404. Also guard in code: the page re-checks the player row exists. Drive/Storage cleanup afterwards is best-effort (`deletePlayer.ts`, steps 5-6) and irrelevant to link death. I did not verify how Drive treats a *trashed* "anyone with link" file for outside viewers. |
| **Expired** | `expires_at <= now()` → uniform 404 page with plain wording: "This link is no longer available. Ask the coach for a new one." The same text for every dead state so nothing is revealed. |
| **Revoked** | Same as expired. |
| **Malformed / unknown token** | Same page, no DB query for malformed. |
| **A Drive image is no longer shared / deleted / quota-throttled** | Proxy tries the id forms like `DriveImage` does (stored → `lh3` → Supabase copy), then returns 404; the page shows the existing "Image unavailable" tile **without** the "Open image ↗" link (`shareMode`). The rest of the report renders. |
| **YouTube video private/removed** | Embed shows YouTube's own "unavailable"; the "Watch on YouTube" link remains (`VideoBlock.tsx:37-44`). Coach guidance: unlisted is fine, private breaks the embed. |
| **Coach's plan lapsed** | Today a downgraded coach keeps read access to saved players (`middleware.ts:79-81`), delete is never plan-gated (`app/api/players/[id]/route.ts:66-72`), writes are (`requireFeature(...,'players')`, `:38`). Same philosophy here: **creating/replacing links requires the Pro `players` feature** (`lib/entitlements.ts:126`); **revoking is never gated**; **existing links keep working until their expiry** (≤90 days) so a parent is not cut off by a billing event. Q6 offers the stricter alternative. |
| **Coach signs out / changes Google account** | Irrelevant: the viewer path uses no Google session. Images that depend on the coach's Drive keep working only while the files stay shared. |
| **Service-role key missing** | `createSupabaseServiceClient()` returns `null` (`lib/supabase/service.ts:70-103`); the page must treat that as the uniform 404 and log once, never as an open page. |
| **Entry edited after sharing** | Viewer sees the edited content (link points at entries, not a copy). Said in the sheet. |

---

## 7. Phone

### 7a. Coach: share flow (390×844 and 844×390)

- On the report page (`/players/[id]/reports/[entryId]`) a 44px **Share** action beside the title. Hidden when the
  flag is off or the plan lacks `players`.
- Tap → bottom sheet (full-height scroll in landscape, sticky action row, safe-area padding):
  1. Title "Share this report" + one sentence: "Anyone with the link can view this report. No account needed."
  2. **Include** toggles: Video · Screenshots · Measurements (on) · My written notes (off, helper text).
  3. **Link expires**: 7 days / 30 days / 90 days (segmented, 44px).
  4. Primary **Create link**.
  5. After creating: read-only field with the link; **Copy link** (primary; `navigator.clipboard`, with a
     select-and-copy fallback; "Copied" confirmation) and **Share…** (calls `navigator.share({ url, title })`;
     shown only where supported — on desktop only Copy appears). The title passed to the share sheet is generic
     ("Training report"), no player name.
  6. If a link already exists: "Active until 28 Nov · viewed 3 times" with **Replace link** and **Revoke**
     (Revoke asks for one confirmation; both explain that the old link stops working immediately).
- Error states keep what the coach set (no lost toggles) and say what happened ("Couldn't create the link.
  Check your connection and try again.").

### 7b. Viewer: `/share/<token>` at 390×844

- Single column, 16px gutters, 15px/1.6 body, reading measure from `reportStyles` (`measure`), no horizontal
  scroll; screenshots full-width; tables inside their own scroll box (the risk noted in `REPORT_PAGES_PLAN.md:140`).
- Header: "Report for {first name}", report title, date · vs opponent. Footer: "Shared by your coach · link
  expires {date}". No nav, no login button, no install banner, no "report a problem" button, no links into the app.
  Branding line is a decision (Q9).
- Light/dark follow the existing tokens; images pinch-zoom; the video block keeps the 16:9 box and the
  always-visible "Watch on YouTube" link.
- Verified later with Playwright at 390×844 and 844×390 plus a real-phone check by Vin (CLAUDE.md: the user confirms
  on devices).

---

## 8. Test plan (priority order; node:test, same style as `tests/deriveBlocks.test.ts`, `tests/deletePlayer.test.ts`)

1. **Token (highest):** 43 chars, charset `[A-Za-z0-9_-]`, 1,000 generated tokens all distinct, decodes to 32 bytes;
   `hash(token)` is 64 lowercase hex, deterministic, different from the token; the stored value is never the token;
   `isWellFormedToken` rejects empty, short, long, wrong charset, whitespace, `../`, unicode, 10 kB strings.
2. **Access decision (pure function):** ok / expired (at the exact boundary → expired) / revoked / revoked beats
   not-expired / missing player → "not found"; unknown, expired, revoked, deleted produce **identical** response
   body and status.
3. **Projection allow-list (canary test):** build a fully populated player and entries with canary strings in
   `date_of_birth`, `notes`, `technical_sheet` (diet/health), `google_doc_id`, `coach_id`, `metadata.doc_url`, an
   unknown metadata key and an unknown block type; assert `JSON.stringify(view)` contains none of them. Notes
   toggle off strips the technique `Notes` block, `gameNotes` and section `notes`; on keeps them; each include
   toggle removes exactly its block; first-name rule.
4. **Query scoping (fake store):** a link for player A never returns an entry of player B (or another coach) even if
   its id is in `entry_ids`; a deleted entry is skipped; all-entries-gone → not found.
5. **Wiring tests (read source, repo convention):** share page does not import `WorkspaceChrome`/`PlayerNav`, has
   no `select('*')`, exports `robots` noindex and `referrer: 'no-referrer'`; `middleware.ts` lists `/share/`;
   `next.config.js` has the three headers for `/share/:path*`; migration contains `enable row level security`, no
   policy `to anon`/`public`, `token_hash` and no raw `token` column; `DriveImage` in `shareMode` renders no
   raw-URL link; `ReportProblemButton`/`InstallPrompt` guard `/share/`.
6. **Sentry scrub:** `scrubUrl('https://x/share/<43 chars>')` → `/share/[token]`; also inside breadcrumbs/free text.
7. **Management API (handler-level, injected deps):** 401 signed out; another coach's player → 404 (nothing
   written); entry from another player in `entry_ids` → 400; plan lapsed → creation refused, **revoke still works**;
   expiry clamped to 90 days; cap of 50 active links; response contains the URL once and never the hash.
8. **Proxy:** only allow-listed upstream hosts; image index out of range → 404; revoked link → 404; no `Location`
   or upstream headers forwarded.
9. **Playwright smoke (CI `smoke` job from #126):** malformed token → 404 page with `X-Robots-Tag`,
   `Referrer-Policy`, `Cache-Control: no-store`; no coach UI in the DOM. The real round trip (create → open
   incognito → revoke → 404) runs on a Supabase preview branch, once, by hand.

The existing rule applies throughout: a failing test means a code bug; never weaken it.

---

## 9. Estimate — steps of at most 3 files each

Each step is its own draft PR, behind `REPORT_SHARE_ENABLED` (off), with `npx tsc --noEmit`, `npm test`, and a
runtime check. Sizes: S ≈ small, M ≈ medium.

| # | Step | Files (≤3) | Migration? |
|---|---|---|---|
| 1 | Pure logic + tests: token generate/hash/validate, access decision, projection | `lib/reports/shareToken.ts`, `lib/reports/shareView.ts`, `tests/reportShare.test.ts` | no (S) |
| 2 | **Migration** + flag | `supabase/migrations/20261101120000_report_shares.sql`, `lib/featureFlags.ts`, `tests/reportShareMigration.test.ts` | **YES — Vin applies/approves, preview DB first (S)** |
| 3 | Coach API: create / list / revoke | `app/api/players/[id]/shares/route.ts`, `app/api/players/[id]/shares/[shareId]/route.ts`, `lib/reports/shareStore.ts` (+ extend `tests/reportShare.test.ts`) | needs table (M) |
| 4 | Viewer page + public path | `app/share/[token]/page.tsx`, `components/share/SharedReport.tsx`, `middleware.ts` | needs table (M) |
| 5 | Hardening: headers, Sentry token scrub | `next.config.js`, `lib/sentryConfig.ts`, `tests/sentryConfig.test.ts` | no (S) |
| 6 | Hide coach shell on `/share/`; `shareMode` in images | `components/ReportProblemButton.tsx`, `components/InstallPrompt.tsx`, `components/reports/DriveImage.tsx` | no (S) |
| 7 | Image proxy | `app/share/[token]/img/[n]/route.ts`, `lib/reports/shareImages.ts`, `tests/shareImages.test.ts` | needs table (M) |
| 8 | Coach UI: Share sheet (Copy + native share) | `components/reports/ShareReportSheet.tsx`, `components/reports/ReportViewClient.tsx`, `tests/shareSheet.test.ts` | no, but needs 3 (M) |
| 9 | Smoke + docs: Playwright check, `KNOWN_ISSUES`/`LESSONS_LEARNED`, privacy-policy line, user manual | `smoke/share.spec.ts`, `docs/KNOWN_ISSUES.md`, `app/privacy/page.tsx` | no (S) |

Order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Steps 1, 5, 6 can be built before the migration is approved. Do not
turn the flag on until 5, 6 and 7 are merged: without them the page leaks the token to Sentry, shows the coach
shell, and exposes Drive ids. Step 8 is the first thing Vin can try on a phone; steps 4-7 ship dark.

---

## 10. Questions for Vin (decisions only you can make)

Each has my default; reply "defaults" to accept all.

1. **Q1 Granularity:** one link per **report** (default) or per player?
2. **Q2 Expiry:** default 30 days, choices 7/30/90, no "never" (default). OK, or do you want "never"?
3. **Q3 Name on the page:** first name only (default), full name, or no name?
4. **Q4 Notes and video:** written notes off by default and covering technique notes + game notes + section notes
   (default); video on by default (default). Agree?
5. **Q5 Re-copying a link:** show once, then Replace/Revoke (default), or store it encrypted so the coach can copy
   it again later (more to maintain)?
6. **Q6 Lapsed plan:** existing links keep working until expiry; only creating/replacing needs Pro (default), or
   kill all links when the plan lapses?
7. **Q7 Images:** through our token-scoped proxy so revoke really works (default; uses some bandwidth), or direct
   Drive links (simpler, but a revoked viewer keeps any Drive URL they already saw)?
8. **Q8 Juniors and consent:** how do you want parent/guardian consent handled for under-18 players, and may I
   add one line about share links to the privacy policy and terms (waits on the `[VIN TO CONFIRM]` items in #122)?
   The coach is the one choosing to share; the text should say so.
9. **Q9 Branding:** a small "Made with AngleMotion" line linking to the landing page on the viewer page
   (acquisition) or nothing (cleanest, no coach/app navigation as asked)? Default: nothing in v1.
10. **Q10 Rate limit rule:** are you willing to add the Vercel Firewall rate-limit rule on `/share/*`
    (a dashboard setting only you can change; I haven't checked whether your plan includes it)?
11. **Q11 Migration:** who applies it, and do you have a Supabase preview branch / staging database I should target
    first? I will not touch any database without your explicit go.
12. **Q12 Scope of v1:** reports only (default), or should the profile summary (selected rows, each opt-in) be
    shareable too? Diet/health are the reason I'd say no for now.

---

## 11. Known issues found while reading (to be recorded in `docs/KNOWN_ISSUES.md` in step 9, not fixed here)

- `lib/sentryConfig.ts:51-54` does not scrub path tokens: `/affiliate/<view_token>` URLs already reach Sentry
  events unredacted. Severity: low-medium (affiliate pages are read-only, no player data). Fix: same scrub as 3g.
- `app/layout.tsx:68-80` renders coach-app UI (`ReportProblemButton`, `InstallPrompt`) on every public page,
  including `/affiliate/<token>` and `/pricing`. Severity: low (cosmetic on the affiliate page; relevant for share).
- `app/api/players/[id]/route.ts:17-32` returns whole `players`/`player_entries` rows (`select('*')`) to the
  browser; fine for the owner behind RLS, but it is why a share page must never reuse it.
