# Scale limits: Vercel and Supabase, and what hits first at 100 / 1,000 / 10,000 coaches

Written 2026-11-02 for the share-link plan (`docs/REPORT_SHARE_PLAN.md`). No code, database or settings changed.
Goal under test: **no paid Vercel or Supabase tier at 1,000 coaches.**

## 0. How to read this document (and what could not be verified)

- **Source rule.** Every number has a URL and the date it was read (2026-11-02). If a number is not
  published in a source I could read, it says "not published".
- **Important limit of this research.** In this sandbox `vercel.com` and `supabase.com` are **not reachable
  with the page fetcher** (the network policy denies those hosts). The numbers below come from **web-search
  results that quote the official pages** (the source URL is the official page the result pointed to), not
  from reading those pages in full. The search tool itself warned that some indexed copies are 44 to 395
  days old. **Treat every number as "to re-check on the official page"** before a billing decision. To let me
  verify them properly, add `vercel.com`, `supabase.com`, `developers.cloudflare.com` to the session's allowed
  domains (Network access in the cloud environment settings) and say so.
- **Not measured.** No Supabase project was visible to my tools (`list_projects` returned none), so
  database sizes below are **modelled from the schema, not measured**. Section 5 gives three read-only SQL
  queries Vin can run in the Supabase SQL editor to replace the assumptions with real numbers.

## 1. Which plans the project runs on today

| Service | Plan | How I know |
|---|---|---|
| Supabase | **Free** (`plan: "free"`, `tier: "tier_free"`) | Supabase management API `get_organization` for the organization "Anglemotion", read 2026-11-02. |
| Vercel | **Not determinable from here** | No Vercel API access in this session. Two Vercel projects exist (`anglemotion-v1`, `anglemotionverification`) under the team `vinbaccellis-projects` (from the Vercel bot comments on the PRs). The plan is a dashboard fact: Vin has to read it (Team settings → Billing). |

### Commercial-use terms (this is the first thing that matters)

- **Vercel Hobby is for non-commercial personal use only.** Quote from Vercel's fair use guidelines as returned by the search tool:
  "Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform
  requires either a Pro or Enterprise plan." Source: <https://vercel.com/docs/limits/fair-use-guidelines>
  (read 2026-11-02, through search result). The Terms of Service say the same: "You shall only use the Services
  under a Hobby plan for your personal or non-commercial use." Source: <https://vercel.com/terms>
  (read 2026-11-02, through search result). A community post quotes the guidelines' definition of commercial
  usage as "any Deployment that is used for the purpose of financial gain of anyone involved in any part of
  the production of the project" (community post, not an official page; the official page was not read in full).
- AngleMotion sells subscriptions (Stripe, Light / Pro / Academy plans). On the quoted wording that is
  commercial use. **If the project runs on a Hobby team today, "no paid Vercel tier" is not available to it
  under Vercel's own terms, at any number of coaches, including 1.** If it already runs on Pro, the goal
  becomes "stay inside Pro's included usage", which is a different (easier) goal. Vin needs to say which.
- **Supabase Free:** the sources I could read do not state a commercial-use restriction for the Free plan.
  I found no such wording; I did **not** find an explicit "commercial use allowed" statement either:
  **not published in the results I read.** Re-check <https://supabase.com/terms> and the pricing page.

## 2. Limits that matter (Free / Hobby), with sources

### Vercel Hobby (read 2026-11-02, via search result quoting the official page)

| Limit | Value | Source |
|---|---|---|
| Fast Data Transfer (bandwidth out) | first 100 GB / month | <https://vercel.com/docs/plans/hobby> |
| Function invocations | first 1,000,000 / month | <https://vercel.com/docs/plans/hobby> |
| CDN requests ("Edge Requests" on older pages) | first 1,000,000 / month | <https://vercel.com/docs/plans/hobby> |
| Fast Origin Transfer | first 10 GB / month | <https://vercel.com/docs/plans/hobby> (from a mirror of the doc) |
| Active CPU | 4 CPU-hours / month | same (mirror) |
| Provisioned memory | 360 GB-hours / month | same (mirror) |
| ISR reads / writes | 1M / 200k per month | <https://vercel.com/docs/pricing> |
| Image optimization cache reads / writes | 300k / 100k per month | <https://vercel.com/docs/pricing> |
| What happens at the limit | "Hobby plans will be paused when they exceed the included free tier usage. In most cases, you will have to wait until 30 days have passed before you can use the feature again." On-demand overage rates exist only on paid plans. Community threads report enforcement does not always match the docs. | <https://vercel.com/docs/plans/hobby> |
| Maximum function duration, build minutes, deployments per day, file-size limits | **not collected** in this pass | <https://vercel.com/docs/limits> |
| CDN caching with `Cache-Control` / `CDN-Cache-Control`, tag invalidation (`invalidateByTag`, up to 128 tags per response) | documented; whether tag invalidation is available on Hobby and its rate limits: **not published** in what I read | <https://vercel.com/docs/caching/cdn-cache/purge> |

### Supabase Free (read 2026-11-02, via search result quoting the official pages)

| Limit | Value | Source |
|---|---|---|
| Database size | 500 MB per active project (disk is fixed at 2 GB; read-only mode at 95% of disk) | <https://supabase.com/docs/guides/platform/database-size> |
| Storage | 1 GB | <https://supabase.com/docs/guides/storage/pricing> |
| Max upload file size | 50 MB global cap on Free | <https://supabase.com/docs/guides/storage/uploads/file-limits> |
| Egress (bandwidth) | 5 GB uncached + 5 GB cached per month (10 GB total) | <https://supabase.com/docs/guides/platform/manage-your-usage/egress> and <https://supabase.com/docs/guides/storage/serving/bandwidth> |
| Monthly active users (Auth) | 50,000, no overage charge on Free | <https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users> |
| Active projects | 2 | <https://supabase.com/docs/guides/platform/billing-on-supabase> |
| Pausing | Free projects are paused after 1 week of inactivity (a warning email about a week before); paused Free projects are restorable for 90 days; dashboard or app requests reset the clock | <https://supabase.com/kb/faqs/platform/free-project-pausing> |
| What happens when the 500 MB database quota is exceeded | **not published** in what I read (the sources describe the 2 GB disk and the 95% read-only mode, not an action at 500 MB) | <https://supabase.com/changelog/33121-relaxing-database-size-limit-on-free-plan-0-5-gb-database-size-per-project> |
| Daily backups / point-in-time recovery on Free | **not collected** | <https://supabase.com/docs/guides/platform/backups> |
| Compute (CPU/RAM), connection limits on Free | **not collected** | <https://supabase.com/docs/guides/platform/compute-and-disk> |

### Cloudflare Free in front (considered as an option in the plan)

- Cloudflare's CDN service-specific terms: the CDN may be used to cache and serve web pages and websites;
  "unless you are an Enterprise customer, Cloudflare offers specific Paid Services (e.g., the Developer
  Platform, Images, and Stream) that you must use in order to serve video and other large files via the CDN";
  Cloudflare "may act against accounts" that serve video or "a disproportionate percentage of pictures,
  audio files, or other large files" without them (quoted by the search tool). Source:
  <https://www.cloudflare.com/service-specific-terms-application-services/> and
  <https://blog.cloudflare.com/updated-tos/> (read 2026-11-02, through search result).
  Commercial use on the Free plan: **not stated in what I read.**
- Google Drive: the error "Too many users have viewed or downloaded this file recently" exists and is
  temporary (typically lifts within 24 hours); **the threshold is not published.** Source:
  <https://support.google.com/drive/answer/2423534> (read 2026-11-02, through search result).

## 3. What the app already weighs on these limits (measured locally, 2026-11-02)

- `public/` is **238 MB**, of which `public/models` is **115 MB** (largest: `sam2` 33 MB,
  `pose_landmarker_heavy.task` 30 MB, `selfie_multiclass_256x256.tflite` 16 MB, `movenet-thunder` 13 MB).
  `.next/static` is **30 MB** (production build). These files are served by Vercel and count as Fast Data
  Transfer when a browser fetches them. How much of that a typical coach downloads, and how often the
  service worker re-downloads it, is **not measured**.
- `GET /api/players/[id]` returns the whole player row and **every entry with its metadata** on every open of
  a report page (`app/api/players/[id]/route.ts:17-32`). Entry size is not capped (a decoder report stores
  SVG charts inside `metadata`).
- No rate limiter exists in the repo (`grep` found none outside an unrelated worker), so nothing bounds how
  often a script can hit a public link.

## 4. Model: 100, 1,000 and 10,000 coaches

### Assumptions (all explicit; replace with measured values from section 5)

| | Low | Mid | High |
|---|---|---|---|
| Players per coach | 8 | 15 | 40 |
| Entries per player | 10 | 25 | 60 |
| Average bytes per entry row (text + `metadata` jsonb + indexes) | 1.5 KB | 3 KB | 10 KB |
| Player row (profile + `technical_sheet` jsonb) | 3 KB | 3 KB | 3 KB |
| Share-link row (plan) per player | 0.6 KB | 0.6 KB | 0.6 KB |

Per-coach database size = players × (entries × entry bytes + player row + share row):
**Low ≈ 0.15 MB, Mid ≈ 1.2 MB, High ≈ 24 MB.** Screenshots are **not** in the database (URLs only; the images
are in the coach's Drive). Light now gets the player database (PR #130), so the "coaches with players" share
rises; the table assumes **every** coach has players, which is the worst case.

### Database size against the 500 MB Free limit

| Coaches | Low (0.15 MB each) | Mid (1.2 MB each) | High (24 MB each) |
|---|---|---|---|
| 100 | 15 MB | 118 MB | 2.4 GB (over) |
| 1,000 | 150 MB | 1.2 GB (**over**) | 24 GB (over) |
| 10,000 | 1.5 GB (over) | 12 GB (over) | 240 GB (over) |
| Coaches that fit in 500 MB | ~3,300 | ~420 | ~21 |

The share feature itself adds ~0.6 KB per player (≈ 9 MB at 1,000 coaches × 15 players), about 2% of the budget.
The notes feature (plan section 5) adds entries, not tables.

### Everything else, mid case, 1,000 coaches (order of magnitude, each assumption stated)

| Resource | Assumption | Result | Limit | Verdict |
|---|---|---|---|---|
| Supabase egress | each coach opens reports/profile 40×/month; mid entry list ≈ 75 KB per open; high ≈ 600 KB | mid 3 GB; high 24 GB | 10 GB | mid OK, high **over** |
| Vercel function invocations | 5,000 API/page calls per coach-month (app calls entitlement, trial, players, entries APIs) | 5 M | 1 M | **over** (not measured: this is an assumption to replace with Vercel's own usage page) |
| Vercel Fast Data Transfer | 1.3 devices per coach download ~50 MB of models/JS once a month | ~65 GB | 100 GB | OK on the assumption; very sensitive: `public/models` is 115 MB, so if every coach downloaded all of it just once a month, 1,000 coaches = 115 GB (**over**). **Not measured.** |
| Supabase Auth MAU | all 1,000 active | 1,000 | 50,000 | OK |
| Supabase Storage | Light/Pro session artifacts + Phase C uploads | not modelled except Phase C caps | 1 GB | see plan section 7 |
| **Share viewers** (new) | 10 links per coach, 10 views per link per month | 100,000 page views | | below |

Share viewer traffic at 1,000 coaches (100,000 views/month), by delivery option (plan section 8):

| Delivery option | Vercel invocations | Vercel bandwidth | Supabase egress | Fits free limits? |
|---|---|---|---|---|
| A. Dynamic page every view, images direct from Drive | 100,000 | ~100 KB page × 100k = 10 GB | ~10 KB × 100k = 1 GB | yes: 10% of invocations, 10% of bandwidth |
| **B+G (recommended). CDN-cached page (60 s), token-scoped image redirect to Drive** | ≈ 20,000 to 40,000 on cache misses (+ image redirects on misses) | ≈ 6 to 10 GB (cached bytes still count as Fast Data Transfer; the redirected images do not) | ≈ 0.3 GB | yes: 2 to 4% of invocations, 6 to 10% of bandwidth |
| E. Image proxy through our functions (2 MB of images per view) | 100,000 + images | **~200 GB** | ~1 GB | **No**: 2× the 100 GB bandwidth limit |

(Cache-hit rate for B+G is an assumption: a family opens a link in bursts, so most views land inside the
60-second cache window of one origin render. Replace with measured data after a month.)

### What is hit first (for the mid case unless noted)

| Scale | First limit hit | Then |
|---|---|---|
| **100 coaches** | **Vercel Hobby commercial-use term** (if on Hobby): applies at 1 coach. Technical limits: none in the mid case (DB 118 MB; invocations 0.5 M if the assumption holds) | invocations (~200 coaches), then DB size (~420 coaches) |
| **1,000 coaches** | **Supabase database size** (1.2 GB vs 500 MB; Free-plan action when over: not published) and **Vercel function invocations** (5 M vs 1 M) | Supabase egress in the high case; Vercel bandwidth if the models are re-downloaded |
| **10,000 coaches** | Everything: DB 12 GB, invocations 50 M, bandwidth ≈ 650 GB, egress | Supabase MAU (50,000) is still not reached |

**Conclusion for the cost goal.** With the mid assumptions "no paid tier at 1,000 coaches" **does not hold
for the app as a whole**, with or without the share link: the database and the invocation count exceed Free /
Hobby well before 1,000 coaches, and Vercel Hobby forbids commercial use outright. **The share link can be
designed so it is not what pushes a limit** (option B+G: ≈ 2 to 4% of invocations, ≈ 2% of the database, ≈ 6 to 10% of
bandwidth) and so that the paid tier, when it is needed, is the first paid tier of each service and nothing more.
The thing that would break the goal on its own is the image proxy (option E).

## 5. Measure the real numbers (read-only; run in the Supabase SQL editor)

These only read sizes and counts; they do not change anything and show no personal data.

```sql
-- 1. Total database size and the biggest tables
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select relname, pg_size_pretty(pg_total_relation_size(oid)) as total,
       reltuples::bigint as approx_rows
from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace
order by pg_total_relation_size(oid) desc limit 10;

-- 2. Real average and biggest entry row (bytes), and players/entries per coach
select count(*) as entries, avg(pg_column_size(e.*))::int as avg_bytes,
       max(pg_column_size(e.*)) as max_bytes from public.player_entries e;
select avg(c)::numeric(8,1) as avg_players_per_coach, max(c) as max_players
from (select count(*) c from public.players group by coach_id) t;
select avg(c)::numeric(8,1) as avg_entries_per_player, max(c) as max_entries
from (select count(*) c from public.player_entries group by player_id) t;

-- 3. Storage bucket use (player-assets and any other bucket)
select bucket_id, count(*) as objects,
       pg_size_pretty(sum((metadata->>'size')::bigint)) as total
from storage.objects group by bucket_id;
```

And in the Vercel dashboard (Usage page): last 30 days of Fast Data Transfer, Function Invocations and CDN
Requests, plus the plan name on the billing page. Send me those and this file gets real numbers.
