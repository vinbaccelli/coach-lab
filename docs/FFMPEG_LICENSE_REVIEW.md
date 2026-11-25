# FFmpeg (ffmpeg.wasm) licence review: second pass

**Status: Pending legal review.** Written 2026-11-24. This is not legal advice and it draws no legal conclusion. It is a documentation-only review: no code, dependency, lock file, deployed asset or configuration was changed. Register: [`THIRD_PARTY_LICENSE_AUDIT.md`](THIRD_PARTY_LICENSE_AUDIT.md) (entry B.14). Evidence: [`evidence/README.md`](evidence/README.md) (§ "Second pass").

The sections are kept apart on purpose: **verified facts** (§1), **technical findings** (§2), **questions for counsel** (§3), **recommended engineering changes** (§4, none made) and **production risks** (§5).

---

## 1. Verified facts

### 1.1 What the application loads (read from code on branch `docs/licensing-second-pass` @ `93130c3`)

| # | file:line | what it does |
|---|---|---|
| a | `lib/ffmpegWebmToMp4.ts:10` | `const CORE_VERSION = '0.12.10';` |
| b | `lib/ffmpegWebmToMp4.ts:11` | `const CORE_BASE = \`https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm\`;` |
| c | `lib/ffmpegWebmToMp4.ts:78-79` | fetches `${CORE_BASE}/ffmpeg-core.js` and `${CORE_BASE}/ffmpeg-core.wasm` into `blob:` URLs (`toBlobURL`) in the user's browser |
| d | `lib/ffmpegWebmToMp4.ts:47,83-84` | the worker script is served **from our own origin**: `classWorkerURL = ${window.location.origin}/ffmpeg/worker.js` |
| e | `scripts/copy-ffmpeg-worker.mjs:42-47` | copies `worker.js`, `const.js`, `errors.js` from `node_modules/@ffmpeg/ffmpeg/dist/esm` into `public/ffmpeg/` (run by `postinstall`, `predev`, `prebuild`: `package.json:6,7,9`). `public/ffmpeg/` is git-ignored (`.gitignore:43`), so these files are generated at build and served by our deployment |
| f | `package.json:18-19` | dependencies `@ffmpeg/ffmpeg ^0.12.15` and `@ffmpeg/util ^0.12.2` (these are the JavaScript wrapper and helpers; they are bundled into our JavaScript by Next.js and dynamically imported at `lib/ffmpegWebmToMp4.ts:72-75`). **`@ffmpeg/core` is not a dependency** and is not in `node_modules`. |
| g | `components/ExportModal.tsx:25,143-147` | a second loader: `FFMPEG_CORE_VERSION = '0.12.6'`, `https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd`. **This component is not imported anywhere.** Search of all `.ts/.tsx` files outside `node_modules` finds the name `ExportModal` only in its own file and in a comment (`components/Canvas.tsx:301`). It is therefore not part of any page bundle. |
| h | `public/sw.js:241-252` | the service worker serves `cdn.jsdelivr.net` requests **cache-first** and stores the response (`storeInBackground`) when it is a complete 200 response of at most `MAX_ENTRY_BYTES = 1024*1024` (`public/sw.js:55,121`). By this logic the 0.12.10 `ffmpeg-core.js` (111,804 bytes) would be stored in the visitor's Cache Storage under our origin's service worker; `ffmpeg-core.wasm` (32,232,419 bytes) would not. This is from reading the code; it was **not measured** in a browser. |

Search scope: `app/`, `components/`, `lib/`, `hooks/`, `public/`, `next.config.js`, `package.json`, `scripts/` (grep `-i ffmpeg`). `next.config.js` has no FFmpeg-specific setting or CSP. `hooks/` has no FFmpeg reference.

### 1.2 Which features use FFmpeg (what a replacement must preserve)

FFmpeg is used for **one job: converting a browser recording (WebM, sometimes MP4) into an H.264 MP4**, optionally re-timed. Entry points:

| feature (user-visible) | call site | FFmpeg function | what FFmpeg does there |
|---|---|---|---|
| **Replay recording / "Generate" video** (records the replay with skeleton/drawings, then converts) | `app/analysis/page.tsx:1948` (`recordReplayToMp4`), conversion at `:2024` | `convertWebmBlobToMp4(webmBlob, { retimeFactor })` (`lib/ffmpegWebmToMp4.ts:90`) | re-time with `setpts=<f>*PTS` and `-r 30` (`:113-115`) when the master was recorded slower than the target speed; encode `libx264` (`-preset ultrafast`/`veryfast`, `-crf 28`, `yuv420p`, `+faststart`, **no audio** `-an`), fallback `mpeg4` (`:144-163`). The recorder prefers WebM (`page.tsx:1995`), and the conversion call is unconditional |
| **Tab / embed capture recording** (record the playing video from the screen) | `app/analysis/page.tsx:6504` | `convertWebmBlobToMp4(capturedBlob)` | same ladder, no re-time, no audio |
| **Post-recording crop / trim** (download and "upload to YouTube" of the cropped recording) | `app/analysis/page.tsx:5598,5614` → `lib/cropExport.ts:779` `exportCroppedVideo` → `exportEditedVideo` (`lib/cropExport.ts:133`); also `components/PostRecordingCropModal.tsx:307,334` | `convertWebmToMp4ForScreenRecord` (`lib/cropExport.ts:621`, function at `lib/ffmpegWebmToMp4.ts:217`) | `libx264` + **AAC audio** 128k + `+faststart`; then video-only; then `mpeg4` (`lib/ffmpegWebmToMp4.ts:247-265`). Skipped when the browser's `MediaRecorder` already produced MP4 (`lib/cropExport.ts:617`; MP4 is tried first, `lib/cropExport.ts:115-121`) |
| **Metrics export** (video with metrics overlay) | `components/metrics/MetricsExportPanel.tsx:754` → `exportEditedVideo` | same as previous row, with `videoBitsPerSecond` | as previous row |
| Memory release | `app/analysis/page.tsx:3899,3905,4522,6033` | `disposeFfmpegWasm()` | terminates the worker |
| *(dead code)* `components/ScreenRecorder.tsx:5,158` | `convertWebmToMp4ForScreenRecord` | — | component **not rendered anywhere** (name appears only in comments in `app/analysis/page.tsx:434,5646`, `contexts/RecordingContext.tsx:12`, `lib/videoSound.ts:20`) |
| *(dead code)* `components/ExportModal.tsx:136-160` | its own loader (0.12.6 via unpkg) | — | not imported (1.1 g) |

FFmpeg capabilities actually exercised: WebM/Matroska (VP8/VP9/Opus) **demux + decode**, MP4 demux (Safari case), `setpts` filter + frame-rate conversion, **libx264 H.264 encode**, native **AAC encode**, `mpeg4` (MPEG-4 Part 2) encode, MP4 mux with `faststart`. Not used: x265, libvpx encode, MP3, Theora, Vorbis, Opus encode, WebP, libass/freetype/fribidi, zimg (all compiled in, §1.3).

Features that **do not** use FFmpeg (already WebCodecs + `mediabunny`): Motion Layer fixed-fps export (`lib/stroMotionDraft/fixedFpsEncoder.ts:40-75`: `getFirstEncodableVideoCodec(['avc','vp9'])`, `Mp4OutputFormat`, `CanvasSource`; video only) and phone "shrink" re-encode (`lib/phoneShrink/shrink.ts:41-57`: `Conversion` to `avc` MP4). Both return `null` and fall back when `VideoEncoder` is missing.

### 1.3 The two `@ffmpeg/core` builds: npm metadata **and** the build configuration compiled into the binaries

Both tarballs were downloaded from `registry.npmjs.org` on 2026-11-24 (jsDelivr and unpkg themselves were **not reachable** from this environment, so the bytes those CDNs serve were not fetched; npm is the origin those CDNs mirror for `/npm/` paths, but that equivalence was not verified here).

| | `@ffmpeg/core@0.12.6` | `@ffmpeg/core@0.12.10` |
|---|---|---|
| loaded by | dead code only (`ExportModal.tsx`, unpkg) | **production** (`lib/ffmpegWebmToMp4.ts`, jsDelivr) |
| npm `license` field (registry + tarball `package.json`) | `"MIT"` | `"GPL-2.0-or-later"` |
| `author` | `Jerome Wu <jeromewus@gmail.com>` | same |
| registry `gitHead` | `e0d4c62a229ba58ea0c6e6b881e289f2fefe97c4` | *not present* |
| tarball sha1 (= registry `dist.shasum`) | `9a61866fdd662118bcf419b96db76d5fa3c6c270` | `3177e88852bfbfaad5d258e9e0ac1fd9dffd3223` |
| `dist/esm/ffmpeg-core.wasm` sha256 | `2390efa7fb66e7e42dbae15427571a5ffc96b829480904c30f471f0a78967f61` (32,129,114 B) | `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7` (32,232,419 B) |
| `dist/esm/ffmpeg-core.js` sha256 | `c972f5ab…cfb7f1` | `67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3` (111,804 B) |
| LICENSE / COPYING file in the tarball | **none** (files: `package.json`, `dist/{esm,umd}/ffmpeg-core.{js,wasm}`) | **none** |
| FFmpeg `configure` line **embedded in the wasm** (`strings`) | identical to the right-hand column | see below |

The configure line compiled into **both** `.wasm` files (verbatim, `evidence/ffmpeg-core-0.12.{6,10}-wasm-embedded-build-config.txt`):

```text
--target-os=none --arch=x86_32 --enable-cross-compile --disable-asm --disable-stripping --disable-programs --disable-doc --disable-debug --disable-runtime-cpudetect --disable-autodetect --nm=emnm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc --extra-cflags='-I/opt/include -O3 -msimd128' --extra-cxxflags='-I/opt/include -O3 -msimd128' --disable-pthreads --disable-w32threads --disable-os2threads --enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame --enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib --enable-libwebp --enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg
```

Both binaries also contain the x264 banner `x264 - core %d%s - H.264/MPEG-4 AVC codec - Copy%s 2003-2022 - http://www.videolan.org/x264.html`, the encoder name `libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10`, and the GPL notice text `…GNU General Public License for more details. You should have received a copy of the GNU General Public License along with %s…`. **No `--enable-nonfree`** appears in either configure line.

### 1.4 The ffmpeg.wasm project's own build files (`github.com/ffmpegwasm/ffmpeg.wasm`, read via `raw.githubusercontent.com`)

- Repo `LICENSE` (identical at `main`, tags `v0.12.6` and `v0.12.10`; sha256 `3e123e29…459f`): `MIT License` / `Copyright (c) 2019 Jerome Wu` (`evidence/ffmpegwasm-github-LICENSE.txt`). The README carries an MIT badge. Neither says that the MIT licence covers the compiled FFmpeg core.
- Repo tags are **`@ffmpeg/ffmpeg` versions, not core versions**: `packages/core/package.json` reads `"version": "0.12.3"` at tag `v0.12.6`, `"0.12.6"` / `"license": "MIT"` at tag `v0.12.10`, and `"0.12.10"` / `"license": "GPL-2.0-or-later"` at `main`. At the npm `gitHead` of core 0.12.6 (`e0d4c62a…`) it reads `"0.12.5"` / `"MIT"` (`evidence/ffmpegwasm-github-e0d4c62a-packages-core-package.json`).
- `Dockerfile` at `main` (sha256 `2501ef0a…7bee`) is **byte-identical** at tag `v0.12.10` and at commit `e0d4c62a` (the commit npm records for core 0.12.6). So the same build recipe applies to both cores used by this app. It pins `emscripten/emsdk:3.1.40`, `FFMPEG_VERSION=n5.1.4`, `X264_BRANCH=4-cores`, `X265_BRANCH=3.4`, `LIBVPX_BRANCH=v1.13.1`, `LAME_BRANCH=master`, ogg v1.3.4, theora v1.1.1, opus v1.3.1, vorbis v1.3.3, zlib v1.2.11, libwebp v1.3.2, freetype `VER-2-10-4`, fribidi v1.0.9, harfbuzz 5.2.0, libass 0.15.0, zimg `release-3.0.5`, and configures FFmpeg with `--enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame --enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib --enable-libwebp --enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg` (`evidence/ffmpegwasm-github-main-Dockerfile.txt`, lines 151-167). This matches the configure line compiled into the binaries (§1.3).
- Commit SHAs of `main` and of the tags could not be read (`api.github.com` / `github.com` refused). Files are pinned by sha256 in the evidence index.

### 1.5 FFmpeg's own licence statement (`FFmpeg/FFmpeg`, tag `n5.1.4`, `LICENSE.md`, sha256 `cb48bf09…83f2`; saved in full)

> "Most files in FFmpeg are under the GNU Lesser General Public License version 2.1 or later (LGPL v2.1+). … Some optional parts of FFmpeg are licensed under the GNU General Public License version 2 or later (GPL v2+). See the file `COPYING.GPLv2` for details. None of these parts are used by default, you have to explicitly pass `--enable-gpl` to configure to activate them. In this case, FFmpeg's license changes to GPL v2+."

> "The following libraries are under GPL version 2: … libx264 · libx265 … When combining them with FFmpeg, FFmpeg needs to be licensed as GPL as well by passing `--enable-gpl` to configure."

> "If you wish to enable these libraries, even in circumstances that their license may be incompatible, pass `--enable-nonfree` to configure. This will cause the resulting binary to be unredistributable."

`COPYING.GPLv2` at `n5.1.4` saved in full (`evidence/ffmpeg-n5.1.4-COPYING.GPLv2.txt`). x264 and x265 `COPYING` files (default branches) begin with `GNU GENERAL PUBLIC LICENSE Version 2, June 1991` (first 20 lines saved).

### 1.6 Alternatives: what was verified

- No npm package was found that is a drop-in LGPL-only ffmpeg.wasm core (registry search "ffmpeg core lgpl", 2026-11-24, top 10 results: none is an `@ffmpeg/core` replacement). The ffmpeg.wasm Dockerfile has no LGPL variant.
- `mediabunny` 1.65.2 is already a dependency (`package.json:36`), declared **MPL-2.0** (first pass, `evidence/npm-mediabunny-LICENSE.txt`), and already does H.264 MP4 encode/mux through the browser's WebCodecs (§1.2).
- OpenH264 (an H.264 encoder FFmpeg can use via `--enable-libopenh264`): `cisco/openh264` LICENSE (default branch) begins `Copyright (c) 2013, Cisco Systems … Redistribution and use in source and binary forms … are permitted` (BSD-2-Clause form; saved). Not tested, not proposed as a decision; patent questions about H.264 are outside what was read.

---

## 2. Technical findings

- **T-F1.** The npm `license` field of `@ffmpeg/core` **does not describe the compiled contents.** Core 0.12.6 is labelled MIT, yet its wasm was configured with `--enable-gpl --enable-libx264 --enable-libx265` exactly like 0.12.10 (labelled GPL-2.0-or-later). By FFmpeg's own `LICENSE.md` (§1.5) a build with `--enable-gpl` and libx264/libx265 is under GPL v2+. The relabelling from MIT to GPL between 0.12.6 and 0.12.8 appears in the package metadata only; the configure line did not change. "0.12.6 is MIT" from the first pass is therefore **not a safe reading**, and switching back to 0.12.6 would not change what is compiled in.
- **T-F2.** The app **depends on the GPL component specifically**: every conversion path tries `-c:v libx264` first (`lib/ffmpegWebmToMp4.ts:148,156,249,257`). An LGPL build (no `--enable-gpl`, no libx264) would leave only `mpeg4` (MPEG-4 Part 2), which the code itself notes Safari/QuickTime may refuse to play (`lib/ffmpegWebmToMp4.ts:197-200`).
- **T-F3.** Delivery chain: the GPL-labelled bytes (`ffmpeg-core.js` + `.wasm`) are fetched by each visitor's browser from `cdn.jsdelivr.net` at a version **pinned by our code**, executed inside a worker script **served from our origin** (`/ffmpeg/worker.js`, from the MIT `@ffmpeg/ffmpeg` package), driven by our bundled JavaScript, and the `.js` part is likely kept in our service worker's cache (1.1 h). Our deployment does not host the `.wasm` itself. Whether any of this is "distribution" by Anglemotion is a legal question (§3 Q-F1), not a technical one.
- **T-F4.** Remote integrity: the jsDelivr load has **no integrity check** (no SRI or hash comparison; `toBlobURL` only fetches). The bytes users run are controlled by jsDelivr/npm, not by us; if the CDN is unreachable every conversion fails and the user gets WebM or an error (`lib/recordingUtils.ts:129` comment; `app/analysis/page.tsx:2025-2035`).
- **T-F5.** The legacy 0.12.6 loader (`components/ExportModal.tsx`) and `components/ScreenRecorder.tsx` are dead code; they are not in any bundle (verified by import search and by the bundle analyser: neither `components/ExportModal` nor `components/ScreenRecorder` appears in the client, nodejs or edge report of a scratch production build, while `lib/ffmpegWebmToMp4` does; `@ffmpeg/core` appears in none — method in [`THIRD_PARTY_DEPENDENCY_CLASSIFICATION.md`](THIRD_PARTY_DEPENDENCY_CLASSIFICATION.md)). Removing them would remove the second version from the source tree (§4).
- **T-F6.** No FFmpeg/x264 source offer, licence text or notice is shown anywhere in the app, and the app's repository contains no copy of the GPL for this component.
- **T-F7 (technical equivalence of alternatives, not tested here):** the features in §1.2 need H.264 encode at chosen quality/bitrate, AAC audio, re-timing to 30 fps, and a playable MP4 with a moov-at-front layout. WebCodecs `VideoEncoder`/`AudioEncoder` + `mediabunny` (decode WebM via `Input`/`Conversion`, encode `avc`/`aac`, `Mp4OutputFormat` with fast-start) covers these on browsers that expose WebCodecs encoders (the app already relies on this for the Motion Layer export and shrink). Gaps to measure before any switch: browsers/OS versions without `VideoEncoder` or without an AAC `AudioEncoder`; re-timing (mediabunny writes timestamps directly, which may replace `setpts`); output parity (file size at the same bitrate; Safari/QuickTime playback). A self-built **LGPL** ffmpeg.wasm with `--enable-libopenh264` is a second, heavier option.

---

## 3. Legal interpretations requiring counsel (numbered questions)

- **Q-F1.** Given 1.1 and T-F3 (version pinned and URL chosen by our code, bytes fetched from jsDelivr by the user's browser, executed by our worker under our origin, `.js` likely cached by our service worker), does Anglemotion "distribute" or "convey" the GPL-2.0-or-later FFmpeg/x264/x265 binary to its users? The review does **not** assume that loading from a CDN avoids obligations.
- **Q-F2.** If it does, what obligations follow for Anglemotion under GPL v2 §§1-3 (licence text to recipients, notices, offer or provision of complete corresponding source including build scripts — the ffmpeg.wasm `Dockerfile` and pinned library versions in §1.4 — and how is that satisfied for a web application: in-app notice, link, written offer)?
- **Q-F3.** Does the GPL extend to Anglemotion's own JavaScript (the bundled `@ffmpeg/ffmpeg` wrapper, our worker copy, `lib/ffmpegWebmToMp4.ts` and the page that calls it), which communicates with the core via `postMessage` and a virtual filesystem in a separate worker? Or is this an "aggregate"/separate program? Please advise what facts matter (we can supply call graphs).
- **Q-F4.** The npm metadata of core 0.12.6 says MIT although the binary was built with `--enable-gpl` (T-F1). May Anglemotion rely on that MIT label at all? (Our engineering reading is that it should not; we ask for counsel's view.)
- **Q-F5.** Are there obligations specific to the bundled third-party libraries in the core (x265 GPL v2; libvpx, LAME, Theora, Vorbis, Opus, zlib, libwebp, FreeType, FriBidi, HarfBuzz, libass, zimg under their own licences, not read here) beyond the FFmpeg GPL obligations?
- **Q-F6.** The configure line has no `--enable-version3`, so on its face GPL **v2-or-later** applies, not GPL v3 or AGPL. Please confirm that no version-3 or Affero term applies to this build.
- **Q-F7.** H.264 / AAC encoding patents (MPEG LA / Via LA pools) are outside a copyright-licence review; does counsel want this assessed for (a) the current x264 path, (b) a WebCodecs path (encoder provided by the browser/OS), (c) OpenH264?
- **Q-F8.** Is the risk acceptable to keep the current behaviour unchanged until a replacement ships, and if so what interim notice (if any) should be shown?

---

## 4. Recommended engineering changes (none made in this PR; each needs the owner's approval)

- **E-F1 (preferred).** Replace the FFmpeg conversion with WebCodecs + `mediabunny` (already shipped, MPL-2.0) for the three live features in §1.2, behind the existing fallback pattern, after the parity measurements in T-F7. Keep the user-visible behaviour: H.264 MP4, AAC when audio is present, re-time to the coach's speed, fast-start layout, a visible failure notice.
- **E-F2.** Until then, decide with counsel whether to (a) keep the jsDelivr load and add the notices/source offer counsel requires, or (b) disable MP4 conversion (deliver WebM) on the affected paths. No change is made by this review.
- **E-F3.** Delete the dead code `components/ExportModal.tsx` and `components/ScreenRecorder.tsx` so a second, mislabelled core version cannot be revived by accident.
- **E-F4.** If FFmpeg stays in any form: self-host a pinned build with recorded SHA-256 (or add an integrity check), and record it in the register; do not leave production dependent on an unchecked third-party CDN.
- **E-F5.** If an FFmpeg build is still needed (e.g. a browser without WebCodecs), build an **LGPL-only** ffmpeg.wasm (no `--enable-gpl`, no libx264/libx265; optionally `--enable-libopenh264`) from the pinned Dockerfile, and record the configure line, versions and hashes. Counsel to review before use.

## 5. Production risks requiring immediate attention

1. **R-F1 (high).** Production loads, for every replay recording, tab capture, post-recording crop/trim/YouTube upload and Metrics export on browsers that record WebM, an FFmpeg core that is **built with `--enable-gpl --enable-libx264 --enable-libx265` and labelled GPL-2.0-or-later**, with no licence text, notice or source offer shown, and the app actively uses libx264. Whether this creates obligations for Anglemotion is open (Q-F1-Q-F3).
2. **R-F2 (medium).** The bytes are fetched unverified from a third-party CDN; availability and content are outside our control (T-F4).
3. **R-F3 (low, latent).** A second loader for core 0.12.6 (mislabelled MIT, same GPL configuration) exists in dead code and could be re-imported.
