# Player database — security audit, landing / pricing audit, open items

*2026-11-14 · player database PR I. Derived from the code and a local database built from every
migration (`scripts/local-stack/start.sh --reset`), including the not-yet-merged PR G (#194) and
PR H (#195).*

## 1. Row level security

Every player-database table has RLS enabled and only owner policies (`auth.uid() = coach_id`); inserts
and updates also check that the row's player (and its tracker, plan, workout or questionnaire) belongs
to the same coach and to each other. Verified with the roles and JWT claims Supabase uses
(`npm run test:db`, 33 tests on the PR H branch).

| Table | Policies | Notes |
|---|---|---|
| `players`, `player_entries`, `player_shares`, `player_metrics` | select / insert / update / delete own | earlier releases |
| `player_timeline_items` | select / insert / delete own | items are not edited |
| `player_trackers`, `player_tracker_entries` | own; entry ↔ tracker ↔ player matched | fixed in #193 (KNOWN_ISSUES 079) |
| `player_nutrition_plans`, `player_meal_logs` | own; player checked | PR E |
| `exercise_library`, `questionnaire_templates` | built-in rows readable by signed-in coaches, writable by none; own rows private | PR G / PR H |
| `workout_templates`, `player_workouts`, `player_workout_logs` | own; template and workout ↔ player matched | PR G |
| `player_questionnaires`, `player_questionnaire_responses`, `player_assignments` | own; answer ↔ questionnaire ↔ player matched; a task can point only at a questionnaire (never an assessment) of the same player | PR H |
| `youtube_connections` | none on purpose | encrypted tokens, service role only |

**Finding fixed during the audit:** KNOWN_ISSUES 079 (a policy subquery compared a column with
itself). Every policy of these tables was searched for the same pattern; the remaining
`players p where p.id = player_id` subqueries are correct (`players` has no `player_id` column), and
the new migrations write the row's own columns with the table name.

## 2. Share links (no login)

Server-side on every route (`lib/players/shareAccess.ts`, `lib/players/sharePermissions.ts`):

* the token is looked up by hash; revoked or unknown → the same 404; an email-locked link asks for
  the email;
* the service role is used **only scoped to the link's player**, and each route returns an
  allow-listed set of columns (never coach notes, reports, Google ids, other players, coach ids);
* **see** permissions decide which sections are sent at all (hidden = not in the response, 403 on the
  section's own route); **add** permissions decide every write (403); a view link never writes;
  nothing can be added into a hidden section;
* player additions are `author = link` and wait for review; the player changes only their own
  pending items; approved items and the coach's items cannot be changed through the link;
* an hourly brake counts additions across every table a link can add to; retries are deduplicated
  with `client_ref`;
* Mental is off by default; coach assessments are never sent through a link (PR H).

Covered by the browser workflows `student`, `nutrition`, `timeline`, `workouts` (coach side) and
`mental`, which call the routes directly to confirm the refusals, not only the hidden buttons.

## 3. Mobile pass

Every new screen was exercised at 390 × 844 (iPhone size) in Chromium: Progress / Biometrics /
Fitness, Nutrition (plan editor, meal form, meters, 7-day strip), the universal timeline with filters,
Workouts (library picker, editor, log form), Mental and the to-do. One overflow was found and fixed
(LESSONS_LEARNED 022). Not tested on a real iPhone by me: your device check is still the final word.

## 4. Landing and pricing (read only, nothing changed)

* Prices, plans and entitlements are unchanged (`lib/plans.ts`, `lib/entitlements.ts`: the player
  database is in every paid plan, Light and up).
* Today's copy (`components/LandingPage.tsx`) claims "a player database and progress tracking across
  the whole season" — true on main (trackers, PR C).
* Merged but not mentioned yet: nutrition plans and the meal diary (PR E), the universal timeline and
  the share link where the player logs and the coach reviews (PR D, PR F). Proposed addition, once
  you have checked them on your phone: *"Your players log their meals, workouts and measurements
  from a private link; you review everything in one timeline."*
* **Not merged, must not be advertised yet:** workouts and the exercise library (PR G #194), mental
  questionnaires and the to-do (PR H #195), Drive copies of player pictures (designed only,
  `docs/DRIVE_PHOTOS.md`).

## 5. Open items (each needs you)

| Item | Why it waits | What I need |
|---|---|---|
| Run the SQL of PR C, D, E and the #193 fix in Supabase | the Supabase connector here cannot see the project | run the files listed in `docs/PLAYER_DATABASE.md` §5 (prompt given in chat) |
| PR G (#194) merge | Rule 8: `workouts.e2e.mjs` test defects | written approval of the two proposed test fixes |
| PR H (#195) merge | stacked on PR G; Rule 8: one `tsc` error in `tests/mental.test.ts` | written approval of the proposed fix |
| Workouts in the universal timeline | changes the expected value of `tests/history.test.ts` | written approval of the new expectation |
| `trackers.e2e.mjs` "share page trackers are read-only in this PR" | intended change since PR D | written approval of the new expectation |
| `timeline.e2e.mjs` "Added by: Me" selector | test defect (matches "Biometrics") | written approval of the fix |
| Drive copies of player pictures | product decision + coach consent | decision in `docs/DRIVE_PHOTOS.md` |
| Private picture URLs (KNOWN_ISSUES 078) | changes every picture route and stored URLs | go-ahead for a separate PR |
| Real-device check | I can only test in Chromium | your iPhone pass of the new tabs |
