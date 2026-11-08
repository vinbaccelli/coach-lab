# RTMPose-t — licence findings and obligations

Researched 2026-11-08 for the V1 decision (RTMPose-t as the Live Skeleton engine). **Not legal advice.** Primary sources that could not be opened from the research environment are marked; they must be checked by counsel or by someone with access.

**Status:** the approach to commercial use is being settled with the architect's lawyer. That approach is **not written down in this repository**; the architect must add it below. Until then RTMPose-t is **not approved for a production deploy** (V1_FREEZE.md S-rule 14 already requires explicit approval to merge or deploy).

## What is licensed how

| Item | Licence / status | Source |
|---|---|---|
| MMPose / RTMPose **code** | Apache-2.0, "Copyright 2018-2020 Open-MMLab" | https://raw.githubusercontent.com/open-mmlab/mmpose/main/LICENSE |
| RTMPose **pretrained weights** (`rtmpose-t_simcc-body7_pt-body7_420e-256x192`) | **No licence statement exists for the weights.** The RTMPose README has no licence section. | https://github.com/open-mmlab/mmpose/blob/main/projects/rtmpose/README.md |
| Maintainer statement on commercial use | One line, Tau-J, 29 May 2024: "Sure, please feel free to use it." No licence cited, datasets not addressed. Later questions (Feb and Nov 2026) about datasets, redistribution and attribution are unanswered. | https://github.com/open-mmlab/mmpose/issues/3062 |
| Related, all unanswered | Same question for other checkpoints | https://github.com/open-mmlab/mmpose/issues/3275 , https://github.com/open-mmlab/mmpose/issues/3277 |
| YOLOX code | Apache-2.0 (Megvii) | https://github.com/Megvii-BaseDetection/YOLOX |
| ONNX Runtime Web | MIT | https://github.com/microsoft/onnxruntime |

## Training datasets of the Body7 weights (per the RTMPose README)

AI Challenger, MS COCO, CrowdPose, MPII, sub-JHMDB, Halpe, PoseTrack18.

| Dataset | Finding | Confidence |
|---|---|---|
| AI Challenger | No official licence found. A third-party mirror (https://github.com/zhhezhhe/AI_Challenger) states research use only, no commercial use. No longer publicly available (2025 review). | Low (secondary) |
| MPII | Page labelled Simplified BSD but reported to state commercial use is not allowed because the authors do not hold the image copyright. Images come from YouTube. https://www.mpi-inf.mpg.de/departments/computer-vision-and-machine-learning/software-and-datasets/mpii-human-pose-dataset/download | Medium (search summary of the page; page itself not opened) |
| PoseTrack | PoseTrack21 paper says the dataset is research-only and forbids training or evaluating commercial systems; a figshare mirror is labelled CC BY 4.0. Official site `posetrack.net` not reachable from the research environment. | Low (conflicting, secondary) |
| COCO | Annotations CC BY 4.0. Images are Flickr images under their own per-image licences (a community thread puts about 70 % as non-commercial). https://github.com/cocodataset/cocoapi/issues/551 | Medium |
| Halpe | No licence statement in the repo (https://github.com/Fang-Haoshu/Halpe-FullBody). Train images from HICO-DET, val from COCO. | Unknown |
| CrowdPose, sub-JHMDB | Not checked | – |

Whether dataset terms bind trained weights is a legal question; none of the sources found settles it.

## The person detector (separate problem)

The detector shipped in the lab (`public/models/rtmpose/yolox-tiny.onnx`) is the **Human-Art** variant. Human-Art is distributed under an authorization form "for non-commercial purposes" (https://github.com/IDEA-Research/HumanArt). It should not be in V1 at all.

Decision pending with the architect; see "Detector options" below. Nothing is changed yet.

## Detector options (investigated 2026-11-08)

**Apache-2.0 YOLOX-tiny (COCO): provenance is NOT sufficiently documented, so it is not adopted.**
- Code licence: Apache-2.0, "Megvii Inc., 2021-2022" (https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/main/LICENSE).
- Checkpoint: `yolox_tiny.pth` from `github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/` (legacy: `Megvii-BaseDetection/storage/releases/download/0.0.1/yolox_tiny_32dot8.pth`); README model zoo: Tiny, 416, 32.8 mAP, 5.06 M params. The README does not say what it was trained on beyond "reproduce our results on COCO". https://github.com/Megvii-BaseDetection/YOLOX
- **No licence statement for the weights.** Two open issues ask exactly this and have no maintainer answer: https://github.com/Megvii-BaseDetection/YOLOX/issues/1865 (commercial iOS app bundling) and https://github.com/Megvii-BaseDetection/YOLOX/issues/1915. Third-party sites that call the weights Apache-2.0 cite no Megvii statement.
- Training data would be COCO: annotations CC BY 4.0, images Flickr under per-image licences (see the COCO row above), the same open question as the pose weights.
- Technical cost too: the shipped detector is the OpenMMLab mmdeploy export (outputs `dets`/`labels`, NMS inside). Megvii's ONNX export has a different output and needs new decode + NMS code in `lib/rtmpose/core.ts`.

**Alternatives that add no new unclear dependency (for the architect to choose):**
1. **Seed the RTMPose box from the MoveNet pose already running in the app (worker).** MoveNet's model card states Apache-2.0 for the model (https://storage.googleapis.com/movenet/MoveNet.SinglePose%20Model%20Card.pdf; training data COCO + Google's internal "Active" set, so the training-data question is not zero either), and it is the product's current default engine. It needs no extra download. Limit: single person (same crowd behaviour the app has today); re-acquire when RTMPose loses the box.
2. **Seed from the on-screen player the coach locks or confirms** (the existing "click player" / lock flow). No model at all; needs a click when the player is lost.
3. **Seed from MediaPipe's pose landmarker** (already self-hosted, Apache-2.0 model card). Heavier, main thread, failed on small players in the lab unless seeded.
4. **Ask counsel / Megvii** for written confirmation on the YOLOX weights, or train our own detector (V2 scope).

Recommendation (not implemented): 1 with 2 as the manual fallback; keep the Human-Art file out of any production build until then.

## Obligations if RTMPose-t ships (Apache-2.0 for code, to be confirmed for weights)

- Ship the Apache-2.0 licence text and any NOTICE with the model files; credit OpenMMLab / MMPose / RTMPose and Megvii YOLOX (if used) and ONNX Runtime (MIT).
- Add an in-app "Third-party notices" entry reachable by users, and a `THIRD_PARTY_NOTICES` file in the repo.
- Keep the "OpenMMLab notification" the architect agreed with the lawyer (wording to be supplied).
- Do not ship `rtmpose-s`, `rtmpose-m`, or the MediaPipe/MoveNet lab models from the lab folder to production: the lab folder (`public/models/rtmpose/`, ~109 MB) is for the spike only. A production PR adds only the chosen model on a clean branch.

## Open items

1. Architect: add the lawyer-agreed approach and notification text here.
2. Decide the detector (COCO YOLOX-tiny vs none) and remove Human-Art from the default path.
3. Verify the unopened primary sources (MPII page, PoseTrack site, COCO terms of use, CrowdPose, sub-JHMDB).
4. Written confirmation from Open-MMLab for the exact checkpoint (optional, recommended).
5. Create `THIRD_PARTY_NOTICES` and the in-app notice before any production deploy.
