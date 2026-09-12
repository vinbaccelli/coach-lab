# Lessons learned

Per CLAUDE.md §10. One entry per incident, newest last, in the format that
section specifies: **symptom → verified root cause → fix → the *class* of
mistake**. The class line is the point of the entry — it is what generalises to
the next incident that looks nothing like this one.

Record an entry when something cost real debugging time and the cause was not
obvious from the error. Do not record ordinary bugs fixed in the course of the
work they belong to.

> The companion **known-issues** log that §10 also asks for does not exist yet.
> When it is started, defects found while working on something else go there
> (symptom, root cause, fault assessment, proposed fix, severity) — not here.

---

## 001 — A deleted `/dev/*` harness breaks the next production build

*2026-09-05 · branch `snapshot-v1`*

### Symptom

`npx next build` failed during "Linting and checking validity of types":

```
Failed to compile.
Type error: Cannot find module '../../../../../app/dev/control-panel/page.js'
or its corresponding type declarations.
```

The named file did not exist, nothing in the committed source referenced it,
and the actual change in the working tree was unrelated (a component rewrite).
The error pointed at a path no code had ever imported, which is what made it
expensive: the instinct is to look for the import, and there isn't one.

### Verified root cause

To visually verify `components/ControlPanelHome.tsx` — which is only reachable
behind Supabase auth — a temporary route `app/dev/control-panel/page.tsx` was
created, using the dev-only `/dev/*` convention that `middleware.ts:35` already
allows outside production. The dev server ran with `NEXT_DIST_DIR=.next-3001`.

Loading that route made Next generate a route type at
`.next-3001/types/app/dev/control-panel/page.ts`, which **imports the route
module** to type-check it.

`tsconfig.json`'s `include` lists `.next-3001/types/**/*.ts` (along with twelve
other `.next-*/types` directories). So when the harness page was deleted, the
generated type it produced stayed behind, remained inside the compiler's
include set, and still imported a module that no longer existed.

The artifact outlived its source. Because the orphan sits in `include`, any
type-check over the project resolves it — the build's type step is simply where
it surfaced first.

### Fix

After removing a temporary `/dev/*` route, delete what the dev server generated
from it, before the next build:

```bash
rm -rf .next-3001/types/app/dev .next-3001/server/app/dev .next-3001/static/chunks/app/dev
```

Clearing the whole dist directory (`rm -rf .next-3001`) also works and is safer
if unsure which artifacts exist. Then re-run `npx tsc --noEmit -p tsconfig.json`
before the build, so an orphan is caught in seconds rather than minutes.

The same applies to every `.next-*` directory named in `tsconfig.json`'s
`include`, not just `.next-3001` — whichever `NEXT_DIST_DIR` the dev server was
using when the temporary route was loaded.

### Class of mistake

**Deleting a temporary file is not the same as undoing the change it caused.**
Scaffolding that a build tool has already *observed* leaves derived artifacts —
generated types, manifests, caches — and when those artifacts sit inside a
config's include set, they keep asserting the existence of something that is
gone. The resulting error names the deleted thing, never the tool that
generated the reference, so it reads as unrelated to the work in hand.

When removing anything temporary, ask what read it while it existed and what
that reader wrote down.

---

## 002 — A service worker's catch-all decides what goes stale, and it is easy to under-notice

**Symptom.** "Clicking Demo (Tutorial) loads the tennis court video." Reported
twice in one day as a wiring bug; both times the wiring was correct.

**Verified root cause.** `public/sw.js` ended with a blanket
stale-while-revalidate for every same-origin request that fell through the
earlier branches:

```js
return cached || networkFetch;   // hands back the OLD copy, refreshes for next time
```

A plain `fetch('/x.mp4')` has `request.destination === ''`, so it missed the
image/font branch and landed in that catch-all. Files served from `public/` have
**stable, unhashed URLs**, so re-encoding a video in place left every browser
that had already fetched it serving the old bytes indefinitely — there is no new
URL to break the tie.

**The distinction that matters.** Build output was never at risk. Next emits
content-hashed filenames, so a new build is a NEW URL and a cached entry cannot
shadow it. Verified by rebuilding: changing emitted code moved the analysis
chunk from `page-20a0462fb88eef0c.js` to `page-97c9b85e228d079a.js`, and
reverting restored the original hash. **Hashing is what makes caching safe; the
absence of hashing is what makes it dangerous.** The two must not share one
strategy.

**Fix.** Three routes instead of one catch-all: media never cached (unhashed,
large, and Range/206 responses cannot be stored at all); `/_next/static/`
cache-first (content-hashed, so staleness is impossible); everything else
network-first with the cache as an offline fallback only. `CACHE_NAME` bumped to
`angle-motion-v3` so `activate` evicts the entries the old rules wrote.

**Class of mistake.** *Applying one cache strategy across URLs with different
freshness guarantees.* The safety of a cache-first or SWR strategy comes entirely
from whether the URL changes when the content changes. `app/ServiceWorkerRegistration.tsx`
already carried a long comment about this exact hazard in DEV (where Next's chunk
names are stable) and tears the worker down there — the same reasoning was never
applied to unhashed production assets in `public/`.

**Second-order lesson.** Both times, the reported symptom pointed at
application code that turned out to be correct. When served bytes and source
agree but behaviour does not, suspect the layer between them — service worker,
CDN, or HTTP cache — before editing the source.

