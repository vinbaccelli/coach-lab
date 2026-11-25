<p float="center">
  <img src="assets/logo2.png?raw=true" width="99.1%" />
</p>

# Faster Segment Anything (MobileSAM) and Everything (MobileSAMv2)
:pushpin: MobileSAMv2, available at [ResearchGate](https://www.researchgate.net/publication/376579294_MobileSAMv2_Faster_Segment_Anything_to_Everything) and [arXiv](https://arxiv.org/abs/2312.09579.pdf), replaces the grid-search prompt sampling in SAM with object-aware prompt sampling for faster **segment everything(SegEvery)**.

:pushpin: MobileSAM, available at [ResearchGate](https://www.researchgate.net/publication/371851844_Faster_Segment_Anything_Towards_Lightweight_SAM_for_Mobile_Applications) and [arXiv](https://arxiv.org/pdf/2306.14289.pdf), replaces the heavyweight image encoder in SAM with a lightweight image encoder for faster **segment anything(SegAny)**. 


**Support for ONNX model export**. Feel free to test it on your devices and share your results with us.

...
![MobileSAM](assets/model_diagram.jpg?raw=true)

:star: **How is MobileSAM trained?** MobileSAM is trained on a single GPU with 100k datasets (1% of the original images) for less than a day. The training code will be available soon.

:star: **How to Adapt from SAM to MobileSAM?** Since MobileSAM keeps exactly the same pipeline as the original SAM, we inherit pre-processing, post-processing, and all other interfaces from the original SAM. Therefore, by assuming everything is exactly the same except for a smaller image encoder, those who use the original SAM for their projects can **adapt to MobileSAM with almost zero effort**.
...
## ONNX Export
**MobileSAM** now supports ONNX export. Export the model with

```
python scripts/export_onnx_model.py --checkpoint ./weights/mobile_sam.pt --model-type vit_t --output ./mobile_sam.onnx
```

Also check the [example notebook](https://github.com/ChaoningZhang/MobileSAM/blob/master/notebooks/onnx_model_example.ipynb) to follow detailed steps.
We recommend to use `onnx==1.12.0` and `onnxruntime==1.13.1` which is tested.

