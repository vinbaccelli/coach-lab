# Third-party notices

Generated 2026-11-24 for the licensing review (`docs/THIRD_PARTY_LICENSE_AUDIT.md`). **Not legal advice. Status of every item is in the audit register; no item is marked Approved.** Where a copyright notice or licence statement is not stated in the sources read, this file says so. This file is not yet linked from the app UI (open item in `docs/RTMPOSE_LICENCE.md`).

## 1. Models and model-related assets

Licence text for each: §5 (Apache-2.0 full text) and the per-project files saved in `docs/evidence/`. Copyright notice = what the project's own licence file/card states; GitHub Apache-2.0 LICENSE files read here carry only the unfilled appendix template (`Copyright [yyyy] [name of copyright owner]`), so **no named copyright holder is stated in those files**.

| component | author / source (as recorded) | licence stated in source | notice / attribution condition | evidence file(s) |
|---|---|---|---|---|
| SAM 2.1 hiera-tiny q4f16 ONNX (`public/models/sam2/`) | Meta FAIR weights; ONNX/q4f16 by `onnx-community/sam2.1-hiera-tiny-ONNX` @ 814a0666… | Meta: *"The SAM 2 model checkpoints, SAM 2 demo code … and SAM 2 training code are licensed under Apache 2.0"*; HF `facebook/sam2.1-hiera-tiny` `license:apache-2.0`; the ONNX repo states **no licence** | Apache-2.0 §4: give recipients the licence, retain notices, mark modified files (quantised), include NOTICE if any (none exists) | `sam2-*`, `evidence/README.md` |
| D-FINE-N COCO q4f16 ONNX (`public/models/dfine-n/`) | D-FINE authors (Peterande et al.), `ustc-community/dfine-nano-coco` @ 066438d3…, ONNX by `onnx-community/dfine_n_coco-ONNX` @ 380d2839… | base: `license:apache-2.0`; D-FINE repo Apache-2.0; the ONNX repo states **no licence** | Apache-2.0 §4 as above | `dfine-*` |
| RTMPose-t / -s body7 ONNX (`public/models/rtmpose/`) | OpenMMLab MMPose/RTMPose (per `public/models/rtmpose/README.md`) | code Apache-2.0 "Copyright 2018-2020 Open-MMLab" (per `docs/RTMPOSE_LICENCE.md`); **weights: no licence statement** | Apache-2.0 §4; OpenMMLab notification wording agreed with the lawyer is **not recorded** in the repo | `mmpose-github-LICENSE.txt`, `docs/RTMPOSE_LICENCE.md` |
| YOLOX-tiny COCO ONNX (`public/models/rtmpose/yolox-tiny-coco.onnx`) | Megvii | Apache-2.0 (repo LICENSE; copyright line is the template) | Apache-2.0 §4 | `yolox-github-LICENSE.txt` |
| MoveNet Lightning/Thunder TF.js (`public/models/movenet-*`) | Google; provenance **not recorded** | **not stated / not read** | **not stated** | — |
| MediaPipe Pose Landmarker full/heavy `.task` | Google MediaPipe; provenance **not recorded** | weights/model-card terms **not read**; MediaPipe code Apache-2.0 | **not stated** for weights; Apache-2.0 §4 for code | `mediapipe-github-LICENSE.txt` |
| `magic_touch.tflite` (interactive segmenter), `selfie_multiclass_256x256.tflite` | presumed Google MediaPipe; provenance **not recorded** | **not stated / not read** | **not stated** | — |
| MediaPipe Selfie Segmentation (`public/mediapipe-selfie/`, and CDN copy in `lib/webcamSegmentation.ts`) | Google, npm `@mediapipe/selfie_segmentation@0.1.1675465747` | npm metadata Apache-2.0; weights/model card **not read** | Apache-2.0 §4 for the package | `mediapipe-github-LICENSE.txt` |
| Tesseract OCR core + `eng.traineddata.gz` (`public/tesseract/`) | tesseract.js 5.1.1 / tesseract-ocr tessdata | Apache-2.0 (npm; tessdata repo LICENSE read) | Apache-2.0 §4 | `tessdata-github-LICENSE.txt` |
| ONNX Runtime Web wasm (`/ort/`, from `onnxruntime-web` 1.26.0-dev.20260416-b7804b056c) | Microsoft | MIT per `package.json` `license` field; the package ships **no LICENSE file and states no copyright holder** | MIT requires the copyright + permission notice with copies — **notice text not available from what was read** | §5 MIT is a generic text from another package, not ORT's own |
| `@huggingface/transformers` 4.2.0 | Hugging Face | Apache-2.0 | Apache-2.0 §4 | `transformersjs-github-LICENSE.txt` |
| `@tensorflow-models/*`, `@tensorflow/tfjs*` | Google / TensorFlow authors | Apache-2.0 (npm metadata; tfjs-models LICENSE read; `tfjs-layers` is `Apache-2.0 AND MIT`) | Apache-2.0 §4 | `tfjs-models-github-LICENSE.txt` |
| `mediabunny` 1.65.2 | per package | MPL-2.0 | MPL-2.0 conditions (source availability for covered files, notices) — counsel to review | `npm-mediabunny-LICENSE.txt` |

## 2. Assets loaded from a remote host at runtime (bytes controlled by a third party)

| asset | loaded from | where in code | licence stated |
|---|---|---|---|
| COCO-SSD MobileNet-v2 weights | `https://storage.googleapis.com/tfjs-models/savedmodel/` | `lib/racketCocoDetect.ts:33`, library `coco-ssd.js:515` | weights licence **not obtained** (library Apache-2.0) |
| MediaPipe Selfie Segmentation solution | `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/` | `lib/webcamSegmentation.ts:7` | npm: Apache-2.0 |
| `@ffmpeg/core` 0.12.10 | `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm` | `lib/ffmpegWebmToMp4.ts:10-11` | npm metadata: **GPL-2.0-or-later** |
| `@ffmpeg/core` 0.12.6 | `https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd` | `components/ExportModal.tsx:25,143` | npm metadata: MIT |
| Gemini API (service) | `https://generativelanguage.googleapis.com/` | `lib/gemini/decodeMatchScreenshots.ts:20` | Google API terms — not read |

## 3. npm packages (non-development entries of `package-lock.json`)

429 entries. 'Licence' = SPDX expression declared in the installed `package.json`. 'Copyright' = first line starting with Copyright/(c)/© in the package's licence file, if one is installed. **99 entries are platform-specific optional packages not installed on the review machine** (licence from the lockfile, copyright not read); 41 installed packages have no licence file (licence field only). Which of these reach the browser bundle, the server, or build tooling only was **not determined**. Direct dependencies in bold.

| package | version | licence | copyright |
|---|---|---|---|
| @asamuzakjp/css-color | 3.2.0 | MIT | Copyright (c) 2024 asamuzaK (Kazz) |
| @babel/runtime | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @csstools/color-helpers | 5.1.0 | MIT-0 | Copyright © CSSTools Contributors |
| @csstools/css-calc | 2.1.4 | MIT | Copyright 2022 Romain Menke, Antonio Laguna <antonio@laguna.es> |
| @csstools/css-color-parser | 3.1.0 | MIT | Copyright 2022 Romain Menke, Antonio Laguna <antonio@laguna.es> |
| @csstools/css-parser-algorithms | 3.0.5 | MIT | Copyright 2022 Romain Menke, Antonio Laguna <antonio@laguna.es> |
| @csstools/css-tokenizer | 3.0.4 | MIT | Copyright 2022 Romain Menke, Antonio Laguna <antonio@laguna.es> |
| @emnapi/runtime | 1.9.2 | MIT | Copyright (c) 2021-present Toyobayashi |
| **@ffmpeg/ffmpeg** | 0.12.15 | MIT | no licence file |
| @ffmpeg/types | 0.12.4 | MIT | no licence file |
| **@ffmpeg/util** | 0.12.2 | MIT | no licence file |
| @huggingface/jinja | 0.5.9 | MIT | Copyright (c) 2023 Hugging Face |
| @huggingface/tokenizers | 0.1.3 | Apache-2.0 | copyright notice that is included in or attached to the work |
| **@huggingface/transformers** | 4.2.0 | Apache-2.0 | copyright notice that is included in or attached to the work |
| @img/colour | 1.1.0 | MIT | Copyright (c) 2012 Heather Arthur |
| @img/sharp-darwin-arm64 | 0.34.5 | Apache-2.0 | not read (not installed) |
| @img/sharp-darwin-x64 | 0.34.5 | Apache-2.0 | not read (not installed) |
| @img/sharp-libvips-darwin-arm64 | 1.2.4 | LGPL-3.0-or-later | not read (not installed) |
| @img/sharp-libvips-darwin-x64 | 1.2.4 | LGPL-3.0-or-later | not read (not installed) |
| @img/sharp-libvips-linux-arm | 1.2.4 | LGPL-3.0-or-later | not read (not installed) |
| @img/sharp-libvips-linux-arm64 | 1.2.4 | LGPL-3.0-or-later | not read (not installed) |
| @img/sharp-libvips-linux-ppc64 | 1.2.4 | LGPL-3.0-or-later | not read (not installed) |
| @img/sharp-libvips-linux-riscv64 | 1.2.4 | LGPL-3.0-or-later | not read (not installed) |
| @img/sharp-libvips-linux-s390x | 1.2.4 | LGPL-3.0-or-later | not read (not installed) |
| @img/sharp-libvips-linux-x64 | 1.2.4 | LGPL-3.0-or-later | no licence file |
| @img/sharp-libvips-linuxmusl-arm64 | 1.2.4 | LGPL-3.0-or-later | not read (not installed) |
| @img/sharp-libvips-linuxmusl-x64 | 1.2.4 | LGPL-3.0-or-later | no licence file |
| @img/sharp-linux-arm | 0.34.5 | Apache-2.0 | not read (not installed) |
| @img/sharp-linux-arm64 | 0.34.5 | Apache-2.0 | not read (not installed) |
| @img/sharp-linux-ppc64 | 0.34.5 | Apache-2.0 | not read (not installed) |
| @img/sharp-linux-riscv64 | 0.34.5 | Apache-2.0 | not read (not installed) |
| @img/sharp-linux-s390x | 0.34.5 | Apache-2.0 | not read (not installed) |
| @img/sharp-linux-x64 | 0.34.5 | Apache-2.0 | not stated in licence file |
| @img/sharp-linuxmusl-arm64 | 0.34.5 | Apache-2.0 | not read (not installed) |
| @img/sharp-linuxmusl-x64 | 0.34.5 | Apache-2.0 | not stated in licence file |
| @img/sharp-wasm32 | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | not read (not installed) |
| @img/sharp-win32-arm64 | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later | not read (not installed) |
| @img/sharp-win32-ia32 | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later | not read (not installed) |
| @img/sharp-win32-x64 | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later | not read (not installed) |
| @jridgewell/sourcemap-codec | 1.5.5 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @mapbox/node-pre-gyp | 1.0.11 | BSD-3-Clause | not read (not installed) |
| **@mediapipe/pose** | 0.5.1675469404 | Apache-2.0 | no licence file |
| @mediapipe/selfie_segmentation | 0.1.1675465747 | Apache-2.0 | no licence file |
| **@mediapipe/tasks-vision** | 0.10.35 | Apache-2.0 | no licence file |
| @napi-rs/lzma-linux-x64-gnu | 1.5.1 | MIT | no licence file |
| @next/env | 15.5.24 | MIT | no licence file |
| @next/swc-darwin-arm64 | 15.5.24 | MIT | not read (not installed) |
| @next/swc-darwin-x64 | 15.5.24 | MIT | not read (not installed) |
| @next/swc-linux-arm64-gnu | 15.5.24 | MIT | not read (not installed) |
| @next/swc-linux-arm64-musl | 15.5.24 | MIT | not read (not installed) |
| @next/swc-linux-x64-gnu | 15.5.24 | MIT | no licence file |
| @next/swc-linux-x64-musl | 15.5.24 | MIT | no licence file |
| @next/swc-win32-arm64-msvc | 15.5.24 | MIT | not read (not installed) |
| @next/swc-win32-x64-msvc | 15.5.24 | MIT | not read (not installed) |
| @opentelemetry/api | 1.10.0 | Apache-2.0 | copyright notice that is included in or attached to the work |
| @oxc-parser/binding-android-arm-eabi | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-android-arm64 | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-darwin-arm64 | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-darwin-x64 | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-freebsd-x64 | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-linux-arm-gnueabihf | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-linux-arm-musleabihf | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-linux-arm64-gnu | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-linux-arm64-musl | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-linux-ppc64-gnu | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-linux-riscv64-gnu | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-linux-riscv64-musl | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-linux-s390x-gnu | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-linux-x64-gnu | 0.152.0 | MIT | no licence file |
| @oxc-parser/binding-linux-x64-musl | 0.152.0 | MIT | no licence file |
| @oxc-parser/binding-openharmony-arm64 | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-win32-arm64-msvc | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-win32-ia32-msvc | 0.152.0 | MIT | not read (not installed) |
| @oxc-parser/binding-win32-x64-msvc | 0.152.0 | MIT | not read (not installed) |
| @oxc-project/types | 0.152.0 | MIT | Copyright (c) 2024-present VoidZero Inc. & Contributors |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. |
| @rollup/plugin-commonjs | 28.0.1 | MIT | Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors) |
| @rollup/pluginutils | 5.5.1 | MIT | Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors) |
| @rollup/rollup-android-arm-eabi | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-android-arm64 | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-darwin-arm64 | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-darwin-x64 | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-freebsd-arm64 | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-freebsd-x64 | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-arm-gnueabihf | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-arm-musleabihf | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-arm64-gnu | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-arm64-musl | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-loong64-gnu | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-loong64-musl | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-ppc64-gnu | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-ppc64-musl | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-riscv64-gnu | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-riscv64-musl | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-s390x-gnu | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-linux-x64-gnu | 4.65.0 | MIT | no licence file |
| @rollup/rollup-linux-x64-musl | 4.65.0 | MIT | no licence file |
| @rollup/rollup-openbsd-x64 | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-openharmony-arm64 | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-win32-arm64-msvc | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-win32-ia32-msvc | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-win32-x64-gnu | 4.65.0 | MIT | not read (not installed) |
| @rollup/rollup-win32-x64-msvc | 4.65.0 | MIT | not read (not installed) |
| @sentry/browser | 11.9.0 | MIT | Copyright (c) 2019 Functional Software, Inc. dba Sentry |
| @sentry/browser-utils | 11.9.0 | MIT | Copyright (c) 2020 Functional Software, Inc. dba Sentry |
| @sentry/bundler-plugins | 11.9.0 | MIT | Copyright (c) 2022 Functional Software, Inc. dba Sentry |
| @sentry/cloudflare | 11.9.0 | MIT | Copyright (c) 2024 Functional Software, Inc. dba Sentry |
| @sentry/conventions | 0.27.0 | MIT | Copyright (c) 2023-2025 Functional Software, Inc. dba Sentry |
| @sentry/core | 11.9.0 | MIT | Copyright (c) 2019 Functional Software, Inc. dba Sentry |
| @sentry/feedback | 11.9.0 | MIT | Copyright (c) 2023 Functional Software, Inc. dba Sentry |
| **@sentry/nextjs** | 11.9.0 | MIT | Copyright (c) 2021 Functional Software, Inc. dba Sentry |
| @sentry/node | 11.9.0 | MIT | Copyright (c) 2023 Functional Software, Inc. dba Sentry |
| @sentry/opentelemetry | 11.9.0 | MIT | Copyright (c) 2023 Functional Software, Inc. dba Sentry |
| @sentry/react | 11.9.0 | MIT | Copyright (c) 2019 Functional Software, Inc. dba Sentry |
| @sentry/replay | 11.9.0 | MIT | Copyright (c) 2022 Functional Software, Inc. dba Sentry |
| @sentry/replay-canvas | 11.9.0 | MIT | Copyright (c) 2024 Functional Software, Inc. dba Sentry |
| @sentry/server-runtime-injection | 11.9.0 | MIT | no licence file |
| @sentry/server-utils | 11.9.0 | MIT | no licence file |
| @sentry/vercel-edge | 11.9.0 | MIT | Copyright (c) 2023 Functional Software, Inc. dba Sentry |
| @supabase/auth-js | 2.108.2 | MIT | Copyright (c) 2020 Supabase |
| @supabase/functions-js | 2.108.2 | MIT | Copyright (c) 2020 Supabase |
| @supabase/phoenix | 0.4.4 | MIT | Copyright (c) 2014 Chris McCord |
| @supabase/postgrest-js | 2.108.2 | MIT | Copyright (c) 2020 Supabase |
| @supabase/realtime-js | 2.108.2 | MIT | Copyright (c) 2020 Supabase |
| **@supabase/ssr** | 0.12.0 | MIT | Copyright (c) 2022-2023 Supabase, Inc. |
| @supabase/storage-js | 2.108.2 | MIT | Copyright (c) 2020 Supabase |
| **@supabase/supabase-js** | 2.108.2 | MIT | Copyright (c) 2020 Supabase |
| @swc/helpers | 0.5.15 | Apache-2.0 | copyright notice that is included in or attached to the work |
| **@tensorflow-models/body-segmentation** | 1.0.2 | Apache-2.0 | no licence file |
| **@tensorflow-models/coco-ssd** | 2.2.3 | Apache-2.0 | no licence file |
| **@tensorflow-models/pose-detection** | 2.1.3 | Apache-2.0 | no licence file |
| **@tensorflow/tfjs** | 4.22.0 | Apache-2.0 | no licence file |
| @tensorflow/tfjs-backend-cpu | 4.22.0 | Apache-2.0 | no licence file |
| @tensorflow/tfjs-backend-wasm | 4.22.0 | Apache-2.0 | no licence file |
| @tensorflow/tfjs-backend-webgl | 4.22.0 | Apache-2.0 | no licence file |
| **@tensorflow/tfjs-backend-webgpu** | 4.22.0 | Apache-2.0 | no licence file |
| @tensorflow/tfjs-converter | 4.22.0 | Apache-2.0 | no licence file |
| @tensorflow/tfjs-core | 4.22.0 | Apache-2.0 | no licence file |
| @tensorflow/tfjs-data | 4.22.0 | Apache-2.0 | no licence file |
| @tensorflow/tfjs-layers | 4.22.0 | Apache-2.0 AND MIT | no licence file |
| @types/dom-mediacapture-transform | 0.1.12 | MIT | Copyright (c) Microsoft Corporation. |
| @types/dom-webcodecs | 0.1.13 | MIT | Copyright (c) Microsoft Corporation. |
| @types/emscripten | 0.0.34 | MIT | Copyright (c) Microsoft Corporation. All rights reserved. |
| @types/estree | 1.0.9 | MIT | Copyright (c) Microsoft Corporation. |
| @types/long | 4.0.2 | MIT | Copyright (c) Microsoft Corporation. |
| @types/node | 20.19.39 | MIT | Copyright (c) Microsoft Corporation. |
| @types/node-fetch | 2.6.13 | MIT | Copyright (c) Microsoft Corporation. |
| @types/offscreencanvas | 2019.3.0 | MIT | Copyright (c) Microsoft Corporation. All rights reserved. |
| @types/offscreencanvas | 2019.7.3 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pako | 2.0.4 | MIT | Copyright (c) Microsoft Corporation. |
| @types/raf | 3.4.3 | MIT | Copyright (c) Microsoft Corporation. |
| @types/seedrandom | 2.4.34 | MIT | Copyright (c) Microsoft Corporation. |
| @types/trusted-types | 2.0.7 | MIT | Copyright (c) Microsoft Corporation. |
| @webgpu/types | 0.1.38 | BSD-3-Clause | Copyright 2022 WebGPU Developers |
| **@ybd-project/ytdl-core** | 6.0.8 | MIT | Copyright (C) 2024 YBD Project |
| abbrev | 1.1.1 | ISC | not read (not installed) |
| acorn | 8.16.0 | MIT | Copyright (C) 2012-2022 by various contributors (see AUTHORS) |
| adm-zip | 0.5.18 | MIT | Copyright (c) 2012 Another-D-Mention Software and other contributors |
| agent-base | 6.0.2 | MIT | not read (not installed) |
| agent-base | 7.1.4 | MIT | Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net> |
| ansi-regex | 5.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| ansi-styles | 4.3.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| aproba | 2.1.0 | ISC | not read (not installed) |
| are-we-there-yet | 2.0.0 | ISC | not read (not installed) |
| argparse | 1.0.10 | MIT | Copyright (C) 2012 by Vitaly Puzrin |
| asynckit | 0.4.0 | MIT | Copyright (c) 2016 Alex Indigo |
| balanced-match | 1.0.2 | MIT | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; |
| balanced-match | 4.0.4 | MIT | not stated in licence file |
| base64-arraybuffer | 1.0.2 | MIT | Copyright (c) 2012 Niklas von Hertzen |
| base64-js | 1.5.1 | MIT | Copyright (c) 2014 Jameson Little |
| bgutils-js | 3.2.0 | MIT | Copyright (c) 2024 LuanRT |
| bignumber.js | 9.3.1 | MIT | Copyright © `<2025>` `Michael Mclaughlin` |
| bmp-js | 0.1.0 | MIT | Copyright (c) 2014 @丝刀口 |
| boolean | 3.2.0 | MIT | not stated in licence file |
| brace-expansion | 1.1.13 | MIT | Copyright (c) 2013 Julian Gruber <julian@juliangruber.com> |
| brace-expansion | 5.0.12 | MIT | Copyright Julian Gruber <julian@juliangruber.com> |
| buffer-equal-constant-time | 1.0.1 | BSD-3-Clause | Copyright (c) 2013, GoInstant Inc., a salesforce.com company |
| call-bind-apply-helpers | 1.0.2 | MIT | Copyright (c) 2024 Jordan Harband |
| call-bound | 1.0.4 | MIT | Copyright (c) 2024 Jordan Harband |
| caniuse-lite | 1.0.30001784 | CC-BY-4.0 | copyright and certain other rights. Our licenses are |
| canvas | 2.11.2 | MIT | not read (not installed) |
| canvg | 3.0.11 | MIT | Copyright (c) 2010 - present Gabe Lerner (gabelerner@gmail.com) - https://github.com/canvg/canvg |
| chalk | 4.1.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| chownr | 2.0.0 | ISC | not read (not installed) |
| client-only | 0.0.1 | MIT | no licence file |
| cliui | 7.0.4 | ISC | Copyright (c) 2015, Contributors |
| color-convert | 2.0.1 | MIT | Copyright (c) 2011-2016 Heather Arthur <fayearthur@gmail.com> |
| color-name | 1.1.4 | MIT | Copyright (c) 2015 Dmitry Ivanov |
| color-support | 1.1.3 | ISC | not read (not installed) |
| combined-stream | 1.0.8 | MIT | Copyright (c) 2011 Debuggable Limited <felix@debuggable.com> |
| commondir | 1.0.1 | MIT | Copyright (c) 2013 James Halliday (mail@substack.net) |
| concat-map | 0.0.1 | MIT | COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER |
| console-control-strings | 1.1.0 | ISC | not read (not installed) |
| cookie | 1.1.1 | MIT | Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com> |
| core-js | 3.29.1 | MIT | Copyright (c) 2014-2023 Denis Pushkarev |
| css-line-break | 2.1.0 | MIT | Copyright (c) 2017 Niklas von Hertzen |
| cssstyle | 4.6.0 | MIT | Copyright (c) Chad Walker |
| data-urls | 5.0.0 | MIT | Copyright © Domenic Denicola <d@domenic.me> |
| debug | 4.4.3 | MIT | Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> |
| decimal.js | 10.6.0 | MIT | Copyright (c) 2025 Michael Mclaughlin |
| decompress-response | 4.2.1 | MIT | not read (not installed) |
| define-data-property | 1.1.4 | MIT | Copyright (c) 2023 Jordan Harband |
| define-properties | 1.2.1 | MIT | Copyright (C) 2015 Jordan Harband |
| delayed-stream | 1.0.0 | MIT | Copyright (c) 2011 Debuggable Limited <felix@debuggable.com> |
| delegates | 1.0.0 | MIT | not read (not installed) |
| detect-libc | 2.1.2 | Apache-2.0 | copyright notice that is included in or attached to the work |
| detect-node | 2.1.0 | MIT | Copyright (c) 2017 Ilya Kantor |
| dompurify | 3.4.14 | (MPL-2.0 OR Apache-2.0) | (c) under Patent Claims infringed by Covered Software in the absence of |
| dotenv | 17.4.2 | BSD-2-Clause | Copyright (c) 2015, Scott Motte |
| dunder-proto | 1.0.1 | MIT | Copyright (c) 2024 ECMAScript Shims |
| ecdsa-sig-formatter | 1.0.11 | Apache-2.0 | copyright notice that is included in or attached to the work |
| emoji-regex | 8.0.0 | MIT | Copyright Mathias Bynens <https://mathiasbynens.be/> |
| entities | 6.0.1 | BSD-2-Clause | Copyright (c) Felix Böhm |
| es-define-property | 1.0.1 | MIT | Copyright (c) 2024 Jordan Harband |
| es-errors | 1.3.0 | MIT | Copyright (c) 2024 Jordan Harband |
| es-object-atoms | 1.1.1 | MIT | Copyright (c) 2024 Jordan Harband |
| es-set-tostringtag | 2.1.0 | MIT | Copyright (c) 2022 ECMAScript Shims |
| es6-error | 4.1.1 | MIT | Copyright (c) 2015 Ben Youngblood |
| escalade | 3.2.0 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| escape-string-regexp | 4.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| estree-walker | 2.0.2 | MIT | Copyright (c) 2015-20 [these people](https://github.com/Rich-Harris/estree-walker/graphs/contributors) |
| extend | 3.0.2 | MIT | Copyright (c) 2014 Stefan Thomas |
| fast-png | 6.4.0 | MIT | Copyright (c) 2015 Michaël Zasso |
| fdir | 6.5.0 | MIT | Copyright 2023 Abdullah Atta |
| fflate | 0.8.3 | MIT | Copyright (c) 2026 Arjun Barrett |
| flatbuffers | 25.9.23 | Apache-2.0 | copyright notice that is included in or attached to the work |
| form-data | 4.0.6 | MIT | Copyright (c) 2012 Felix Geisendörfer (felix@debuggable.com) and contributors |
| fs-minipass | 2.1.0 | ISC | not read (not installed) |
| fs.realpath | 1.0.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| fsevents | 2.3.3 | MIT | not read (not installed) |
| function-bind | 1.1.2 | MIT | Copyright (c) 2013 Raynos. |
| gauge | 3.0.2 | ISC | not read (not installed) |
| gaxios | 6.7.1 | Apache-2.0 | copyright notice that is included in or attached to the work |
| gcp-metadata | 6.1.1 | Apache-2.0 | copyright notice that is included in or attached to the work |
| get-caller-file | 2.0.5 | ISC | Copyright 2018 Stefan Penner |
| get-intrinsic | 1.3.0 | MIT | Copyright (c) 2020 Jordan Harband |
| get-proto | 1.0.1 | MIT | Copyright (c) 2025 Jordan Harband |
| glob | 13.0.6 | BlueOak-1.0.0 | Copyright |
| glob | 7.2.3 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| global-agent | 3.0.0 | BSD-3-Clause | Copyright (c) 2019, Gajus Kuizinas (http://gajus.com/) |
| globalthis | 1.0.4 | MIT | Copyright (c) 2016 Jordan Harband |
| google-auth-library | 9.15.1 | Apache-2.0 | copyright notice that is included in or attached to the work |
| google-logging-utils | 0.0.2 | Apache-2.0 | copyright notice that is included in or attached to the work |
| **googleapis** | 140.0.1 | Apache-2.0 | copyright notice that is included in or attached to the work |
| googleapis-common | 7.2.0 | Apache-2.0 | copyright notice that is included in or attached to the work |
| gopd | 1.2.0 | MIT | Copyright (c) 2022 Jordan Harband |
| gtoken | 7.1.0 | MIT | Copyright (c) 2014 Ryan Seys |
| guid-typescript | 1.0.9 | ISC | no licence file |
| has-flag | 4.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| has-property-descriptors | 1.0.2 | MIT | Copyright (c) 2022 Inspect JS |
| has-symbols | 1.1.0 | MIT | Copyright (c) 2016 Jordan Harband |
| has-tostringtag | 1.0.2 | MIT | Copyright (c) 2021 Inspect JS |
| has-unicode | 2.0.1 | ISC | not read (not installed) |
| hasown | 2.0.4 | MIT | Copyright (c) Jordan Harband and contributors |
| html-encoding-sniffer | 4.0.0 | MIT | Copyright © Domenic Denicola <d@domenic.me> |
| **html-to-image** | 1.11.13 | MIT | Copyright (c) 2017-2025 W.Y. |
| html2canvas | 1.4.1 | MIT | Copyright (c) 2012 Niklas von Hertzen |
| http-proxy-agent | 7.0.2 | MIT | Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net> |
| https-proxy-agent | 5.0.1 | MIT | not read (not installed) |
| https-proxy-agent | 7.0.6 | MIT | Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net> |
| iceberg-js | 0.8.1 | MIT | Copyright (c) 2025 Supabase |
| iconv-lite | 0.6.3 | MIT | Copyright (c) 2011 Alexander Shtuchkin |
| idb-keyval | 6.3.0 | Apache-2.0 | Copyright 2016, Jake Archibald |
| inflight | 1.0.6 | ISC | Copyright (c) Isaac Z. Schlueter |
| inherits | 2.0.4 | ISC | Copyright (c) Isaac Z. Schlueter |
| iobuffer | 5.4.0 | MIT | Copyright (c) 2015 Michaël Zasso |
| is-electron | 2.2.2 | MIT | Copyright (c) 2016-2018 Cheton Wu |
| is-fullwidth-code-point | 3.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| is-potential-custom-element-name | 1.0.1 | MIT | Copyright Mathias Bynens <https://mathiasbynens.be/> |
| is-reference | 1.2.1 | MIT | no licence file |
| is-stream | 2.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| is-url | 1.2.4 | MIT | not stated in licence file |
| js-tokens | 4.0.0 | MIT | Copyright (c) 2014, 2015, 2016, 2017, 2018 Simon Lydell |
| jsdom | 25.0.1 | MIT | Copyright (c) 2010 Elijah Insua |
| json-bigint | 1.0.0 | MIT | Copyright (c) 2013 Andrey Sidorov |
| json-stringify-safe | 5.0.1 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| **jspdf** | 4.2.1 | MIT | Copyright |
| jwa | 2.0.1 | MIT | Copyright (c) 2013 Brian J. Brennan |
| jws | 4.0.1 | MIT | Copyright (c) 2013 Brian J. Brennan |
| long | 4.0.0 | Apache-2.0 | copyright notice that is included in or attached to the work |
| long | 5.3.2 | Apache-2.0 | copyright notice that is included in or attached to the work |
| long | 5.3.2 | Apache-2.0 | copyright notice that is included in or attached to the work |
| loose-envify | 1.4.0 | MIT | Copyright (c) 2015 Andres Suarez <zertosh@gmail.com> |
| lru-cache | 10.4.3 | ISC | Copyright (c) 2010-2023 Isaac Z. Schlueter and Contributors |
| lru-cache | 11.5.3 | BlueOak-1.0.0 | Copyright |
| **lucide-react** | 0.263.1 | ISC | Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide  |
| magic-string | 0.30.21 | MIT | Copyright 2018 Rich Harris |
| make-dir | 3.1.0 | MIT | not read (not installed) |
| matcher | 3.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| math-intrinsics | 1.1.0 | MIT | Copyright (c) 2024 ECMAScript Shims |
| **mediabunny** | 1.65.2 | MPL-2.0 | (c) under Patent Claims infringed by Covered Software in the absence of |
| mime-db | 1.52.0 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |
| mime-types | 2.1.35 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |
| mimic-response | 2.1.0 | MIT | not read (not installed) |
| minimatch | 10.2.6 | BlueOak-1.0.0 | Copyright |
| minimatch | 3.1.5 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| minipass | 3.3.6 | ISC | not read (not installed) |
| minipass | 3.3.6 | ISC | not read (not installed) |
| minipass | 5.0.0 | ISC | not read (not installed) |
| minipass | 7.1.3 | BlueOak-1.0.0 | Copyright |
| minipass | 7.1.3 | BlueOak-1.0.0 | Copyright |
| minizlib | 2.1.2 | MIT | not read (not installed) |
| mkdirp | 1.0.4 | MIT | not read (not installed) |
| ms | 2.1.3 | MIT | Copyright (c) 2020 Vercel, Inc. |
| nan | 2.29.0 | MIT | not read (not installed) |
| nanoid | 3.3.11 | MIT | Copyright 2017 Andrey Sitnik <andrey@sitnik.ru> |
| **next** | 15.5.24 | MIT | Copyright (c) 2025 Vercel, Inc. |
| node-fetch | 2.6.13 | MIT | Copyright (c) 2016 David Frank |
| nopt | 5.0.0 | ISC | not read (not installed) |
| normalize-wheel | 1.0.1 | BSD-3-Clause | Copyright (c) 2015, Facebook, Inc. All rights reserved. |
| npmlog | 5.0.1 | ISC | not read (not installed) |
| nwsapi | 2.2.23 | MIT | Copyright (c) 2007-2025 Diego Perini (http://www.iport.it/) |
| object-assign | 4.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| object-inspect | 1.13.4 | MIT | Copyright (c) 2013 James Halliday |
| object-keys | 1.1.1 | MIT | Copyright (C) 2013 Jordan Harband |
| once | 1.4.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| onnxruntime-common | 1.24.0-dev.20251116-b39e144322 | MIT | no licence file |
| onnxruntime-common | 1.24.3 | MIT | no licence file |
| onnxruntime-node | 1.24.3 | MIT | no licence file |
| onnxruntime-web | 1.26.0-dev.20260416-b7804b056c | MIT | no licence file |
| opencollective-postinstall | 2.0.3 | MIT | Copyright (c) 2018 Open Collective |
| oxc-parser | 0.152.0 | MIT | Copyright (c) 2024-present VoidZero Inc. & Contributors |
| pako | 2.2.0 | (MIT AND Zlib) | Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn |
| parse5 | 7.3.0 | MIT | Copyright (c) 2013-2019 Ivan Nikulin (ifaaan@gmail.com, https://github.com/inikulin) |
| path-is-absolute | 1.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| path-scurry | 2.0.2 | BlueOak-1.0.0 | Copyright |
| performance-now | 2.1.0 | MIT | Copyright (c) 2013 Braveg1rl |
| picocolors | 1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov |
| picomatch | 4.0.4 | MIT | Copyright (c) 2017-present, Jon Schlinkert. |
| platform | 1.3.6 | MIT | Copyright 2014-2020 Benjamin Tan |
| postcss | 8.4.31 | MIT | Copyright 2013 Andrey Sitnik <andrey@sitnik.ru> |
| protobufjs | 7.6.5 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. |
| punycode | 2.3.1 | MIT | Copyright Mathias Bynens <https://mathiasbynens.be/> |
| qs | 6.15.2 | BSD-3-Clause | Copyright (c) 2014, Nathan LaFreniere and other [contributors](https://github.com/ljharb/qs/graphs/contributors) |
| raf | 3.4.1 | MIT | Copyright 2013 Chris Dickinson <chris@neversaw.us> |
| **react** | 18.3.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates. |
| **react-dom** | 18.3.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates. |
| **react-easy-crop** | 6.2.3 | MIT | Copyright (c) 2022 Valentin Hervieu |
| readable-stream | 3.6.2 | MIT | Copyright Node.js contributors. All rights reserved. |
| regenerator-runtime | 0.13.11 | MIT | Copyright (c) 2014-present, Facebook, Inc. |
| require-directory | 2.1.1 | MIT | Copyright (c) 2011 Troy Goode <troygoode@gmail.com> |
| rgbcolor | 1.0.1 | MIT OR SEE LICENSE IN FEEL-FREE.md | Copyright (c) 2016 Stoyan Stefanov, http://phpied.com/ |
| rimraf | 3.0.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| roarr | 2.15.4 | BSD-3-Clause | Copyright (c) 2019, Gajus Kuizinas (http://gajus.com/) |
| rollup | 4.65.0 | MIT | Copyright (c) 2017 [these people](https://github.com/rollup/rollup/graphs/contributors) |
| rrweb-cssom | 0.7.1 | MIT | Copyright (c) Nikita Vasilyev |
| rrweb-cssom | 0.8.0 | MIT | Copyright (c) Nikita Vasilyev |
| safe-buffer | 5.2.1 | MIT | Copyright (c) Feross Aboukhadijeh |
| safer-buffer | 2.1.2 | MIT | Copyright (c) 2018 Nikita Skovoroda <chalkerx@gmail.com> |
| saxes | 6.0.0 | ISC | no licence file |
| scheduler | 0.23.2 | MIT | Copyright (c) Facebook, Inc. and its affiliates. |
| seedrandom | 3.0.5 | MIT | no licence file |
| semver | 6.3.1 | ISC | not read (not installed) |
| semver | 7.7.4 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| semver-compare | 1.0.0 | MIT | COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER |
| sentry | 0.45.0 | FSL-1.1-Apache-2.0 | Copyright 2025 Functional Software, Inc. dba Sentry |
| serialize-error | 7.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| **server-only** | 0.0.1 | MIT | no licence file |
| set-blocking | 2.0.0 | ISC | not read (not installed) |
| sharp | 0.34.5 | Apache-2.0 | not stated in licence file |
| side-channel | 1.1.0 | MIT | Copyright (c) 2019 Jordan Harband |
| side-channel-list | 1.0.0 | MIT | Copyright (c) 2024 Jordan Harband |
| side-channel-map | 1.0.1 | MIT | Copyright (c) 2024 Jordan Harband |
| side-channel-weakmap | 1.0.2 | MIT | Copyright (c) 2019 Jordan Harband |
| signal-exit | 3.0.7 | ISC | not read (not installed) |
| simple-concat | 1.0.1 | MIT | Copyright (c) Feross Aboukhadijeh |
| simple-get | 3.1.1 | MIT | not read (not installed) |
| source-map-js | 1.2.1 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |
| sprintf-js | 1.0.3 | BSD-3-Clause | Copyright (c) 2007-2014, Alexandru Marasteanu <hello [at) alexei (dot] ro> |
| sprintf-js | 1.1.3 | BSD-3-Clause | Copyright (c) 2007-present, Alexandru Mărășteanu <hello@alexei.ro> |
| stackblur-canvas | 2.7.0 | MIT | Copyright (c) 2010 Mario Klingemann |
| stacktrace-parser | 0.1.11 | MIT | Copyright (c) 2014-2019 Georg Tavonius |
| string-width | 4.2.3 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| string_decoder | 1.3.0 | MIT | Copyright Node.js contributors. All rights reserved. |
| strip-ansi | 6.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| **stripe** | 22.2.2 | MIT | Copyright (C) 2011 Ask Bjørn Hansen |
| styled-jsx | 5.1.6 | MIT | Copyright (c) 2016-present Vercel, Inc. |
| supports-color | 7.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| supports-color | 8.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| svg-pathdata | 6.0.3 | MIT | Copyright © 2017 Nicolas Froidure |
| symbol-tree | 3.2.4 | MIT | Copyright (c) 2015 Joris van der Wel |
| tar | 6.2.1 | ISC | not read (not installed) |
| **tesseract.js** | 5.1.1 | Apache-2.0 | copyright notice that is included in or attached to the work |
| tesseract.js-core | 5.1.1 | Apache-2.0 | copyright notice that is included in or attached to the work |
| text-segmentation | 1.0.3 | MIT | Copyright (c) 2021 Niklas von Hertzen |
| tldts | 6.1.86 | MIT | Copyright (c) 2017 Thomas Parisot, 2018 Rémi Berson |
| tldts-core | 6.1.86 | MIT | Copyright (c) 2017 Thomas Parisot, 2018 Rémi Berson |
| tough-cookie | 5.1.2 | BSD-3-Clause | Copyright (c) 2015, Salesforce.com, Inc. |
| tr46 | 0.0.3 | MIT | no licence file |
| tr46 | 5.1.1 | MIT | Copyright (c) Sebastian Mayr |
| tslib | 2.4.0 | 0BSD | Copyright (c) Microsoft Corporation. |
| tslib | 2.8.1 | 0BSD | Copyright (c) Microsoft Corporation. |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https:/sindresorhus.com) |
| type-fest | 0.7.1 | (MIT OR CC0-1.0) | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| undici | 6.25.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |
| url-template | 2.0.8 | BSD | Copyright (c) 2012-2014, Bram Stein |
| util-deprecate | 1.0.2 | MIT | Copyright (c) 2014 Nathan Rajlich <nathan@tootallnate.net> |
| utrie | 1.0.2 | MIT | Copyright (c) 2021 Niklas von Hertzen |
| uuid | 9.0.1 | MIT | Copyright (c) 2010-2020 Robert Kieffer and other contributors |
| w3c-xmlserializer | 5.0.0 | MIT | Copyright © Sebastian Mayr |
| wasm-feature-detect | 1.8.0 | Apache-2.0 | copyright notice that is included in or attached to the work |
| web-vitals | 6.2.3 | Apache-2.0 | copyright notice that is included in or attached to the work |
| webidl-conversions | 3.0.1 | BSD-2-Clause | Copyright (c) 2014, Domenic Denicola |
| webidl-conversions | 7.0.0 | BSD-2-Clause | Copyright (c) 2014, Domenic Denicola |
| **webm-fix-duration** | 1.0.1 | MIT | Copyright (c) 2018 Yury Sitnikov |
| whatwg-encoding | 3.1.1 | MIT | Copyright © Domenic Denicola <d@domenic.me> |
| whatwg-mimetype | 4.0.0 | MIT | Copyright © Domenic Denicola <d@domenic.me> |
| whatwg-url | 14.2.0 | MIT | Copyright (c) Sebastian Mayr |
| whatwg-url | 5.0.0 | MIT | Copyright (c) 2015–2016 Sebastian Mayr |
| wide-align | 1.1.5 | ISC | not read (not installed) |
| wrap-ansi | 7.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| wrappy | 1.0.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| ws | 8.21.0 | MIT | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> |
| xml-name-validator | 5.0.0 | Apache-2.0 | copyright notice that is included in or attached to the work |
| xmlchars | 2.2.0 | MIT | Copyright Louis-Dominique Dubeau and contributors to xmlchars |
| y18n | 5.0.8 | ISC | Copyright (c) 2015, Contributors |
| yallist | 4.0.0 | ISC | not read (not installed) |
| yargs | 16.2.0 | MIT | Copyright 2010 James Halliday (mail@substack.net); Modified work Copyright 2014 Contributors (ben@npmjs.com) |
| yargs-parser | 20.2.9 | ISC | Copyright (c) 2016, Contributors |
| zlibjs | 0.3.1 | MIT | Copyright (c) 2012 imaya |

## 4. Items needing counsel's attention

- `@img/sharp-libvips-darwin-arm64` 1.2.4 — `LGPL-3.0-or-later` (optional platform package family: all `@img/sharp-*`)
- `@img/sharp-wasm32` 0.34.5 — `Apache-2.0 AND LGPL-3.0-or-later AND MIT` (optional platform package family: all `@img/sharp-*`)
- `@img/sharp-win32-arm64` 0.34.5 — `Apache-2.0 AND LGPL-3.0-or-later` (optional platform package family: all `@img/sharp-*`)
- `@tensorflow/tfjs-layers` 4.22.0 — `Apache-2.0 AND MIT`
- `caniuse-lite` 1.0.30001784 — `CC-BY-4.0`
- `dompurify` 3.4.14 — `(MPL-2.0 OR Apache-2.0)`
- `glob` 13.0.6 — `BlueOak-1.0.0`
- `lru-cache` 11.5.3 — `BlueOak-1.0.0`
- `mediabunny` 1.65.2 — `MPL-2.0`
- `minimatch` 10.2.6 — `BlueOak-1.0.0`
- `minipass` 7.1.3 — `BlueOak-1.0.0`
- `pako` 2.2.0 — `(MIT AND Zlib)`
- `path-scurry` 2.0.2 — `BlueOak-1.0.0`
- `rgbcolor` 1.0.1 — `MIT OR SEE LICENSE IN FEEL-FREE.md`
- `sentry` 0.45.0 — `FSL-1.1-Apache-2.0`
- `type-fest` 0.13.1 — `(MIT OR CC0-1.0)`
- `url-template` 2.0.8 — `BSD`
- `@ffmpeg/core` (remote CDN, not in lockfile) — see §2.

## 5. Licence texts (one canonical copy per distinct licence; each package's own file remains in `node_modules/<pkg>/`)

### Apache-2.0 — text as shipped in `@huggingface/transformers@4.2.0`

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### MIT — text as shipped in `@asamuzakjp/css-color@3.2.0`

```text
MIT License

Copyright (c) 2024 asamuzaK (Kazz)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MPL-2.0 — text as shipped in `mediabunny@1.65.2`

```text
Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at https://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
```

### BSD-3-Clause — text as shipped in `@protobufjs/aspromise@1.1.2`

```text
Copyright (c) 2016, Daniel Wirtz  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of its author, nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD-2-Clause — text as shipped in `dotenv@17.4.2`

```text
Copyright (c) 2015, Scott Motte
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### ISC — text as shipped in `cliui@7.0.4`

```text
Copyright (c) 2015, Contributors

Permission to use, copy, modify, and/or distribute this software
for any purpose with or without fee is hereby granted, provided
that the above copyright notice and this permission notice
appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE
LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### 0BSD — text as shipped in `tslib@2.4.0`

```text
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### MIT-0 — text as shipped in `@csstools/color-helpers@5.1.0`

```text
MIT No Attribution (MIT-0)

Copyright © CSSTools Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### BlueOak-1.0.0 — text as shipped in `glob@13.0.6`

```text
All packages under `src/` are licensed according to the terms in
their respective `LICENSE` or `LICENSE.md` files.

The remainder of this project is licensed under the Blue Oak
Model License, as follows:

-----

# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with
this software as possible, while protecting contributors
from liability.

## Acceptance

In order to receive this license, you must agree to its
rules.  The rules of this license are both obligations
under that agreement and conditions to your license.
You must not do anything with this software that triggers
a rule that you cannot or will not follow.

## Copyright

Each contributor licenses you to do everything with this
software that would otherwise infringe that contributor's
copyright in it.

## Notices

You must ensure that everyone who gets a copy of
any part of this software from you, with or without
changes, also gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>.

## Excuse

If anyone notifies you in writing that you have not
complied with [Notices](#notices), you can keep your
license by taking all practical steps to comply within 30
days after the notice.  If you do not do so, your license
ends immediately.

## Patent

Each contributor licenses you to do everything with this
software that would otherwise infringe any patent claims
they can license or become able to license.

## Reliability

No contributor can revoke this license.

## No Liability

***As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim.***
```

### CC-BY-4.0 — text as shipped in `caniuse-lite@1.0.30001784`

```text
Attribution 4.0 International

=======================================================================

Creative Commons Corporation ("Creative Commons") is not a law firm and
does not provide legal services or legal advice. Distribution of
Creative Commons public licenses does not create a lawyer-client or
other relationship. Creative Commons makes its licenses and related
information available on an "as-is" basis. Creative Commons gives no
warranties regarding its licenses, any material licensed under their
terms and conditions, or any related information. Creative Commons
disclaims all liability for damages resulting from their use to the
fullest extent possible.

Using Creative Commons Public Licenses

Creative Commons public licenses provide a standard set of terms and
conditions that creators and other rights holders may use to share
original works of authorship and other material subject to copyright
and certain other rights specified in the public license below. The
following considerations are for informational purposes only, are not
exhaustive, and do not form part of our licenses.

     Considerations for licensors: Our public licenses are
     intended for use by those authorized to give the public
     permission to use material in ways otherwise restricted by
     copyright and certain other rights. Our licenses are
     irrevocable. Licensors should read and understand the terms
     and conditions of the license they choose before applying it.
     Licensors should also secure all rights necessary before
     applying our licenses so that the public can reuse the
     material as expected. Licensors should clearly mark any
     material not subject to the license. This includes other CC-
     licensed material, or material used under an exception or
     limitation to copyright. More considerations for licensors:
	wiki.creativecommons.org/Considerations_for_licensors

     Considerations for the public: By using one of our public
     licenses, a licensor grants the public permission to use the
     licensed material under specified terms and conditions. If
     the licensor's permission is not necessary for any reason--for
     example, because of any applicable exception or limitation to
     copyright--then that use is not regulated by the license. Our
     licenses grant only permissions under copyright and certain
     other rights that a licensor has authority to grant. Use of
     the licensed material may still be restricted for other
     reasons, including because others have copyright or other
     rights in the material. A licensor may make special requests,
     such as asking that all changes be marked or described.
     Although not required by our licenses, you are encouraged to
     respect those requests where reasonable. More_considerations
     for the public: 
	wiki.creativecommons.org/Considerations_for_licensees

=======================================================================

Creative Commons Attribution 4.0 International Public License

By exercising the Licensed Rights (defined below), You accept and agree
to be bound by the terms and conditions of this Creative Commons
Attribution 4.0 International Public License ("Public License"). To the
extent this Public License may be interpreted as a contract, You are
granted the Licensed Rights in consideration of Your acceptance of
these terms and conditions, and the Licensor grants You such rights in
consideration of benefits the Licensor receives from making the
Licensed Material available under these terms and conditions.


Section 1 -- Definitions.

  a. Adapted Material means material subject to Copyright and Similar
     Rights that is derived from or based upon the Licensed Material
     and in which the Licensed Material is translated, altered,
     arranged, transformed, or otherwise modified in a manner requiring
     permission under the Copyright and Similar Rights held by the
     Licensor. For purposes of this Public License, where the Licensed
     Material is a musical work, performance, or sound recording,
     Adapted Material is always produced where the Licensed Material is
     synched in timed relation with a moving image.

  b. Adapter's License means the license You apply to Your Copyright
     and Similar Rights in Your contributions to Adapted Material in
     accordance with the terms and conditions of this Public License.

  c. Copyright and Similar Rights means copyright and/or similar rights
     closely related to copyright including, without limitation,
     performance, broadcast, sound recording, and Sui Generis Database
     Rights, without regard to how the rights are labeled or
     categorized. For purposes of this Public License, the rights
     specified in Section 2(b)(1)-(2) are not Copyright and Similar
     Rights.

  d. Effective Technological Measures means those measures that, in the
     absence of proper authority, may not be circumvented under laws
     fulfilling obligations under Article 11 of the WIPO Copyright
     Treaty adopted on December 20, 1996, and/or similar international
     agreements.

  e. Exceptions and Limitations means fair use, fair dealing, and/or
     any other exception or limitation to Copyright and Similar Rights
     that applies to Your use of the Licensed Material.

  f. Licensed Material means the artistic or literary work, database,
     or other material to which the Licensor applied this Public
     License.

  g. Licensed Rights means the rights granted to You subject to the
     terms and conditions of this Public License, which are limited to
     all Copyright and Similar Rights that apply to Your use of the
     Licensed Material and that the Licensor has authority to license.

  h. Licensor means the individual(s) or entity(ies) granting rights
     under this Public License.

  i. Share means to provide material to the public by any means or
     process that requires permission under the Licensed Rights, such
     as reproduction, public display, public performance, distribution,
     dissemination, communication, or importation, and to make material
     available to the public including in ways that members of the
     public may access the material from a place and at a time
     individually chosen by them.

  j. Sui Generis Database Rights means rights other than copyright
     resulting from Directive 96/9/EC of the European Parliament and of
     the Council of 11 March 1996 on the legal protection of databases,
     as amended and/or succeeded, as well as other essentially
     equivalent rights anywhere in the world.

  k. You means the individual or entity exercising the Licensed Rights
     under this Public License. Your has a corresponding meaning.


Section 2 -- Scope.

  a. License grant.

       1. Subject to the terms and conditions of this Public License,
          the Licensor hereby grants You a worldwide, royalty-free,
          non-sublicensable, non-exclusive, irrevocable license to
          exercise the Licensed Rights in the Licensed Material to:

            a. reproduce and Share the Licensed Material, in whole or
               in part; and

            b. produce, reproduce, and Share Adapted Material.

       2. Exceptions and Limitations. For the avoidance of doubt, where
          Exceptions and Limitations apply to Your use, this Public
          License does not apply, and You do not need to comply with
          its terms and conditions.

       3. Term. The term of this Public License is specified in Section
          6(a).

       4. Media and formats; technical modifications allowed. The
          Licensor authorizes You to exercise the Licensed Rights in
          all media and formats whether now known or hereafter created,
          and to make technical modifications necessary to do so. The
          Licensor waives and/or agrees not to assert any right or
          authority to forbid You from making technical modifications
          necessary to exercise the Licensed Rights, including
          technical modifications necessary to circumvent Effective
          Technological Measures. For purposes of this Public License,
          simply making modifications authorized by this Section 2(a)
          (4) never produces Adapted Material.

       5. Downstream recipients.

            a. Offer from the Licensor -- Licensed Material. Every
               recipient of the Licensed Material automatically
               receives an offer from the Licensor to exercise the
               Licensed Rights under the terms and conditions of this
               Public License.

            b. No downstream restrictions. You may not offer or impose
               any additional or different terms or conditions on, or
               apply any Effective Technological Measures to, the
               Licensed Material if doing so restricts exercise of the
               Licensed Rights by any recipient of the Licensed
               Material.

       6. No endorsement. Nothing in this Public License constitutes or
          may be construed as permission to assert or imply that You
          are, or that Your use of the Licensed Material is, connected
          with, or sponsored, endorsed, or granted official status by,
          the Licensor or others designated to receive attribution as
          provided in Section 3(a)(1)(A)(i).

  b. Other rights.

       1. Moral rights, such as the right of integrity, are not
          licensed under this Public License, nor are publicity,
          privacy, and/or other similar personality rights; however, to
          the extent possible, the Licensor waives and/or agrees not to
          assert any such rights held by the Licensor to the limited
          extent necessary to allow You to exercise the Licensed
          Rights, but not otherwise.

       2. Patent and trademark rights are not licensed under this
          Public License.

       3. To the extent possible, the Licensor waives any right to
          collect royalties from You for the exercise of the Licensed
          Rights, whether directly or through a collecting society
          under any voluntary or waivable statutory or compulsory
          licensing scheme. In all other cases the Licensor expressly
          reserves any right to collect such royalties.


Section 3 -- License Conditions.

Your exercise of the Licensed Rights is expressly made subject to the
following conditions.

  a. Attribution.

       1. If You Share the Licensed Material (including in modified
          form), You must:

            a. retain the following if it is supplied by the Licensor
               with the Licensed Material:

                 i. identification of the creator(s) of the Licensed
                    Material and any others designated to receive
                    attribution, in any reasonable manner requested by
                    the Licensor (including by pseudonym if
                    designated);

                ii. a copyright notice;

               iii. a notice that refers to this Public License;

                iv. a notice that refers to the disclaimer of
                    warranties;

                 v. a URI or hyperlink to the Licensed Material to the
                    extent reasonably practicable;

            b. indicate if You modified the Licensed Material and
               retain an indication of any previous modifications; and

            c. indicate the Licensed Material is licensed under this
               Public License, and include the text of, or the URI or
               hyperlink to, this Public License.

       2. You may satisfy the conditions in Section 3(a)(1) in any
          reasonable manner based on the medium, means, and context in
          which You Share the Licensed Material. For example, it may be
          reasonable to satisfy the conditions by providing a URI or
          hyperlink to a resource that includes the required
          information.

       3. If requested by the Licensor, You must remove any of the
          information required by Section 3(a)(1)(A) to the extent
          reasonably practicable.

       4. If You Share Adapted Material You produce, the Adapter's
          License You apply must not prevent recipients of the Adapted
          Material from complying with this Public License.


Section 4 -- Sui Generis Database Rights.

Where the Licensed Rights include Sui Generis Database Rights that
apply to Your use of the Licensed Material:

  a. for the avoidance of doubt, Section 2(a)(1) grants You the right
     to extract, reuse, reproduce, and Share all or a substantial
     portion of the contents of the database;

  b. if You include all or a substantial portion of the database
     contents in a database in which You have Sui Generis Database
     Rights, then the database in which You have Sui Generis Database
     Rights (but not its individual contents) is Adapted Material; and

  c. You must comply with the conditions in Section 3(a) if You Share
     all or a substantial portion of the contents of the database.

For the avoidance of doubt, this Section 4 supplements and does not
replace Your obligations under this Public License where the Licensed
Rights include other Copyright and Similar Rights.


Section 5 -- Disclaimer of Warranties and Limitation of Liability.

  a. UNLESS OTHERWISE SEPARATELY UNDERTAKEN BY THE LICENSOR, TO THE
     EXTENT POSSIBLE, THE LICENSOR OFFERS THE LICENSED MATERIAL AS-IS
     AND AS-AVAILABLE, AND MAKES NO REPRESENTATIONS OR WARRANTIES OF
     ANY KIND CONCERNING THE LICENSED MATERIAL, WHETHER EXPRESS,
     IMPLIED, STATUTORY, OR OTHER. THIS INCLUDES, WITHOUT LIMITATION,
     WARRANTIES OF TITLE, MERCHANTABILITY, FITNESS FOR A PARTICULAR
     PURPOSE, NON-INFRINGEMENT, ABSENCE OF LATENT OR OTHER DEFECTS,
     ACCURACY, OR THE PRESENCE OR ABSENCE OF ERRORS, WHETHER OR NOT
     KNOWN OR DISCOVERABLE. WHERE DISCLAIMERS OF WARRANTIES ARE NOT
     ALLOWED IN FULL OR IN PART, THIS DISCLAIMER MAY NOT APPLY TO YOU.

  b. TO THE EXTENT POSSIBLE, IN NO EVENT WILL THE LICENSOR BE LIABLE
     TO YOU ON ANY LEGAL THEORY (INCLUDING, WITHOUT LIMITATION,
     NEGLIGENCE) OR OTHERWISE FOR ANY DIRECT, SPECIAL, INDIRECT,
     INCIDENTAL, CONSEQUENTIAL, PUNITIVE, EXEMPLARY, OR OTHER LOSSES,
     COSTS, EXPENSES, OR DAMAGES ARISING OUT OF THIS PUBLIC LICENSE OR
     USE OF THE LICENSED MATERIAL, EVEN IF THE LICENSOR HAS BEEN
     ADVISED OF THE POSSIBILITY OF SUCH LOSSES, COSTS, EXPENSES, OR
     DAMAGES. WHERE A LIMITATION OF LIABILITY IS NOT ALLOWED IN FULL OR
     IN PART, THIS LIMITATION MAY NOT APPLY TO YOU.

  c. The disclaimer of warranties and limitation of liability provided
     above shall be interpreted in a manner that, to the extent
     possible, most closely approximates an absolute disclaimer and
     waiver of all liability.


Section 6 -- Term and Termination.

  a. This Public License applies for the term of the Copyright and
     Similar Rights licensed here. However, if You fail to comply with
     this Public License, then Your rights under this Public License
     terminate automatically.

  b. Where Your right to use the Licensed Material has terminated under
     Section 6(a), it reinstates:

       1. automatically as of the date the violation is cured, provided
          it is cured within 30 days of Your discovery of the
          violation; or

       2. upon express reinstatement by the Licensor.

     For the avoidance of doubt, this Section 6(b) does not affect any
     right the Licensor may have to seek remedies for Your violations
     of this Public License.

  c. For the avoidance of doubt, the Licensor may also offer the
     Licensed Material under separate terms or conditions or stop
     distributing the Licensed Material at any time; however, doing so
     will not terminate this Public License.

  d. Sections 1, 5, 6, 7, and 8 survive termination of this Public
     License.


Section 7 -- Other Terms and Conditions.

  a. The Licensor shall not be bound by any additional or different
     terms or conditions communicated by You unless expressly agreed.

  b. Any arrangements, understandings, or agreements regarding the
     Licensed Material not stated herein are separate from and
     independent of the terms and conditions of this Public License.


Section 8 -- Interpretation.

  a. For the avoidance of doubt, this Public License does not, and
     shall not be interpreted to, reduce, limit, restrict, or impose
     conditions on any use of the Licensed Material that could lawfully
     be made without permission under this Public License.

  b. To the extent possible, if any provision of this Public License is
     deemed unenforceable, it shall be automatically reformed to the
     minimum extent necessary to make it enforceable. If the provision
     cannot be reformed, it shall be severed from this Public License
     without affecting the enforceability of the remaining terms and
     conditions.

  c. No term or condition of this Public License will be waived and no
     failure to comply consented to unless expressly agreed to by the
     Licensor.

  d. Nothing in this Public License constitutes or may be interpreted
     as a limitation upon, or waiver of, any privileges and immunities
     that apply to the Licensor or You, including from the legal
     processes of any jurisdiction or authority.


=======================================================================

Creative Commons is not a party to its public
licenses. Notwithstanding, Creative Commons may elect to apply one of
its public licenses to material it publishes and in those instances
will be considered the “Licensor.” The text of the Creative Commons
public licenses is dedicated to the public domain under the CC0 Public
Domain Dedication. Except for the limited purpose of indicating that
material is shared under a Creative Commons public license or as
otherwise permitted by the Creative Commons policies published at
creativecommons.org/policies, Creative Commons does not authorize the
use of the trademark "Creative Commons" or any other trademark or logo
of Creative Commons without its prior written consent including,
without limitation, in connection with any unauthorized modifications
to any of its public licenses or any other arrangements,
understandings, or agreements concerning use of licensed material. For
the avoidance of doubt, this paragraph does not form part of the
public licenses.

Creative Commons may be contacted at creativecommons.org.
```

### FSL-1.1-Apache-2.0 — text as shipped in `sentry@0.45.0`

```text
# Functional Source License, Version 1.1, Apache 2.0 Future License

## Abbreviation

FSL-1.1-Apache-2.0

## Notice

Copyright 2025 Functional Software, Inc. dba Sentry

## Terms and Conditions

### Licensor ("We")

The party offering the Software under these Terms and Conditions.

### The Software

The "Software" is each version of the software that we make available under
these Terms and Conditions, as indicated by our inclusion of these Terms and
Conditions with the Software.

### License Grant

Subject to your compliance with this License Grant and the Patents,
Redistribution and Trademark clauses below, we hereby grant you the right to
use, copy, modify, create derivative works, publicly perform, publicly display
and redistribute the Software for any Permitted Purpose identified below.

### Permitted Purpose

A Permitted Purpose is any purpose other than a Competing Use. A Competing Use
means making the Software available to others in a commercial product or
service that:

1. substitutes for the Software;

2. substitutes for any other product or service we offer using the Software
   that exists as of the date we make the Software available; or

3. offers the same or substantially similar functionality as the Software.

Permitted Purposes specifically include using the Software:

1. for your internal use and access;

2. for non-commercial education;

3. for non-commercial research; and

4. in connection with professional services that you provide to a licensee
   using the Software in accordance with these Terms and Conditions.

### Patents

To the extent your use for a Permitted Purpose would necessarily infringe our
patents, the license grant above includes a license under our patents. If you
make a claim against any party that the Software infringes or contributes to
the infringement of any patent, then your patent license to the Software ends
immediately.

### Redistribution

The Terms and Conditions apply to all copies, modifications and derivatives of
the Software.

If you redistribute any copies, modifications or derivatives of the Software,
you must include a copy of or a link to these Terms and Conditions and not
remove any copyright notices provided in or with the Software.

### Disclaimer

THE SOFTWARE IS PROVIDED "AS IS" AND WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF FITNESS FOR A PARTICULAR
PURPOSE, MERCHANTABILITY, TITLE OR NON-INFRINGEMENT.

IN NO EVENT WILL WE HAVE ANY LIABILITY TO YOU ARISING OUT OF OR RELATED TO THE
SOFTWARE, INCLUDING INDIRECT, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES,
EVEN IF WE HAVE BEEN INFORMED OF THEIR POSSIBILITY IN ADVANCE.

### Trademarks

Except for displaying the License Details and identifying us as the origin of
the Software, you have no right under these Terms and Conditions to use our
trademarks, trade names, service marks or product names.

## Grant of Future License

We hereby irrevocably grant you an additional license to use the Software under
the Apache License, Version 2.0 that is effective on the second anniversary of
the date we make the Software available. On or after that date, you may use the
Software under the Apache License, Version 2.0, in which case the following
will apply:

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License.

You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.

<!-- packages/cli/LICENSE.md is a copy of ../LICENSE.md (the canonical source in this repo). Both files must remain byte-identical. -->
```

### (MPL-2.0 OR Apache-2.0) — text as shipped in `dompurify@3.4.14`

```text
Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in 
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
```

### (MIT AND Zlib) — text as shipped in `pako@2.2.0`

```text
(The MIT License)

Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### MIT OR SEE LICENSE IN FEEL-FREE.md — text as shipped in `rgbcolor@1.0.1`

```text
Copyright (c) 2016 Stoyan Stefanov, http://phpied.com/

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


Exemptions
==========

Please either apply this, the MIT license, or the license in './FEEL-FREE.md'
```

### (MIT OR CC0-1.0) — text as shipped in `type-fest@0.13.1`

```text
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https:/sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### BSD — text as shipped in `url-template@2.0.8`

```text
Copyright (c) 2012-2014, Bram Stein
All rights reserved.

Redistribution and use in source and binary forms, with or without 
modification, are permitted provided that the following conditions 
are met:
 
 1. Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer. 
 2. Redistributions in binary form must reproduce the above copyright 
    notice, this list of conditions and the following disclaimer in the 
    documentation and/or other materials provided with the distribution. 
 3. The name of the author may not be used to endorse or promote products 
    derived from this software without specific prior written permission. 

THIS SOFTWARE IS PROVIDED BY THE AUTHOR "AS IS" AND ANY EXPRESS OR IMPLIED 
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF 
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO 
EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, 
INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, 
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, 
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY 
OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING 
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, 
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

