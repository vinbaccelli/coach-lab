# Player Database — architecture, status and setup

Living document for the athlete-development platform built on the player profile. Derived from the
code; update it with every PR that changes the player database.

## 1. Model in one paragraph

A **player** (`players`) belongs to one coach. Around it sit distinct kinds of data, never mixed
into one generic list:

| Kind | Where | What |
|---|---|---|
| Profile information | `players` columns + `players.profile_fields` (rows) | photo, date of birth, coach notes, custom rows (Nationality…) |
| Technical tracking categories | `players.technical_sheet` (jsonb rows) | Forehand, Backhand, Serve, Volley, Footwork (+ custom): dated comments |
| Structured performance trackers | `player_trackers` + `player_tracker_entries` | anything measured over time: biometrics, fitness tests, custom metrics |
| Nutrition | `player_nutrition_plans` + `player_meal_logs` | versioned plans with daily targets; the meal diary |
| Timeline activities | `player_timeline_items` (+ reports, tracker entries…) | comments, pictures, YouTube videos, analyses |

The tracking engine is **sport-agnostic**: a tracker is a name, a category and a list of fields
(`id`, `label`, `kind`, `unit`, `better`). Presets (Biometrics, Fitness exercises) live in code
(`lib/players/trackerPresets.ts`) and only produce a definition, so new sports need no migration.

## 2. Tracker engine (PR C)

* **Field kinds**: number, count (reps), weight (kg/lb), length (cm/m/in), distance (km/m/mi),
  duration (stored in **seconds**, typed as m:ss / h:mm:ss / a number in the field unit), speed,
  percent (0–100), score. Values are stored in the unit the field declares (no silent conversion).
* **Modes**: `single` (one value per field per entry: weight 72 kg, run 5 km in 24:00) and `sets`
  (a list of sets per entry: 3 × 12 reps × 40 kg, 3 × 60 s plank).
* **Calculated fields**: `bmi` (weight ÷ height², using the latest height on or before the entry
  date, else the nearest later one, with kg/lb and cm/m/in handled) and `pace` (time ÷ distance,
  per km). They are never typed in and never stored.
* **Charts adapt**: one series per field for `single`; for `sets`: top weight, best set, totals for
  counts/times/distances, volume (reps × weight) and number of sets. Durations are labelled m:ss,
  percentages %, weights with their unit. `better: higher|lower` decides whether a change is an
  improvement (a lower run time is green).
* **History is protected**: a field with history can be renamed or archived but not removed or
  retyped; the entry mode cannot change once a tracker has entries; editing with a stale copy
  returns 409 (`expected_updated_at`); a retried submit is deduplicated (`client_ref`, unique per
  tracker).
* **Player submissions** (`author = 'link'`) start as `submitted`; the coach approves or asks for a
  fix (`needs_revision` + note). Coach entries are `approved`.
* **Legacy progress values** (`player_metrics`) are copied into trackers by the migration (one
  tracker per player + name + unit, field kind `number`, original unit and values unchanged).
  `player_metrics` is not modified or dropped; the copy is idempotent.

Profile sections (tabs, `?tab=` in the URL): Overview · Technical · Progress · Biometrics · Fitness ·
Nutrition · Timeline. Later PRs add Workouts and Mental.

## 2b. Nutrition (PR E)

* **Plans** (`player_nutrition_plans`): a name, a period (`starts_on` .. `ends_on`, open-ended when
  empty), daily targets (calories, protein, carbs, fat, plus custom targets such as water or fibre,
  each with a unit), meal recommendations (name, time, what to eat) and notes for the player.
  Status: `active`, `draft` (not shown to the player, not used for totals) or `archived`.
* **Versions**: "New version" saves a new plan from a date (default tomorrow, or today when the
  current plan started earlier) with `previous_id` pointing at the old one, then closes the old
  plan the day before. The old plan's content is never changed. If the old plan was changed
  elsewhere meanwhile, the new one is removed again and the coach gets 409 (nothing half done).
  A plan whose period has ended is **history**: it cannot be edited (409), only duplicated,
  archived or deleted. Duplicate = a copy saved as a draft.
* **Plan in force on a day** = the active plan with the latest start whose period covers it
  (`planForDate`). Daily totals compare with that plan's targets; a day without a plan shows totals
  only.
* **Meals** (`player_meal_logs`): date, time, category (breakfast, lunch, dinner, snack, before /
  after training, other; guessed from the time), what was eaten, calories, protein, carbs, fat (empty
  calories are calculated from the macros: 4/4/9 kcal per g), values for the plan's custom targets,
  an optional photo and a note. One day of slack on "not in the future" so a player east of UTC can
  log today's meal. Retries are deduplicated (`client_ref`, unique per player).
* **Photos** are shrunk on the phone (max 1280 px JPEG) and uploaded by the server into
  `player-assets/{coach}/{player}/meals/`. A photo URL sent in a request body is never stored (only
  photos the server uploaded); replacing or deleting a meal removes its photo.
* **Day view**: date navigation, meters (eaten / target, the share in %, amber with "+N" when over),
  the meals of the day, and the last 7 days of calories against the target.
* **Player meals** (share link, `add.meals`) start `submitted`; the coach approves (one, a whole
  day, or everything from Overview → To review) or asks for a fix with a note. The player corrects
  or removes their own meals until they are approved; coach meals and approved meals cannot be
  changed through the link. The player sees active plans only (no drafts, no archived plans) and
  never edits plans.

## 3. Security model

* **RLS everywhere**: every player-database table allows select/insert/update/delete only to the
  owning coach (`auth.uid() = coach_id`); inserts and updates also check that the player (and, for
  entries, the tracker) belongs to that coach and to each other.
* **Share link** (`/share/<token>`, no login): the server resolves the token (hashed lookup), then
  uses the service role **scoped to the one player of the link** and returns an allow-listed set of
  fields. A view link cannot write; a "can add" link can only add (rate-limited per hour) and its
  tracker entries wait for review.
* **Share permissions** (PR D, `player_shares.permissions`, `lib/players/sharePermissions.ts`): per
  section, what the player can **see** (technical, progress, biometrics, fitness, nutrition,
  timeline; later workouts, mental) and **add** (comments, pictures, videos, progress / biometrics /
  fitness entries, meals; later workouts, questionnaires). Defaults come from the link mode; Mental is
  never visible unless the coach turns it on; nothing can be added into a hidden section; a view
  link can never add. Every share route checks these on the server (403 otherwise) and the GET only
  returns visible sections.
* **Player entries**: added with `author = 'link'`, `status = 'submitted'`. The player can correct or
  withdraw their own entries only while they wait (submitted / needs_revision); approved entries and
  coach entries cannot be changed through the link. The coach reviews everything in Overview → To
  review (Approve, or Ask for a fix with a note the player sees).
* Server routes also check the `players` feature (plan) for writes; reads stay open so a profile
  remains readable without a plan.
* **Pictures are public URLs.** Profile photos, timeline pictures and meal photos live in the public
  `player-assets` bucket under unguessable paths (random UUIDs): anyone who has a picture's URL can
  open it. Listing the bucket is not possible without the coach's login. See KNOWN_ISSUES 078.

## 4. Requirements matrix

Status: ✅ done and verified in a browser · 🟡 partial · ⏳ planned (PR) · ⛔ blocked (reason)

| # | Requirement | Status | Where / plan | Acceptance |
|---|---|---|---|---|
| 1 | Top card: photo, photo URL, date of birth, coach notes, Add row (+ Nationality suggestion) | ✅ | #184, photo upload in PR C | photo uploads to the coach folder; rows add/rename/drag/delete |
| 2 | Five standard technical tracking rows; old untouched sheets migrated; content never deleted | ✅ | #188 | new player = 5 rows; Reset keeps typed content |
| 3 | Custom fields: add, rename, delete, reorder (drag), per player | ✅ | #184, #188, rename in PR C | |
| 4 | Dated comments on technical categories | ✅ | #188 | |
| 5 | Custom trackers, multiple values per entry, sets, notes, history, edit/delete | ✅ | PR C | e2e `trackers.e2e.mjs` |
| 6 | Adaptive graphs | ✅ | PR C | sets → volume/top weight; times m:ss; improvement colour by direction |
| 7 | Biometrics preset, BMI calculated, extra measurements, different frequencies | ✅ | PR C | BMI from carried-forward height |
| 8 | Fitness preset with examples, fully customisable | ✅ | PR C | run, push-ups, squat, pull-ups, plank, jump, sprint, strength, mobility |
| 9 | Old Progress card removed; its values kept | ✅ | PR C | migrated to Progress tab |
| 10 | Student logging (biometrics, fitness, workouts, meals, comments, pictures, videos) with review | 🟡 | trackers (biometrics, fitness, progress), comments, pictures, videos + review queue ✅ PR D; meals ✅ PR E; workouts ⏳ PR G | e2e `student.e2e.mjs`, `nutrition.e2e.mjs` |
| 11 | Granular share permissions, enforced server-side | ✅ | PR D | view link refuses writes; hidden sections not sent and not writable |
| 12 | Nutrition plans (versioned) + meal tracking with daily totals vs plan | ✅ | PR E | e2e `nutrition.e2e.mjs` (56 checks), DB `tests-db/nutrition.rls.test.ts` |
| 13 | Universal timeline across modules, filters, pagination | 🟡 | timeline exists (#174/#177/#184); universal + filters ⏳ PR F | |
| 14 | Workout plans, schedule, exercise library, workout logs (planned ≠ completed) | ⏳ | PR G | |
| 15 | Mental questionnaires + assessments | ⏳ | PR H | |
| 16 | Assignments and reminders (in-app) | ⏳ | PR H | |
| 17 | Student pictures to the coach's Google Drive | ⏳ | PR I (investigation; needs a server-held Drive grant) | |
| 18 | Landing / pricing positioning | ⏳ | after the database is complete | no unfinished feature advertised |

## 5. Setup (owner runs the SQL once per release)

The app never breaks when its SQL has not been run yet: a section whose tables are missing shows
"needs a one-time database update" and everything else keeps working.

Run, in the Supabase SQL editor, the migration files of each release (idempotent, safe to re-run):

| Release | File |
|---|---|
| PR C — trackers | `supabase/migrations/20261114090000_player_trackers.sql` |
| PR D — share permissions | `supabase/migrations/20261114100000_share_permissions.sql` |
| PR E — nutrition | `supabase/migrations/20261114110000_player_nutrition.sql` |

## 6. Testing

* `npm test` — pure logic (`tests/*.test.ts`), incl. `tests/trackers.test.ts`, `tests/nutrition.test.ts`.
* `npm run test:db` — migrations and RLS against a real Postgres (`tests-db/`), run as the
  `authenticated` / `anon` / `service_role` roles with JWT claims, like Supabase.
* `npm run test:e2e` — browser workflows (Playwright) against the local stack.
* Local stack: `scripts/local-stack/start.sh --reset` (Postgres 16 + every migration + seeded test
  coaches + a small Supabase stand-in for auth/REST/storage), then `scripts/local-stack/dev.sh`.
  Test-only; it never touches production.
