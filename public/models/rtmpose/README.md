Official OpenMMLab RTMPose body7 (COCO-17, 256x192, SimCC) ONNX models from download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/ (mmdeploy end2end exports, fp32).
yolox-tiny-coco.onnx: stock Megvii YOLOX-tiny COCO weights (Apache-2.0), github.com/Megvii-BaseDetection/YOLOX release 0.1.1rc0 (yolox_tiny.onnx, 20 MB). Used only to find the first person box; it replaced the Human-Art (non-commercial) detector.
Licence: RTMPose / YOLOX code is Apache-2.0; the body7 / HumanArt TRAINING DATA mixes licences (some non-commercial datasets) —
check before shipping commercially. Served to the analysis page by the live skeleton (rtmpose-t + yolox-tiny-coco; rtmpose-s via ?live=rtmpose-s).
