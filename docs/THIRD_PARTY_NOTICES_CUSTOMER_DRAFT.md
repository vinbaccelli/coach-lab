# DRAFT: customer-facing third-party notices (Anglemotion / CoachLab)

> **DRAFT. NOT FOR PUBLICATION. Pending review by the owner's counsel.**
> Prepared 2026-11-24 by engineering from [`THIRD_PARTY_DEPENDENCY_CLASSIFICATION.md`](THIRD_PARTY_DEPENDENCY_CLASSIFICATION.md) and the audit register ([`THIRD_PARTY_LICENSE_AUDIT.md`](THIRD_PARTY_LICENSE_AUDIT.md)). Nothing here is a legal conclusion, and no component is "Approved". Text in `[[double brackets]]` is a gap that counsel or engineering must fill before publication. The full internal inventory stays in [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
>
> **Scope rule used:** this page lists only what reaches the customer's device, either served by Anglemotion (JavaScript bundle, static runtimes, model files) or fetched by the app from a third-party host. Development tools, server-only libraries, and platform packages that are not installed are left out (they are not given to customers). Server-only components may need their own notices; counsel to confirm (question N-3).
>
> **Open item that blocks publication:** the FFmpeg section (§4). Its wording depends on counsel's answers in [`FFMPEG_LICENSE_REVIEW.md`](FFMPEG_LICENSE_REVIEW.md) §3.

---

## Proposed page text (begins here)

### Third-party software and models used by Anglemotion

Anglemotion includes, or loads in your browser, software and machine-learning models made by other people. They are provided under their own licences, listed below. Those licences apply to those components only, not to Anglemotion as a whole. `[[counsel: confirm this sentence, especially with regard to §4]]`

### 1. Machine-learning models running in your browser

| Component | Provider | Licence stated by the provider | Our changes |
|---|---|---|---|
| SAM 2.1 (hiera-tiny), segmentation | Meta Platforms, Inc. (`facebookresearch/sam2`) | Apache License 2.0 (model checkpoints). Trained in part on the SA-V dataset, released by Meta under CC BY 4.0. `[[counsel: SA-V attribution required? Q-S3]]` | Converted to ONNX and quantised to 4-bit/16-bit by a third party (`onnx-community`). `[[replace if we self-convert]]` |
| D-FINE-N (COCO), object detection | D-FINE authors (`Peterande/D-FINE`) | Apache License 2.0 | Converted to ONNX / quantised by a third party (`onnx-community`) |
| RTMPose-t / RTMPose-s (body pose), YOLOX-tiny (person detection) | OpenMMLab (MMPose); Megvii (YOLOX) | Code: Apache License 2.0. `[[weights: no licence statement found — counsel decision required before listing; see docs/RTMPOSE_LICENCE.md]]` | None (fp32 ONNX as downloaded) |
| MoveNet SinglePose Lightning / Thunder | Google LLC | Apache License 2.0 (per Google's model card) `[[source of the files to be confirmed, Q-M1]]` | None known |
| MediaPipe Pose Landmarker (full, heavy); Interactive Segmenter ("MagicTouch"); Selfie Multiclass Segmenter; Selfie Segmentation | Google LLC | Apache License 2.0 (per Google's model cards) | None (files identical to Google's published files) |
| COCO-SSD (MobileNet v2), object detection — **downloaded by your browser directly from Google** (`storage.googleapis.com`) | Google LLC | `[[no licence statement found for the weights; C-1]]` | None |
| Tesseract English language data (`eng.traineddata`, `best_int`) | Tesseract OCR project; packaged by tesseract.js | Apache License 2.0 (tessdata) / MIT (npm package) `[[which applies, Q-M7]]` | None |

### 2. Runtimes that execute those models (served by Anglemotion)

| Component | Copyright / provider | Licence |
|---|---|---|
| ONNX Runtime Web | Microsoft Corporation | MIT `[[exact copyright line to be taken from the official ONNX Runtime LICENSE for the served version, O-1]]` |
| Transformers.js (`@huggingface/transformers`) | Hugging Face | Apache License 2.0 |
| MediaPipe Tasks Vision (JavaScript + WebAssembly) and MediaPipe Selfie Segmentation | Google LLC | Apache License 2.0 |
| TensorFlow.js and TensorFlow.js models (`@tensorflow/tfjs*`, `pose-detection`, `coco-ssd`) | Google LLC / TensorFlow authors | Apache License 2.0 (`tfjs-layers`: Apache-2.0 AND MIT) |
| Tesseract.js and tesseract.js-core (OCR) | tesseract.js contributors; Tesseract OCR | Apache License 2.0 |

### 3. Other open-source software in the web application

**Notices requiring specific mention** (licence not MIT/ISC/BSD/Apache, or with extra conditions):

| Component | Licence | Note |
|---|---|---|
| Mediabunny 1.65.2 (video encoding/muxing) | Mozilla Public License 2.0 | Source code of the MPL-covered files is available at `[[link to the exact upstream source for 1.65.2]]`. We have not modified it. `[[engineering to confirm "not modified"]]` |
| DOMPurify 3.4.14 | MPL-2.0 OR Apache-2.0 (we elect Apache-2.0 `[[counsel to confirm election]]`) | |
| pako 2.2.0 | MIT AND Zlib | |
| rgbcolor 1.0.1 | "MIT OR SEE LICENSE IN FEEL-FREE.md" | `[[counsel]]` |
| Sentry JavaScript SDK (`@sentry/*` 11.9.0) | MIT | Error reporting |

**Permissive-licence components** (MIT, ISC, BSD-2/3-Clause, 0BSD, Apache-2.0), each under the licence and copyright notice in its own package: React, React DOM, scheduler, Next.js (including its bundled libraries), Supabase client libraries (`@supabase/*`), FFmpeg.wasm JavaScript wrapper (`@ffmpeg/ffmpeg`, `@ffmpeg/util`, MIT, Copyright (c) 2019 Jerome Wu — *wrapper only; see §4 for the FFmpeg core*), jsPDF, html2canvas, html-to-image, canvg, fflate, fast-png, iobuffer, lucide-react (ISC), react-easy-crop, webm-fix-duration, core-js, regenerator-runtime, @babel/runtime, @swc/helpers, tslib (0BSD), long, seedrandom, web-vitals, buffer, base64-js, ieee754, cookie, iceberg-js, is-electron, normalize-wheel, performance-now, raf, stackblur-canvas, svg-pathdata. `[[engineering: generate the per-package copyright lines from node_modules at release time; they are in THIRD_PARTY_NOTICES.md §3 for most packages]]`

### 4. FFmpeg (video conversion) — `[[BLOCKED: wording depends on counsel, FFMPEG_LICENSE_REVIEW.md Q-F1…Q-F3]]`

When you export or record a video as MP4, your browser downloads FFmpeg compiled to WebAssembly (`@ffmpeg/core` 0.12.10) from the jsDelivr CDN. That build includes FFmpeg, x264 and x265 and is licensed under the **GNU General Public License, version 2 or later**. `[[If counsel concludes obligations apply: licence text link, and the source-code offer / location of the complete corresponding source and build scripts (ffmpeg.wasm Dockerfile, FFmpeg n5.1.4, x264, x265 and the other bundled libraries).]]` `[[If the feature is replaced (FFMPEG_LICENSE_REVIEW.md E-F1), delete this section.]]`

### 5. Services contacted by the app
Google Gemini API (match-screenshot decoding) — governed by Google's terms `[[counsel]]`. jsDelivr (cdn.jsdelivr.net) and Google Cloud Storage (storage.googleapis.com) serve the components marked as downloaded above.

### 6. Licence texts
`[[Attach full texts: Apache License 2.0, MIT, MPL-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Zlib, CC BY 4.0 (if counsel requires the SA-V attribution), GPL-2.0 (if §4 stays). Canonical copies are in THIRD_PARTY_NOTICES.md §5 and docs/evidence/.]]`

## (end of proposed page text)

---

## Notes for counsel and engineering (not part of the page)
- **N-1.** Where the page goes (footer link / About / inside the app / alongside downloaded exports) is open (register questions A-4, Q-M6).
- **N-2.** Model weights are listed separately from the runtimes (§1 vs §2) because their licences are stated separately and some (RTMPose, COCO-SSD) have no stated licence.
- **N-3.** Server-only components (e.g. `stripe`, `googleapis`, `@sentry/node`, `sharp` and its LGPL-3.0 `libvips` binary traced into server functions on linux-x64) are not given to customers in a bundle; whether any notice is still expected (e.g. in terms of service) is for counsel.
- **N-4.** Every status in the audit register remains as recorded; this draft does not approve anything.
