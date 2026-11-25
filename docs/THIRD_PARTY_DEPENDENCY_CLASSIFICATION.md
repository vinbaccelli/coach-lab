# Third-party dependency classification (second pass)

Written 2026-11-24. Not legal advice. **This file classifies; it changes nothing.** The full internal inventory in [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) is left untouched; the proposed customer-facing notice built from this classification is [`THIRD_PARTY_NOTICES_CUSTOMER_DRAFT.md`](THIRD_PARTY_NOTICES_CUSTOMER_DRAFT.md).

## Method (reproducible)
1. Fresh clone of this branch (`93130c3` + docs only) into a scratch directory outside the repository; `npm ci` (Node v22.23.5, npm 10.9.9); `npm run build` (Next.js 15.5.24) → exit 0. `git status` in the scratch clone after the build: clean (no tracked file changed). The real working tree was not built.
2. Second scratch build with the repository's own `@next/bundle-analyzer` switch: `ANALYZE=true NEXT_DIST_DIR=.next-analyze next build` → `client.html`, `nodejs.html`, `edge.html`. Every module path under `node_modules/<pkg>/` in each report was collected. **"Browser bundle" = the package has at least one module in the client report.**
3. Server-side externals: every `.nft.json` trace file under `.next/server/` and `.next/` was read; packages with traced files are "server (traced)". Packages with modules in the `nodejs`/`edge` reports are "server (bundled)".
4. Static files: `public/` directories copied from packages by the `prebuild`/`postinstall` scripts or committed, identified by byte comparison (`evidence/npm-package-byte-comparison.txt`) or by the copy scripts.
5. Lockfile flags: `dev: true` → dev-only; non-dev entries without an installed `package.json` on linux-x64 → optional platform-specific, not installed.

Caveats: Next.js ships many vendored libraries precompiled inside the `next` package (`next/dist/compiled/*`); they appear here only as `next`. The analyser shows modules **reachable** by webpack; lazily imported chunks count as bundled even if a user never triggers them. Results are for a linux-x64 build.

Counts (821 lockfile entries): 392 dev-only · 99 optional/not installed · **73 in the browser bundle** (of which 6 also ship static files) · 2 more ship only static files · 116 server-only (bundled or traced) · 139 installed but in no build output.

## Loaded remotely at runtime (not in our bundle; bytes controlled by a third party)
| what | URL | code | licence as declared |
|---|---|---|---|
| `@ffmpeg/core@0.12.10` (ffmpeg.wasm core) | `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.{js,wasm}` | `lib/ffmpegWebmToMp4.ts:10-11,78-79` | npm: GPL-2.0-or-later; build contains `--enable-gpl --enable-libx264 --enable-libx265` ([`FFMPEG_LICENSE_REVIEW.md`](FFMPEG_LICENSE_REVIEW.md)) |
| `@ffmpeg/core@0.12.6` | `https://unpkg.com/…/dist/umd` | `components/ExportModal.tsx:143` — **dead code, not in bundle** (`components/ExportModal` absent from all three analyser reports) | npm: MIT; same GPL build config |
| MediaPipe Selfie Segmentation solution | `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/` | `lib/webcamSegmentation.ts:7` | Apache-2.0 |
| COCO-SSD weights | `https://storage.googleapis.com/tfjs-models/savedmodel/ssd_mobilenet_v2/` | `lib/racketCocoDetect.ts:33` → `coco-ssd.js:515` | none found for weights |
| Gemini API (service, not code) | `generativelanguage.googleapis.com` | `lib/gemini/decodeMatchScreenshots.ts:20` | Google API terms (unread) |

## Actually redistributed by Anglemotion (served from our origin)
- **Browser JavaScript bundle**: the 73 packages marked **browser bundle** below.
- **Static files under `public/`**: `ort/*` (`onnxruntime-web`, generated at build), `ffmpeg/*.js` (`@ffmpeg/ffmpeg` worker, generated at build), `mediapipe-wasm/*` (`@mediapipe/tasks-vision@0.10.35`), `mediapipe-selfie/*` (`@mediapipe/selfie_segmentation@0.1.1675465747`, a transitive lockfile entry, not a direct dependency; byte-identical), `tesseract/*` (`tesseract.js` worker, `tesseract.js-core` wasm, `@tesseract.js-data/eng@1.0.0` traineddata — `tesseract.js-core` is transitive; `@tesseract.js-data/eng` is not in the lockfile at all, the file was matched by hash), and **model weights** in `public/models/*` (see audit register Part B/F).
- Model weights are listed separately from the runtimes that execute them (register Part F, last paragraph).

## Full table (every lockfile entry)
| package | version | declared licence | classification |
|---|---|---|---|
| @alloc/quick-lru | 5.2.0 | MIT | dev-only |
| @asamuzakjp/css-color | 3.2.0 | MIT | server (bundled or traced into server functions) |
| @babel/runtime | 7.29.7 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @csstools/color-helpers | 5.1.0 | MIT-0 | server (bundled or traced into server functions) |
| @csstools/css-calc | 2.1.4 | MIT | server (bundled or traced into server functions) |
| @csstools/css-color-parser | 3.1.0 | MIT | server (bundled or traced into server functions) |
| @csstools/css-parser-algorithms | 3.0.5 | MIT | server (bundled or traced into server functions) |
| @csstools/css-tokenizer | 3.0.4 | MIT | server (bundled or traced into server functions) |
| @discoveryjs/json-ext | 0.5.7 | MIT | dev-only |
| @emnapi/core | 1.9.2 | MIT | dev-only |
| @emnapi/runtime | 1.9.2 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @emnapi/wasi-threads | 1.2.1 | MIT | dev-only |
| @esbuild/aix-ppc64 | 0.28.2 | MIT | dev-only |
| @esbuild/android-arm | 0.28.2 | MIT | dev-only |
| @esbuild/android-arm64 | 0.28.2 | MIT | dev-only |
| @esbuild/android-x64 | 0.28.2 | MIT | dev-only |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | dev-only |
| @esbuild/darwin-x64 | 0.28.2 | MIT | dev-only |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT | dev-only |
| @esbuild/freebsd-x64 | 0.28.2 | MIT | dev-only |
| @esbuild/linux-arm | 0.28.2 | MIT | dev-only |
| @esbuild/linux-arm64 | 0.28.2 | MIT | dev-only |
| @esbuild/linux-ia32 | 0.28.2 | MIT | dev-only |
| @esbuild/linux-loong64 | 0.28.2 | MIT | dev-only |
| @esbuild/linux-mips64el | 0.28.2 | MIT | dev-only |
| @esbuild/linux-ppc64 | 0.28.2 | MIT | dev-only |
| @esbuild/linux-riscv64 | 0.28.2 | MIT | dev-only |
| @esbuild/linux-s390x | 0.28.2 | MIT | dev-only |
| @esbuild/linux-x64 | 0.28.2 | MIT | dev-only |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT | dev-only |
| @esbuild/netbsd-x64 | 0.28.2 | MIT | dev-only |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT | dev-only |
| @esbuild/openbsd-x64 | 0.28.2 | MIT | dev-only |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT | dev-only |
| @esbuild/sunos-x64 | 0.28.2 | MIT | dev-only |
| @esbuild/win32-arm64 | 0.28.2 | MIT | dev-only |
| @esbuild/win32-ia32 | 0.28.2 | MIT | dev-only |
| @esbuild/win32-x64 | 0.28.2 | MIT | dev-only |
| @eslint-community/eslint-utils | 4.9.1 | MIT | dev-only |
| @eslint-community/regexpp | 4.12.2 | MIT | dev-only |
| @eslint/eslintrc | 2.1.4 | MIT | dev-only |
| @eslint/js | 8.57.1 | MIT | dev-only |
| @ffmpeg/ffmpeg | 0.12.15 | MIT | **browser bundle**; **redistributed static file**; server (bundled or traced into server functions) |
| @ffmpeg/types | 0.12.4 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @ffmpeg/util | 0.12.2 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @huggingface/jinja | 0.5.9 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @huggingface/tokenizers | 0.1.3 | Apache-2.0 | installed, not in any build output (transitive/unused/type-only) |
| @huggingface/transformers | 4.2.0 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @humanwhocodes/config-array | 0.13.0 | Apache-2.0 | dev-only |
| @humanwhocodes/module-importer | 1.0.1 | Apache-2.0 | dev-only |
| @humanwhocodes/object-schema | 2.0.3 | BSD-3-Clause | dev-only |
| @img/colour | 1.1.0 | MIT | server (bundled or traced into server functions) |
| @img/sharp-darwin-arm64 | 0.34.5 | Apache-2.0 | optional, platform-specific, not installed |
| @img/sharp-darwin-x64 | 0.34.5 | Apache-2.0 | optional, platform-specific, not installed |
| @img/sharp-libvips-darwin-arm64 | 1.2.4 | LGPL-3.0-or-later | optional, platform-specific, not installed |
| @img/sharp-libvips-darwin-x64 | 1.2.4 | LGPL-3.0-or-later | optional, platform-specific, not installed |
| @img/sharp-libvips-linux-arm | 1.2.4 | LGPL-3.0-or-later | optional, platform-specific, not installed |
| @img/sharp-libvips-linux-arm64 | 1.2.4 | LGPL-3.0-or-later | optional, platform-specific, not installed |
| @img/sharp-libvips-linux-ppc64 | 1.2.4 | LGPL-3.0-or-later | optional, platform-specific, not installed |
| @img/sharp-libvips-linux-riscv64 | 1.2.4 | LGPL-3.0-or-later | optional, platform-specific, not installed |
| @img/sharp-libvips-linux-s390x | 1.2.4 | LGPL-3.0-or-later | optional, platform-specific, not installed |
| @img/sharp-libvips-linux-x64 | 1.2.4 | LGPL-3.0-or-later | server (bundled or traced into server functions) |
| @img/sharp-libvips-linuxmusl-arm64 | 1.2.4 | LGPL-3.0-or-later | optional, platform-specific, not installed |
| @img/sharp-libvips-linuxmusl-x64 | 1.2.4 | LGPL-3.0-or-later | server (bundled or traced into server functions) |
| @img/sharp-linux-arm | 0.34.5 | Apache-2.0 | optional, platform-specific, not installed |
| @img/sharp-linux-arm64 | 0.34.5 | Apache-2.0 | optional, platform-specific, not installed |
| @img/sharp-linux-ppc64 | 0.34.5 | Apache-2.0 | optional, platform-specific, not installed |
| @img/sharp-linux-riscv64 | 0.34.5 | Apache-2.0 | optional, platform-specific, not installed |
| @img/sharp-linux-s390x | 0.34.5 | Apache-2.0 | optional, platform-specific, not installed |
| @img/sharp-linux-x64 | 0.34.5 | Apache-2.0 | server (bundled or traced into server functions) |
| @img/sharp-linuxmusl-arm64 | 0.34.5 | Apache-2.0 | optional, platform-specific, not installed |
| @img/sharp-linuxmusl-x64 | 0.34.5 | Apache-2.0 | server (bundled or traced into server functions) |
| @img/sharp-wasm32 | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | optional, platform-specific, not installed |
| @img/sharp-win32-arm64 | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later | optional, platform-specific, not installed |
| @img/sharp-win32-ia32 | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later | optional, platform-specific, not installed |
| @img/sharp-win32-x64 | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later | optional, platform-specific, not installed |
| @jridgewell/gen-mapping | 0.3.13 | MIT | dev-only |
| @jridgewell/resolve-uri | 3.1.2 | MIT | dev-only |
| @jridgewell/sourcemap-codec | 1.5.5 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @jridgewell/trace-mapping | 0.3.31 | MIT | dev-only |
| @mapbox/node-pre-gyp | 1.0.11 | BSD-3-Clause | optional, platform-specific, not installed |
| @mediapipe/pose | 0.5.1675469404 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @mediapipe/selfie_segmentation | 0.1.1675465747 | Apache-2.0 | **redistributed static file** |
| @mediapipe/tasks-vision | 0.10.35 | Apache-2.0 | **browser bundle**; **redistributed static file**; server (bundled or traced into server functions) |
| @napi-rs/lzma-linux-x64-gnu | 1.5.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @napi-rs/wasm-runtime | 0.2.12 | MIT | dev-only |
| @next/bundle-analyzer | 16.2.9 | MIT | dev-only |
| @next/env | 15.5.24 | MIT | server (bundled or traced into server functions) |
| @next/eslint-plugin-next | 15.5.14 | MIT | dev-only |
| @next/swc-darwin-arm64 | 15.5.24 | MIT | optional, platform-specific, not installed |
| @next/swc-darwin-x64 | 15.5.24 | MIT | optional, platform-specific, not installed |
| @next/swc-linux-arm64-gnu | 15.5.24 | MIT | optional, platform-specific, not installed |
| @next/swc-linux-arm64-musl | 15.5.24 | MIT | optional, platform-specific, not installed |
| @next/swc-linux-x64-gnu | 15.5.24 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @next/swc-linux-x64-musl | 15.5.24 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @next/swc-win32-arm64-msvc | 15.5.24 | MIT | optional, platform-specific, not installed |
| @next/swc-win32-x64-msvc | 15.5.24 | MIT | optional, platform-specific, not installed |
| @nodelib/fs.scandir | 2.1.5 | MIT | dev-only |
| @nodelib/fs.stat | 2.0.5 | MIT | dev-only |
| @nodelib/fs.walk | 1.2.8 | MIT | dev-only |
| @nolyfill/is-core-module | 1.0.39 | MIT | dev-only |
| @opentelemetry/api | 1.10.0 | Apache-2.0 | server (bundled or traced into server functions) |
| @oxc-parser/binding-android-arm-eabi | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-android-arm64 | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-darwin-arm64 | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-darwin-x64 | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-freebsd-x64 | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-linux-arm-gnueabihf | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-linux-arm-musleabihf | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-linux-arm64-gnu | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-linux-arm64-musl | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-linux-ppc64-gnu | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-linux-riscv64-gnu | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-linux-riscv64-musl | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-linux-s390x-gnu | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-linux-x64-gnu | 0.152.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @oxc-parser/binding-linux-x64-musl | 0.152.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @oxc-parser/binding-openharmony-arm64 | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-win32-arm64-msvc | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-win32-ia32-msvc | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-parser/binding-win32-x64-msvc | 0.152.0 | MIT | optional, platform-specific, not installed |
| @oxc-project/types | 0.152.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @polka/url | 1.0.0-next.29 | MIT | dev-only |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| @rollup/plugin-commonjs | 28.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @rollup/pluginutils | 5.5.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @rollup/rollup-android-arm-eabi | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-android-arm64 | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-darwin-arm64 | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-darwin-x64 | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-freebsd-arm64 | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-freebsd-x64 | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-arm-gnueabihf | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-arm-musleabihf | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-arm64-gnu | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-arm64-musl | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-loong64-gnu | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-loong64-musl | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-ppc64-gnu | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-ppc64-musl | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-riscv64-gnu | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-riscv64-musl | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-s390x-gnu | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-linux-x64-gnu | 4.65.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @rollup/rollup-linux-x64-musl | 4.65.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @rollup/rollup-openbsd-x64 | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-openharmony-arm64 | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-win32-arm64-msvc | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-win32-ia32-msvc | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-win32-x64-gnu | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rollup/rollup-win32-x64-msvc | 4.65.0 | MIT | optional, platform-specific, not installed |
| @rtsao/scc | 1.1.0 | MIT | dev-only |
| @rushstack/eslint-patch | 1.16.1 | MIT | dev-only |
| @sentry/browser | 11.9.0 | MIT | **browser bundle** |
| @sentry/browser-utils | 11.9.0 | MIT | **browser bundle** |
| @sentry/bundler-plugins | 11.9.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @sentry/cloudflare | 11.9.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @sentry/conventions | 0.27.0 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @sentry/core | 11.9.0 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @sentry/feedback | 11.9.0 | MIT | **browser bundle** |
| @sentry/nextjs | 11.9.0 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @sentry/node | 11.9.0 | MIT | server (bundled or traced into server functions) |
| @sentry/opentelemetry | 11.9.0 | MIT | server (bundled or traced into server functions) |
| @sentry/react | 11.9.0 | MIT | **browser bundle** |
| @sentry/replay | 11.9.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @sentry/replay-canvas | 11.9.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @sentry/server-runtime-injection | 11.9.0 | MIT | server (bundled or traced into server functions) |
| @sentry/server-utils | 11.9.0 | MIT | server (bundled or traced into server functions) |
| @sentry/vercel-edge | 11.9.0 | MIT | server (bundled or traced into server functions) |
| @supabase/auth-js | 2.108.2 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @supabase/functions-js | 2.108.2 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @supabase/phoenix | 0.4.4 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @supabase/postgrest-js | 2.108.2 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @supabase/realtime-js | 2.108.2 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @supabase/ssr | 0.12.0 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @supabase/storage-js | 2.108.2 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @supabase/supabase-js | 2.108.2 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| @swc/helpers | 0.5.15 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow-models/body-segmentation | 1.0.2 | Apache-2.0 | installed, not in any build output (transitive/unused/type-only) |
| @tensorflow-models/coco-ssd | 2.2.3 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow-models/pose-detection | 2.1.3 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow/tfjs | 4.22.0 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow/tfjs-backend-cpu | 4.22.0 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow/tfjs-backend-wasm | 4.22.0 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow/tfjs-backend-webgl | 4.22.0 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow/tfjs-backend-webgpu | 4.22.0 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow/tfjs-converter | 4.22.0 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow/tfjs-core | 4.22.0 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow/tfjs-data | 4.22.0 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| @tensorflow/tfjs-layers | 4.22.0 | Apache-2.0 AND MIT | **browser bundle**; server (bundled or traced into server functions) |
| @tybys/wasm-util | 0.10.1 | MIT | dev-only |
| @types/dom-mediacapture-transform | 0.1.12 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/dom-webcodecs | 0.1.13 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/emscripten | 0.0.34 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/estree | 1.0.9 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/json5 | 0.0.29 | MIT | dev-only |
| @types/long | 4.0.2 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/node | 20.19.39 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/node-fetch | 2.6.13 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/offscreencanvas | 2019.7.3 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/offscreencanvas | 2019.3.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/pako | 2.0.4 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/pg | 8.23.1 | MIT | dev-only |
| @types/prop-types | 15.7.15 | MIT | dev-only |
| @types/raf | 3.4.3 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/react | 18.3.28 | MIT | dev-only |
| @types/react-dom | 18.3.7 | MIT | dev-only |
| @types/seedrandom | 2.4.34 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @types/trusted-types | 2.0.7 | MIT | installed, not in any build output (transitive/unused/type-only) |
| @typescript-eslint/eslint-plugin | 8.58.0 | MIT | dev-only |
| @typescript-eslint/parser | 8.58.0 | MIT | dev-only |
| @typescript-eslint/project-service | 8.58.0 | MIT | dev-only |
| @typescript-eslint/scope-manager | 8.58.0 | MIT | dev-only |
| @typescript-eslint/tsconfig-utils | 8.58.0 | MIT | dev-only |
| @typescript-eslint/type-utils | 8.58.0 | MIT | dev-only |
| @typescript-eslint/types | 8.58.0 | MIT | dev-only |
| @typescript-eslint/typescript-estree | 8.58.0 | MIT | dev-only |
| @typescript-eslint/utils | 8.58.0 | MIT | dev-only |
| @typescript-eslint/visitor-keys | 8.58.0 | MIT | dev-only |
| @ungap/structured-clone | 1.3.0 | ISC | dev-only |
| @unrs/resolver-binding-android-arm-eabi | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-android-arm64 | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-darwin-arm64 | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-darwin-x64 | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-freebsd-x64 | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-linux-arm-gnueabihf | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-linux-arm-musleabihf | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-linux-arm64-gnu | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-linux-arm64-musl | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-linux-ppc64-gnu | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-linux-riscv64-gnu | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-linux-riscv64-musl | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-linux-s390x-gnu | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-linux-x64-gnu | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-linux-x64-musl | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-wasm32-wasi | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-win32-arm64-msvc | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-win32-ia32-msvc | 1.11.1 | MIT | dev-only |
| @unrs/resolver-binding-win32-x64-msvc | 1.11.1 | MIT | dev-only |
| @webgpu/types | 0.1.38 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| @ybd-project/ytdl-core | 6.0.8 | MIT | server (bundled or traced into server functions) |
| abbrev | 1.1.1 | ISC | optional, platform-specific, not installed |
| acorn | 8.16.0 | MIT | server (bundled or traced into server functions) |
| acorn-jsx | 5.3.2 | MIT | dev-only |
| acorn-walk | 8.3.5 | MIT | dev-only |
| adm-zip | 0.5.18 | MIT | installed, not in any build output (transitive/unused/type-only) |
| agent-base | 6.0.2 | MIT | optional, platform-specific, not installed |
| agent-base | 7.1.4 | MIT | server (bundled or traced into server functions) |
| ajv | 6.14.0 | MIT | dev-only |
| ansi-regex | 5.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| ansi-styles | 4.3.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| any-promise | 1.3.0 | MIT | dev-only |
| anymatch | 3.1.3 | ISC | dev-only |
| aproba | 2.1.0 | ISC | optional, platform-specific, not installed |
| are-we-there-yet | 2.0.0 | ISC | optional, platform-specific, not installed |
| arg | 5.0.2 | MIT | dev-only |
| argparse | 1.0.10 | MIT | installed, not in any build output (transitive/unused/type-only) |
| argparse | 2.0.1 | Python-2.0 | dev-only |
| aria-query | 5.3.2 | Apache-2.0 | dev-only |
| array-buffer-byte-length | 1.0.2 | MIT | dev-only |
| array-includes | 3.1.9 | MIT | dev-only |
| array.prototype.findlast | 1.2.5 | MIT | dev-only |
| array.prototype.findlastindex | 1.2.6 | MIT | dev-only |
| array.prototype.flat | 1.3.3 | MIT | dev-only |
| array.prototype.flatmap | 1.3.3 | MIT | dev-only |
| array.prototype.tosorted | 1.1.4 | MIT | dev-only |
| arraybuffer.prototype.slice | 1.0.4 | MIT | dev-only |
| ast-types-flow | 0.0.8 | MIT | dev-only |
| async-function | 1.0.0 | MIT | dev-only |
| asynckit | 0.4.0 | MIT | server (bundled or traced into server functions) |
| autoprefixer | 10.4.27 | MIT | dev-only |
| available-typed-arrays | 1.0.7 | MIT | dev-only |
| axe-core | 4.11.2 | MPL-2.0 | dev-only |
| axobject-query | 4.1.0 | Apache-2.0 | dev-only |
| balanced-match | 4.0.4 | MIT | installed, not in any build output (transitive/unused/type-only) |
| balanced-match | 4.0.4 | MIT | dev-only |
| balanced-match | 1.0.2 | MIT | installed, not in any build output (transitive/unused/type-only) |
| base64-arraybuffer | 1.0.2 | MIT | installed, not in any build output (transitive/unused/type-only) |
| base64-js | 1.5.1 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| baseline-browser-mapping | 2.10.14 | Apache-2.0 | dev-only |
| bgutils-js | 3.2.0 | MIT | server (bundled or traced into server functions) |
| bignumber.js | 9.3.1 | MIT | server (bundled or traced into server functions) |
| binary-extensions | 2.3.0 | MIT | dev-only |
| bl | 4.1.0 | MIT | dev-only |
| bmp-js | 0.1.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| boolean | 3.2.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| brace-expansion | 5.0.12 | MIT | installed, not in any build output (transitive/unused/type-only) |
| brace-expansion | 5.0.6 | MIT | dev-only |
| brace-expansion | 1.1.13 | MIT | installed, not in any build output (transitive/unused/type-only) |
| braces | 3.0.3 | MIT | dev-only |
| browserslist | 4.28.2 | MIT | dev-only |
| buffer | 5.7.1 | MIT | dev-only |
| buffer-equal-constant-time | 1.0.1 | BSD-3-Clause | server (bundled or traced into server functions) |
| call-bind | 1.0.8 | MIT | dev-only |
| call-bind-apply-helpers | 1.0.2 | MIT | server (bundled or traced into server functions) |
| call-bound | 1.0.4 | MIT | server (bundled or traced into server functions) |
| callsites | 3.1.0 | MIT | dev-only |
| camelcase-css | 2.0.1 | MIT | dev-only |
| caniuse-lite | 1.0.30001784 | CC-BY-4.0 | installed, not in any build output (transitive/unused/type-only) |
| canvas | 2.11.2 | MIT | optional, platform-specific, not installed |
| canvas | 3.2.3 | MIT | dev-only |
| canvg | 3.0.11 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| chalk | 4.1.2 | MIT | installed, not in any build output (transitive/unused/type-only) |
| chokidar | 3.6.0 | MIT | dev-only |
| chownr | 1.1.4 | ISC | dev-only |
| chownr | 2.0.0 | ISC | optional, platform-specific, not installed |
| client-only | 0.0.1 | MIT | server (bundled or traced into server functions) |
| cliui | 7.0.4 | ISC | installed, not in any build output (transitive/unused/type-only) |
| color-convert | 2.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| color-name | 1.1.4 | MIT | installed, not in any build output (transitive/unused/type-only) |
| color-support | 1.1.3 | ISC | optional, platform-specific, not installed |
| combined-stream | 1.0.8 | MIT | server (bundled or traced into server functions) |
| commander | 4.1.1 | MIT | dev-only |
| commander | 7.2.0 | MIT | dev-only |
| commondir | 1.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| concat-map | 0.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| console-control-strings | 1.1.0 | ISC | optional, platform-specific, not installed |
| cookie | 1.1.1 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| core-js | 3.29.1 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| cross-spawn | 7.0.6 | MIT | dev-only |
| css-line-break | 2.1.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| cssesc | 3.0.0 | MIT | dev-only |
| cssstyle | 4.6.0 | MIT | server (bundled or traced into server functions) |
| csstype | 3.2.3 | MIT | dev-only |
| damerau-levenshtein | 1.0.8 | BSD-2-Clause | dev-only |
| data-urls | 5.0.0 | MIT | server (bundled or traced into server functions) |
| data-view-buffer | 1.0.2 | MIT | dev-only |
| data-view-byte-length | 1.0.2 | MIT | dev-only |
| data-view-byte-offset | 1.0.1 | MIT | dev-only |
| debounce | 1.2.1 | MIT | dev-only |
| debug | 4.4.3 | MIT | server (bundled or traced into server functions) |
| debug | 3.2.7 | MIT | dev-only |
| debug | 3.2.7 | MIT | dev-only |
| debug | 3.2.7 | MIT | dev-only |
| decimal.js | 10.6.0 | MIT | server (bundled or traced into server functions) |
| decompress-response | 4.2.1 | MIT | optional, platform-specific, not installed |
| decompress-response | 6.0.0 | MIT | dev-only |
| deep-extend | 0.6.0 | MIT | dev-only |
| deep-is | 0.1.4 | MIT | dev-only |
| define-data-property | 1.1.4 | MIT | installed, not in any build output (transitive/unused/type-only) |
| define-properties | 1.2.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| delayed-stream | 1.0.0 | MIT | server (bundled or traced into server functions) |
| delegates | 1.0.0 | MIT | optional, platform-specific, not installed |
| detect-libc | 2.1.2 | Apache-2.0 | server (bundled or traced into server functions) |
| detect-node | 2.1.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| didyoumean | 1.2.2 | Apache-2.0 | dev-only |
| dlv | 1.1.3 | MIT | dev-only |
| doctrine | 3.0.0 | Apache-2.0 | dev-only |
| doctrine | 2.1.0 | Apache-2.0 | dev-only |
| doctrine | 2.1.0 | Apache-2.0 | dev-only |
| dompurify | 3.4.14 | (MPL-2.0 OR Apache-2.0) | **browser bundle**; server (bundled or traced into server functions) |
| dotenv | 17.4.2 | BSD-2-Clause | installed, not in any build output (transitive/unused/type-only) |
| dunder-proto | 1.0.1 | MIT | server (bundled or traced into server functions) |
| duplexer | 0.1.2 | MIT | dev-only |
| ecdsa-sig-formatter | 1.0.11 | Apache-2.0 | server (bundled or traced into server functions) |
| electron-to-chromium | 1.5.331 | ISC | dev-only |
| emoji-regex | 9.2.2 | MIT | dev-only |
| emoji-regex | 8.0.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| end-of-stream | 1.4.5 | MIT | dev-only |
| entities | 6.0.1 | BSD-2-Clause | server (bundled or traced into server functions) |
| es-abstract | 1.24.1 | MIT | dev-only |
| es-define-property | 1.0.1 | MIT | server (bundled or traced into server functions) |
| es-errors | 1.3.0 | MIT | server (bundled or traced into server functions) |
| es-iterator-helpers | 1.3.1 | MIT | dev-only |
| es-object-atoms | 1.1.1 | MIT | server (bundled or traced into server functions) |
| es-set-tostringtag | 2.1.0 | MIT | server (bundled or traced into server functions) |
| es-shim-unscopables | 1.1.0 | MIT | dev-only |
| es-to-primitive | 1.3.0 | MIT | dev-only |
| es6-error | 4.1.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| esbuild | 0.28.2 | MIT | dev-only |
| escalade | 3.2.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| escape-string-regexp | 4.0.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| eslint | 8.57.1 | MIT | dev-only |
| eslint-config-next | 15.5.14 | MIT | dev-only |
| eslint-import-resolver-node | 0.3.10 | MIT | dev-only |
| eslint-import-resolver-typescript | 3.10.1 | ISC | dev-only |
| eslint-module-utils | 2.12.1 | MIT | dev-only |
| eslint-plugin-import | 2.32.0 | MIT | dev-only |
| eslint-plugin-jsx-a11y | 6.10.2 | MIT | dev-only |
| eslint-plugin-react | 7.37.5 | MIT | dev-only |
| eslint-plugin-react-hooks | 5.2.0 | MIT | dev-only |
| eslint-scope | 7.2.2 | BSD-2-Clause | dev-only |
| eslint-visitor-keys | 5.0.1 | Apache-2.0 | dev-only |
| eslint-visitor-keys | 3.4.3 | Apache-2.0 | dev-only |
| espree | 9.6.1 | BSD-2-Clause | dev-only |
| esquery | 1.7.0 | BSD-3-Clause | dev-only |
| esrecurse | 4.3.0 | BSD-2-Clause | dev-only |
| estraverse | 5.3.0 | BSD-2-Clause | dev-only |
| estree-walker | 2.0.2 | MIT | installed, not in any build output (transitive/unused/type-only) |
| esutils | 2.0.3 | BSD-2-Clause | dev-only |
| expand-template | 2.0.3 | (MIT OR WTFPL) | dev-only |
| extend | 3.0.2 | MIT | server (bundled or traced into server functions) |
| fabric | 7.2.0 | MIT | dev-only |
| fast-deep-equal | 3.1.3 | MIT | dev-only |
| fast-glob | 3.3.1 | MIT | dev-only |
| fast-glob | 3.3.3 | MIT | dev-only |
| fast-json-stable-stringify | 2.1.0 | MIT | dev-only |
| fast-levenshtein | 2.0.6 | MIT | dev-only |
| fast-png | 6.4.0 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| fastq | 1.20.1 | ISC | dev-only |
| fdir | 6.5.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| fflate | 0.8.3 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| file-entry-cache | 6.0.1 | MIT | dev-only |
| fill-range | 7.1.1 | MIT | dev-only |
| find-up | 5.0.0 | MIT | dev-only |
| flat-cache | 3.2.0 | MIT | dev-only |
| flatbuffers | 25.9.23 | Apache-2.0 | installed, not in any build output (transitive/unused/type-only) |
| flatted | 3.4.2 | ISC | dev-only |
| for-each | 0.3.5 | MIT | dev-only |
| form-data | 4.0.6 | MIT | server (bundled or traced into server functions) |
| fraction.js | 5.3.4 | MIT | dev-only |
| fs-constants | 1.0.0 | MIT | dev-only |
| fs-minipass | 2.1.0 | ISC | optional, platform-specific, not installed |
| fs.realpath | 1.0.0 | ISC | installed, not in any build output (transitive/unused/type-only) |
| fsevents | 2.3.3 | MIT | optional, platform-specific, not installed |
| function-bind | 1.1.2 | MIT | server (bundled or traced into server functions) |
| function.prototype.name | 1.1.8 | MIT | dev-only |
| functions-have-names | 1.2.3 | MIT | dev-only |
| gauge | 3.0.2 | ISC | optional, platform-specific, not installed |
| gaxios | 6.7.1 | Apache-2.0 | server (bundled or traced into server functions) |
| gcp-metadata | 6.1.1 | Apache-2.0 | server (bundled or traced into server functions) |
| generator-function | 2.0.1 | MIT | dev-only |
| get-caller-file | 2.0.5 | ISC | installed, not in any build output (transitive/unused/type-only) |
| get-intrinsic | 1.3.0 | MIT | server (bundled or traced into server functions) |
| get-proto | 1.0.1 | MIT | server (bundled or traced into server functions) |
| get-symbol-description | 1.1.0 | MIT | dev-only |
| get-tsconfig | 4.13.7 | MIT | dev-only |
| github-from-package | 0.0.0 | MIT | dev-only |
| glob | 13.0.6 | BlueOak-1.0.0 | installed, not in any build output (transitive/unused/type-only) |
| glob | 7.2.3 | ISC | installed, not in any build output (transitive/unused/type-only) |
| glob-parent | 5.1.2 | ISC | dev-only |
| glob-parent | 5.1.2 | ISC | dev-only |
| glob-parent | 6.0.2 | ISC | dev-only |
| glob-parent | 5.1.2 | ISC | dev-only |
| global-agent | 3.0.0 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| globals | 13.24.0 | MIT | dev-only |
| globalthis | 1.0.4 | MIT | installed, not in any build output (transitive/unused/type-only) |
| google-auth-library | 9.15.1 | Apache-2.0 | server (bundled or traced into server functions) |
| google-logging-utils | 0.0.2 | Apache-2.0 | server (bundled or traced into server functions) |
| googleapis | 140.0.1 | Apache-2.0 | server (bundled or traced into server functions) |
| googleapis-common | 7.2.0 | Apache-2.0 | server (bundled or traced into server functions) |
| gopd | 1.2.0 | MIT | server (bundled or traced into server functions) |
| graphemer | 1.4.0 | MIT | dev-only |
| gtoken | 7.1.0 | MIT | server (bundled or traced into server functions) |
| guid-typescript | 1.0.9 | ISC | installed, not in any build output (transitive/unused/type-only) |
| gzip-size | 6.0.0 | MIT | dev-only |
| has-bigints | 1.1.0 | MIT | dev-only |
| has-flag | 4.0.0 | MIT | server (bundled or traced into server functions) |
| has-property-descriptors | 1.0.2 | MIT | installed, not in any build output (transitive/unused/type-only) |
| has-proto | 1.2.0 | MIT | dev-only |
| has-symbols | 1.1.0 | MIT | server (bundled or traced into server functions) |
| has-tostringtag | 1.0.2 | MIT | server (bundled or traced into server functions) |
| has-unicode | 2.0.1 | ISC | optional, platform-specific, not installed |
| hasown | 2.0.4 | MIT | server (bundled or traced into server functions) |
| html-encoding-sniffer | 4.0.0 | MIT | server (bundled or traced into server functions) |
| html-escaper | 2.0.2 | MIT | dev-only |
| html-to-image | 1.11.13 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| html2canvas | 1.4.1 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| http-proxy-agent | 7.0.2 | MIT | server (bundled or traced into server functions) |
| https-proxy-agent | 5.0.1 | MIT | optional, platform-specific, not installed |
| https-proxy-agent | 7.0.6 | MIT | server (bundled or traced into server functions) |
| iceberg-js | 0.8.1 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| iconv-lite | 0.6.3 | MIT | server (bundled or traced into server functions) |
| idb-keyval | 6.3.0 | Apache-2.0 | installed, not in any build output (transitive/unused/type-only) |
| ieee754 | 1.2.1 | BSD-3-Clause | dev-only |
| ignore | 7.0.5 | MIT | dev-only |
| ignore | 5.3.2 | MIT | dev-only |
| import-fresh | 3.3.1 | MIT | dev-only |
| imurmurhash | 0.1.4 | MIT | dev-only |
| inflight | 1.0.6 | ISC | installed, not in any build output (transitive/unused/type-only) |
| inherits | 2.0.4 | ISC | installed, not in any build output (transitive/unused/type-only) |
| ini | 1.3.8 | ISC | dev-only |
| internal-slot | 1.1.0 | MIT | dev-only |
| iobuffer | 5.4.0 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| is-array-buffer | 3.0.5 | MIT | dev-only |
| is-async-function | 2.1.1 | MIT | dev-only |
| is-bigint | 1.1.0 | MIT | dev-only |
| is-binary-path | 2.1.0 | MIT | dev-only |
| is-boolean-object | 1.2.2 | MIT | dev-only |
| is-bun-module | 2.0.0 | MIT | dev-only |
| is-callable | 1.2.7 | MIT | dev-only |
| is-core-module | 2.16.1 | MIT | dev-only |
| is-data-view | 1.0.2 | MIT | dev-only |
| is-date-object | 1.1.0 | MIT | dev-only |
| is-electron | 2.2.2 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| is-extglob | 2.1.1 | MIT | dev-only |
| is-finalizationregistry | 1.1.1 | MIT | dev-only |
| is-fullwidth-code-point | 3.0.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| is-generator-function | 1.1.2 | MIT | dev-only |
| is-glob | 4.0.3 | MIT | dev-only |
| is-map | 2.0.3 | MIT | dev-only |
| is-negative-zero | 2.0.3 | MIT | dev-only |
| is-number | 7.0.0 | MIT | dev-only |
| is-number-object | 1.1.1 | MIT | dev-only |
| is-path-inside | 3.0.3 | MIT | dev-only |
| is-plain-object | 5.0.0 | MIT | dev-only |
| is-potential-custom-element-name | 1.0.1 | MIT | server (bundled or traced into server functions) |
| is-reference | 1.2.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| is-regex | 1.2.1 | MIT | dev-only |
| is-set | 2.0.3 | MIT | dev-only |
| is-shared-array-buffer | 1.0.4 | MIT | dev-only |
| is-stream | 2.0.1 | MIT | server (bundled or traced into server functions) |
| is-string | 1.1.1 | MIT | dev-only |
| is-symbol | 1.1.1 | MIT | dev-only |
| is-typed-array | 1.1.15 | MIT | dev-only |
| is-url | 1.2.4 | MIT | server (bundled or traced into server functions) |
| is-weakmap | 2.0.2 | MIT | dev-only |
| is-weakref | 1.1.1 | MIT | dev-only |
| is-weakset | 2.0.4 | MIT | dev-only |
| isarray | 2.0.5 | MIT | dev-only |
| isexe | 2.0.0 | ISC | dev-only |
| iterator.prototype | 1.1.5 | MIT | dev-only |
| jiti | 1.21.7 | MIT | dev-only |
| js-tokens | 4.0.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| js-yaml | 4.2.0 | MIT | dev-only |
| jsdom | 25.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| jsdom | 26.1.0 | MIT | dev-only |
| json-bigint | 1.0.0 | MIT | server (bundled or traced into server functions) |
| json-buffer | 3.0.1 | MIT | dev-only |
| json-schema-traverse | 0.4.1 | MIT | dev-only |
| json-stable-stringify-without-jsonify | 1.0.1 | MIT | dev-only |
| json-stringify-safe | 5.0.1 | ISC | installed, not in any build output (transitive/unused/type-only) |
| json5 | 1.0.2 | MIT | dev-only |
| jspdf | 4.2.1 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| jsx-ast-utils | 3.3.5 | MIT | dev-only |
| jwa | 2.0.1 | MIT | server (bundled or traced into server functions) |
| jws | 4.0.1 | MIT | server (bundled or traced into server functions) |
| keyv | 4.5.4 | MIT | dev-only |
| language-subtag-registry | 0.3.23 | CC0-1.0 | dev-only |
| language-tags | 1.0.9 | MIT | dev-only |
| levn | 0.4.1 | MIT | dev-only |
| lilconfig | 3.1.3 | MIT | dev-only |
| lines-and-columns | 1.2.4 | MIT | dev-only |
| locate-path | 6.0.0 | MIT | dev-only |
| lodash.merge | 4.6.2 | MIT | dev-only |
| long | 4.0.0 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| long | 5.3.2 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| long | 5.3.2 | Apache-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| loose-envify | 1.4.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| lru-cache | 10.4.3 | ISC | server (bundled or traced into server functions) |
| lru-cache | 11.5.3 | BlueOak-1.0.0 | server (bundled or traced into server functions) |
| lucide-react | 0.263.1 | ISC | **browser bundle**; server (bundled or traced into server functions) |
| magic-string | 0.30.21 | MIT | installed, not in any build output (transitive/unused/type-only) |
| make-dir | 3.1.0 | MIT | optional, platform-specific, not installed |
| matcher | 3.0.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| math-intrinsics | 1.1.0 | MIT | server (bundled or traced into server functions) |
| mediabunny | 1.65.2 | MPL-2.0 | **browser bundle**; server (bundled or traced into server functions) |
| merge2 | 1.4.1 | MIT | dev-only |
| micromatch | 4.0.8 | MIT | dev-only |
| mime-db | 1.52.0 | MIT | server (bundled or traced into server functions) |
| mime-types | 2.1.35 | MIT | server (bundled or traced into server functions) |
| mimic-response | 2.1.0 | MIT | optional, platform-specific, not installed |
| mimic-response | 3.1.0 | MIT | dev-only |
| minimatch | 10.2.6 | BlueOak-1.0.0 | installed, not in any build output (transitive/unused/type-only) |
| minimatch | 10.2.5 | BlueOak-1.0.0 | dev-only |
| minimatch | 3.1.5 | ISC | installed, not in any build output (transitive/unused/type-only) |
| minimist | 1.2.8 | MIT | dev-only |
| minipass | 7.1.3 | BlueOak-1.0.0 | installed, not in any build output (transitive/unused/type-only) |
| minipass | 3.3.6 | ISC | optional, platform-specific, not installed |
| minipass | 5.0.0 | ISC | optional, platform-specific, not installed |
| minipass | 3.3.6 | ISC | optional, platform-specific, not installed |
| minipass | 7.1.3 | BlueOak-1.0.0 | installed, not in any build output (transitive/unused/type-only) |
| minizlib | 2.1.2 | MIT | optional, platform-specific, not installed |
| mkdirp | 1.0.4 | MIT | optional, platform-specific, not installed |
| mkdirp-classic | 0.5.3 | MIT | dev-only |
| mrmime | 2.0.1 | MIT | dev-only |
| ms | 2.1.3 | MIT | server (bundled or traced into server functions) |
| mz | 2.7.0 | MIT | dev-only |
| nan | 2.29.0 | MIT | optional, platform-specific, not installed |
| nanoid | 3.3.11 | MIT | installed, not in any build output (transitive/unused/type-only) |
| napi-build-utils | 2.0.0 | MIT | dev-only |
| napi-postinstall | 0.3.4 | MIT | dev-only |
| natural-compare | 1.4.0 | MIT | dev-only |
| next | 15.5.24 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| node-abi | 3.89.0 | MIT | dev-only |
| node-addon-api | 7.1.1 | MIT | dev-only |
| node-exports-info | 1.6.0 | MIT | dev-only |
| node-fetch | 2.6.13 | MIT | server (bundled or traced into server functions) |
| node-releases | 2.0.37 | MIT | dev-only |
| nopt | 5.0.0 | ISC | optional, platform-specific, not installed |
| normalize-path | 3.0.0 | MIT | dev-only |
| normalize-wheel | 1.0.1 | BSD-3-Clause | **browser bundle**; server (bundled or traced into server functions) |
| npmlog | 5.0.1 | ISC | optional, platform-specific, not installed |
| nwsapi | 2.2.23 | MIT | server (bundled or traced into server functions) |
| object-assign | 4.1.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| object-hash | 3.0.0 | MIT | dev-only |
| object-inspect | 1.13.4 | MIT | server (bundled or traced into server functions) |
| object-keys | 1.1.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| object.assign | 4.1.7 | MIT | dev-only |
| object.entries | 1.1.9 | MIT | dev-only |
| object.fromentries | 2.0.8 | MIT | dev-only |
| object.groupby | 1.0.3 | MIT | dev-only |
| object.values | 1.2.1 | MIT | dev-only |
| once | 1.4.0 | ISC | installed, not in any build output (transitive/unused/type-only) |
| onnxruntime-common | 1.24.3 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| onnxruntime-common | 1.24.0-dev.20251116-b39e144322 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| onnxruntime-node | 1.24.3 | MIT | server (bundled or traced into server functions) |
| onnxruntime-web | 1.26.0-dev.20260416-b7804b056c | MIT | **browser bundle**; **redistributed static file** |
| opencollective-postinstall | 2.0.3 | MIT | installed, not in any build output (transitive/unused/type-only) |
| opener | 1.5.2 | (WTFPL OR MIT) | dev-only |
| optionator | 0.9.4 | MIT | dev-only |
| own-keys | 1.0.1 | MIT | dev-only |
| oxc-parser | 0.152.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| p-limit | 3.1.0 | MIT | dev-only |
| p-locate | 5.0.0 | MIT | dev-only |
| pako | 2.2.0 | (MIT AND Zlib) | **browser bundle**; server (bundled or traced into server functions) |
| parent-module | 1.0.1 | MIT | dev-only |
| parse5 | 7.3.0 | MIT | server (bundled or traced into server functions) |
| path-exists | 4.0.0 | MIT | dev-only |
| path-is-absolute | 1.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| path-key | 3.1.1 | MIT | dev-only |
| path-parse | 1.0.7 | MIT | dev-only |
| path-scurry | 2.0.2 | BlueOak-1.0.0 | installed, not in any build output (transitive/unused/type-only) |
| performance-now | 2.1.0 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| pg | 8.23.1 | MIT | dev-only |
| pg-cloudflare | 1.4.1 | MIT | dev-only |
| pg-connection-string | 2.14.1 | MIT | dev-only |
| pg-int8 | 1.0.1 | ISC | dev-only |
| pg-pool | 3.14.0 | MIT | dev-only |
| pg-protocol | 1.16.1 | MIT | dev-only |
| pg-types | 2.2.0 | MIT | dev-only |
| pgpass | 1.0.5 | MIT | dev-only |
| picocolors | 1.1.1 | ISC | installed, not in any build output (transitive/unused/type-only) |
| picomatch | 2.3.2 | MIT | dev-only |
| picomatch | 2.3.2 | MIT | dev-only |
| picomatch | 4.0.4 | MIT | installed, not in any build output (transitive/unused/type-only) |
| picomatch | 2.3.2 | MIT | dev-only |
| pify | 2.3.0 | MIT | dev-only |
| pirates | 4.0.7 | MIT | dev-only |
| platform | 1.3.6 | MIT | installed, not in any build output (transitive/unused/type-only) |
| possible-typed-array-names | 1.1.0 | MIT | dev-only |
| postcss | 8.4.31 | MIT | installed, not in any build output (transitive/unused/type-only) |
| postcss | 8.5.14 | MIT | dev-only |
| postcss-import | 15.1.0 | MIT | dev-only |
| postcss-js | 4.1.0 | MIT | dev-only |
| postcss-load-config | 6.0.1 | MIT | dev-only |
| postcss-nested | 6.2.0 | MIT | dev-only |
| postcss-selector-parser | 6.1.2 | MIT | dev-only |
| postcss-value-parser | 4.2.0 | MIT | dev-only |
| postgres-array | 2.0.0 | MIT | dev-only |
| postgres-bytea | 1.0.1 | MIT | dev-only |
| postgres-date | 1.0.7 | MIT | dev-only |
| postgres-interval | 1.2.0 | MIT | dev-only |
| prebuild-install | 7.1.3 | MIT | dev-only |
| prelude-ls | 1.2.1 | MIT | dev-only |
| prop-types | 15.8.1 | MIT | dev-only |
| protobufjs | 7.6.5 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| pump | 3.0.4 | MIT | dev-only |
| punycode | 2.3.1 | MIT | server (bundled or traced into server functions) |
| qs | 6.15.2 | BSD-3-Clause | server (bundled or traced into server functions) |
| queue-microtask | 1.2.3 | MIT | dev-only |
| raf | 3.4.1 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| rc | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) | dev-only |
| react | 18.3.1 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| react-dom | 18.3.1 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| react-easy-crop | 6.2.3 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| react-is | 16.13.1 | MIT | dev-only |
| read-cache | 1.0.0 | MIT | dev-only |
| readable-stream | 3.6.2 | MIT | installed, not in any build output (transitive/unused/type-only) |
| readdirp | 3.6.0 | MIT | dev-only |
| reflect.getprototypeof | 1.0.10 | MIT | dev-only |
| regenerator-runtime | 0.13.11 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| regexp.prototype.flags | 1.5.4 | MIT | dev-only |
| require-directory | 2.1.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| resolve | 1.22.11 | MIT | dev-only |
| resolve | 2.0.0-next.6 | MIT | dev-only |
| resolve | 1.22.11 | MIT | dev-only |
| resolve-from | 4.0.0 | MIT | dev-only |
| resolve-pkg-maps | 1.0.0 | MIT | dev-only |
| reusify | 1.1.0 | MIT | dev-only |
| rgbcolor | 1.0.1 | MIT OR SEE LICENSE IN FEEL-FREE.md | **browser bundle**; server (bundled or traced into server functions) |
| rimraf | 3.0.2 | ISC | installed, not in any build output (transitive/unused/type-only) |
| roarr | 2.15.4 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| rollup | 4.65.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| rrweb-cssom | 0.7.1 | MIT | server (bundled or traced into server functions) |
| rrweb-cssom | 0.8.0 | MIT | server (bundled or traced into server functions) |
| run-parallel | 1.2.0 | MIT | dev-only |
| safe-array-concat | 1.1.3 | MIT | dev-only |
| safe-buffer | 5.2.1 | MIT | server (bundled or traced into server functions) |
| safe-push-apply | 1.0.0 | MIT | dev-only |
| safe-regex-test | 1.1.0 | MIT | dev-only |
| safer-buffer | 2.1.2 | MIT | server (bundled or traced into server functions) |
| saxes | 6.0.0 | ISC | server (bundled or traced into server functions) |
| scheduler | 0.23.2 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| seedrandom | 3.0.5 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| semver | 6.3.1 | ISC | dev-only |
| semver | 6.3.1 | ISC | dev-only |
| semver | 6.3.1 | ISC | optional, platform-specific, not installed |
| semver | 6.3.1 | ISC | dev-only |
| semver | 7.7.4 | ISC | server (bundled or traced into server functions) |
| semver-compare | 1.0.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| sentry | 0.45.0 | FSL-1.1-Apache-2.0 | installed, not in any build output (transitive/unused/type-only) |
| serialize-error | 7.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| server-only | 0.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| set-blocking | 2.0.0 | ISC | optional, platform-specific, not installed |
| set-function-length | 1.2.2 | MIT | dev-only |
| set-function-name | 2.0.2 | MIT | dev-only |
| set-proto | 1.0.0 | MIT | dev-only |
| sharp | 0.34.5 | Apache-2.0 | server (bundled or traced into server functions) |
| shebang-command | 2.0.0 | MIT | dev-only |
| shebang-regex | 3.0.0 | MIT | dev-only |
| side-channel | 1.1.0 | MIT | server (bundled or traced into server functions) |
| side-channel-list | 1.0.0 | MIT | server (bundled or traced into server functions) |
| side-channel-map | 1.0.1 | MIT | server (bundled or traced into server functions) |
| side-channel-weakmap | 1.0.2 | MIT | server (bundled or traced into server functions) |
| signal-exit | 3.0.7 | ISC | optional, platform-specific, not installed |
| simple-concat | 1.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| simple-get | 3.1.1 | MIT | optional, platform-specific, not installed |
| simple-get | 4.0.1 | MIT | dev-only |
| sirv | 2.0.4 | MIT | dev-only |
| source-map-js | 1.2.1 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| split2 | 4.2.0 | ISC | dev-only |
| sprintf-js | 1.1.3 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| sprintf-js | 1.0.3 | BSD-3-Clause | installed, not in any build output (transitive/unused/type-only) |
| stable-hash | 0.0.5 | MIT | dev-only |
| stackblur-canvas | 2.7.0 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| stacktrace-parser | 0.1.11 | MIT | server (bundled or traced into server functions) |
| stop-iteration-iterator | 1.1.0 | MIT | dev-only |
| string-width | 4.2.3 | MIT | installed, not in any build output (transitive/unused/type-only) |
| string.prototype.includes | 2.0.1 | MIT | dev-only |
| string.prototype.matchall | 4.0.12 | MIT | dev-only |
| string.prototype.repeat | 1.0.0 | MIT | dev-only |
| string.prototype.trim | 1.2.10 | MIT | dev-only |
| string.prototype.trimend | 1.0.9 | MIT | dev-only |
| string.prototype.trimstart | 1.0.8 | MIT | dev-only |
| string_decoder | 1.3.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| strip-ansi | 6.0.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
| strip-bom | 3.0.0 | MIT | dev-only |
| strip-json-comments | 2.0.1 | MIT | dev-only |
| strip-json-comments | 3.1.1 | MIT | dev-only |
| stripe | 22.2.2 | MIT | server (bundled or traced into server functions) |
| styled-jsx | 5.1.6 | MIT | server (bundled or traced into server functions) |
| sucrase | 3.35.1 | MIT | dev-only |
| supports-color | 8.1.1 | MIT | server (bundled or traced into server functions) |
| supports-color | 7.2.0 | MIT | server (bundled or traced into server functions) |
| supports-preserve-symlinks-flag | 1.0.0 | MIT | dev-only |
| svg-pathdata | 6.0.3 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| symbol-tree | 3.2.4 | MIT | server (bundled or traced into server functions) |
| tailwindcss | 3.4.19 | MIT | dev-only |
| tar | 6.2.1 | ISC | optional, platform-specific, not installed |
| tar-fs | 2.1.4 | MIT | dev-only |
| tar-stream | 2.2.0 | MIT | dev-only |
| tesseract.js | 5.1.1 | Apache-2.0 | **browser bundle**; **redistributed static file**; server (bundled or traced into server functions) |
| tesseract.js-core | 5.1.1 | Apache-2.0 | **redistributed static file** |
| text-segmentation | 1.0.3 | MIT | installed, not in any build output (transitive/unused/type-only) |
| text-table | 0.2.0 | MIT | dev-only |
| thenify | 3.3.1 | MIT | dev-only |
| thenify-all | 1.6.0 | MIT | dev-only |
| tinyglobby | 0.2.15 | MIT | dev-only |
| tldts | 6.1.86 | MIT | server (bundled or traced into server functions) |
| tldts-core | 6.1.86 | MIT | installed, not in any build output (transitive/unused/type-only) |
| to-regex-range | 5.0.1 | MIT | dev-only |
| totalist | 3.0.1 | MIT | dev-only |
| tough-cookie | 5.1.2 | BSD-3-Clause | server (bundled or traced into server functions) |
| tr46 | 0.0.3 | MIT | server (bundled or traced into server functions) |
| tr46 | 5.1.1 | MIT | server (bundled or traced into server functions) |
| ts-api-utils | 2.5.0 | MIT | dev-only |
| ts-interface-checker | 0.1.13 | Apache-2.0 | dev-only |
| tsconfig-paths | 3.15.0 | MIT | dev-only |
| tslib | 2.4.0 | 0BSD | **browser bundle**; server (bundled or traced into server functions) |
| tslib | 2.8.1 | 0BSD | **browser bundle**; server (bundled or traced into server functions) |
| tsx | 4.23.15 | MIT | dev-only |
| tunnel-agent | 0.6.0 | Apache-2.0 | dev-only |
| type-check | 0.4.0 | MIT | dev-only |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) | installed, not in any build output (transitive/unused/type-only) |
| type-fest | 0.7.1 | (MIT OR CC0-1.0) | installed, not in any build output (transitive/unused/type-only) |
| type-fest | 0.20.2 | (MIT OR CC0-1.0) | dev-only |
| typed-array-buffer | 1.0.3 | MIT | dev-only |
| typed-array-byte-length | 1.0.3 | MIT | dev-only |
| typed-array-byte-offset | 1.0.4 | MIT | dev-only |
| typed-array-length | 1.0.7 | MIT | dev-only |
| typescript | 5.9.3 | Apache-2.0 | dev-only |
| unbox-primitive | 1.1.0 | MIT | dev-only |
| undici | 6.25.0 | MIT | server (bundled or traced into server functions) |
| undici-types | 6.21.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| unrs-resolver | 1.11.1 | MIT | dev-only |
| update-browserslist-db | 1.2.3 | MIT | dev-only |
| uri-js | 4.4.1 | BSD-2-Clause | dev-only |
| url-template | 2.0.8 | BSD | server (bundled or traced into server functions) |
| util-deprecate | 1.0.2 | MIT | installed, not in any build output (transitive/unused/type-only) |
| utrie | 1.0.2 | MIT | installed, not in any build output (transitive/unused/type-only) |
| uuid | 9.0.1 | MIT | server (bundled or traced into server functions) |
| w3c-xmlserializer | 5.0.0 | MIT | server (bundled or traced into server functions) |
| wasm-feature-detect | 1.8.0 | Apache-2.0 | installed, not in any build output (transitive/unused/type-only) |
| web-vitals | 6.2.3 | Apache-2.0 | **browser bundle** |
| webidl-conversions | 3.0.1 | BSD-2-Clause | server (bundled or traced into server functions) |
| webidl-conversions | 7.0.0 | BSD-2-Clause | server (bundled or traced into server functions) |
| webm-fix-duration | 1.0.1 | MIT | **browser bundle**; server (bundled or traced into server functions) |
| webpack-bundle-analyzer | 4.10.1 | MIT | dev-only |
| whatwg-encoding | 3.1.1 | MIT | server (bundled or traced into server functions) |
| whatwg-mimetype | 4.0.0 | MIT | server (bundled or traced into server functions) |
| whatwg-url | 5.0.0 | MIT | server (bundled or traced into server functions) |
| whatwg-url | 14.2.0 | MIT | server (bundled or traced into server functions) |
| which | 2.0.2 | ISC | dev-only |
| which-boxed-primitive | 1.1.1 | MIT | dev-only |
| which-builtin-type | 1.2.1 | MIT | dev-only |
| which-collection | 1.0.2 | MIT | dev-only |
| which-typed-array | 1.1.20 | MIT | dev-only |
| wide-align | 1.1.5 | ISC | optional, platform-specific, not installed |
| word-wrap | 1.2.5 | MIT | dev-only |
| wrap-ansi | 7.0.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| wrappy | 1.0.2 | ISC | installed, not in any build output (transitive/unused/type-only) |
| ws | 7.5.11 | MIT | dev-only |
| ws | 8.21.0 | MIT | server (bundled or traced into server functions) |
| xml-name-validator | 5.0.0 | Apache-2.0 | server (bundled or traced into server functions) |
| xmlchars | 2.2.0 | MIT | server (bundled or traced into server functions) |
| xtend | 4.0.2 | MIT | dev-only |
| y18n | 5.0.8 | ISC | installed, not in any build output (transitive/unused/type-only) |
| yallist | 4.0.0 | ISC | optional, platform-specific, not installed |
| yargs | 16.2.0 | MIT | installed, not in any build output (transitive/unused/type-only) |
| yargs-parser | 20.2.9 | ISC | installed, not in any build output (transitive/unused/type-only) |
| yocto-queue | 0.1.0 | MIT | dev-only |
| zlibjs | 0.3.1 | MIT | installed, not in any build output (transitive/unused/type-only) |
