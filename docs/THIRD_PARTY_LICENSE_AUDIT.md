# Third-party licence audit register (models, libraries, runtime assets)

Permanent register and process. **Not legal advice; nothing here is a legal conclusion.** Written 2026-11-24 from files in this repository and from the public sources named in each row (evidence preserved in [`docs/evidence/`](evidence/README.md), index with URL, date read and SHA-256 of every saved file). Libraries/npm: see [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Rules used in this document
- **Missing licensing information is not permission.** Where a source does not state a licence or a right, this document says "not stated" and lists it as an open question.
- A repository tag/file saying MIT or Apache-2.0 **never** makes a model "Approved". Code licence and weights licence are separate questions, as are dataset terms.
- **Clearance status** is exactly one of: `Approved` (commercial use and distribution reviewed and cleared), `Conditional` (commercial use appears possible but conditions remain; the licence text itself states them and they are listed), `Pending legal review` (material questions remain; the default), `Prohibited` (a quoted licence term prohibits the intended use). **Only the owner's lawyer can mark anything `Approved`; nothing below is.**
- Sources that could not be reached from the review environment are named as such (egress proxy refused `ai.meta.com`, `arxiv.org`, `tfhub.dev`, `www.kaggle.com`, `developers.google.com`, `github.com`, and `api.github.com` is not enabled; `raw.githubusercontent.com` and `huggingface.co` were reachable). Nothing was filled in from memory.
- GitHub commit SHAs could not be read (`api.github.com` refused). GitHub files were read from the default branch via `raw.githubusercontent.com` on 2026-11-24; their identity is pinned by the SHA-256 of the saved copy (see evidence index), not by commit.

No change was made to any model, weight or application code by this review. No dataset asset (SA-1B, SA-V, COCO, …) was downloaded or is distributed by this repository (check by file name and size only: `git ls-files` shows no SA-1B/SA-V files; largest tracked files are the model files listed below, the demo videos in `public/`, and wasm runtimes).

---

## Part A — SAM 2 (existing integration) — audit

### A.1 Verified facts (source · date read · revision)
1. **What the app loads.** `lib/stroMotionDraft/samRacket.ts:211` loads `Sam2Model.from_pretrained('sam2', { dtype: 'q4f16', … })` with `env.allowRemoteModels = false`, `env.localModelPath = '/models/'` (`samRacket.ts:171`), i.e. only the self-hosted files in `public/models/sam2/`. `racketDetect.ts` uses the same pattern for D-FINE.
2. **Shipped files and SHA-256 (computed from the repo files, 2026-11-24):**

| file | bytes | sha256 |
|---|---|---|
| `public/models/sam2/onnx/vision_encoder_q4f16.onnx` | 327,108 | `c4092f4c02a369a94b65718ba9fd274c0dc8923e4fa10e55bc908633d4a4a794` |
| `public/models/sam2/onnx/vision_encoder_q4f16.onnx_data` | 28,532,736 | `48c3dc2795f70c855fc35061b9f49431d50762c00af8c644380781f2a20eb187` |
| `public/models/sam2/onnx/prompt_encoder_mask_decoder_q4f16.onnx` | 243,598 | `0ff3ee0406764a4c5e8f05c1b5d59de4ec292c7c2a13d64f08a7d37a2d9f697b` |
| `public/models/sam2/onnx/prompt_encoder_mask_decoder_q4f16.onnx_data` | 4,563,968 | `8b204a80f601cf580f81ede775a096ecbb0c25f3d49ea592b6364ac7d67cc3d0` |
| `public/models/sam2/config.json` | 5,814 | `9813c595dfbbe73c6b40ed269a2d6252915f538b8cdef5955f48c79716414cce` |
| `public/models/sam2/preprocessor_config.json` | 749 | `240c886b428d36b63bbb51b0c17ad4d2668d83ba851a04f09880a2b93f0b7349` |

3. **Download source (matched by hash).** The Hugging Face repo **`onnx-community/sam2.1-hiera-tiny-ONNX`, revision `814a066640debee5a91e70aa401fb8e17e030503`** (lastModified 2025-11-18T01:23:25Z; API read 2026-11-24, saved: `evidence/sam2-hf-onnx-community-sam2.1-hiera-tiny-ONNX-api.json`) lists the four `q4f16` files with LFS SHA-256 values **identical** to the shipped files above, the same byte sizes, and `config.json` / `preprocessor_config.json` served from that revision hash to the values above. The repository itself does not record which URL it was downloaded from; the match is by content.
4. **Licence metadata of that ONNX repo:** tags are `onnx`, `sam2`, `region:us`; **no `license:` tag**; the file list contains **no README.md and no LICENSE file** (`raw/main/README.md` → HTTP 404). Author on the Hub: `onnx-community`. Not stated: its upstream checkpoint, who quantised/exported it, the licence of the conversion, any redistribution terms.
5. **Upstream Meta checkpoint (named by the app's own docs/comments as SAM2.1-hiera-tiny; the ONNX repo does not itself say so — see question A-2).** `facebook/sam2.1-hiera-tiny`, revision `de431c4043854a71d8101e17995dfe596bf101a5`, lastModified 2025-08-15T21:18:13Z, tags include `license:apache-2.0`; card header `license: apache-2.0` (saved: `sam2-hf-facebook-sam2.1-hiera-tiny-api.json`, `…-README.md`). No LICENSE file in that repo (`raw/main/LICENSE` → 404).
6. **Official code repo licence statement** (`facebookresearch/sam2`, README "License" section, saved `sam2-github-README-license-section.txt`; default branch, commit not readable): *"The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under Apache 2.0, however the Inter Font and Noto Color Emoji used in the SAM 2 demo code are made available under the SIL Open Font License, version 1.1."* The repo `LICENSE` is the Apache License 2.0 text with the unfilled appendix template (`Copyright [yyyy] [name of copyright owner]`); full text saved (`sam2-github-LICENSE.txt`). There is no `NOTICE` file (HTTP 404). Third-party code note in the README: connected-components code adapted from `cc_torch` with `LICENSE_cctorch` (exists, HTTP 200; not relevant to the ONNX inference files, not read).
7. **SA-V dataset licence — NOT verified.** The owner states CC BY 4.0. Meta's SA-V page and the SAM 2 paper (`ai.meta.com`, `arxiv.org`) were **unreachable** from this environment (HTTP 403 from the egress proxy), and the SAM 2 GitHub README/HF card contain **no** dataset-licence statement (README "License" section above covers checkpoints and code only). So "CC BY 4.0" is recorded here only as the owner's statement, **unverified**.
8. **SA-1B** (training set of the original SAM, not SAM 2): the `facebookresearch/segment-anything` README states *"By downloading the datasets you agree that you have read and accepted the terms of the SA-1B Dataset Research License."* (saved: `segment-anything-github-README-dataset-and-license.txt`). The terms of the "SA-1B Dataset Research License" themselves were not readable (`ai.meta.com` blocked). It is not stated in the sources read whether SAM 2 weights were trained on SA-1B.
9. **What the app ships alongside the weights:** the `public/models/sam2/` folder contains no LICENSE, NOTICE or attribution file; the repo had no `THIRD_PARTY_NOTICES` file before this PR (`docs/RTMPOSE_LICENCE.md` already lists creating it as an open item).

### A.2 Unresolved legal questions for counsel (SAM 2)
- **A-1.** The ONNX files are a third-party conversion + 4-bit quantisation by `onnx-community`, whose repo states no licence and no upstream. Does the Apache-2.0 statement on Meta's checkpoints extend to this derivative, and may we redistribute it from our own servers?
- **A-2.** The ONNX repo does not name its base checkpoint. Should provenance (that these are the SAM 2.1 hiera-tiny weights) be confirmed with the converter or by re-exporting from Meta's official checkpoint ourselves?
- **A-3.** What are the licence terms of the SA-V dataset (and other data) SAM 2 was trained on, and do any restrict commercial use of the trained weights? The owner's CC BY 4.0 statement is unverified here; the primary source must be read by someone with access.
- **A-4.** Attribution/notice obligations for distributing Apache-2.0 weights (licence text, NOTICE, indication of changes — the files are quantised) are not currently satisfied in the shipped folder. What must be added, and where (in-app notice, file next to the weights, both)?
- **A-5.** Is the Apache-2.0 patent grant / no-trademark clause relevant to branding ("SAM 2" is named in code comments only)?

Status (see inventory): **Pending legal review.**

---

## Part B — model inventory (every model shipped or loaded)

Fields per row: model/version · author · exact download location (as far as provable) · file + SHA-256 · code licence · weights licence · training data & its licence (if disclosed) · commercial-use status · redistribution requirements · **status** · open questions. SHA-256 computed from the shipped file on 2026-11-24 unless noted. "Provenance not recorded" = no record in this repository of where the file was downloaded; the files were added in a single commit (`6c7d0b7`, 2026-11-18, history shows no source note).

### B.1 SAM 2.1 hiera-tiny, q4f16 ONNX — segmenter (Object select, Auto-detect racket) — shipped
- Author: Meta FAIR (weights) / `onnx-community` (ONNX export + q4f16 quantisation). Location: HF `onnx-community/sam2.1-hiera-tiny-ONNX` @ `814a0666…` (hash-matched, Part A). Files and SHA-256: Part A.1.
- Code licence: Apache-2.0 (`facebookresearch/sam2` LICENSE). Weights licence: Meta states Apache-2.0 for the checkpoints (README quote A.1-6; `facebook/sam2.1-hiera-tiny` tag `license:apache-2.0`); the ONNX conversion states **none**.
- Training data: SA-V and others per the paper — **not verified** (A.1-7). Commercial use: Meta's licence statement is Apache-2.0 (permits commercial use per its terms); conversion and dataset questions open.
- Redistribution requirements (from the Apache-2.0 text): give recipients the licence, retain notices, mark changed files, include NOTICE if any (none exists).
- **Status: Pending legal review.** Open: A-1…A-5.

### B.2 D-FINE-N (COCO), q4f16 ONNX — racket detector (Auto-detect) — shipped
- Author: Peterande et al. (D-FINE, USTC) · converted by `onnx-community` / `ustc-community` base. Location: HF `onnx-community/dfine_n_coco-ONNX` @ `380d2839c327efaf65dd0fe0c2c10ab7fadd5473` (lastModified 2025-04-30T22:37:25Z). `onnx/model_q4f16.onnx` 5,966,346 bytes, sha256 `cf7539c7b143263091cd0ab03b64c5d0ebfcec0dbb5493feb10b482f3a0af108` = the repo's LFS SHA-256 (match). `config.json` sha256 `a5c7533f…80c4c` and `preprocessor_config.json` sha256 `cd38cd59…2eaf1` equal the raw files at that revision.
- The ONNX repo: no `license:` tag, no LICENSE file; README says only `base_model: ustc-community/dfine_n_coco` and "ONNX weights to be compatible with Transformers.js … intended to be a temporary solution". Base `ustc-community/dfine-nano-coco` @ `066438d3d8f0da137a37b38fdf3368fd4afceced`: `license:apache-2.0`, `dataset:coco`, arXiv 2410.13842. Code: `Peterande/D-FINE` LICENSE Apache-2.0 (copyright line is the unfilled template). The D-FINE README states: *"License note: Checkpoints trained or pretrained on Objects365 (\*_obj365, \*_obj2coco) may be subject to the Objects365 dataset terms and should not be assumed to be commercially cleared under the D-FINE license."* The shipped file is the **COCO-only** variant per its name/base (not an `obj365` one); that the file contains no Objects365 pretraining is not stated beyond the name.
- Training data: MS COCO. COCO licensing (annotations CC BY 4.0, images under their Flickr licences) is recorded in `docs/RTMPOSE_LICENCE.md` from secondary sources; not re-verified here.
- Redistribution: Apache-2.0 conditions as in B.1.
- **Status: Pending legal review.** Open: D-1 conversion licence not stated; D-2 COCO image-licence position for weights; D-3 confirm no Objects365 pretraining in this checkpoint.

### B.3 RTMPose-t / RTMPose-s (body7, ONNX) — live skeleton — shipped
- Author: OpenMMLab (MMPose/RTMPose). Download location per `public/models/rtmpose/README.md`: `download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/` (mmdeploy exports, fp32) — **taken from that README, not re-verified**. `rtmpose-t.onnx` 13,350,364 B sha256 `a6c2f6a3896a4d51131d14d7a80a3d08b50f559af5a58a45d5b098aef510a70f`; `rtmpose-s.onnx` 21,890,172 B sha256 `9aeb635b83f86aea45cf45d85798f7eba1a162de8e0d721c44e54fe5eebaf47d` (rtmpose-s is only used with `?live=rtmpose-s`).
- Code: Apache-2.0, "Copyright 2018-2020 Open-MMLab" (per `docs/RTMPOSE_LICENCE.md`; MMPose LICENSE re-saved: `mmpose-github-LICENSE.txt`). Weights: **no licence statement exists** (per `docs/RTMPOSE_LICENCE.md`, sources and maintainer remark recorded there). Training data (README): AI Challenger, COCO, CrowdPose, MPII, sub-JHMDB, Halpe, PoseTrack18; several have non-commercial / unclear terms per that document (secondary sources).
- **Status: Pending legal review** (not "Prohibited": no *quoted* licence term in the sources read prohibits it; the dataset findings in `docs/RTMPOSE_LICENCE.md` are mostly secondary). Open: the full list in `docs/RTMPOSE_LICENCE.md` (items 1–5) — the lawyer-agreed approach and notification wording are not written in this repo.

### B.4 YOLOX-tiny COCO (ONNX) — first-person detector for RTMPose — shipped
- Author: Megvii. Location per `public/models/rtmpose/README.md`: `github.com/Megvii-BaseDetection/YOLOX` release 0.1.1rc0 `yolox_tiny.onnx` (not re-verified). `yolox-tiny-coco.onnx` 20,219,662 B sha256 `427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7`.
- Code: Apache-2.0 (`yolox-github-LICENSE.txt`, read 2026-11-24; copyright line is the unfilled template). Weights licence: not stated beyond the repo licence. Training data: MS COCO.
- **Status: Pending legal review.** Open: COCO position as D-2; exact release asset provenance and hash.

### B.5 MoveNet Lightning / Thunder (TF.js graph models) — pose (older paths, still shipped and loaded) — shipped
- Author: Google. `model.json` says `"generatedBy": "2.7.0", "convertedBy": "TensorFlow.js Converter v3.6.0"` (read from the file). **Provenance not recorded** (TF Hub / Kaggle not reachable from this environment; origin URL unverified). Loaded from `/models/movenet-*/model.json` by `lib/sharedPoseDetector.ts`, `lib/poseDetection.ts`, `lib/poseWorker.ts`.
- SHA-256: lightning `model.json` `c65a3447…dcbfb`, `group1-shard1of2.bin` `b42c3232…bea2`, `group1-shard2of2.bin` `8253ab96…c5dc`; thunder `model.json` `957721af…7349`, shards `58dd47fd…cba`, `08da980b…f0bc`, `c1c6b712…de34` (full 64-hex values: list in `docs/evidence/README.md` §"shipped-file hashes").
- Code licence (`@tensorflow-models/pose-detection`): Apache-2.0 (npm metadata). Weights licence and training data: **not stated in this repo; not verified**.
- **Status: Pending legal review.** Open: M-1 source, licence and dataset of these two checkpoints.

### B.6 MediaPipe Pose Landmarker (full, heavy) `.task` — pose — shipped
- Author: Google (MediaPipe). `pose_landmarker_full.task` 9,398,198 B sha256 `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`; `pose_landmarker_heavy.task` 30,664,242 B sha256 `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b`. The `full` bundle contains `pose_detector.tflite` and `pose_landmarks_detector.tflite` dated 2023-04-28 (read with `unzip -l`). **Provenance not recorded** (official download host not verified).
- Code: Apache-2.0 (`mediapipe-github-LICENSE.txt`, saved; copyright line is the licence template appendix). Weights licence / model card terms: **not read** (`developers.google.com`, `storage.googleapis.com` model card not reachable). Training data: not disclosed in anything read.
- **Status: Pending legal review.** Open: P-1 model-card terms; P-2 dataset; P-3 provenance.

### B.7 MediaPipe Interactive Segmenter "magic touch" — `public/models/magic_touch.tflite` — shipped
- 6,227,884 B, sha256 `e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25`. Loaded by `lib/mediapipeSegmenter.ts:29` with `@mediapipe/tasks-vision`. Author presumed Google (file metadata contains the string "MediaPipe"; **not confirmed**). Provenance, weights licence, training data: **not recorded / not read**.
- **Status: Pending legal review.** Open: M-2 provenance/licence/dataset.

### B.8 Multiclass selfie segmenter — `public/models/selfie_multiclass_256x256.tflite` — shipped
- 16,371,837 B, sha256 `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0`. Loaded by `lib/stroMotionDraft/multiclassSegmenter.ts:47`. Author presumed Google MediaPipe; **provenance, licence, training data not recorded / not read**.
- **Status: Pending legal review.** Open: M-3.

### B.9 MediaPipe Selfie Segmentation (legacy solution) — `public/mediapipe-selfie/*` — shipped; also remote CDN copy
- Files: `selfie_segmentation.tflite` (249,024 B), `selfie_segmentation_landscape.tflite` (249,792 B), wasm/js runtimes. npm package `@mediapipe/selfie_segmentation@0.1.1675465747` is Apache-2.0 (npm metadata). Used via `lib/stroMotionDraft/selfieSegmenter.ts` (`SOLUTION_DIR = '/mediapipe-selfie'`, self-hosted). **Separately**, `lib/webcamSegmentation.ts:7` loads the same solution at runtime from **`https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/`** (remote, not shipped).
- Weights licence / model card / dataset: **not read**.
- **Status: Pending legal review.** Open: M-4.

### B.10 COCO-SSD (MobileNet-v2 base) — object detector for tennis racket (legacy path) — **loaded from a remote host at runtime**
- `lib/racketCocoDetect.ts:33` → `cocoSsd.load({ base: 'mobilenet_v2' })`; the library's `BASE_PATH` is `https://storage.googleapis.com/tfjs-models/savedmodel/` (`node_modules/@tensorflow-models/coco-ssd/dist/coco-ssd.js:515`, model path `…/ssd_mobilenet_v2/model.json`), so weights are fetched from Google Cloud Storage by every user's browser, not shipped in the repo. Preloaded at analysis-page load (`app/analysis/page.tsx:3630`). Library `@tensorflow-models/coco-ssd` 2.2.3: Apache-2.0 (tfjs-models LICENSE saved). Weights licence, training data (COCO), SHA-256: **not obtained** (remote; not fetched here — and not reachable under the review's restrictions to confirm).
- **Status: Pending legal review.** Open: C-1 licence/redistribution terms of the hosted weights; C-2 COCO images position; C-3 hash of the bytes users actually receive (remote content can change).

### B.11 Tesseract OCR (tesseract.js 5.1.1, `eng.traineddata.gz`) — match decoder — shipped
- Files in `public/tesseract/`: `eng.traineddata.gz` 2,952,873 B (sha256 not listed in the table; see `docs/evidence/README.md`), `tesseract-core-lstm.wasm`, `tesseract-core-simd-lstm.wasm`, `worker.min.js`. `tesseract.js` / `tesseract.js-core` 5.1.1: Apache-2.0 (npm metadata); `tessdata` repo LICENSE saved: Apache-2.0 template text (`tessdata-github-LICENSE.txt`). Which tessdata variant (`tessdata`, `_fast`, `_best`) the shipped `eng.traineddata.gz` is: **not recorded**.
- **Status: Conditional** — Apache-2.0 text states the conditions (give recipients the licence, keep notices, mark changes); they are listed in `THIRD_PARTY_NOTICES.md`; the notice is not yet displayed in-app. Open: T-1 provenance of the traineddata variant.

### B.12 ONNX Runtime Web wasm (`public/ort/*`, staged at build from `node_modules`) — runtime
- `onnxruntime-web` 1.26.0-dev.20260416-b7804b056c: MIT (npm metadata). Not committed (`public/ort/` is git-ignored; `scripts/copy-ort-wasm.mjs` copies it at build), but it is served to users. The installed package ships **no LICENSE file** (only the `license: "MIT"` field in its `package.json`, and no copyright notice), and the ONNX Runtime LICENSE could not be fetched from GitHub (`master` and `main` → HTTP 404). So Microsoft's own copyright notice is **not stated in anything read**; `THIRD_PARTY_NOTICES.md` carries only a generic MIT text taken from another package.
- **Status: Pending legal review** (was going to be Conditional; the MIT notice to reproduce — Microsoft's copyright line — is not available from what was read). Open: O-1 obtain the official ONNX Runtime LICENSE/notice text for the version served.

### B.13 `@huggingface/transformers` 4.2.0 (transformers.js) — loader for D-FINE and SAM 2
- Apache-2.0 (LICENSE saved). **Status: Conditional** (conditions listed in `THIRD_PARTY_NOTICES.md`).

### B.14 `@ffmpeg/core` (ffmpeg.wasm) — WebM→MP4 conversion — **loaded from a remote CDN at runtime**
- `lib/ffmpegWebmToMp4.ts:10-11` loads core **0.12.10** from `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm`; `components/ExportModal.tsx:25,143` uses **0.12.6** from `https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd`. npm registry metadata read 2026-11-24 (saved: `npm-ffmpeg-core-license-metadata.json`): `0.12.10` → **`GPL-2.0-or-later`**, `0.12.8`, `0.12.9` → `GPL-2.0-or-later`, `0.12.6` → `MIT`. The wrapper packages `@ffmpeg/ffmpeg`, `@ffmpeg/util` are MIT.
- Not verified: what code is actually compiled into each core build, and the licence consequences for serving/using it from a CDN.
- **Status: Pending legal review.** Open: F-1 licence of the core builds actually served (two different versions, two different declared licences); F-2 whether loading a GPL-declared core from a CDN into a proprietary page creates obligations.

### B.15 External API, not a shipped model: Google Gemini (`lib/gemini/decodeMatchScreenshots.ts:20`, `generativelanguage.googleapis.com`)
- A hosted API used for the match decoder; governed by Google's API terms (not read here). Listed so the inventory is complete. **Status: Pending legal review.** Open: G-1 terms, data-processing and attribution requirements.

### B.16 Models/weights considered but **not** shipped
- MobileSAM: investigation paused; **no MobileSAM file or code is added by this PR**.
- Human-Art YOLOX-tiny detector: removed earlier (`docs/RTMPOSE_LICENCE.md`).

---

## Part C — library / dependency register
All non-development npm packages in `package-lock.json` (429 entries), with name, version, SPDX licence declared in the installed `package.json`, and copyright line from each package's licence file where one starts with "Copyright", are in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) §3, together with full text of every distinct licence found. Items in that list that are **not** plain permissive (MIT/ISC/BSD/Apache-2.0/0BSD) and need counsel's attention are called out in `THIRD_PARTY_NOTICES.md` §4 (`mediabunny` MPL-2.0; `caniuse-lite` CC-BY-4.0; `sharp` optional LGPL-3.0 libvips binaries; `sentry` FSL-1.1-Apache-2.0; `dompurify` MPL-2.0 OR Apache-2.0; `@ffmpeg/core` as in B.14). Which packages end up in the browser bundle vs server vs build tooling was not determined by this review.

## Part D — process: checklist before anything new ships
Every new model, library or externally sourced component (including a CDN/remote load) must have, recorded in this file **in the same PR** that adds it:
1. Source: exact URL, repo id and **revision/commit SHA**, uploader/author, date read.
2. Licence **text preserved** in `docs/evidence/` (full file or exact excerpt) plus the HF model-card YAML header/tags as read; note where the licence is absent ("not stated").
3. **SHA-256** of every shipped file (computed from the file in the PR, and compared with the source's published hash if it has one).
4. Dataset provenance and the dataset's licence/terms (quoted, with URL and date), or "not disclosed".
5. Code licence and weights licence recorded **separately**; derivative/conversion step documented (who converted, how, with which pinned versions).
6. Redistribution requirements (attribution, notice, licence text, NOTICE, "changes made") and where they are satisfied (file in repo, in-app notice).
7. Remote loads (CDN, bucket, API) listed with the URL and who controls the bytes.
8. Clearance status (one of the four values), open questions listed per item.
9. **Lawyer sign-off recorded with date and name** before status may become `Approved`; engineers may not set `Approved`.
10. `THIRD_PARTY_NOTICES.md` updated; in-app notice updated if the licence requires attribution to users.
No model is replaced, removed or swapped until the owner has recorded a decision here.

## Part E — change log
| date | change | by |
|---|---|---|
| 2026-11-24 | Register created: SAM 2 audit, full model inventory, process, evidence preserved, `THIRD_PARTY_NOTICES.md` generated. No code or model changes. | licensing review (assistant), awaiting counsel |
