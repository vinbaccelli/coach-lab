# Phone-safe editor opening after Auto-detect

Follows `docs/POST_AUTODETECT_FREEZE.md` (#146). Phones only: every path below is behind `isPhoneBudgetActive()` or only reachable from a phone-gated call; desktop runs the same calls as before.

## What changed
1. **"Opening editor…"** (`phoneFinalize.ts`, `app/analysis/page.tsx`). `finalizeBuiltAtNativeSize` sends `stro:opening-editor` first and waits two frames for it to paint. The page shows the text and holds the pass's final message until `stro:first-layers-drawn` (or a 45 s failsafe, an error, or a pass that built nothing), then restores it. A video that is not capped (no finalize) announces when the first composite starts.
2. **Sliced mask upscale** (`phoneFinalize.ts`). `upscaleAlphaMaskSliced` is the same arithmetic as `upscaleAlphaMask`, row for row, and yields after 25 ms of work (`SLICE_BUDGET_MS`). Output is byte-identical (tested). One macrotask yield after each frame's re-capture.
3. **First composite, one layer per frame** (`PhoneFirstComposite` in `phoneFinalize.ts`, call site `components/Canvas.tsx`). For a draft not composited before, the real `renderStroMotionDraftComposite` is called once for the background plate (every mask withheld), then once per layer (`overlayMode` + a `resolveMask` that lets exactly that layer through), in the one-pass paint order, onto an off-screen canvas with the visible canvas's size and transform; each frame the growing picture is copied 1:1 to the visible canvas. Overlay mode, a changed option mid-build, a changed transform (zoom/pan) after the build, and any draft already composited use the original one-pass call.
4. **Crash marker** (`hooks/useStroMotion.ts`, phone wrapper only). Kept set after the commit until the first layers are drawn (45 s failsafe), cleared at once on any error or when nothing was built.

## Measured, 4× CPU throttle, gate forced on, desktop Chromium (software GL)
Main-thread blocks (gaps in a 4 ms timer), last racket frame → editor ready. Before = #146 numbers from the same harness.

| | before (#146) | after |
|---|---|---|
| 1080p re-capture + upscale, per frame | 485–671 ms ×5 | ≤ ~105 ms (bounded by `createImageBitmap` 35–70 ms plus a ≤25 ms slice) |
| 1080p first layers | one block of 2594 ms | per layer: 264 / 450 / 1276 / 104 ms (run 2); 669 / 235 / 544 / 267 ms (run 1, 40 ms slices) |
| 1080p **longest block** | **2594 ms** | **1276 ms** |
| 4K re-capture + upscale, per frame | 1.7–2.3 s ×5 | 0.19 s ×4, one 0.98 s (a single 914 ms `createImageBitmap`) |
| 4K first layers | one block of 8548 ms | per layer: 2.4 / 2.5 / 4.5 / 2.7 s |
| 4K **longest block** | **8548 ms** | **4522 ms** |
| 4K editor opened by a tap | 3.3 s | 3.8 s (not addressed here) |

Marker/status timeline (unthrottled, 1080p): marker set at 39.4 s; "Opening editor…" shown 120.9 s → 122.8 s; marker cleared at 122.8 s, the same instant the first layers were drawn.

**Pixel comparison.** Same draft, same canvas: progressive result copied out, gate flipped off, original one-pass call re-rendered (5 `getImageData` calls confirm it ran), 2,628,080 bytes compared: **0 differing bytes, max delta 0**.

## What is not under 100 ms, and why
- **Each composite layer** is one unchanged `renderMaskedFrame` call (drawImage + full-frame `getImageData` + per-pixel loop + `putImageData`). That is the floor: ~0.3–1.3 s at 1080p and ~2.4–4.5 s at 4K at 4×. Getting below 100 ms needs a change inside `lib/stroMotionDraft/compositeFromDraft.ts` (row-banded masking, or masking on the GPU instead of a readback), which this prompt did not allow. Proposed as the next step.
- **`createImageBitmap` of a native frame** (35–70 ms at 1080p, 140–900 ms at 4K) cannot be sliced.
- A ~1.2 s block at 4K between the last re-capture and the commit log (not attributed; it sits in the unchanged commit/React render).
- The editor's first open at 4K (Canvas draw of a 4K frame) is unchanged.
- Run-to-run variance is large on software GL (the 1276 ms layer vs 264–450 ms for the others); each row is one or two runs, not a distribution.

## Known issues recorded
- Per-layer floor above (`compositeFromDraft.ts`).
- The progressive path also runs for later drafts (for example after closing the editor), not only the first after Auto-detect, and shows "Opening editor…" then. Cheap, but the wording is slightly off there.
- Branch 2 of the Canvas composite (no video bounds) still uses the one-pass call.

## Tests
`tests/phoneFirstComposite.test.ts` (15): sliced upscale equals the one-pass result, slices stay within budget, marker held until the layers are drawn / failsafe / cleared once, build order (background then one layer per call, ascending, reverse and windowed orders), overlay mode declined, option change hands back to the original call, new draft builds again, transform change not served from cache, source checks that the Canvas path is gated and falls back and that the desktop hook path returns the inner pass unchanged. No existing test changed. `npm test` 441/441, `tsc` 0 errors, `next build` clean.

Not run on a real iPhone.
