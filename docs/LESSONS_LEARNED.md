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


---

## 003 — A capability probe answered the wrong question, and hid an upstream EP bug for two rounds

*2026-09-16 · branch `claude/zealous-faraday-ijq9nz`*

### Symptom

Auto-racket detection found nothing, on every frame, on the coach's machine.
Object Select failed to prepare any frame. Both reported the identical error:

```
Error: failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE:
.../tensor_shape.cc:67 dimension <= num_dims was false. Invalid dimension of
4294967295 for SizeToDimension. Tensor has 1 dimensions.
```

The same code, the same models and the same footage worked perfectly in every
environment available for testing — 7/8 frames detected, rising to 8/8 with the
batch scale floor. Two earlier rounds looked for the cause in the application:
a released ImageBitmap, a collapsed body-scale unit, a degenerate capture. A
zero-pixel guard was added and did not help, because there was nothing wrong
with the input to guard against.

### Verified root cause

**ORT's WebGPU execution provider cannot run this model, and the machines used
for testing could never reach that code path.**

`4294967295` is `(size_t)(-1)` on wasm32: a negative axis arriving at an
unsigned dimension check. It is
[microsoft/onnxruntime#32438](https://github.com/microsoft/onnxruntime/issues/32438),
filed against `onnx-community/dfine_n_coco-ONNX` — which is exactly what
`public/models/dfine-n` is. The session is created successfully, the EP accepts
the whole graph, and the **first** `run()` throws. The issue records that the
wasm EP runs the same graph correctly at every input size, and that neither
`graphOptimizationLevel: 'disabled'` nor `freeDimensionOverrides` helps. Open
and unfixed at the time of writing.

Both `racketDetect.ts` and `samRacket.ts` chose their execution provider with
the same test:

```ts
if (adapter?.features?.has('shader-f16')) device = 'webgpu';
```

That asks whether the adapter can **compile** fp16 shaders. It cannot say
whether the EP will **execute** a given graph, and the two come apart precisely
here. An adapter with `shader-f16` passes, loads, and then fails every frame. An
adapter without it falls to wasm and everything works.

**Which is why this was invisible.** Every available test environment runs
SwiftShader, which does not expose `shader-f16`, so the probe failed, wasm was
chosen, and the pipeline passed end to end. The bug was unreachable in testing
and unavoidable in production on any machine with a real fp16-capable GPU.
Measured directly: forcing `device: 'webgpu'` on SwiftShader does not even
create a session (`Program Transpose requires f16 but the device does not
support it`), confirming the branch had never once been executed.

The input was never implicated, and this was checkable rather than assumable.
`RTDetrImageProcessor` resizes to a fixed 640×640 with `do_pad: false`, so
`pixel_values` is `[1,3,640,640] float32` for every frame regardless of source
size — logged directly off the real path. A constant, well-formed rank-4 input
cannot explain a failure that varies by machine, and "Tensor has 1 dimensions"
was never `pixel_values` but an internal tensor built mid-graph by the EP.

### Fix

Two different fixes, because the two models are in different situations.

**D-FINE is pinned to wasm.** The bug is a property of the model and the EP, not
of the device, so no capability check can express it and no probe should be
attempted. The pin carries the issue number and an escape hatch
(`window.__autoRacketWebGPU = true`) so the fix can be re-tested without a code
change once upstream lands one. Cost: ~580ms/frame against ~200–400ms, over the
1–15 frames of a batch, against a feature that previously returned zero
detections on affected machines.

**SAM verifies its EP by execution.** There is no evidence SAM-2 hits #32438, so
WebGPU is still worth having where it works (~4s per encode against ~9s). But
the first real run is now the test: if it throws while on WebGPU, the session is
released, the embedding cache is dropped with it — those tensors belong to the
runtime being abandoned — and the encode re-runs on a wasm session. Once per
tab. Verified by fault injection: the downgrade fires, the cache clears, the
rebuild lands on wasm, and Object Select arms normally.

### Class of mistake

***Probing for a capability when the question is whether the thing works.***
A feature flag describes what hardware supports, not what a software stack does
with it. Where the two can differ, the only honest test is to run the thing and
watch — which is what "verified by execution" means and why the SAM fix is
shaped the way it is.

### Second-order lesson

***A test environment that cannot reach a branch reports success for it.***
Every environment available here lacked `shader-f16`, so every test run took the
wasm path and passed, and three rounds of "measured, verified in a real browser"
evidence were all measurements of the branch that was not broken. Local
verification proves that the path *you executed* works. When a bug reproduces
for the user and not for you, establish *which branch each of you actually ran*
before investigating anything else — here, one line of the log
(`ready in 2779ms (webgpu...)` against `(wasm...)`) named the entire difference
and was present from the first report.
