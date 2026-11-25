| Model | Dataset | AP<sup>val</sup> | #Params | Latency | GFLOPs | config | checkpoint | logs |
| :---: | :---: | :---: |  :---: | :---: | :---: | :---: | :---: | :---: |
**D&#8209;FINE&#8209;N** | COCO | **42.8** | 4M | 2.12ms | 7 | [yml](./configs/dfine/dfine_hgnetv2_n_coco.yml) | [42.8](https://github.com/Peterande/storage/releases/download/dfinev1.0/dfine_n_coco.pth) | [url](https://raw.githubusercontent.com/Peterande/storage/refs/heads/master/logs/coco/dfine_n_coco_log.txt)
- **AP<sup>5000</sup>** is evaluated on the first 5000 samples of the *Objects365* validation set.
</details>

**Notes:**
- **AP<sup>val</sup>** is evaluated on *MSCOCO val2017* dataset.
- **Latency** is evaluated on a single T4 GPU with $batch\\_size = 1$, $fp16$, and $TensorRT==10.4.0$.
- **Objects365+COCO** means finetuned model on *COCO* using pretrained weights trained on *Objects365*.
- **License note:** Checkpoints trained or pretrained on Objects365 (*_obj365, *_obj2coco) may be subject to the Objects365 dataset terms and should not be assumed to be commercially cleared under the D-FINE license.

