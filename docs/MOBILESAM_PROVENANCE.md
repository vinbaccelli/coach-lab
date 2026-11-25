# MobileSAM — technical provenance of the converted models

Status: **Shipped by the owner's decision; licensing NOT cleared by counsel.** The converted models are served as public assets from `/public/models/mobilesam/` (`encoder-v1.onnx`, `decoder-v1.onnx`) and MobileSAM is the default Object-select model in the racket worker (phones), with SAM-2 as the automatic fallback. Kill switch: `localStorage['anglemotion:mobileSam']='0'`. This document records facts; it does not claim commercial clearance.

## Verified facts
| Item | Value |
|---|---|
| Source repository | https://github.com/ChaoningZhang/MobileSAM, commit `f706ad9c4eb7f219c00d9050e46328518ffb65d2` |
| Repository licence file | Apache License 2.0; the copy read on 2026-11-25 has SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| Checkpoint | `weights/mobile_sam.pt`, fetched from `raw.githubusercontent.com/ChaoningZhang/MobileSAM/master/weights/mobile_sam.pt` on 2026-11-25; 40,728,226 bytes; SHA-256 `6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f` |
| Conversion (done by us) | The repository's own `mobile_sam` package. Decoder: its `scripts/export_onnx_model.py` (`--model-type vit_t --return-single-mask --opset 17`, legacy exporter). Encoder: `torch.onnx.export(sam.image_encoder, 1x3x1024x1024, opset 17, dynamo=False)`. fp32, no quantisation |
| Toolchain | PyTorch 2.15.0, onnx 1.23.2, onnxruntime 1.32.0, timm 1.0.31 |
| Encoder ONNX | 27,969,731 bytes, SHA-256 `d71bd1833c84f233e3ea5c966173f657085ac90d4c4c3df29c952a3e38f282e5` |
| Decoder ONNX | 16,501,737 bytes, SHA-256 `b2f74183732e1bd499ec8087d8338f4bcd46272dde4d927831ad6488ccd622c0` |
| Third-party converted copies | **Not used.** (No Hugging Face / community ONNX copy.) |
| Numerical check | One real 540x960 frame: image features differ from PyTorch by at most 2.2e-6; mask IoU against the PyTorch mask 0.948 |

## Not verified / unresolved (no permission is inferred from silence)
1. **Weights licence.** The repository code is Apache 2.0. Whether the licence also covers the checkpoint, and what applies because the model was trained / distilled from data and a teacher model with their own terms (SA-1B, SAM ViT-H), is not established here. We do not distribute SA-1B.
2. **Bundled component licences.** The encoder is TinyViT-derived and the decoder is derived from Meta's segment-anything code; their individual licence/notice requirements were not independently checked.
3. **Hosting the converted files** from our origin as a downloadable model: whether that is "redistribution" that requires the licence text and notices to accompany it.
4. **Hugging Face / checkpoint hosting claims** (e.g. a differing licence label on a Hugging Face page) were not examined.

## What exists in code
`samMobile.ts` (same exported functions as `samRacket.ts`), `samMobilePre.ts` (pure preprocessing, unit-tested), `mobileSamSwitch.ts` (default on; `'0'` disables), `racketWorker.ts` (tries MobileSAM, falls back to SAM-2 for the rest of the session if it cannot load or run). Model URLs: `/models/mobilesam/encoder-v1.onnx`, `decoder-v1.onnx` (same origin, `Cache-Control: public, max-age=31536000, immutable`). Desktop keeps the in-page SAM-2 path (the worker is a phone path unless `localStorage.racketWorker='1'`).
