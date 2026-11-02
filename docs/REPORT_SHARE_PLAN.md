# Share link for a player's profile and reports: design, security and build plan

Status: **plan only** (revision 2, 2026-11-02). No code changed, no migration applied, no Supabase, Vercel or
Drive setting touched. Revision 1 (per-report link, first name, 30-day expiry) is replaced by Vin's settled
decisions below. Companion document: `docs/SCALE_LIMITS.md` (limits, sources, scale model).

Every statement about current code carries a `file:line` from a file read for this document. Things I could
not verify say so. Model note: this was asked for Opus 5.5 at high effort and written by a Sonnet 5.5 session;
`docs/REPORT_SHARE_REVIEW.md` (R1) is the independent second look.

Markers: `[VIN TO CONFIRM]` = a text or choice only Vin can approve. `[DISAGREE]` = I disagree with a settled
decision; the decision is implemented as settled and the reason is given. Nothing was silently changed.

---

## 0. Recommendation in one paragraph

Build **one link per player** at `/share/<token>`: a read-only copy of the player profile with the reports inside.
The token is 256 random bits; the database keeps its **SHA-256 hash** (for lookup) and an **AES-256-GCM
encrypted copy** (so the coach can always re-copy it). Every profile field and every note is visible by default,
each with a coach switch ("Hide from shared page" / "Private"), after a first-time warning. The link never
expires; the coach can **revoke** or **replace** it and the old URL dies in one step. The page is served from a
short CDN cache with tag invalidation, images go through a **token-scoped redirect to Drive** (not a byte
proxy), and the "opened N times" counter writes at most once per 10 minutes per link, so the feature stays
inside free-tier limits. Link-holder contributions are a per-player switch, **off**, built in phases
(A read-only, B text comments the coach approves, C pictures). Prerequisite: Light gets the player database
(PR #130, and a one-line decision about the Drive upload gate, section 3a).
**The one thing the design cannot fix:** Vercel's Hobby plan forbids commercial use, so "no paid Vercel tier"
is probably unavailable regardless of the share link (section 7, `[DISAGREE]` 1).

---

## 1. Settled decisions, and how this plan treats each

| # | Decision (Vin) | Status in this plan |
|---|---|---|
| D1 | One link per player; opens the player profile page (info + all reports) at `/share/<token>` | Done: one row per player (`unique (player_id)`), section 4 |
| D2 | Full name on the page; **all profile fields visible by default**, each with a "hide from shared page" switch | Done; two `[DISAGREE]` notes (age instead of date of birth; sensitive row labels), section 4.5 |
| D3 | Notes shared by default; each with a "Private" switch; notes can come from recording with screenshots or stand alone | Done; **gaps found**: no standalone-note screen, no note field when saving a screenshot, **no way to edit or delete an entry**, section 3b |
| D4 | The link never expires; coach can revoke or replace; old link dies in one step | Done, section 4.7 |
| D5 | Always re-copyable: hash for lookup + encrypted copy for display | Done, key management and leak analysis in section 4.2 |
| D6 | Coach sees "opened N times, last opened on" | Done with a bucketed counter (no write per view), section 4.6 |
| D7 | Links keep working if the account stops paying; creating/replacing needs the existing `players` entitlement, checked in one place | Done, section 4.8 |
| D8 | Light gets the player database and the share link (separate PR) | Prerequisite P7 = PR #130. Share code depends on `players`, never on a plan id |
| D9 | "Made with AngleMotion" footer link is the only app navigation | Done, section 4.4 |
| D10 | First-time warning on link creation; draft terms line about minors | Draft copy in section 4.9, `[VIN TO CONFIRM]` |
| D11 | Contributions: per-player switch, off by default; A read-only, B text comments, C pictures and videos; add-only | Section 5 |
| D12 | Cost goal: no paid Vercel or Supabase tier at 1,000 coaches | Section 7 and `docs/SCALE_LIMITS.md`; `[DISAGREE]` 1 |
| D13 | Make `checks` a required check | **Not decided.** Repository setting, unchanged; waits for "yes, require checks" |

---

## 2. What exists today (verified by reading the code)

### 2a. How reports are read now, and why a share page must not reuse it

- The report pages (`app/players/[id]/reports/page.tsx:4-13`, `…/[entryId]/page.tsx:4-13`) are thin wrappers;
  data comes from `GET /api/players/[id]` (`components/reports/usePlayerReports.ts:25`), which returns the
  **entire** `players` row and **every** `player_entries` row with `select('*')` through the coach's session
  client (RLS) (`app/api/players/[id]/route.ts:13-32`; auth `lib/auth/routeSession.ts:46-50`).
- `middleware.ts:13-38` lists the public prefixes (`/`, `/pricing`, `/privacy`, `/terms`, `/coaches`, `/coach/`,
  `/r/`, `/affiliate/`, `/login`, `/api`); any other path sends a signed-out visitor to `/login`
  (`middleware.ts:63-68`). `/affiliate/<token>` is the existing precedent for a public, token-in-path, read-only,
  `noindex` page that reads with the service role (`app/affiliate/[token]/page.tsx:7-19`).
- Blocks are derived in the browser by the pure `lib/reports/deriveBlocks.ts` (`deriveBlocks` `:366`); the
  renderer is `components/reports/ReportBlocks.tsx:18-126` (client component, takes blocks as props).
- With `REPORTS_IN_APP = true` (`lib/featureFlags.ts:56`) reports live in `player_entries`; the Docs write is
  skipped (`app/api/players/[id]/entries/route.ts:105-107`).

### 2b. Fields: what a visitor could see if the coach's endpoint were reused, versus what the share page may show

| Source | Share page shows (default) | Never sent to a viewer |
|---|---|---|
| `players` | `display_name` (full name), `photo_url`, **age** (derived from `date_of_birth`), `nationality`, `playing_hand`, `notes` (profile coach notes), every `technical_sheet` row (label + value) | raw `date_of_birth`, `google_doc_id`, `google_match_doc_id`, `google_folder_id`, `coach_id`, `created_at`/`updated_at` |
| `player_entries` | `category`, `folder_label` (title), date, `opponent_name`, `body_text` (the note), `youtube_url`, `screenshots` (as token-scoped image links), `metadata.measurements`, `.sections`, `.manualMatch`, `.decoderReport` | `coach_id`, `source`, every other `metadata` key (for example a `doc_url`), Drive file ids |
| `player_sessions` | **not shown in v1** (they hold `coach_notes` and saved clips; question Q2) | everything |
| coach account | nothing (no email, name, Google data) | all |

### 2c. Screenshot sharing today

`app/api/google/upload-image/route.ts:125-127` sets `role: 'reader', type: 'anyone'` on each uploaded
screenshot (anyone with the link). Stored URL form `https://drive.google.com/uc?export=view&id=<id>`. If the Drive
upload fails the image is stored in the **public** Supabase bucket `player-assets` (guessable paths,
KNOWN_ISSUES 082). The report page already falls back stored URL → `lh3.googleusercontent.com/d/<id>=w1600` →
Supabase copy → "Image unavailable" (`components/reports/DriveImage.tsx:20-23`).

### 2d. Two traps the share page inherits unless handled

- `app/layout.tsx:68-80` renders `ReportProblemButton` and `InstallPrompt` (and recording providers) on **every**
  route, so a viewer would get coach-app UI.
- `lib/sentryConfig.ts:51-54` `scrubUrl` removes query strings but **not path segments**, so
  `/share/<token>` would reach Sentry. (`/affiliate/<token>` has the same gap today, KNOWN_ISSUES to add.)

---

## 3. Findings that change the build

### 3a. Light + saving to a player: the Drive upload gate (decision needed)

PR #130 moves `players` and `saveToPlayer` to the Light plan. But `POST /api/google/upload-image` is guarded by
**`docsExport`** (a Pro feature; `app/api/google/upload-image/route.ts:21`, pinned by `tests/apiGuards.test.ts:26`).
For a Light coach that call returns 403, and `lib/reports/saveScreenshot.ts:129-147` falls back to the **public**
Supabase `player-assets` bucket ("kept in AngleMotion — Drive unavailable"). Result: Light coaches' player
screenshots would all land in the public fallback bucket. **Recommended:** guard that route with `saveToPlayer`
(one line + its test) in PR #130. Waiting on Vin's yes.

### 3b. Notes: how they exist today, what is missing

| Where a note lives today | Written how | Editable/deletable? |
|---|---|---|
| `players.notes` (profile "Coach notes") | profile form, `PATCH /api/players/[id]` (`route.ts:35-63`) | edit yes |
| `players.technical_sheet` rows, e.g. Strengths, Diet, Goals | profile; `PATCH` | edit yes |
| `player_entries.body_text` on a technique entry | **screenshot save writes a fixed placeholder, "Screenshot from analysis session."** (`lib/reports/saveScreenshot.ts:154-156`); report/decoder exports pass their own text (`components/shared/SaveReportModal.tsx:213`) | **no**: the only entries route is `POST` (`app/api/players/[id]/entries/route.ts:41`; no `PATCH`/`DELETE` exists) |
| `player_sessions.coach_notes` | save-session modal (`components/sessions/SaveSessionModal.tsx:180`) | via the sessions routes |
| `metadata.manualMatch.gameNotes`, `sections[].notes` | match recorder / decoder output | no |

**Missing for D3:** (1) a note field when saving a screenshot (today it is a placeholder, so there is no way to
type a note "during recording with screenshots"); (2) a way to add a standalone note (no screen creates a
text-only entry; the schema already allows one: a `technique` entry with `body_text` and no screenshots renders
as a "Notes" block, `deriveBlocks.ts:320-325`); (3) **an entry edit/delete route**, which also has to carry the
**Private** switch; (4) a per-note Private flag. Recommended storage with **no migration**: `private: true` inside
the existing `metadata` jsonb of the entry, and `'notes'` in `hidden_fields` for the profile-level note.
Meaning of an entry's Private: its free text (`body_text`, `gameNotes`, section `notes`) is withheld; its
screenshots, measurements and generated report content are still shown.

---

## 4. Design

### 4.1 Route and page

- Public route `app/share/[token]/page.tsx` (server-rendered, `dynamic = 'force-dynamic'` at the page, caching
  handled by headers, 4.10). Add `/share/` to the public list in `middleware.ts:13-38`.
- It resolves the token, loads **explicit columns** with the service-role client (`lib/supabase/service.ts:70`),
  builds a projection on the server, and passes only the projection to a client component (props are public).
  It never calls `/api/players/[id]`, never uses `WorkspaceChrome`, `PlayerNav` or `/players/...` links.
- Content: header (photo, full name, age · nationality · hand), profile groups (the P2 layout grouped from
  `technical_sheet`, with hidden rows removed), then the reports (same `ReportBlocks` renderer, fed filtered
  blocks), then the footer: "Made with AngleMotion" linking to `/` (the only app link).
- Root-layout extras (`ReportProblemButton`, `InstallPrompt`) are suppressed on `/share/` by a `usePathname()`
  guard in those two components (not by editing `app/layout.tsx`, a hot global file).
- `DriveImage` gets a `shareMode` prop: no outer link to a raw Drive URL and no "Open image ↗" link
  (`DriveImage.tsx:33,41`).

### 4.2 Token, hash, encrypted copy, keys

- **Token:** `randomBytes(32).toString('base64url')` = 43 characters = 256 bits. Well-formed check
  `/^[A-Za-z0-9_-]{43}$/` before any database call.
- **Lookup:** `token_hash = sha256(token)` hex, `unique`. No salt or slow hash needed: the input has 256 bits.
- **Display copy:** `token_enc = base64(iv ‖ authTag ‖ ciphertext)` using **AES-256-GCM**, a fresh random 12-byte
  IV per encryption, `key_version`, and **AAD = player_id** (so a ciphertext copied to another row will not
  decrypt). Decryption happens only in the coach-authenticated `GET …/share` route, which answers
  `Cache-Control: no-store`, and the plaintext token is never logged.
- **Key management:** the key is a 32-byte random value in a Vercel **Sensitive** environment variable
  (`SHARE_TOKEN_KEY_V1`), never in the database or the repository. Rotation: add `SHARE_TOKEN_KEY_V2`, make it
  the current key for new encryptions; rows are re-encrypted lazily when the coach opens the share card, and
  `select count(*) … where key_version = 1` shows when V1 can be deleted. If the key is **lost**: existing links
  keep working (lookup uses the hash) but cannot be re-copied; the coach presses Replace. The server refuses to
  start the feature (404 on `/share/*`, share card hidden) if the key is missing or not 32 bytes.
- **What a database leak exposes:** hashes (useless: preimage resistance on 256-bit inputs) and ciphertexts
  (useless without the key). No link works from a database dump alone.
- **What a key leak exposes:** the key alone gives nothing (no ciphertexts). **Database dump + key** together
  reveal every token, hence every shared player. Recovery: rotate the key and bulk-replace all tokens (every
  link changes; coaches must resend). Reduce the chance: key only in Vercel Sensitive env, not in preview
  environments that a contributor can read, and rotated if anyone with access leaves.
- **Alternative I considered:** derive the token as `HMAC(key, player_id ‖ version)` and store only the hash:
  no ciphertext column, same exposure on dump + key. Not chosen because key rotation would change every link;
  the encrypted copy lets rotation preserve links. Settled decision D5 kept.

### 4.3 What the viewer sees: allow-list

The server builds a DTO from an allow-list; unknown fields and unknown block types are **dropped**, so a field or
block type added next year stays hidden until someone adds it on purpose. The DTO is the only thing serialized
to the browser (a test searches its JSON for canary strings, section 11).

### 4.4 Footer, headers

- Footer line: "Made with AngleMotion" → `/` (`rel="noopener"`, no referrer). No other link to the app, no login button.
- Headers on `/share/:path*` (`next.config.js`, beside the existing COOP/COEP block at `:59-62`):
  `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`
  for the browser, and a **separate** CDN directive for Vercel's cache (4.10). No `Disallow` in robots.txt (a
  disallowed URL can still be listed and the crawler never sees `noindex`). Same pattern as
  `app/affiliate/[token]/page.tsx:16-19`.
- Link previews (WhatsApp/iMessage unfurl): generic Open Graph text only, no name, no image.

### 4.5 Profile fields and the hide switches

- `hidden_fields text[]` on the share row. Keys: `photo`, `age`, `nationality`, `hand`, `notes`, and one key per
  technical-sheet row.
- **Hazard found:** technical-sheet rows are `{ label, value }` with no id (`lib/players/technicalSheet.ts:9-12`).
  If the hide key is the label, **renaming a hidden row makes it visible again**. Fix: give rows a stable `id`
  (jsonb, no migration; existing rows get ids on next save) and key by id. Until then the coach UI must keep the
  hidden state when a label is edited.
- `[DISAGREE]` 2 (date of birth): "all fields visible" would show a minor's exact date of birth. I implement
  **age only** and never send the raw date; no switch needed. If Vin wants the date shown, it is a one-line change.
- `[DISAGREE]` 3 (sensitive rows visible by default): P2 deliberately suggests rows named **Diet** and
  **Goals**, and coaches may add Health, Injury or Medical. Visible-by-default means those go live the moment the
  link exists. The settled rule is kept, but I recommend two cheap safeguards that do not change it: the
  first-time warning (4.9) lists the rows that would be public with their current values, and any row whose label
  matches diet / health / injury / medical / allerg* / medication starts **hidden** in the share settings with a
  visible "Show" switch. This is a default only; the coach decides.

### 4.6 "Opened N times, last opened on" without a write per view

Columns `opens_total`, `last_opened_at`. The page increments only when it is **rendered at the origin** (a CDN
cache hit never reaches it) and only if the last increment is more than 10 minutes old:

```sql
update public.player_shares
   set opens_total = opens_total + 1, last_opened_at = now()
 where id = $1 and (last_opened_at is null or last_opened_at < now() - interval '10 minutes');
```

So at most one write per link per 10 minutes, and zero writes for cached views. The coach card says "Opened N
times (counted at most once per 10 minutes)". A bot hammering one link cannot raise the write rate. Cost
effect: section 7.

### 4.7 Revoke and replace

- **Revoke:** `revoked_at = now()`; then `invalidateByTag('share:<playerId>')` so the CDN stops serving the cached
  page. Whether tag invalidation exists on the plan in use is **not published** in what I read
  (`docs/SCALE_LIMITS.md` section 2); without it the cached page lives at most its TTL (60 s).
- **Replace:** the same row gets a new `token_hash`, `token_enc`, `rotated_at`, and `revoked_at = null`. The old
  hash no longer exists, so the old URL is a normal "not found". The hide switches stay (they live on the row).
- **A viewer after revoke/replace** sees one neutral page: "This link is no longer available. Ask the coach for
  a new one." (same page and status for unknown, malformed, revoked, deleted: no oracle).
- **Image URLs:** page images are `/share/<token>/img/<n>` (4.10), so they die with the token (within the
  redirect cache time, 60 s). The underlying Drive files remain "anyone with link" (existing behaviour,
  `upload-image/route.ts:127`); a viewer who copied a Drive id keeps those files until the coach un-shares them in
  Drive. This is inherent to Drive sharing and is stated in the first-time warning.

### 4.8 Plan gating: one place

`lib/share/access.ts` exports `canManageShare(supabase, user)` which calls `requireFeature(..., 'players')`
(`lib/entitlements.server.ts:104`); it is the **only** gate, used by create, replace and settings routes.
**Revoke and read-status are never gated** (like `DELETE /api/players/[id]`, `route.ts:66-72`). The viewer
route never checks entitlement, so a cancelled coach's existing links keep working. The share code refers to
the `players` entitlement only, so it follows whatever plan holds it (Light after #130, Pro and Academy as now).
A test fails if any other plan id appears in `lib/share/` or `app/api/players/[id]/share/`.

### 4.9 First-time warning and draft terms line

On first creating a link (and after each Replace), a confirmation sheet:

> **Before you share.** Anyone with this link can see {Name}'s profile and reports, including everything you
> have not hidden. Right now that includes: {list of visible fields with their values, notes counted}.
> Hide anything private, or mark notes Private. Only send the link to people who should see it. For players under
> 18, make sure a parent or guardian is happy for you to share. If you stop sharing, press Revoke; files saved in
> your Google Drive stay viewable by anyone who already has their address until you change them in Drive.

Draft terms line `[VIN TO CONFIRM]`: "When you create a share link you decide who receives it and you confirm
that you have the permission of the player, or of a parent or guardian if the player is under 18, to share
this information." Whether to add it to `app/terms/page.tsx` and `app/privacy/page.tsx` waits on the
`[VIN TO CONFIRM]` items already open in PR #122.

### 4.10 Delivery and caching (recommended option B+G of section 7)

- **Page:** `CDN-Cache-Control: max-age=60` with `Vercel-Cache-Tag: share:<playerId>`, browser
  `Cache-Control: private, no-store` (Vercel documents CDN-specific cache headers and tag invalidation; see
  `docs/SCALE_LIMITS.md`). Cache key is the full URL, so each token is its own cache entry. Editing the profile
  or an entry also calls `invalidateByTag`, otherwise edits show within 60 s.
- **Images:** `app/share/[token]/img/[n]/route.ts`: validate token (hash lookup), take image `n` from the
  server-built list, **302** to `https://lh3.googleusercontent.com/d/<id>=w1600` (Drive) or the Supabase copy;
  `CDN-Cache-Control: max-age=60`. The browser downloads bytes from Google, not from Vercel. The upstream URL is
  reconstructed from a Drive id or restricted to the project's own Supabase storage host: never an arbitrary
  stored URL (no open redirect/SSRF).
- **Rate limiting:** malformed tokens are rejected before the database; a **Vercel Firewall rate-limit rule** on
  `/share/*` (Vin's dashboard setting; availability on the plan in use is not published in my sources); a
  best-effort in-process limiter as a second layer. Why it matters here: on Vercel Hobby an exceeded limit
  **pauses** the account (`docs/SCALE_LIMITS.md`), so a bot trying random tokens is a denial-of-service risk to
  the whole app, not just to the share route.

---

## 5. Link-holder contributions (switch per player, off by default)

### 5.1 The switch

`contrib_mode` on the share row: `'off'` (default) | `'comments'` | `'media'`. **In the first migration the
column exists but a check constraint allows only `'off'`** (`check (contrib_mode = 'off')`). Phase B's migration
widens it. Until then no code path can enable it, the UI has no control for it, and the API refuses any other
value. When it is added, turning it on needs a confirmation sheet that restates what visitors will be able to
do. Add-only means: viewer routes only `INSERT` rows into their own tables (`share_comments`, `share_uploads`,
`share_suggestions`); there is **no viewer path that updates or deletes anything**, and none that writes to
`players` or `player_entries`.

### 5.2 Phases

| Phase | What link holders can do | Hard limits | Coach tooling |
|---|---|---|---|
| **A** (first) | nothing: read-only | no write route exists at all | n/a |
| **B** text comments | add a comment with an optional display name (≤ 40 chars), body ≤ 1,000 chars, plain text | ≤ 3 per hour and ≤ 20 pending per link, 429 beyond; honeypot field; no URLs rendered as links; never auto-published | list "pending", **Approve** / **Hide** / **Delete**; badge on the profile; approved comments appear on the shared page |
| **C** pictures and videos | pictures: JPEG/PNG/WebP, ≤ 3 MB each, ≤ 5 pending per link and ≤ 50 MB per player; videos: **a link to YouTube only** (no video file upload) | private storage bucket (no public URLs), served to the coach by short-lived signed URLs; quarantined until approved | same moderation list with previews; a "Report" note in the warning |

Why no video upload: the Supabase Free plan allows 1 GB of storage and a 50 MB per-file cap
(`docs/SCALE_LIMITS.md`), the coach's Google token is not stored server-side (so link holders cannot write into
the coach's Drive), and video storage and egress would exhaust the free tier quickly. **Who pays:** the project's
Supabase storage; the per-player cap and a per-coach total cap keep it bounded, and the coach can delete uploads
to reclaim space.

### 5.3 Threat model for anonymous writes (B and C)

| Threat | Phase | Control |
|---|---|---|
| Spam / link flooding | B, C | per-link hourly and pending caps; honeypot; plain text; moderation queue; coach can switch the mode off, which also stops new writes server-side |
| Abuse / harassment of a minor posted into their profile | B, C | never auto-published; coach approves; no display of anything to other link holders until approved |
| Illegal content (images, links) | C | quarantine bucket, never public; coach-only preview; allow-listed types; size caps; no processing that renders untrusted content on our origin (images are served as `Content-Disposition: attachment` or from a signed URL on the storage host); legal exposure of hosting anonymous uploads about minors is **a question for Vin and a lawyer before C** |
| Stored XSS | B | text only, rendered as text nodes, never `dangerouslySetInnerHTML` |
| Storage cost attack | C | caps above; uploads refused when caps are reached; signed upload URLs issued only after token validation |
| Token holder impersonates a coach | B, C | contributions are labelled "From a link visitor", never styled as coach content |
| Identifying visitors | B, C | no IP or user agent stored; rate limiting uses counts per link, not per person |

### 5.4 If link holders should also edit profile fields: "suggested changes"

Not a direct edit. A `share_suggestions` table (`field_key`, proposed value ≤ 500 chars, `pending`) accepts an
anonymous suggestion for a **visible** field; the coach sees a diff and **Accept** applies it through the
existing `PATCH /api/players/[id]`; **Reject** discards. An anonymous direct edit of a player's record is hard to
undo and impossible to attribute, so this is the recommended shape if Vin wants it. Not part of A, B or C; a
phase D on request.

---

## 6. Threat model (updated)

| Question | Answer |
|---|---|
| What does a leaked link expose? | The shared profile and reports of one player as projected (4.3), until revoked/replaced. Not other players, not the coach's account. Because **all fields are visible by default**, the first-time warning and hide switches are the main control; `[DISAGREE]` 3 adds safe defaults. |
| Guessability | 256 bits. Guessing is infeasible; the realistic abuse is *cost* (random tokens burning invocations), handled by the rate rule. |
| Lifetime | Never expires (D4). Mitigation: revoke/replace, the "opened N times" signal, optional reminder in the card ("This link has been active for 6 months"). |
| Database exposure | Hash + ciphertext only; no usable link (4.2). |
| Search engines | `noindex` header + meta; no `Disallow`; not linked from anywhere. |
| Referrer leakage | `Referrer-Policy: no-referrer`; footer link `noopener`; images are token redirects. |
| Other players / coach data | Query pinned to `share.player_id` and `share.coach_id`; explicit column list; DTO allow-list. |
| Sentry/telemetry | scrub `/share/<token>` in `lib/sentryConfig.ts`; Vercel logs contain the path: treat as sensitive. |
| Link previews and scanners | GET is read-only; generic Open Graph; counter bucketed. |
| Anonymous writes | none in phase A; section 5.3 for B and C. |

Attack attempts and what stops each are listed in the review document (R1).

---

## 7. Cost design: no paid tier at 1,000 coaches (D12)

Facts (details and sources in `docs/SCALE_LIMITS.md`):

- Supabase runs on **Free** (organization "Anglemotion", plan `free`, read 2026-11-02).
- Vercel's plan is not readable from here. **Vercel Hobby is restricted to non-commercial personal use only;
  commercial use requires Pro or Enterprise** (fair use guidelines, via search result; the official page could not
  be fetched from this sandbox).
- Free limits: Supabase 500 MB database, 1 GB storage, 10 GB egress, 50 MB upload; Vercel Hobby 100 GB bandwidth,
  1,000,000 function invocations, 1,000,000 CDN requests.

### Options for serving the shared page and its images

| # | Option | Cost at 1,000 coaches (100k views/month) | Revoke strength | Effort | Risk |
|---|---|---|---|---|---|
| 1 | Dynamic page on every view, images direct from Drive | 100k invocations, ~10 GB bandwidth, ~1 GB Supabase egress; counter writes bucketed | Page: immediate. Images: Drive links keep working | Lowest | Origin hit by every bot request; Drive "too many views" throttling (threshold not published) |
| 2 **B+G (recommended)** | **CDN-cached page (60 s) + tag invalidation, images via token-scoped 302 to Drive/Supabase, bucketed counter** | ≈ 20–40k invocations, ≈ 6–10 GB bandwidth, ≈ 0.3 GB egress | Page: seconds (tag) or ≤ 60 s; images: ≤ 60 s; Drive files persist | Medium | Tag invalidation availability on the plan not published; cache lag if it fails |
| 3 | Cached page + **image proxy** through our functions | ≈ 200 GB image bandwidth: **2× the Hobby limit** | Strongest (bytes never leave our control; Drive id never exposed) | Medium | **Breaks the cost goal on its own**; function time per image |
| 4 | Cloudflare Free in front of Vercel | $0 | Purge API (free) | High (DNS move) | CDN terms restrict serving large non-HTML files without Cloudflare's paid services; commercial use on Free not stated in what I read |
| 5 | Static snapshot of the page in a public storage bucket | ~0 | **None** (public URL cannot be revoked reliably) | Medium | Rejected: contradicts `REPORT_PAGES_PLAN.md:144` (never the public bucket) |

**Recommendation: option 2.** It uses ~2–4% of Hobby invocations and ~6–10% of bandwidth at the modelled
traffic, keeps image bytes off Vercel, and revoke is fast enough that the remaining gap (Drive files) is the one
Drive sharing already has. Upgrade path: if Drive-id exposure is unacceptable later, switch the image route from
302 to a streaming proxy per deployment (option 3) once a paid plan exists.

### What the numbers say about the goal

- `[DISAGREE]` 1: **"no paid Vercel tier" probably cannot be met by anyone selling a subscription product on
  Hobby**: Vercel's terms restrict Hobby to non-commercial use. Vin must say which plan the project runs on. If it
  is Pro, the goal becomes "stay inside Pro's included usage" and is easy. If it is Hobby, the issue exists
  today and is independent of this feature. This is a Vin action, not a code change.
- With the mid-range assumptions the **app as a whole** passes Supabase Free's 500 MB database at ≈ 420 coaches
  and Hobby's 1M invocations well before 1,000 coaches, **with or without** the share link
  (`docs/SCALE_LIMITS.md` section 4). The share feature adds ≈ 2% to the database (a ~0.6 KB row per player) and the
  traffic in the table above.
- **Light gets the player database (D8):** this raises the number of coaches with players. The model already
  assumes every coach has players (worst case). Light can also create player *sessions* and clip artifacts (stored
  by AngleMotion; the `artifacts` route requires `players`, `app/api/sessions/[sessionId]/artifacts/route.ts:15`),
  which consume the 1 GB storage: no per-plan player or storage limit exists today (searched `app`, `lib`,
  `components`), so none was invented; recommend adding a per-coach storage cap before Light volume grows.

---

## 8. Schema: migration SQL (NOT applied)

First migration only. File to add in the build step: `supabase/migrations/20261102120000_player_shares.sql`
(the latest existing migration is `20261016120000_affiliates.sql`). Idempotent, RLS on.

```sql
-- Share link for a player's profile and reports: one row per player.
-- Only the SHA-256 hash is used for lookup; token_enc is an AES-256-GCM copy
-- (key in a server environment variable, never in the database) so the coach
-- can always re-copy the link. Coaches may READ their own row except the two
-- token columns; every write goes through server routes using the service role
-- after an ownership check. Idempotent: safe to re-run.

create table if not exists public.player_shares (
  id             uuid primary key default gen_random_uuid(),
  coach_id       uuid not null references auth.users (id) on delete cascade,
  player_id      uuid not null unique references public.players (id) on delete cascade,
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_enc      text not null check (length(token_enc) between 60 and 400),
  key_version    smallint not null default 1 check (key_version >= 1),
  hidden_fields  text[] not null default '{}' check (cardinality(hidden_fields) <= 80),
  -- Reserved for phases B and C. Only 'off' is allowed until a later migration widens it.
  contrib_mode   text not null default 'off' check (contrib_mode = 'off'),
  created_at     timestamptz not null default now(),
  rotated_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  opens_total    bigint not null default 0 check (opens_total >= 0),
  last_opened_at timestamptz
);

create index if not exists player_shares_coach_idx on public.player_shares (coach_id);

alter table public.player_shares enable row level security;

-- A coach may read their own row (status, hidden fields, counters).
drop policy if exists "player_shares_select_own" on public.player_shares;
create policy "player_shares_select_own" on public.player_shares
  for select to authenticated
  using (auth.uid() = coach_id);

-- Deliberately NO insert / update / delete policy for clients:
--   * the token and its hash must come from the server;
--   * the server must check that player_id belongs to this coach (an RLS
--     check on coach_id alone would not verify that);
--   * hide switches, revoke and replace also go through the server.
-- anon gets nothing: the public viewer page reads with the service role.

revoke all on public.player_shares from anon, authenticated;
-- Column-level read: a coach's browser can never select token_hash or token_enc.
grant select (id, coach_id, player_id, key_version, hidden_fields, contrib_mode,
              created_at, rotated_at, revoked_at, opens_total, last_opened_at)
  on public.player_shares to authenticated;
```

Notes:

- `player_id … unique … on delete cascade` enforces one link per player and removes the link in the same
  statement that deletes the player (`lib/players/deletePlayer.ts` step 4). `coach_id … on delete cascade` removes
  it with the account.
- Phase B/C migrations (separate files, **not** part of the first): widen `contrib_mode`, create
  `share_comments` (`share_id`, `author_label ≤ 40`, `body 1..1000`, `status pending|visible|hidden`),
  `share_uploads` (private bucket path, `bytes ≤ 3_000_000`, `status`), `share_suggestions` (phase D). All with RLS
  enabled, no client write policies, service-role inserts only.
- Entry privacy (`metadata.private`) and row ids in `technical_sheet` need **no** migration (jsonb).
- Live drift risk (`REPORT_PAGES_PLAN.md:147`): before applying, someone with project access confirms `players`
  and `player_entries` in the live database match the migration files.

**Applying it:** on a Supabase preview branch or copy first, with Vin's explicit go; then production. I will not
apply it from this plan.

**Rollback:** `drop table if exists public.player_shares;` (nothing else references it; this kills every share link).
Code rollback: flag `REPORT_SHARE_ENABLED = false` makes `/share/*` return 404 and hides the card; the table can
stay. Key rollback: remove `SHARE_TOKEN_KEY_V1` (the feature disables itself, 4.2).

---

## 9. Failure cases

| Case | Behaviour |
|---|---|
| **Player deleted** | cascade removes the share row with the player (8) → uniform "no longer available". Cache is tag-invalidated on delete (`deletePlayer` step), else ≤ 60 s. |
| **Revoked / replaced / unknown / malformed token** | same neutral page and status (404) for all. |
| **Drive image no longer shared / deleted / throttled** | the `/img/<n>` route cannot validate upstream (it only redirects), so the browser's image load fails; the page shows the existing fallback chain result: the Supabase copy if one exists, else "Image unavailable" **without** an external link (`shareMode`). The rest of the page renders. |
| **Account stops paying** | existing links keep working (D7); creating/replacing/hide-setting is refused (403 `plan_required`, same as other player writes); revoke still works. |
| **Account deleted** | `coach_id` cascade removes shares; the player rows go too. |
| **Coach disconnects Google** | the viewer path uses no Google session; images keep working only while the Drive files stay shared. New screenshots fall back to the public bucket (`saveScreenshot.ts:129-147`), which is why section 3a matters. |
| **Supabase project paused (Free: 1 week of inactivity)** | all share links 404/500 until restored; unlikely with active coaches, relevant before launch scale (`docs/SCALE_LIMITS.md`). |
| **Service-role key missing** | `createSupabaseServiceClient()` returns `null` (`lib/supabase/service.ts:70-103`): page returns the neutral 404 and logs once. Never an open page. |
| **Encryption key missing/rotated badly** | links keep working; "copy link" shows "Replace link to get a new one". |
| **Entry edited after sharing** | viewer sees the edit within the cache TTL (tag-invalidated on edit). |

---

## 10. Phone (390×844 and 844×390)

### Coach: the share card (on the profile page, after #127)

- A "Share" card in the profile: when no link exists, a primary **Create link** (44 px). After the first-time
  warning (4.9) and confirmation, the card shows the link in a read-only field and two buttons: **Copy link**
  (clipboard, "Copied" confirmation, select-and-copy fallback) and **Share…** (`navigator.share({ url })`, shown
  only where supported; the shared title is generic, no player name).
- Below: "Opened 3 times · last opened 2 Nov, 14:05"; **Replace link** and **Revoke** (one confirmation each,
  stating the old link stops working immediately); the field switches ("Hide from shared page") sit beside each
  profile row and a **Private** switch on each note; a **View as visitor** button that opens the page.
- Contributions switch: absent in phase A.
- Landscape: the card scrolls with the page; the action row is not clipped. Errors keep what the coach typed.

### Viewer: `/share/<token>`

- Single column, 16 px gutters, 15 px/1.6 body, no horizontal scroll; header with photo, full name,
  age · nationality · hand; grouped profile rows; reports as the existing block list (tables scroll inside their
  own box); the footer "Made with AngleMotion". No navigation, no install banner, no "Report a problem" button.
- Pinch-zoom works on images; tapping an image opens the token-scoped image URL in the same tab.

---

## 11. Tests plan (priority order)

1. **Token and crypto (highest):** 43 chars, charset, 1,000 distinct, 32 bytes; `hash` 64 hex deterministic;
   encrypt→decrypt round trip; a different AAD (another `player_id`) fails; a flipped byte fails (GCM tag);
   IV differs every time; wrong/missing key throws and disables the feature; key rotation (V1 row decrypts under V2
   config, re-encrypts to V2); malformed tokens rejected without a DB call (empty, short, long, unicode, `../`).
2. **Projection allow-list (canary test):** populate a player and entries with canary strings in `date_of_birth`,
   Google ids, `coach_id`, `metadata.doc_url`, an unknown metadata key, an unknown block type; `JSON.stringify(dto)`
   contains none. Raw date of birth never present (age only). Hidden field/row absent; **renamed hidden row stays
   hidden** (id-based); `private` entry withholds `body_text`, `gameNotes`, section `notes` but keeps images and
   measurements; unknown fields dropped.
3. **Access:** uniform response for unknown / malformed / revoked / deleted; replace kills the old token at once.
4. **Query scoping (fake store):** a share never returns another player's or coach's rows even if ids are forged.
5. **Plan gating:** the only gate is `requireFeature(...,'players')`; no plan id string in the share code; revoke
   works for a lapsed account; viewer route works for a lapsed account.
6. **Counter:** increments at most once per 10 minutes (SQL condition), never on CDN hits; no write path on
   malformed tokens.
7. **Wiring tests (repo convention):** share page does not import `WorkspaceChrome`/`PlayerNav`, no `select('*')`,
   noindex/referrer metadata; `/share/` in the middleware public list; the three headers in `next.config.js`;
   migration has `enable row level security`, no policy to `anon`, `contrib_mode = 'off'` check, no raw `token`
   column; `DriveImage` in `shareMode` has no raw-URL link; `ReportProblemButton`/`InstallPrompt` guard `/share/`;
   `scrubUrl` replaces `/share/<43 chars>`.
8. **Contributions (when built):** with `contrib_mode = 'off'` every write route returns 403 and writes nothing;
   the constraint rejects any other value in phase A; viewer routes never `update`/`delete`; caps; XSS strings
   rendered as text; uploads reject wrong type/size.
9. **Image redirect:** only allow-listed upstream hosts; out-of-range `n` → 404; revoked → 404.
10. **Playwright smoke (CI `smoke` job from #126):** malformed token → neutral 404 with `X-Robots-Tag`,
    `Referrer-Policy`, `Cache-Control`; no coach UI in the DOM. The full round trip (create → open in a private tab →
    revoke → 404) runs once by hand on a preview database.

Rule: a failing test means a code bug; tests are never weakened to pass.

---

## 12. Estimate: steps of at most 3 files each (source + its test counted)

| Step | What | Files | Migration? | Phone test |
|---|---|---|---|---|
| **P7** | Light gets players (**PR #130**, open) + upload-image gate decision (3a) | `lib/entitlements.ts` etc. (done) + `upload-image/route.ts`, `tests/apiGuards.test.ts` | no | Light account: create player, edit, save a screenshot (goes to Drive, not the public bucket) |
| S1 | Token + crypto + env-key guard | `lib/share/token.ts`, `tests/shareToken.test.ts` | no | none (pure) |
| S2 | Projection (allow-list, hidden fields, private notes, age) | `lib/share/view.ts`, `tests/shareView.test.ts` | no | none (pure) |
| S3 | **Migration** + flag | `supabase/migrations/20261102120000_player_shares.sql`, `lib/featureFlags.ts`, `tests/shareMigration.test.ts` | **YES** | none |
| S4 | Coach API: status/link (decrypt), create, replace, revoke, hide fields | `app/api/players/[id]/share/route.ts`, `lib/share/store.ts`, `tests/shareApi.test.ts` | needs table | none (API); covered by S9 |
| S5 | Entry edit/delete route (note text, `metadata.private`) | `app/api/players/[id]/entries/[entryId]/route.ts`, `lib/players/entryPatch.ts`, `tests/entryPatch.test.ts` | no | edit then delete a note on a real player |
| S6 | Viewer page (profile + reports, neutral 404, bucketed counter) | `app/share/[token]/page.tsx`, `components/share/SharedProfile.tsx`, `tests/shareViewer.test.ts` | needs table | open a link on the phone, both orientations |
| S7 | Public path + headers | `middleware.ts`, `next.config.js`, `tests/shareHeaders.test.ts` | no | check headers with the smoke test |
| S8 | Sentry token scrub (also `/affiliate/`) | `lib/sentryConfig.ts`, `tests/sentryConfig.test.ts` | no | none |
| S9 | Coach shell hidden on `/share/`; `shareMode` images | `components/ReportProblemButton.tsx`, `components/InstallPrompt.tsx`, `components/reports/DriveImage.tsx` | no | viewer page has no coach UI |
| S10 | Image redirect route | `app/share/[token]/img/[n]/route.ts`, `lib/share/images.ts`, `tests/shareImages.test.ts` | needs table | images load; after Revoke they stop |
| S11 | Coach UI: share card (create, copy, share sheet, warning, revoke/replace, counter) | `components/players/ShareLinkCard.tsx`, profile view integration, `tests/shareCard.test.ts` | no | the full coach flow on the phone (needs #127 merged) |
| S12 | Hide switches on profile rows + stable row ids | `lib/players/technicalSheet.ts`, profile view, `tests/technicalSheetIds.test.ts` | no | hide a row, rename it, check it stays hidden |
| S13 | Notes UI: standalone note, note field at screenshot save, Private toggle | `lib/reports/saveScreenshot.ts`, one modal/profile component, `tests/noteFlow.test.ts` | no | add a note with a screenshot and alone |
| S14 | Smoke + docs (KNOWN_ISSUES, LESSONS_LEARNED, privacy/terms text) | `smoke/share.spec.ts`, `docs/KNOWN_ISSUES.md`, privacy/terms page | no | none |
| **B1** | **Migration**: widen `contrib_mode`, `share_comments` | SQL, `tests/shareCommentsMigration.test.ts` | **YES** | none |
| B2 | Comment API (viewer POST with caps; coach list/approve/hide/delete) | 2 routes + `lib/share/comments.ts`; tests in a 4th step if needed | needs B1 | post a comment, approve it |
| B3 | UI: viewer form, coach moderation list, contributions switch + confirmation | 3 components | no | whole loop on the phone |
| **C1** | **Migration**: `share_uploads`, private bucket policy | SQL, test | **YES** | none |
| C2 | Signed upload URL + approve/delete API, caps | 2 routes + lib | needs C1 | upload a picture, see it quarantined |
| C3 | UI: picture upload, coach preview/approve, storage use | 3 components | no | whole loop; quota message |

Where Phases B and C stop: A (S1–S14) is a complete, shippable feature with no write path for visitors. B and C
are independent additions behind the reserved switch; C should not start until the legal question in 5.3 is
answered. A "suggested changes" phase D is only built if Vin asks.

---

## 13. Final organized plan (what to do, in order)

Legend: **V** = needs Vin's decision or approval · **M** = needs the migration · **Ph** = phone test.

1. **Now, Vin (no code):**
   - V: which Vercel plan the project runs on (Team settings → Billing) and the last 30 days of Usage; run the three
     read-only SQL queries in `docs/SCALE_LIMITS.md` section 5; allow `vercel.com` / `supabase.com` in the session's
     network settings so the limits can be verified from the official pages.
   - V: answer the questions in section 14.
2. **P7 / PR #130** (Light gets players). V: yes/no on the upload-image gate change (3a). Ph: Light account creates a
   player, edits, saves a screenshot. Merge before S11 (the share card must work for Light).
3. **Merge #127** (profile layout): the share card and hide switches live in that profile. Ph on the phone sheet.
4. **S1 → S2** (pure logic, tests only). No dependency on anything; can start immediately after step 1.
5. **S3 migration**. **V + M:** approve, apply to a preview database first, then production. Set
   `SHARE_TOKEN_KEY_V1` (V: Vin creates the Vercel Sensitive env var; a command to generate it is given in S3's PR).
6. **S4, S5** (APIs), then **S6, S7, S8, S9, S10** (viewer, headers, scrub, shell, images). The flag stays **off**
   until S6–S10 are all merged: without S7–S10 the page leaks the token to Sentry, shows coach UI, or exposes Drive ids.
7. **S11, S12, S13** (coach UI, hide switches, notes). Ph on the phone: the full coach flow. This is the first thing Vin
   can try end to end.
8. **S14** (smoke test, docs, privacy/terms). V: approve the terms line and resolve the `[VIN TO CONFIRM]` items
   (PR #122) before turning the flag on.
9. **Turn on the flag for one coach (Vin), watch a week.** V: add the Vercel Firewall rate-limit rule on `/share/*`
   first. Check `opens_total` and the Vercel usage page.
10. **Phase B** only after step 9 is calm: B1 (**V + M**), B2, B3. **Phase C**: only after the legal answer
    (5.3): C1 (**V + M**), C2, C3. Phase D on request.

What to do first: step 1 (it unblocks cost decisions), then step 2.

---

## 14. Questions for Vin and the `[DISAGREE]` list

**`[DISAGREE]`**

1. **Cost goal (D12).** Vercel Hobby forbids commercial use; if the project is on Hobby, "no paid Vercel tier" is not
   possible regardless of this feature. Please confirm the plan. Also: with mid assumptions the whole app, not the
   share link, passes Supabase Free's 500 MB near 420 coaches.
2. **Date of birth.** "All fields visible" would publish a minor's exact birth date. Implemented: **age only**.
3. **Sensitive rows visible by default.** Implemented as decided, plus the warning listing what is public; I
   recommend rows labelled diet / health / injury / medical / allergy / medication start hidden (default only).
4. (Soft) **Never expires + re-copyable.** Accepted as decided; the cost is that an old forwarded link stays live
   for years until revoked. The "active for N months" reminder in the card mitigates it.

**Questions**

- Q1 Vercel plan and the real numbers (section 13 step 1).
- Q2 Should `player_sessions` (coach notes, saved clips) appear on the shared page? v1 says no.
- Q3 Upload-image gate: change it to `saveToPlayer` in #130 so Light screenshots go to the coach's Drive? (3a)
- Q4 Phase C video: link-only (recommended) or a different storage plan?
- Q5 Per-coach storage cap for Light (no limit exists today).
- Q6 Terms/privacy lines about sharing and minors, after the #122 items.
- Q7 Who applies the migration, and is there a Supabase preview branch?
- Q8 Vercel Firewall rate-limit rule on `/share/*` (Vin's dashboard setting; plan availability not published).
- Q9 Make `checks` a required check on `main`? ("yes, require checks"; not changed.)
