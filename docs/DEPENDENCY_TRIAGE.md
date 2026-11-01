# Dependency alerts triage (read-only)

Date: 2026-11-01. Nothing was upgraded: `package.json` and `package-lock.json` are untouched in this PR.

**Source of the numbers.** The Dependabot alerts API refused access from the build session (`gh api …/dependabot/alerts` → 403 "Resource not accessible by integration"), so this uses `npm audit` on the committed lockfile. It reads the same GitHub advisory database, but it counts packages, while the Dependabot tab counts one alert per advisory per package. Expect the tab to show a higher number (see §1). Anything below marked *unverified* was not checked against the code or a live system.

## 1. Count by severity (`npm audit`, 2026-11-01)

| | critical | high | moderate | low | total |
|---|---|---|---|---|---|
| Vulnerable packages, all | 3 | 15 | 31 | 0 | **49** |
| Vulnerable packages, shipped code only (`--omit=dev`) | 3 | 13 | 13 | 0 | **29** |
| Distinct advisories behind them, all | 3 | 39 | 27 | 7 | **76** |
| Distinct advisories, shipped code only | 3 | 34 | 24 | 6 | **67** |

The three criticals are `next`, `dompurify` and `tar`.

## 2. Groups: direct or transitive, where it runs, and whether it is reachable

"Shipped" = runs for coaches (browser or Vercel functions). The app is hosted on Vercel (`next.config.js` comments on the 250 MB function limit; Vercel bot on the PRs).

| # | Group | Direct / transitive | Runs where | Reachable from this app? |
|---|---|---|---|---|
| G1 | **next 15.5.24** (critical): image-optimizer RCE with SVG, Server Actions DoS, two cache-poisoning advisories | direct, **pinned exactly** | Vercel functions | **Server Actions DoS: yes**, there is a server action (`app/actions/youtubeResolve.ts`, `'use server'`). **Image-optimizer RCE: not shown reachable**: `next.config.js` has no `images` block (so no `dangerouslyAllowSVG`), and `next/image` is only used in `components/LandingPage.tsx` with local `.webp` files (*unverified:* the advisory text itself was not read). **Cache poisoning:** advisories say "self-hosted"; the app is on Vercel. |
| G2 | **dompurify 3.4.14** (critical, 5 advisories) | transitive: optional dependency of `jspdf` | browser (`jspdf` is loaded by `lib/matchAnalysis/downloadReportPdf.ts:34`) | **Not shown reachable**: the code never calls `jsPDF.html()`, which is where jsPDF uses DOMPurify (*unverified:* jsPDF's own source was not read). |
| G3 | **undici 6.25.0** (high, 15 advisories) | transitive via direct `@ybd-project/ytdl-core` | Vercel functions (`lib/youtubeResolve.ts` and its server action) | **Partly**: it is the HTTP client for outbound calls to YouTube and the public Piped servers, so response-handling advisories (header and cookie injection, content-encoding DoS) apply to what those servers send. The WebSocket and EventSource advisories: not used by this app (*unverified:* ytdl-core's own use). |
| G4 | **qs 6.15.2**, **uuid 9.0.1**, **gaxios 6.7.1**, **googleapis 140 / googleapis-common** (moderate) | `googleapis` is direct; the rest transitive | Vercel functions (Drive, Docs, YouTube-connect routes) | **qs:** only our own parameters are stringified. **uuid:** the advisory needs a `buf` argument to v3/v5/v6 (*unverified:* gaxios' calls were not read). Low risk. |
| G5 | **ML stack:** `@huggingface/transformers` 4.2.0 (direct) → `onnxruntime-node` → `adm-zip` (high); `sharp` 0.34.5 (high) | direct + transitive | browser only: dynamic imports in `lib/stroMotionDraft/racketDetect.ts` and `samRacket.ts` | **No**: `onnxruntime-node` is kept out of the functions (`next.config.js:47`; the comment there says nothing server-side runs ONNX), `adm-zip` only runs in its install script, and no app code imports `sharp` (Next's own optional use is not exercised, see G1). |
| G6 | **ytdl-core install chain:** `tar` (critical, 12 advisories), `@mapbox/node-pre-gyp`, `canvas` 2.11.2, `jsdom` 25, `rimraf`, `glob` | transitive via direct `@ybd-project/ytdl-core` | `tar`, `node-pre-gyp`: **install time only** (unpacking a prebuilt `canvas`; the lockfile marks them optional). `jsdom` itself runs in functions. | **`tar`: not at runtime.** The `jsdom` finding comes only through `canvas`. No upstream fix: every published ytdl-core (up to 6.0.9-beta.12) depends on `jsdom ^25`. npm's suggested "fix" is a downgrade to 5.1.9 and should be ignored. |
| G7 | **Build tooling:** `postcss` (Next's nested 8.4.31 and the dev 8.5.14), `nanoid`, `source-map-js`, `browserslist`, `js-yaml`, `baseline-browser-mapping`, `postcss-selector-parser`, `@sentry/bundler-plugins` → `glob` → `minimatch` → `brace-expansion` | mostly transitive | build / CI only | **No**: they process our own CSS, config and source maps, not user input. |
| G8 | **Lint tooling:** `eslint` 8, `eslint-config-next`, `@typescript-eslint/*`, `minimatch` 3, `brace-expansion` 1, `flat-cache` … | direct (dev) + transitive | `npm run lint` only | **No.** |
| G9 | `@tensorflow-models/body-segmentation`, `…/pose-detection` (moderate) | direct | browser (the models); the finding is their `rimraf` dependency | **No**: nothing imports `rimraf` in the browser. No upstream fix. |
| G10 | **fabric 7.2.0** (moderate, XSS in SVG gradient serialisation) | direct, **dev dependency** | nothing at runtime | **No**: the only import is `import type` in `lib/drawingTools.ts:5`, which is erased. |
| G11 | **@sentry/nextjs** (moderate) | direct | flagged through the bundler plugin (build) and `@sentry/node` | **Build only.** The upstream fix is not out; npm's "fix" is a downgrade to 10.76.1 and should be ignored. |

## 3. Fix, upgrade type, and what could break

| Group | Fix | Type | What could break |
|---|---|---|---|
| G1 | `next` 15.5.24 → **15.5.28**; the exact pin in `package.json` must be edited (`npm audit fix` will not touch it) | patch | Nothing documented. Needs `tsc`, `npm test`, a build, and a preview check of `/analysis`, the middleware sign-in redirect, and the YouTube-link import (the server action). |
| G2 | dompurify → 3.4.17 | patch, inside jsPDF's `^3.3.1` | The PDF download (match report). |
| G3 | undici → 6.29.1 | minor, inside ytdl-core's `^6.20.1` | Importing a video from a YouTube link (outbound requests). |
| G4 | `qs` → 6.17.1: patch. `uuid`/`gaxios`/`googleapis-common`: **only by `googleapis` 140 → 189** | `qs` patch; `googleapis` **major** (its `googleapis-common` → ^9, `google-auth-library` → ^11) | `googleapis` is used by 8 server files (Docs, Drive, YouTube connect). A large client bump. Wait. |
| G5 | `@huggingface/transformers` 4.2.0 → 4.3.2, `onnxruntime-web` dev build 1.26 → 1.31, `onnxruntime-node` 1.24 → 1.30, `sharp` → 0.35.5, `adm-zip` → 0.6.1 | all semver-compatible, **but** it also moves three transitive packages by a major (`global-agent` 3 → 4, `matcher` 3 → 4, `serialize-error` 7 → 8) | In-browser model loading and inference for Motion Layer / racket detection. Needs a real browser test with a clip. |
| G6 | **None upstream.** Options: wait; or an `overrides` entry that points ytdl-core's `jsdom` at 26.1.x (already in the tree via fabric) | n/a / override | The YouTube import could break: jsdom is what ytdl-core runs. Not tried. |
| G7 | lockfile updates: postcss 8.5.32, nanoid 3.3.20, source-map-js 1.2.2, browserslist 4.29.5, js-yaml 4.3.2, … | patch/minor | Nothing at runtime. **Next's nested postcss 8.4.31 stays** until Next 16 (which bundles 8.5.23). |
| G8 | `eslint` 8 → 9 and a flat config migration | **major** | The lint setup. Wait. |
| G9 | none upstream | n/a | n/a |
| G10 | fabric → 7.4.0 | minor, dev only | Nothing at runtime. |
| G11 | `@sentry/nextjs` 11.9.0 → 11.10.0 (minor; does not clear the bundler-plugin finding) | minor | Browser and server error reporting; the scrubbing rules (`lib/sentryConfig.ts`) are ours and unchanged. |

## 4. Proposed batches

Each batch was simulated on a scratch copy of the lockfile (`npm … --package-lock-only`); the numbers are packages flagged by `npm audit` afterwards. **No build, tests or browser run were done on those versions**: the simulation shows what clears, not that the app still works.

| Batch | Contents | Flagged after (all / shipped code only) | Live-coach safety |
|---|---|---|---|
| start | | 49 (3C/15H/31M) / 29 (3C/13H/13M) | |
| **1. Runtime patches** | `next` 15.5.28 (exact pin edit), `undici` 6.29.1, `qs` 6.17.1, `dompurify` 3.4.17 (15 lockfile entries) | 46 (**1C**/14H/31M) / 26 (**1C**/12H/13M) | **Do first.** Removes two of the three criticals. Small, one deploy, easy to revert. Do the preview smoke tests listed in §3 for G1 and G3, then promote. |
| **2. Build and lint tooling** | the G7 lockfile updates, `fabric` 7.4.0 (dev), `@sentry/nextjs` 11.10.0 | 39 / 24 | Safe: no runtime change except the Sentry minor (check that an error still reaches Sentry in preview). |
| **3. ML stack** | the G5 list | 35 (1C/6H/28M) / 20 (1C/6H/13M) | **Not blind.** Needs the Motion Layer / racket-detection flow tested in a real browser first. Ship outside coaching hours, with batch 1 already stable. |
| Not proposed now | `googleapis` 189, ESLint 9, Next 16, a ytdl-core `jsdom` override | | **Wait**, each with its own task and tests (reasons in §3). |

What would still be flagged after batches 1–3 (35 packages): `tar` (critical) and `canvas`/`node-pre-gyp`/`jsdom` (G6), ytdl-core, Next's nested `postcss`, the ESLint chain, the Sentry bundler-plugin chain, the tfjs models, and the `googleapis` chain. None of those is shown reachable at runtime (§2), except the `jsdom` part of ytdl-core, which has no upstream fix.

## 5. Not verified

- The Dependabot tab itself (API refused); counts above are `npm audit`'s.
- Advisory texts were read from `npm audit`'s titles and ranges, not from the full GitHub advisories; the Next.js image-optimizer RCE conditions in particular.
- jsPDF's and gaxios' own source (G2, G4), ytdl-core's use of undici (G3).
- That Vercel's image optimizer does not use the vulnerable `sharp` build.
- Whether any batch builds, passes the tests, or runs: only dependency resolution was simulated.
- The `jsdom` override for ytdl-core.
