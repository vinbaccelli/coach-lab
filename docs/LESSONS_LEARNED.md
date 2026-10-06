# Lessons learned

Per CLAUDE.md §10. One entry per incident, newest last, in the format that
section specifies: **symptom → verified root cause → fix → the *class* of
mistake**. The class line is the point of the entry — it is what generalises to
the next incident that looks nothing like this one.

Record an entry when something cost real debugging time and the cause was not
obvious from the error. Do not record ordinary bugs fixed in the course of the
work they belong to.

> The companion **known-issues** log §10 also asks for is
> `docs/KNOWN_ISSUES.md`. Defects found while working on something else go there
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

---

## 004 — A fix that type-checks, reads correctly, and does nothing

**Date:** 2026-09-26. Found while fixing the toolbar-resize annotation desync
(KNOWN_ISSUES #010).

**Symptom.** Two consecutive attempts at the re-projection fix compiled clean
(`tsc` exit 0), read correctly on the page, and changed the measured outcome by
exactly zero. The marks drifted the same 0.0554 of frame width before and after
each attempt — byte-identical numbers, three runs apart.

**Verified root cause — two different silent no-ops, stacked.**

1. The first version read the pre-resize letterbox from `videoBoundsRef`. That
   ref is rewritten by the rAF render loop, and the resize handler is a PASSIVE
   `useEffect`, so the browser painted between React's commit and the callback.
   By the time the code ran, `videoBoundsRef` already held the POST-resize rect,
   the old-vs-new delta measured zero, and the guard skipped the remap.

2. The second version gated on `renderVideoRef.current`. For a plain HTML5
   upload — the most common case, and the reported one — that flag is FALSE:
   the clip is shown as a native `<video>` underlay rather than painted onto
   the canvas (`paintVideoOnCanvasA`, app/analysis/page.tsx:6716). The whole
   block was dead for exactly the scenario it was written for.

Neither could be seen from the diff. Both were found in one shot by a
five-line `console.log` inside the effect, printing what it actually measured:
`hasVideo:false, prevAnchor:null` is unambiguous where a code read is not.

**Class of mistake.** *Treating "it compiles and the logic reads right" as
evidence that it runs.* Same family as #003 (a capability probe answering the
wrong question) — the check performed was not the check needed. A guard that
is never true and a guard that is always true both produce a clean build and a
silent no-op.

**What to do instead.** For any fix whose effect is a runtime state change,
measure the SAME NUMBER before and after in a real browser. If the number is
unchanged, the fix did not run — do not reason about why it should have.
Instrument the branch and read what it decided. Here that also caught a third,
smaller defect the numbers exposed: the corrected version still left a 3.2%
residual, which the log traced to the very first resize step happening before
the anchor was seeded (predicted 0.4293, measured 0.4292 — an exact match that
confirmed the cause before the fix was written).

**Final state:** drift 0.0554 → 0.0005 of frame width, the residual being
red-pixel bounding-box quantisation at the new scale rather than real error.

---

## 005 — A `null` set in the same event as its replacement never reaches the DOM

*2026-09-27 · branch `claude/text-tool-fix`*

### Symptom

Typing a label, then clicking elsewhere on the canvas with the Text tool, left
the old label correctly committed at its own spot — and opened the new box
**already containing a copy of that same text**, instead of empty.

The commit half had been verified the same day and was genuinely correct. Only
the *new* box was wrong, which is why the earlier check passed: it confirmed the
old text landed in the right place and never re-read the new box's contents.

### Verified root cause

**The draft `<textarea>` is uncontrolled, and React never unmounted it between
the two drafts, so the browser kept the old text in the node.**

The element has no `value`, no `defaultValue` and no `key` — the typed text lives
only in the DOM node, and `commitNewTextDraft` reads it back through a ref. The
pointer-down handler for the Text tool commits the open draft and opens the next
one back to back:

```
if (newTextDraftRef.current) commitNewTextDraftRef.current?.();  // setNewTextDraft(null)
setNewTextDraft({ pos, ... });                                    // the new draft
```

Both are `setState` calls inside one React synthetic event on React 18, so they
**batch**. State went draft A → draft B with no `null` render in between, the
`{newTextDraft && …}` test never went false, React reconciled the same
`<textarea>` at the same position and reused the node — and with no value-ish
prop, nothing existed that would have reset it.

The code's own comment already named element reuse as the hazard and assumed
that *calling commit* answered it. It did not: commit's `null` is precisely what
batching coalesces away.

### Fix

Clear the node explicitly (`newTextInputRef.current.value = ''`) inside
`commitNewTextDraft`, right after reading the value. Keying the element to force
a remount was considered and rejected: unmounting a *focused* textarea risks a
stray `onBlur` firing against the draft that replaced it, and that handler
commits — it would close the box the coach had just opened. The clear leaves
mount/unmount behaviour untouched, which matters because the focus-race fix this
branch exists to deliver is built on that behaviour.

### Class of mistake

**Reasoning about a state transition as a sequence when the framework delivers it
as a single step.** An intermediate state that is set and replaced within one
batch does not exist as far as rendering is concerned: no effect sees it, no
element unmounts on it, no conditional goes false on it. Any cleanup that relies
on passing *through* that state — unmounting to reset an uncontrolled input,
clearing a ref in a `!value` effect branch — silently does nothing.

The related half: **verifying the assertion you wrote rather than the behaviour
the user reported.** "The first text lands at its original spot" was true and was
never the complaint. A two-part expectation needs both parts checked, and the
part you did not write the code for is the one to check first.


## 006 — Three Generate bugs that all came from reading state by position instead of by identity

*2026-09-26 · branch `claude/trusting-allen-ik77qp` · found by Vin in hands-on testing after launch*

Three separate defects in Metrics/Generate, diagnosed together. They look
unrelated — a false hardware warning, a misplaced skeleton, an unplayable file —
and they share one shape.

### Symptom 1 — "This device can't run foot lines smoothly live", ~20 s in, on capable hardware

**Verified root cause.** `detectPoseLive` returned bare `null` both when the
landmarker failed to initialise *and* when the video simply had no decodable
frame this instant (`lib/mediapipePose.ts` — `readyState < 2 || videoWidth < 16`).
The caller could only read `null` as "this device cannot run the model", so it
latched MediaPipe off for the session and blamed the hardware. `readyState`
drops below 2 on every seek, every buffering stall and every return to a
throttled tab — and the live loop detects on exactly those events
(`detectStaticFrame` is wired to `pause`/`seeked`). One scrub was enough.

Two more defects sat behind it. The "re-arm" the page documented on the foot-line
toggle never existed — the toggle effect reset the sample counters but left
`mpLiveDisabledRef`/`mpLiveNotifiedRef` latched, so only a reload could recover.
And the latency guard that was supposed to be the real capability test ran
**once per session**, on the first six post-warmup detections whenever they
arrived, with `s.length === MP_LIVE_GUARD_SAMPLES` — after which the array grew
forever and was never read again. Those six samples were frequently *paused*
detections, which re-run MediaPipe's full person detector on a cold region of
interest and cost several times what playback costs. The verdict was measured on
work that playback never performs.

**Fix.** A distinct `notReady` marker so a not-ready frame skips the tick; the
toggle actually re-arms; and the guard now samples only while playing, discards
the first detections after a seek, rolls its window (clearing it after each
verdict, as `poseWorker` already did with `inferSamples`), and requires two
consecutive over-budget windows before reverting.

### Symptom 2 — in a generated video spanning several snapshots, the skeleton is misplaced from the second snapshot onward, but looks right live

**Verified root cause.** AI Detect stored the snapshot's frozen pose as
`skFrames[skFrames.length - 1]` — the newest entry in the live pose cache **by
array position**, with no check that it belonged to the frame on screen.
Detection on a paused frame is asynchronous (the `seeked` handler starts it; it
lands 30-100 ms later) and the handler read the cache synchronously on click. A
coach who scrubbed to the next phase and hit AI Detect straight away stored the
*previous* phase's pose. The first snapshot escaped because the coach had usually
been playing there and its detection had long since landed.

It is invisible live — live shows the live or baked pose, which tracks the player
— and only surfaces where the stored pose is the sole source: a Generate hold.
The export was never at fault; it was the first honest look at the data.

The same path had a second defect. `saveActiveSnapshot` read
`biomechSelectedPhaseId` from its closure, and it is called from inside
`handleReplaySnapshots` — one long-running async function. So for an entire
replay or recording, every hold boundary persisted canvas state into whichever
snapshot happened to be selected when Record was pressed, overwriting that one
snapshot's pose, column and drawings with mid-motion state.

**Fix.** Pick the cached pose by time (same 0.12 s tolerance the canvas's own
`syncFromCache` uses) and detect on demand when nothing matches, rather than
storing a pose from another moment; and read the save target from a ref.

### Symptom 3 — the exported video will not play: "not supported"

**Verified root cause.** The recording is WebM/VP9 and is converted to MP4 by
ffmpeg.wasm. When that conversion failed the code kept the **WebM** and both
download buttons named it `.mp4` — a Matroska stream in an MP4 filename, which
every OS player rejects. Worse, the failure was usually silent: the "conversion
failed" status was gated on `retimeFactor < 1`, but the track-backed path records
at the coach's target rate, making `retimeFactor` exactly 1 — the common case.

Measured, in a real Chromium with the app's own COOP/COEP headers and a
canvas-`captureStream` WebM: the primary `libx264 -movflags +faststart` pass
succeeds and yields a valid H.264 MP4 at 640×360 and at 1280×720/≈20 s, with and
without the `setpts` retime. So the encoder is not the weak link — the **core
load** is (`@ffmpeg/core` is fetched from jsdelivr at runtime and is not a
dependency). With jsdelivr unreachable, `toBlobURL` throws `TypeError: Failed to
fetch` and the whole conversion returns `ok: false`. That is the file the coach
could not play, and its first four bytes are `1a 45 df a3` — EBML, i.e. WebM.

**Fix.** Name the file from the blob, not from intent; report a failed conversion
unconditionally; spend both of the first two ladder rungs on libx264 before
reaching `mpeg4` (MPEG-4 Part 2 is a valid MP4 container that Safari, QuickTime
and current Chrome refuse to decode, and it used to be attempt two); and validate
the bytes at both ends, as the screen-record converter in the same file already
did.

### Class of mistake

***Reading time-indexed state by position, and collapsing distinct failures into
one signal.***

Every one of these is a lookup that threw away the key. The pose cache is keyed
by `timeSeconds` and was read with `.at(-1)`. The snapshot to persist is
identified by an id that changes during the run and was read from a closure. The
latency verdict is about playback and was fed whatever samples arrived. And
`null` was made to carry both "not ready yet" and "cannot ever work", so the
caller had to guess — and guessed the expensive way, permanently, out loud, to
the user. Where a value has a key, match on the key; where two conditions have
different remedies, give them different signals.

### Second-order lesson

***A pipeline that falls back must never also rename the output.*** The Generate
export's fallback was defensible — ship the unconverted recording rather than
nothing. Labelling it `.mp4` is what turned a graceful degradation into a broken
deliverable, and doing it silently is what made it unreportable: the preview
plays WebM happily in Chrome, so the app looked like it had succeeded. The
working screen-record path in the same repo already tracked a real `outExt` and
refused to deliver on failure. Two converters, one file apart, opposite
honesty.

---

## 007 — A bundler ate the worker's dynamic import, and the error message was hidden behind a modal

*2026-09-30 · branch `claude/trusting-allen-ik77qp` · found by Vin testing the 004 H1 fix*

Two bugs stacked: MP4 conversion could never succeed, and the change meant to
*report* that failure reported it somewhere the coach could not see.

### Symptom

`Generate → Record video` produced a WebM and, in the console,
`[Generate] MP4 conversion failed: Error: Cannot find module
'blob:http://localhost:3001/3ca4f49a-…'`. On screen: nothing at all. Generate
appeared to finish (playable preview, download button) or to hang.

### Verified root cause 1 — webpack compiled `import(url)` into a module lookup

`@ffmpeg/ffmpeg`'s worker loads the core like this
(`dist/esm/worker.js`):

```js
try { importScripts(_coreURL); }                                   // classic worker
catch { self.createFFmpegCore = (await import(/* @vite-ignore */ _coreURL)).default; }
```

Two facts make that fatal under webpack:

1. `classes.js` always constructs the worker with `{ type: "module" }`, and module
   workers have no `importScripts` — so the try ALWAYS throws and the catch is the
   only path ever taken.
2. The pragma on that import is `@vite-ignore`. **Webpack has no equivalent**, so
   webpack compiles the call into its own registry. Read out of the built chunk,
   it becomes `t(30260)(s)` — `__webpack_require__` against a generated context
   module, with the URL passed as a **module key**. No registry entry is keyed by a
   runtime URL, so it throws `Cannot find module 'blob:…'`.

This had nothing to do with where the core was fetched from: reproduced with the
core served **same-origin, 200 OK**. It also hit every caller, since they share
one `getFFmpeg()` (known issue 015).

**Fix.** Serve `@ffmpeg/ffmpeg`'s worker as a static file from `public/ffmpeg/`
(staged from node_modules by `scripts/copy-ffmpeg-worker.mjs`, same pattern as
`copy-ort-wasm.mjs`) and pass it as `classWorkerURL`. Webpack never sees that
file, so the `import()` inside stays native.

The first attempt at that fix was wrong and measuring caught it: a root-relative
`'/ffmpeg/worker.js'` is resolved against `import.meta.url`, which webpack inlines
as the module's **filesystem** path, so the browser tried
`file:///ffmpeg/worker.js` and refused it. The URL has to be absolute
(`location.origin + path`) so the base cannot matter.

### Verified root cause 2 — the failure notice was painted under an opaque modal

The 004 change did call `setProcessingStatus(...)` on failure, correctly. But that
status renders as a `position: fixed` banner at **`zIndex: 240`**, and the Generate
workspace is a full-viewport modal (`inset: 0`) at **`zIndex: 10050`** behind
`rgba(0,0,0,0.85)`, hidden only while `generateRecording` is true. So
`setGenerateRecording(false)` in the `finally` un-hid the modal in the **same React
commit** that set the failure text. The message was correct, in state, and
permanently behind an opaque overlay — while the modal showed a playable WebM
preview and a button labelled "MP4".

**Fix.** Surface the verdict where the coach is looking: a `conversionNotice` prop
rendered inside the workspace next to the preview, plus an honest download-button
label derived from the blob. The banner is kept for the snapshot-strip path, which
is bottom-anchored and does not cover it.

### Class of mistake

***"Reported" is a claim about what reached the user, not about what the code
called.*** 004 was verified by reading the diff and by a console line. Both were
correct, and the user still saw nothing, because a status write is only half of a
status: the other half is stacking context. Any "now it tells the user" fix has to
be checked at the pixel the user looks at — here, `elementFromPoint` at the
notice's own centre, which is what finally proved it.

### Second-order lesson

***A repro that bypasses the build is not a repro of the app.*** 004's
investigation measured the ffmpeg encoders in a standalone Chromium page that
imported `@ffmpeg/ffmpeg` as raw ESM from `node_modules`. Every encoder passed —
truthfully — and the conclusion drawn from it ("the encoder is not the weak link,
the CDN is") was wrong, because the harness had no bundler and the bug *is* the
bundler. The same trap as 003's second-order lesson, one layer out: there, the
environment could not reach the broken branch; here, the environment did not
contain the broken transform. When a measurement is meant to stand in for the
app, the toolchain is part of what must be reproduced — this time the probe was a
real route in a real `next build`, and it reproduced Vin's error to the character
on the first run.
---

## 006 — A feature "stopped working when recording started" because a second renderer took over

*2026-09-26 · branch `claude/dreamy-lamport-urns2o`*

### Symptom

Webcam background removal worked in the Recording Hub preview and appeared to
stop the instant recording began; the PiP shape/geometry was wrong in the
recorded file too. Reported as two bugs (background removal, PiP rendering), and
an earlier round had proposed a fix for the first one alone.

### Verified root cause

One line: `components/Canvas.tsx` gated the canvas-drawn webcam PiP on
`!isRecordingRef.current`. That PiP was the *only* renderer that knew about
background removal (`webcamMaskRef`), the circle/rect shape, the coach's dragged
rect and the opacity. Suppressing it handed the webcam to two renderers that had
never heard of any of those settings: the encode composite's Source B stamp in
`contexts/RecordingContext.tsx` (raw stream, hard-coded 16:9 bottom-right box)
and the Document PiP window's raw `<video>` in `lib/pipRecorderSurface.ts`.

The MediaPipe segmenter itself never stopped — its effect depends only on
`[webcamCutout, webcamActive]`, so fresh masked frames were being produced the
whole time with nobody consuming them. Nothing was broken; the consumer had been
switched off.

### Fix

Canvas publishes its live PiP presentation (cutout canvas, shape, normalized
rect, aspect, opacity) through `lib/webcamPipPresentation.ts`; the composite
reads it once per painted frame and reproduces it. Whole-screen shares keep the
canvas PiP visible instead (the screen grab already contains it) and run the
floating window controls-only, so exactly one webcam reaches the file in every
share mode.

### Class of mistake

**Two renderers for one feature, and only one of them knows the settings.** The
tell was the phrasing: "works in preview, stops when recording starts" is almost
never a feature breaking — it is a *different code path taking over*, with its
own, poorer idea of what to draw. Find the handover before debugging the
feature. The corollary: when a display path is suppressed "to avoid doubling",
whatever replaces it inherits every setting the suppressed path owned, and
nothing enforces that — the settings simply disappear, silently, with no error.


---

## 008 — A control tied to a mode turned itself off in the order coaches actually work

### Symptom

Vin armed "Erase part of line" in Style, picked Circle to draw the mark he wanted
to cut, and the eraser had gone: the drag drew a new circle instead.

### Verified root cause

The eraser was a checkbox inside Style mode, and #56 made leaving Style disarm it
(an armed eraser nobody could see was cutting holes in later Select drags). Every
tool choice leaves Style (`handleToolChange` in `app/analysis/page.tsx`), so
"arm, then pick the drawing tool" always disarmed it. Both behaviours were
correct on their own; the control lived in the wrong place.

### Fix

The eraser is a tool on the Draw list (`Eraser`, tool id `erase`). Its armed size
is derived from the active tool in the page
(`activeTool === 'erase' && !styleMode ? eraserSize : 0`), so there is no
separate on/off state to forget: it is on exactly while its row is lit. One drag
cuts every outline the ring passes over (`eraseAt` in `components/Canvas.tsx`).

### Class of mistake

**A mode-scoped switch with a lifetime of its own.** If a setting can stay on
after the screen that shows it is gone, it needs a disarm rule, and every disarm
rule eventually fires in a workflow nobody pictured. When the thing is really an
action on the canvas, make it a tool: tools already have one owner (the active
tool), one visible state (the lit row), and one exit (picking another tool).
