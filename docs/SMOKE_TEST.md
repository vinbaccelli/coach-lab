# Smoke test

A small Playwright test that builds the app, starts it, and loads the pages a coach hits first. It
catches a broken deploy (a page that errors on the server, throws in the browser, or is gone)
before a coach does. The `checks` job only runs the type check and the unit tests; this is the
only automatic check that the app actually starts and renders.

It uses **dummy settings and no real service**: no Supabase, Stripe, Google or YouTube. The test
aborts every request that leaves the local server, so it needs no network and cannot be made
flaky by an outside site.

## What it checks (`smoke/smoke.spec.ts`)

| Test | Fails when |
|---|---|
| Landing page `/` | the server answers with an error, the page throws an uncaught error, logs a `console.error`, shows "Application error", or has no heading |
| `/pricing` | same, or the plans headline is missing |
| `/login` | same, or the "Continue with Google" button is missing (also means the dummy Supabase settings were not picked up) |
| `/privacy` | same, or the "Privacy Policy" heading is missing |
| `/analysis`, signed out | it does not redirect to `/login`, or the redirect no longer carries `/analysis` |
| `/pricing/does-not-exist` | it is not an HTTP 404 with the not-found page |
| An unknown path outside the public list | it no longer goes to `/login` (see below) |

Failure messages are plain sentences that name the page and what was wrong, for example
`/privacy: expected HTTP 200 but the server answered 500`.

**Behavior worth knowing (found while writing it).** With Supabase configured, `middleware.ts` sends a
signed-out visitor to sign-in for any path that is not on its public list, so a mistyped URL shows the
login page, not a 404. Public prefixes (`/pricing/…`, `/privacy/…`, …) fall through to the normal 404.
The test pins both so a change is noticed. The redirect test only asserts the path: whether the query
string also survives (`?vdebug=1`) is covered by the unit tests (KNOWN_ISSUES 081).

## Run it locally

```bash
npm ci                                  # once; installs @playwright/test
npx playwright install chromium         # once; the browser (already present in some cloud sessions)
npm run smoke:build                     # a production build with the dummy settings (about 4 minutes)
npm run smoke                           # starts `next start` on port 3100, runs the 7 tests (about 10 seconds)
```

- `smoke:build` overwrites `.next`. The dummy `NEXT_PUBLIC_*` values are fixed into the build, so a
  normal `npm run build` is not enough: the sign-in redirect test needs them.
- The server uses port 3100 (`SMOKE_PORT=3200 npm run smoke` for another). An already-running server
  on that port is reused when not in CI.
- Reports and traces go to `smoke/.output/` (not committed). Open a trace with
  `npx playwright show-trace smoke/.output/test-results/<test>/trace.zip`.
- Windows: `smoke:build` sets the variables the Unix way; set the two `NEXT_PUBLIC_SUPABASE_*` values
  from `package.json` by hand there.

## In CI

`.github/workflows/ci.yml` has a second job, `smoke`, next to `checks` (which is unchanged). It runs
on every pull request and push to `main`, installs the browser, builds, and runs the tests. On a
failure it uploads `smoke/.output` as the `smoke-report` artifact (7 days).

It is a **separate job and not a required check** on purpose: a flaky run can never block a merge. A
red `smoke` means "look at this before merging", not "merging is blocked". One retry is allowed in CI;
a test that only passes on retry is shown as "flaky" in the report. Making it required is a repository
setting (branch protection), not part of this file.

Most of the job's time is the production build (about 4 minutes locally); the tests themselves take
seconds. `.next/cache` is cached between runs.

## Adding a test

Add it to `smoke/smoke.spec.ts` with the `load()` and `clean()` helpers: they give the plain-sentence
failures and the "no server error, no uncaught error" checks for free. Keep it to pages that need no
sign-in and no outside service.
