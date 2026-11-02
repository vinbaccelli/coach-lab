# Review of the share-link plan (R1)

Reviewed 2026-11-02: `docs/REPORT_SHARE_PLAN.md` (revision 3) and `docs/SCALE_LIMITS.md` in full, plus the PR #128
conversation and the code the plan points at. **Nothing in the plan, the code or any database/setting was changed by
this review.** One caveat up front: this review was written by the same Sonnet 5.5 session that wrote the plan, so it
is not independent of the author; I tried to attack the plan from the viewer's and the malicious coach's side and to
verify claims in code, but a second reviewer would still add value. Per instruction, the sensitive-rows
`[DISAGREE]` is not re-argued (decided: no hidden defaults).

Finding ids: **B** = Blocker, **F** = Should fix, **N** = Nice to have. (Plan build steps are named S1–S14 in the plan; they are written as "plan S7" etc. where mentioned.)

Severity scale: **Blocker** (fix in the plan before any share code is written) · **Should fix** (fix before the flag
goes on) · **Nice to have**.

## Verdict: **ready after these fixes** (2 Blockers, 9 Should fix, 5 Nice to have)

The structure is sound (hash + encrypted copy, service-role read behind explicit columns, no visitor write path in
phase A, isolated reversible migration). The two Blockers are things the plan does not mention at all: link and script
content that a *coach* controls reaching *viewers* (who may be logged-in coaches) on the app's own origin.

---

## Findings

### Blockers

**B1. Coach-controlled URLs are rendered as links on the shared page without a scheme check** (plan 4.3 allow-list,
4.1 viewer page)
- *Problem:* `deriveBlocks.videoBlocks` accepts any non-empty `youtube_url` (`lib/reports/deriveBlocks.ts:305-312`), and
  `VideoBlock` renders it as `<a href={url}>` (`components/reports/VideoBlock.tsx:38`). The entries route stores it
  unvalidated (`app/api/players/[id]/entries/route.ts:84-87`). `DriveImage` renders stored URLs as `href`
  (`DriveImage.tsx:33,41`). The app is on React `^18.3.1` (`package.json:35`), which does **not** block `javascript:` URLs.
- *Scenario:* a malicious or compromised coach saves an entry with `youtube_url = "javascript:…"` (or a phishing
  `https://` address) and sends the share link to another coach or to a parent. The viewer taps "Watch on YouTube" on a
  trusted AngleMotion page. With `javascript:` it runs on the app's origin (see B2); with a phishing URL it borrows
  the page's trust.
- *Smallest fix:* in the plan's S2 projection, build the video block only when `extractYoutubeVideoId(url)` returns an id, and
  render the link from the **reconstructed** `https://www.youtube.com/watch?v=<id>`, never from the stored string. Same
  rule for `sections[].imageUrl` (already `http(s)` only, `deriveBlocks.ts:119-121`) and any other stored URL: the
  projection emits only `https:` URLs. Add a canary test with `javascript:`, `data:` and `http://evil` values.

**B2. The share page runs on the same origin as the signed-in app, with no Content-Security-Policy** (plan 4.1, 4.4)
- *Problem:* `/share/*` is served from the app's origin, where coaches hold Supabase session cookies. The plan lists
  `noindex`, referrer and cache headers but **no CSP**. Any script injection into that page (B1, or a future bug in the
  SVG chart renderer for `metadata.decoderReport` charts, `components/reports/sanitizeSvg.ts`) executes with the cookies of
  any coach who opens the link. Coaches do send links to each other.
- *Scenario:* B1 payload, or a sanitizer bypass in a chart string, opened by a logged-in coach: account takeover, Drive/
  YouTube tokens in the session, access to that coach's players.
- *Smallest fix:* add a strict CSP header to `/share/:path*` in plan step S7 (`next.config.js`): `default-src 'none'; img-src 'self'
  https://lh3.googleusercontent.com data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src
  https://www.youtube-nocookie.com; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  (tuned to what the page needs; Next's inline bootstrap scripts need a nonce or hash, which has to be tested). Preferred
  later: serve `/share` from a separate host (for example `share.<domain>`) so a script there cannot see the app's
  cookies at all. Add a wiring test that the header is present.

### Should fix

**F1. Image requests are separate function invocations; the cost model leaves them out** (plan 4.10, 7; `SCALE_LIMITS`
section 4)
- *Problem:* the recommended option redirects every image through `/share/<token>/img/<n>`, one function invocation per
  image per cache miss. The model counts only page renders (≈ 20–40k invocations at 100k views).
- *Scenario:* a profile with 20 screenshots and a 30% page-miss rate at 100k views/month is ≈ 600,000 image
  invocations, i.e. **about 60% of Hobby's 1,000,000** from the share feature alone, and trigger 2 (60% of any limit)
  fires with the app's own traffic still to come.
- *Smallest fix:* recompute the table with images included; reduce it: `loading="lazy"` plus `fetchpriority` so only
  images the viewer scrolls to are requested, a cap of N images per section with "show more", and cache redirects 5 min
  (not 60 s) while the page stays 60 s. Revisit "images direct from Drive" (option 1) as the cheap fallback if the
  numbers still do not fit.

**F2. Random-token floods can pause the whole app on Hobby** (plan 4.10 rate limiting; `SCALE_LIMITS` section 2)
- *Problem:* unknown tokens cannot be cached and each costs an invocation plus a database read. On Hobby, "Hobby plans
  will be paused when they exceed the included free tier usage … 30 days" (`SCALE_LIMITS` section 2): a bot at ~20
  requests/second burns 1M invocations in about 14 hours.
- *Smallest fix:* make the Vercel Firewall rate-limit rule a **hard prerequisite** before the flag goes on (it is step 15
  but written as "first"; move it to the gate list), and verify first that the plan in use offers it (not published in
  the sources read). Also give unknown/malformed tokens a ~60 s negative CDN cache per URL only if the header names are
  confirmed; do not rely on it.

**F3. `token_hash` and `token_enc` are not tied to each other** (plan 4.2, 8)
- *Problem:* nothing guarantees `sha256(decrypt(token_enc)) = token_hash`. A bug in replace could leave a row whose
  displayed link does not open.
- *Smallest fix:* on every create/replace, decrypt-and-rehash before commit (test), and on `GET …/share` recompute the
  hash of the decrypted token and answer "Replace link" on mismatch.

**F4. Key lifecycle gaps** (plan 4.2)
- *Problem:* rotation re-encrypts "lazily when the coach opens the card", so V1 can never be retired while any coach
  never opens it; Preview deployments may carry the key and point at the same Supabase project as production.
- *Smallest fix:* one admin script that re-encrypts every row, run before deleting a key version; use a **different
  key** for Preview/Development; state which Supabase project previews use (a single project exists, so previews may
  read production rows) before plan S3 is applied.

**F5. Name the `contrib_mode` constraint** (plan 5.1, 8)
- *Problem:* `check (contrib_mode = 'off')` is unnamed; widening it in B1 needs `drop constraint <auto-name>`.
- *Smallest fix:* `constraint player_shares_contrib_mode_off check (contrib_mode = 'off')` in the first migration.

**F6. Opponent names (third parties, often minors) are shown with no switch** (plan 4.3, 4.5)
- *Problem:* entries carry `opponent_name` and match statistics; the hide switches cover profile rows and notes only.
- *Scenario:* a coach shares a profile; the parent sees the names of the opponents' children in every match report.
- *Smallest fix:* one per-link switch "Hide opponent names" (off by default, consistent with the decision), mentioned in
  the first-time warning; projection replaces the name with "Opponent".

**F7. The service worker registers on the viewer's device** (plan 4.1; `app/layout.tsx:68-80`)
- *Problem:* `ServiceWorkerRegistration` is in the root layout, so every viewer installs the app's service worker and
  precache; same-origin images under `/share/<token>/img/…` may meet the worker's generic cache handler
  (`public/sw.js`, bottom). HTML documents are *not* cached (`sw.js:44-55`), so the page itself is fine.
- *Smallest fix:* do not register the worker on `/share/` (the same `usePathname()` guard as the other two components,
  plan S9) and add `/share/` to the worker's bypass list.

**F8. Plan gating: decrypt/copy for a lapsed account, and the free hour** (plan 4.8)
- *Problem:* the plan says revoke and status are never gated and existing links keep working, but is silent on
  `GET …/share` (decrypt/copy). `requireFeature` also lets the free hour through (`canUse` returns true for trial) and
  **fails open on read errors** (`lib/entitlements.server.ts` header comment), so a link can be created during the free
  hour and lives forever.
- *Smallest fix:* state that copy-link and "view as visitor" are ungated (a lapsed coach must be able to see and
  revoke what is live); state the free-hour behaviour deliberately (allow, or require a paid plan for create only).

**F9. P12 removes a working path; it needs its own safety** (plan 3a, 12; dependency of the plan)
- *Problem:* Drive-only screenshots delete the Supabase fallback. A coach without a valid Google token can no longer
  save a screenshot at all; today the fallback hides that.
- *Smallest fix:* P12 must ship the clear "reconnect Google" message and a phone test with Google disconnected, and the
  step list should treat it as a behaviour change (not a refactor) with a rollback (keep the fallback code behind a
  flag until verified).

### Nice to have

- **N1. `coach_id` and `player_id` are not tied in the schema** (plan 8): a service-role bug could write a row where
  `coach_id` is not the player's owner, and the select policy would then show it to the wrong coach. Add a constraint
  trigger checking `players.coach_id = coach_id` on insert/update.
- **N2. `photo_url` is a coach-entered address loaded by the viewer's browser from an arbitrary host** (plan 4.3): it
  leaks the viewer's IP to that host. `referrerPolicy="no-referrer"` already helps; allow `https:` only and show initials
  if it fails; no proxy (it would become an open redirect).
- **N3. Phase C uploads:** size and type limits must live on the **bucket** (`file_size_limit`, `allowed_mime_types`,
  no SVG), because a signed upload URL cannot enforce them per file; add a post-upload size check that deletes
  violators.
- **N4. Phase B comments have no coach notification** (no email system exists): add an unread count to the share card
  so comments are not silently pending; prefix visitor names ("Visitor: …") so a visitor cannot pose as the coach.
- **N5. Header names:** the plan uses `CDN-Cache-Control` and `Vercel-Cache-Tag`; the sources read mention
  `Vercel-CDN-Cache-Control` too and these came from search snippets. Confirm the exact names, and that tag
  invalidation exists on Hobby (not published), on the official pages once reachable.

---

## Task-by-task result

**1. Token design.**
- Hash for lookup: sound (256 bits, unsalted SHA-256 is fine).
- Encrypted copy (AES-256-GCM, random IV, AAD = `player_id`): sound; random 12-byte IVs are safe at this volume.
- Key storage and rotation: **F4** (one key in an env var, lazy re-encrypt, preview keys).
- Hash/ciphertext consistency: **F3**.
- What a database leak exposes: nothing usable (hash + ciphertext). What a key leak exposes: nothing alone; with the
  database, every link (plan states this). Changes I would make: F3, F4.

**2. RLS and access path.** Policy by policy (migration SQL in plan section 8):
- `enable row level security`: present. `player_shares_select_own` (`to authenticated`, `auth.uid() = coach_id`): correct.
- `revoke all … from anon, authenticated` then column-level `grant select (…)`: correct; `token_hash`/`token_enc` unreadable
  by clients. The coach API must use explicit columns (`select *` would now error). No insert/update/delete policy:
  correct, writes are service role only.
- `unique (player_id)` + `on delete cascade` on `players` and `auth.users`: correct.
- Weak spots: no DB tie between `coach_id` and the player's owner (**N1**); constraint name (**F5**).

Attack attempts tried on paper:

| # | Attempt | What stops it |
|---|---|---|
| 1 | Coach A creates a share for coach B's player id | Ownership is checked through the session (RLS) client (`players` select) before the service-role write; test planned |
| 2 | Coach A reads another coach's `player_shares` rows or hashes | select policy by `coach_id`; token columns not granted |
| 3 | Visitor guesses tokens / enumerates | 256 bits; malformed rejected before DB; uniform 404 (cost abuse: **F2**) |
| 4 | SQL injection through the token path segment | well-formedness regex + parameterised supabase-js |
| 5 | Viewer reaches another player via the image route (`/img/<n>`) | `n` indexes a server-built list for that share only |
| 6 | Open redirect / SSRF through the image redirect | host is fixed (`lh3.googleusercontent.com`) and the id is extracted by regex; the legacy Supabase branch must compare the **exact** project host (stored URLs are coach-controlled), add to S10 test |
| 7 | Malicious coach plants `javascript:` / phishing link in an entry | **not stopped today: B1** |
| 8 | Script injection through SVG chart strings in `metadata` | `sanitizeSvg` allow-list exists; with no CSP a bypass runs on the app origin: **B2** |
| 9 | Viewer replays a cached copy after revoke | page/images CDN-cached ≤ 60 s, browser `no-store`; HTML not cached by the service worker (`sw.js:44-55`); tag invalidation availability: **N5** |
| 10 | Write to the profile through a viewer route | none exists in phase A; planned test asserts it |
| 11 | CSRF on the coach routes | session cookie + JSON body; no GET mutates; fine |
| 12 | Service role key reaches the browser | server-only module; unchanged pattern from the affiliate page |

**3. Exposure of sensitive data** (full profile visible by default, decided). Hide switches and the first-time warning
are adequate for fields the coach owns. Gaps: opponents' names (**F6**), the viewer-side image host (**N2**), links
(**B1**). Page source: the plan sends only the projected DTO (hidden fields removed server-side); keep the canary test.
Error messages: uniform 404, no detail. Images/proxy: Drive file names never appear (only `lh3` ids behind a redirect).
No further control needed beyond F6.

**4. Revoke and replace.** One step: revoke sets `revoked_at` + tag invalidation; replace overwrites the hash in place, so
the old URL is gone in the database immediately. Cached copies: page and redirects live ≤ 60 s on the CDN (≤ 5 min if F1
is applied), nothing in the browser (`no-store`), nothing in the service worker for HTML; the Drive files stay
"anyone with link" (stated). After revoke the viewer sees the neutral page. No new issue beyond N5 and F7.

**5. Opens counter and rate limiting.** It does **not** write on every view: at most once per link per 10 minutes and only
on an origin render (SQL condition in plan 4.6); malformed and unknown tokens write nothing. A bot on a valid link cannot
raise the write rate (cached page; 10-minute gate). The abuse that remains is read/invocation cost: **F2**.

**6. Contributions, phases B and C.** Phase A has no write path: the only new write route is the coach API; the planned
test asserts viewer routes never update/delete. The reserved switch cannot be turned on by accident: a check constraint
allows only `'off'` until a migration widens it (and the UI has no control) — good; name it (**F5**). Anonymous writes:
spam is bounded by per-link caps (a single bot can fill the pending quota, accepted, coach can switch the mode off);
no IP stored, so no per-person limit. Gaps: **N3, N4**; legal exposure of anonymous image uploads about minors stays a
lawyer question before phase C (plan 5.3).

**7. Plan gating.** The plan routes every create/replace/settings path through `requireFeature(...,'players')` in one
place, revoke ungated, viewer route unchecked: matches "every paid tier including Lite" **once #130 merges** (the feature
table is the only place that names a plan; `players` is `light` there). No Pro-only path in the plan's own routes. Gaps:
**F8** (copy/decrypt ungated? free hour; fail-open on read errors) and the Drive upload gate that P12 fixes (**F9**).

**8. Cost design.** The recommended option does **not** stay as comfortably free as stated once image invocations are
counted (**F1**). First limits at scale (from `SCALE_LIMITS`, assumptions stated there): Vercel Hobby's commercial-use term
immediately; then, mid case, Hobby invocations (≈ 200 coaches), Supabase's 500 MB database (≈ 420 coaches), bandwidth if
models are re-downloaded. What happens when one is hit: Hobby pauses the project for 30 days (the whole app, including
links); Supabase's action at 500 MB is **not published** in the sources read. With Vin's triggers (50 users, 60%, $20) the
plan is consistent, provided F1 and F2 are fixed.

**9. Failure cases.** Deleted player: cascade kills the row; the cached page may live ≤ 60 s unless `deletePlayer` also
invalidates the tag (it does not today: add to plan S4). Revoked link: covered. Drive image no longer shared: redirect target
returns an error, the page shows "Image unavailable" with no external link; legacy Supabase copy only for old entries.
Cancelled account: links keep working (**F8** for copy). Deleted account: cascade. Coach disconnects Google: existing
shared images keep working while the Drive files stay shared; new saves fail with a clear message only if P12 delivers it
(**F9**). Supabase Free pause after a week of inactivity kills all links until restored (documented).

**10. Estimate and order.** Steps are ≤ 3 files each (P12 touches `upload-image/route.ts`, `saveScreenshot.ts` and tests: 4,
split it). Nothing in the share steps breaks a working feature; **P12 does** (**F9**), and plan S9 edits the global
`ReportProblemButton`/`InstallPrompt` (add the service-worker guard there, **F7**). The migration step is isolated
(one new table, one flag) and reversible (`drop table`; flag off; remove the key), subject to **F5**.

## Order I would apply the fixes in the plan
B1, B2 (plan S2 projection, plan S7 headers) → F5 (name the constraint, before the migration) → F3, F4 → F1 and F2 (cost) → F6,
F7, F8, F9 → Nice to have.
