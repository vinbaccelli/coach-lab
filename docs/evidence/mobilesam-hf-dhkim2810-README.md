---
license: mit
---

# Faster Segement Anything (MobileSAM)

<!-- Provide a quick summary of what the model is/does. -->

- **Repository:** [Github - MobileSAM](https://github.com/ChaoningZhang/MobileSAM)
- **Paper:** [Faster Segment Anything: Towards Lightweight SAM for Mobile Applications](https://arxiv.org/pdf/2306.14289.pdf)
- **Demo:** [HuggingFace Demo](https://huggingface.co/spaces/dhkim2810/MobileSAM)

**MobileSAM** performs on par with the original SAM (at least visually) and keeps exactly the same pipeline as the original SAM except for a change on the image encoder. Specifically, we replace the original heavyweight ViT-H encoder (632M) with a much smaller Tiny-ViT (5M). On a single GPU, MobileSAM runs around 12ms per image: 8ms on the image encoder and 4ms on the mask decoder. 

The comparison of ViT-based image encoder is summarzed as follows: 

Image Encoder | Original SAM | MobileSAM
:------------:|:-------------:|:---------:
Paramters      |  611M   | 5M
Speed      |  452ms  | 8ms

Original SAM and MobileSAM have exactly the same prompt-guided mask decoder: 

Mask Decoder                                      | Original SAM | MobileSAM 
:-----------------------------------------:|:---------:|:-----:
Paramters      |  3.876M   | 3.876M
Speed      |  4ms  | 4ms

The comparison of the whole pipeline is summarzed as follows: 
Whole Pipeline (Enc+Dec)                                      | Original SAM | MobileSAM 
:-----------------------------------------:|:---------:|:-----:
Paramters      |  615M   | 9.66M
Speed      |  456ms  | 12ms


## Acknowledgement

<!-- If there is a paper or blog post introducing the model, the APA and Bibtex information for that should go in this section. -->

<details>
<summary>
<a href="https://github.com/facebookresearch/segment-anything">SAM</a> (Segment Anything) [<b>bib</b>]
</summary>

```bibtex
@article{kirillov2023segany,
  title={Segment Anything}, 
  author={Kirillov, Alexander and Mintun, Eric and Ravi, Nikhila and Mao, Hanzi and Rolland, Chloe and Gustafson, Laura and Xiao, Tete and Whitehead, Spencer and Berg, Alexander C. and Lo, Wan-Yen and Doll{\'a}r, Piotr and Girshick, Ross},
  journal={arXiv:2304.02643},
  year={2023}
}
```
</details>



<details>
<summary>
<a href="https://github.com/microsoft/Cream/tree/main/TinyViT">TinyViT</a> (TinyViT: Fast Pretraining Distillation for Small Vision Transformers) [<b>bib</b>]
</summary>

```bibtex
@InProceedings{tiny_vit,
  title={TinyViT: Fast Pretraining Distillation for Small Vision Transformers},
  author={Wu, Kan and Zhang, Jinnian and Peng, Houwen and Liu, Mengchen and Xiao, Bin and Fu, Jianlong and Yuan, Lu},
  booktitle={European conference on computer vision (ECCV)},
  year={2022}
```
</details>


**BibTeX:**
```bibtex
@article{mobile_sam,
  title={Faster Segment Anything: Towards Lightweight SAM for Mobile Applications},
  author={Zhang, Chaoning and Han, Dongshen and Qiao, Yu and Kim, Jung Uk and Bae, Sung Ho and Lee, Seungkyu and Hong, Choong Seon},
  journal={arXiv preprint arXiv:2306.14289},
  year={2023}
}
```