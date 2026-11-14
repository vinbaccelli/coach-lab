# Local stack (dev / test only)

A real Postgres 16 with every migration in `supabase/migrations`, seeded test coaches, and
`server.mjs`: a small stand-in for the parts of Supabase the app uses (auth `getUser`, the REST
subset of PostgREST, storage uploads). Each REST request runs as the caller's role with its JWT
claims, so **Row Level Security is the real policy code**. Nothing here talks to production.

```bash
scripts/local-stack/start.sh --reset   # fresh database: bootstrap + migrations + seed
scripts/local-stack/dev.sh             # next dev on :3000 pointed at the stand-in
npm run test:db                        # migrations + RLS tests (tests-db/)
npm run test:e2e                       # browser workflows (Playwright, scripts/local-stack/e2e/)
```

Seeded accounts (see `seed.mjs`): `coachA` and `coachB` (Pro), `coachLight` (Light), `coachFree`
(no plan). `browser.mjs` gives a Playwright context signed in as any of them.

Needs PostgreSQL 16 binaries (`initdb`, `pg_ctl`, `psql`); when run as root it uses a `pgtest`
user because Postgres refuses to run as root.
