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

Options (decision pending with the architect): the Apache-2.0 YOLOX-tiny **COCO** weights, or no detector (seed the first box from the existing MoveNet/MediaPipe pose). Neither is implemented yet.

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
