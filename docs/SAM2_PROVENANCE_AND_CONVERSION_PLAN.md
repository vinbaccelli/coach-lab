# SAM 2 provenance and self-conversion plan: second pass

**Status: Pending legal review.** Written 2026-11-24. This is not legal advice. It changes nothing: the deployed model files in `public/models/sam2/` are untouched, **no conversion was run**, and MobileSAM stays paused ([`MOBILESAM.md`](MOBILESAM.md)). Register entry: [`THIRD_PARTY_LICENSE_AUDIT.md`](THIRD_PARTY_LICENSE_AUDIT.md) Part A / B.1. Evidence: [`evidence/README.md`](evidence/README.md).

---

## 1. Verified facts

### 1.1 What we ship and how it is loaded
- Loader: `lib/stroMotionDraft/samRacket.ts:211` (retry `:216`) `Sam2Model.from_pretrained('sam2', { dtype: 'q4f16', device, … })`, processor `:221`, with `env.allowRemoteModels = false` and `env.localModelPath = '/models/'` (`:170-171`). Device is `webgpu` only when the adapter has `shader-f16`, else `wasm` (`:189-207`). **Quantisation in use: `q4f16`** (confirmed in code). `@huggingface/transformers` `^4.2.0` (`package.json:20`) runs it on `onnxruntime-web` (wasm from `/ort/`).
- Files (sha256 from the first pass, unchanged): `onnx/vision_encoder_q4f16.onnx` `c4092f4c…a794` + `.onnx_data` `48c3dc27…7349`; `onnx/prompt_encoder_mask_decoder_q4f16.onnx` `0ff3ee04…697b` + `.onnx_data` `8b204a80…d3cc7`; `config.json` `9813c595…414cce`; `preprocessor_config.json` `240c886b…0f7349`. Hash-matched to Hugging Face **`onnx-community/sam2.1-hiera-tiny-ONNX` @ `814a066640debee5a91e70aa401fb8e17e030503`** (created 2025-11-18T01:20:16Z per the Hub API; tags `onnx`, `sam2`, `region:us`; **no `license` tag, no README, no LICENSE**; re-read 2026-11-24, `sha` unchanged).
- Read from the shipped graphs with `onnx.load(..., load_external_data=False)` (`evidence/sam2-shipped-onnx-graph-metadata.txt`): both graphs `ir_version 8`, **producer `pytorch` `2.9.0`**, opsets `ai.onnx 18` + `com.microsoft 1`; **`com.microsoft::MatMulNBits`** nodes (4-bit weight-only matmul): 51 in the encoder, 52 in the decoder; graph inputs cast to fp16 (`pixel_values_fp16`, `input_points_fp16`); `metadata_props` empty (no provenance recorded in the files). Encoder input `pixel_values` → outputs `image_embeddings.0/1/2`; decoder inputs `input_points, input_labels, input_boxes, image_embeddings.0-2` → `iou_scores, pred_masks, object_score_logits`. Initialiser names begin `model.vision_encoder.backbone.patch_embed…` and `config.json` says `"transformers_version": "5.0.0.dev0"`, `"architectures": ["Sam2Model"]`.
- Nothing shipped next to the files states a licence, copyright notice or change notice (first pass A.1-9; still true).

### 1.2 The official checkpoint
- **Meta GitHub** `facebookresearch/sam2` (default branch `main`, read through `raw.githubusercontent.com`; commit SHA not readable). README lines 23-28 announce *"09/30/2024 -- SAM 2.1 Developer Suite (new checkpoints, training code, web demo) is released"*; line 164: *"The table below shows the improved SAM 2.1 checkpoints released on September 29, 2024."*; line 167 links `sam2.1_hiera_tiny` config `sam2/configs/sam2.1/sam2.1_hiera_t.yaml` and checkpoint **`https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt`** (also `checkpoints/download_ckpts.sh:40-48`). `dl.fbaipublicfiles.com` was **refused** by the egress proxy (HTTP 403), so that file was not downloaded and its hash is **not known here**.
- **Meta on Hugging Face** `facebook/sam2.1-hiera-tiny` @ **`de431c4043854a71d8101e17995dfe596bf101a5`** (lastModified 2025-08-15T21:18:13Z; tags include `license:apache-2.0`, `arxiv:2408.00714`, `transformers`, `safetensors`). Files with LFS sha256 (`evidence/sam2-hf-facebook-sam2.1-hiera-tiny-api-blobs.json`): `sam2.1_hiera_tiny.pt` 156,008,466 B `7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69`; `model.safetensors` 155,908,064 B `48c14467e5cf9e51870511feb72c89688e82dd74523142c0538b663e193ac2a7`; `config.json`, `preprocessor_config.json`, `processor_config.json`, `video_preprocessor_config.json`, `sam2.1_hiera_t.yaml`, README. No LICENSE file. Whether the HF `.pt` is byte-identical to the `dl.fbaipublicfiles.com` file is **not verified** (the latter was unreachable).
- **Licence statement (Meta README, saved):** *"The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under Apache 2.0, however the Inter Font and Noto Color Emoji used in the SAM 2 demo code are made available under the SIL Open Font License, version 1.1."* `LICENSE` = Apache License 2.0 (unfilled appendix template; sha256 `c71d239d…0ab4`). No `NOTICE` file (first pass). Apache-2.0 §4 (quoted from the saved `LICENSE`): *"You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in Source or Object form, provided that You meet the following conditions: (a) You must give any other recipients of the Work or Derivative Works a copy of this License; and (b) You must cause any modified files to carry prominent notices stating that You changed the files; and (c) You must retain, in the Source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the Source form of the Work … and (d) If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the attribution notices contained within such NOTICE file …"*

### 1.3 SA-V dataset terms (newly verified this pass, in Meta's own repository)
- `facebookresearch/sam2` `sav_dataset/README.md` line 5 (saved, sha256 `d0084f49…3292`): *"[Segment Anything Video (SA-V)](https://ai.meta.com/datasets/segment-anything-video/), consists of 51K diverse videos and 643K high-quality spatio-temporal segmentation masks (i.e., masklets). The dataset is released under the CC by 4.0 license."* Line 162: *"The evaluation code is licensed under the [BSD 3 license](./LICENSE). Please refer to the paper for more details on the models. The videos and annotations in SA-V Dataset are released under CC BY 4.0."*
- This **verifies, from a Meta-controlled primary source, the owner's "CC BY 4.0" statement** that the first pass could only record as unverified. The dataset page and download terms at `ai.meta.com` (which the README links, and which may add click-through terms) were **still unreachable** (proxy refused). The CC BY 4.0 legal code itself was not fetched.
- Other training data: `training/README.md` line 69 (saved): *"The code supports training on images and videos (similar to how SAM 2 is trained). We provide classes for loading SA-1B as a sample image dataset, SA-V as a sample video dataset …"*. That SAM 2's released checkpoints were trained on SA-1B (and any other data) is stated in the SAM 2 paper, which was **not reachable** (`arxiv.org`, `ai.meta.com`); this review does not state the training mix. SA-1B terms remain unread (first pass A.1-8).

### 1.4 What the official repository says about ONNX export
- The `facebookresearch/sam2` README, `INSTALL.md`, `setup.py` and `pyproject.toml` (read 2026-11-24) contain **no ONNX export script or instructions** (`grep -i onnx` finds nothing in the README; the files read have no `onnx` entry). Unlike SAM 1 (`segment-anything/scripts/export_onnx_model.py`), the official SAM 2 repo provides **no** ONNX path. Other repo files were not searched exhaustively (no GitHub tree listing: `api.github.com` refused).
- The transformers.js README recommends converting with Optimum (`optimum-onnx`); its old `scripts/convert.py` / `scripts/quantize.py` paths return 404 on `main`. The exact tool that produced the `onnx-community` files is **not stated** anywhere read; the graph metadata (PyTorch 2.9.0 exporter, transformers `Sam2Model` weight names, transformers 5.0.0.dev0 config) indicates an export **from the Hugging Face transformers port** (`facebook/sam2.1-hiera-tiny` `model.safetensors`), not from Meta's `sam2` code. That is an inference from metadata, not a statement by the converter.

---

## 2. Technical findings
- **T-S1.** Provenance of the shipped files can be proven only to the `onnx-community` upload (by hash). The link from those files to Meta's weights is circumstantial (names, config, transformers weight names); no file states it.
- **T-S2.** The shipped files are a **modified** form of the checkpoint (graph export + 4-bit block quantisation + fp16), i.e. "modified files" in the sense of Apache-2.0 §4(b); nothing marks them as changed, and no licence copy accompanies them.
- **T-S3.** A self-conversion is technically feasible with public, pinned tools, and can be made reproducible (plan §4). Exact byte equality with the current files is **not** a realistic acceptance criterion (different exporter versions change graphs); functional equivalence is.

## 3. Questions for counsel (SAM 2) — supersede/extend first-pass A-1…A-5
- **Q-S1 (= A-1).** May we redistribute the `onnx-community` conversion, which states no licence, given Meta's Apache-2.0 statement for "the SAM 2 model checkpoints"? Does Apache-2.0 cover a third party's derivative that carries no notice?
- **Q-S2.** If we convert Meta's checkpoint ourselves (§4), is the resulting quantised ONNX a Derivative Work we may distribute under Apache-2.0 §4, and is the notice package in §4.6 sufficient?
- **Q-S3.** SA-V is stated as CC BY 4.0 in Meta's repo (§1.3). Does CC BY 4.0 on **training data** impose any attribution or other obligation on distributing **model weights** trained on it? Do the `ai.meta.com` dataset/download terms (unread) add anything?
- **Q-S4.** SA-1B: are the "SA-1B Dataset Research License" terms (unread) relevant to SAM 2 checkpoints if SAM 2 was trained partly on SA-1B (paper unread)? Please obtain both documents.
- **Q-S5.** Which source should be treated as authoritative for the checkpoint: `dl.fbaipublicfiles.com/…/092824/sam2.1_hiera_tiny.pt` (linked by Meta's README) or `facebook/sam2.1-hiera-tiny` on Hugging Face (Meta's org account, carries `license:apache-2.0`)?
- **Q-S6 (= A-5).** Any constraint on naming "SAM 2" / Meta in our notices (Apache-2.0 §6 trademarks)?

## 4. Plan: convert Meta's official checkpoint to ONNX ourselves (NOT executed)

### 4.1 Inputs (record every value at run time)
- Checkpoint: `facebook/sam2.1-hiera-tiny` @ `de431c4043854a71d8101e17995dfe596bf101a5`, file `model.safetensors` (sha256 `48c14467…c2a7`), plus `config.json`, `preprocessor_config.json`, `processor_config.json`; or the Meta `.pt` (`7402e0d8…be69` on HF) if counsel prefers it (Q-S5). Verify sha256 after download; refuse on mismatch.
- If the `.pt` route is chosen, also cross-check it against `dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt` from a network that can reach it.

### 4.2 Tools, pinned (versions current on PyPI 2026-11-24; pin exact versions in a lock file at run time)
- Python 3.11/3.12 in a fresh venv; `torch` (CPU) — **2.9.0** to match the producer of the current files, or the then-current release (PyPI latest read: 2.15.0); `transformers` with `Sam2Model` support (PyPI latest read: 5.24.0; the current files came from 5.0.0.dev0); `optimum-onnx` (0.1.0, Apache-2.0) **if** it supports `sam2` — otherwise a short reviewed export script calling `torch.onnx.export` on the two sub-modules exactly as transformers.js expects (§4.3); `onnx` (1.23.2); `onnxruntime` (1.32.0) for checks and quantisation tools; `onnxruntime`'s `MatMulNBitsQuantizer` (`bits=4`, `block_size=32` — the values read from all 51 encoder `MatMulNBits` nodes of the current files) and `onnxconverter-common` / ORT float16 conversion for the `f16` part. Record `pip freeze` and the git SHA of any script.

### 4.3 Export (two graphs, same I/O contract as today, so `transformers.js` loads them unchanged)
1. `vision_encoder.onnx`: input `pixel_values` [B,3,1024,1024] float → `image_embeddings.0/1/2`. Opset **18** (as today).
2. `prompt_encoder_mask_decoder.onnx`: inputs `input_points, input_labels (int64), input_boxes, image_embeddings.0-2` → `iou_scores, pred_masks, object_score_logits`.
3. Check I/O names, dtypes and shapes against the current files (script prints both and diffs).
4. Quantise to the app's `q4f16`: 4-bit weight-only `MatMulNBits` on MatMul weights + fp16 for the rest, with fp16 input casts as today. Name outputs `*_q4f16.onnx` (+ external `.onnx_data`) so the loader (`samRacket.ts:211`) needs no change.
5. Write `metadata_props` into each graph: source repo + revision + sha256 of the input checkpoint, tool versions, date, "modified by Anglemotion: ONNX export and 4-bit/fp16 quantisation".

### 4.4 Equivalence tests (acceptance thresholds to be agreed before the run)
- **Frame set:** a fixed, committed list of ≥ 30 frames from our own test clips (racket, player, occlusion, motion blur, small racket), with fixed click/box prompts per frame (the same prompts the Object-select and Auto-detect paths generate).
- **Masks:** compare new q4f16 vs current q4f16, and both vs the PyTorch fp32 model. Metric: mask IoU at the app's threshold, per frame and mean; also `iou_scores` ordering (same best mask chosen). Proposed gate: mean IoU ≥ 0.95 vs current and no frame < 0.85; any frame below gate inspected visually.
- **Memory:** peak renderer RSS during encode + decode in desktop Chromium (method as the MobileSAM measurement) and on an iPhone (Safari) — the first pass measured ~1.5 GB peak for the current SAM 2 path.
- **Speed:** model load time, encode time per frame (webgpu with `shader-f16`, and wasm), decode time per click; 5 runs, median.
- **Size:** bytes of each file (today ~33.7 MB total).
- **Integration:** `npx tsc --noEmit`, `npm test`, and a runtime check of Object select and Auto-detect racket in the dev server (CLAUDE.md verification step), with the files swapped only in a scratch build.

### 4.5 Provenance and hash recording
- Commit (in the later implementation PR, not this one): the export script, the pinned requirements lock, a `PROVENANCE.md` next to the files with input revision/hashes, tool versions, commands, output sha256 of every file, and the equivalence-test results; add the row to the audit register with status `Pending legal review`.

### 4.6 Apache-2.0 notices to ship with the converted files (subject to counsel, Q-S2)
- `public/models/sam2/LICENSE` (Apache-2.0 full text), a `NOTICE`/`README` stating: origin (Meta, SAM 2.1 hiera-tiny, URL + revision), Meta's licence statement quoted, "Modified by Anglemotion: converted to ONNX and quantised (q4f16), <date>", and the SA-V CC BY 4.0 attribution if counsel says it is required (Q-S3); and the same text in the customer-facing notice.

### 4.7 Risks
- **Encoder export:** Hiera's windowed attention / positional-embedding interpolation may not trace cleanly with `torch.onnx.export` (dynamic shapes, `interpolate`, data-dependent ops); may need fixed 1024×1024 input and the dynamo exporter.
- **Op-set / runtime:** opset 18 and `com.microsoft` `MatMulNBits` must be supported by the `onnxruntime-web` build we serve (today's files prove they are, for this version); a newer exporter may emit ops (e.g. opset ≥ 19/21 forms) that the web EPs do not support, or that fall back from WebGPU to wasm.
- **dtype:** fp16 overflow in attention/softmax or layer norms after conversion (masks degrade silently); WebGPU requires `shader-f16` (`samRacket.ts:177-188`); the 4-bit block size and symmetric/asymmetric choice change accuracy.
- **Contract drift:** transformers.js expects specific input/output names and the `config.json`/`preprocessor_config.json` keys; a mismatch fails at load or silently mis-scales masks.
- **Reproducibility:** different `torch`/`transformers` versions yield different graphs; pin and record everything.

## 5. Production risks (SAM 2)
- **R-S1 (medium).** We redistribute, from our own servers, third-party-converted and quantised weights whose upload states no licence and no provenance, with no licence copy or change notice next to them (Apache-2.0 §4(a)/(b) appear unmet if Apache-2.0 applies). Not changed by this PR.
