# Storage per coach — what one coach costs us

Method: repository only (migrations, schema, API routes, save code). Nothing was queried or written in production, Supabase, Google Drive or YouTube. Every size below is **estimated** from code and stated assumptions, not measured. Supabase plan limits are **unverified** (see §6).

## 1. Answer first

The founder's assumption ("we store very little") is **true for the database, false for Supabase Storage**.

| Item | Estimate |
|---|---|
| DB per coach per year, founder model (200 reports × 3 screenshots, 1 link, 500-char comment) | ~2,100 B/report → **~420,000 B/year (~0.40 MiB)** |
| Same incl. fixed rows, monthly invoices, webhook events | **~478 KB/year** |
| Cumulative, incl. fixed rows | yr 1 ~496 KB · yr 3 ~1.45 MB · yr 5 ~2.41 MB |
| Coaches in 500 MiB DB (no baseline) | **~1,057 (1 yr) · ~361 (3 yr) · ~217 (5 yr)** |
| Same, with 50 MiB assumed baseline | ~951 · ~325 · ~196 |
| Realistic mix (assumes 20 matches + 20 saved sessions/yr; metadata 31–52 KB each) | ~383 · ~129 · ~77 |
| Storage, Drive working, no sessions saved | ~0 |
| Storage per saved analysis session | **~15 MiB (estimated)**, ~68 sessions per GiB across all coaches |
| Storage per screenshot that falls back to Supabase | ~2 MiB |

The DB limit is not the binding constraint. **Supabase Storage is**, and only through paths the founder did not count (§4, §7).

## 2. Inventory (per coach / per player)

| Place | What | Typical | Worst case | Code |
|---|---|---|---|---|
| `players` | name, photo_url (text), dob, nationality, hand, notes | ~300 B | unbounded: `photo_url`, `notes` have no cap | `supabase/migrations/20260210120000_players_and_entries.sql:6-17` |
| `player_entries` | category, folder_label, body_text, youtube_url, opponent, date, `screenshots` jsonb (URLs), `metadata` jsonb | ~2.1 KB (model above) | decoder/match metadata allowed up to ~2.4 MB | `…players_and_entries.sql:22-35`; caps `lib/reports/entrySections.ts:20` (400,000 chars), `components/decoder/SaveReportToPlayersModal.tsx:158` (2,000,000 chars) |
| `player_sessions` | title, coach_notes, trim, `video_ref`, `measurements`, `frame_markers`, `tool_config`, `artifacts` (URLs + byte counts), `external_links` jsonb | see §3 | unbounded (no caps on `measurements`, `tool_config`, `video_ref.url`, `coach_notes`) | `…player_sessions.sql:3-26` |
| Storage `player-assets` (public) | session PNGs, webm, screenshot fallback | ~15 MiB/session | no size cap | bucket `…player_sessions.sql:45-47`; upload `lib/sessions/serverStorage.ts:12-14`, route `app/api/sessions/[sessionId]/artifacts/route.ts:64-83` |
| Storage `coach-avatars` | one 512×512 JPEG/PNG per upload | ~30–80 KB | accumulates (new path per upload) | `components/coach/CoachProfileEditor.tsx:142-180`, crop `components/coach/AvatarCropModal.tsx` |
| Coach profile row | bio ≤4,000 chars, urls ≤2,048 | ~1–5 KB | ~10 KB | `app/api/coach-profile/route.ts:6-7,83,89` |
| `coach_settings` | technical-sheet template jsonb | ~1 KB | unbounded | `…player_docs_and_technical_sheet.sql:13-17` |
| `youtube_connections` | AES-GCM `iv:tag:ciphertext` of refresh token, channel title | ~250 B | ~400 B | `…youtube_connections.sql:15-24`, `lib/crypto/secretBox.ts` |
| `subscriptions`, `trials`, `access_grants` | one row per coach | ~300 B each | — | migrations `…subscriptions.sql`, `…trials.sql`, `…access_grants.sql` |
| `stripe_webhook_events` | event id + payload | ~1–5 KB per event | grows forever | `…billing_r1g.sql:32` |
| `billing_profiles`, `invoice_settings`, `fiscal_invoices`, `billing_event_errors` | text + FatturaPA XML/records | ~1 KB profile; ~3–10 KB per invoice | grows per payment | `…invoicing*.sql`, `lib/billing/invoicing/fatturaPA.ts` |
| Academy: `academy_questions/replies/votes`, `academy_members` | text | ~0.5–2 KB per post | unbounded text | `…academy_forum.sql:3-27`, `…academy_seats_ebooks.sql:15` |
| `affiliates*` (4 tables) | text/numbers | ~100–300 B/row; clicks grow | one row per click | `…affiliates.sql:16-41` |
| Storage `ebooks` (private) | one shared PDF, not per coach | 0 per coach | — | `…academy_seats_ebooks.sql:81-84` |

Not stored by us: the video (coach's YouTube) and report screenshots when Drive upload works (`lib/reports/saveScreenshot.ts:100-175`: Drive first, Supabase `player-assets` as fallback). `lib/media/mediaAsset.ts` is unused. Motion Layer clips are not persisted server-side in anything read.

## 3. A saved analysis session

Row columns: see §2. Large parts are `measurements` (per-frame angle/speed arrays), `frame_markers` (timestamps), `tool_config`. These are numbers and short strings, so a normal row is a few KB to ~100 KB. The accident risk is the `artifacts` column plus the Storage upload: artifacts hold **URLs and `bytes`** (`artifacts/route.ts:75-76`), not images, so frame images do not enter the DB through this path. The risk is in `player_entries.metadata` / `screenshots`: a data URL in `screenshots` or `metadata` would sit in the row. Guards exist (400,000 and 2,000,000 character caps) but are generous: **largest realistic DB row ≈ 2.4 MB** (decoder report at the cap), not a saved session.
Largest realistic Storage object set: a session with several full-resolution PNGs (~1–3 MiB each) plus a webm clip (~5–10 MiB) ≈ **15 MiB** (estimated; no cap in code).

## 4. Model: 200 reports/yr, 3 screenshots, 1 link, 500-char comment, 5 years

Per report (DB): row overhead ~120 B (tuple header + fixed columns) + indexes (3 × ~40 B) + folder_label/category ~40 B + body 500 B + youtube_url ~60 B + 3 screenshot URLs × ~330 B (Drive/Supabase public URL, jsonb quoted) ≈ 1,000 B + metadata `{}` + jsonb overhead ≈ **~2,100 B**.
Per year: 200 × 2,100 = **420,000 B (0.40 MiB)**. Five years: 2.1 MB. Fixed rows (profile, subscription, token, settings) ~10 KB; monthly invoices 12 × ~6 KB ≈ 72 KB; webhook events ~12 × 3 KB ≈ 36 KB → ~478 KB/yr, 5 yr ≈ 2.41 MB.
Storage in this model: **0 B** if Drive upload succeeds. If 10% of screenshots fall back to Supabase: 60 × ~2 MiB ≈ **120 MiB/coach/year**, ~600 MiB over 5 years.

## 5. Coaches that fit (all estimated)

DB, 500 MiB = 524,288,000 B ÷ cumulative per-coach size (§1): 1 yr ≈ 1,057 · 3 yr ≈ 361 · 5 yr ≈ 217; with a 50 MiB baseline (assumed, covers auth/system) 951 · 325 · 196; realistic mix 383 · 129 · 77.
Storage, assuming 1 GiB: 0 sessions saved and Drive working → unconstrained; ~68 saved sessions fill it; at 10% fallback ≈ 8.5 coach-years per GiB.

## 6. Limits provenance

- 500 MB database and 1 GB Storage for Free: **second-hand**, from `docs/SCALE_LIMITS.md` on branch `origin/docs/report-share-plan`, which itself marks them unverified. **Unverified here.** Check the Supabase billing page before relying on them.
- Postgres row-size model (tuple header, alignment, index tuples) is standard; TOAST compression and B-tree deduplication are ignored, making the DB figures conservative (high).

## 7. Stores more than the founder assumed

1. Public `player-assets` holds full-resolution session PNGs and a webm; no size cap (`artifacts/route.ts:64-83`).
2. Screenshot fallback uploads to Supabase when Drive fails (`saveScreenshot.ts:100-175`); until PR #130 the fallback is reachable.
3. Avatars: each upload is a new object; old ones stay (`CoachProfileEditor.tsx:142-180`).
4. Re-saving a session appends artifacts (`merged = [...existing, ...newArtifacts]`, `artifacts/route.ts:82-83`) and uploads use `upsert: true` on new ids (`serverStorage.ts:12-14`), so duplicates accumulate.
5. Decoder and match metadata of 31–52 KB per entry (up to ~2.4 MB at the caps).
6. No caps on `measurements`, `tool_config`, `video_ref.url`, `coach_notes`, `players.photo_url`, `players.notes`.
7. One row per report-entry; screenshots live inside its jsonb.

## 8. Grows forever / never cleaned

- Old sessions: no retention or delete-by-age; only manual delete.
- Re-saved session artifacts (duplicates, see §7.4); replaced avatars.
- Deleting a player removes its Storage objects (`app/api/players/[id]/route.ts:92-93`), but **deleting a coach account** cascades DB rows (`on delete cascade`) and does **not** remove Storage objects (no code found doing so): orphans remain in `player-assets` and `coach-avatars`.
- Entry deletion: screenshots uploaded to Supabase for that entry are not removed with the entry (unverified path; no cleanup code read).
- `stripe_webhook_events`, `affiliate_clicks`, `billing_event_errors`: append-only, no purge.

## 9. What to watch (founder, Supabase dashboard)

1. **Database size** (Settings → Usage): act at 50% of the plan limit (review sessions/metadata), hard stop at 80%.
2. **Storage size** (Storage → bucket sizes, especially `player-assets`): act at 50% (≈ 500 MB if the 1 GB figure holds); at 80% add size caps and cleanup.
3. **Largest tables** (`player_entries`, `player_sessions`, `stripe_webhook_events`) by row count/size: act when `player_sessions` rows or `player_entries.metadata` average above ~100 KB.
