# Source: https://raw.githubusercontent.com/facebookresearch/sam2/main/README.md (read 2026-11-24; file sha256 eea69ee1042fb30933c5ca5019fbf0f6f9366cec5e792109281b5023a4f1589c); lines 23-28, 62-73, 162-168, 196-210 verbatim
**09/30/2024 -- SAM 2.1 Developer Suite (new checkpoints, training code, web demo) is released**

- A new suite of improved model checkpoints (denoted as **SAM 2.1**) are released. See [Model Description](#model-description) for details.
  * To use the new SAM 2.1 checkpoints, you need the latest model code from this repo. If you have installed an earlier version of this repo, please first uninstall the previous version via `pip uninstall SAM-2`, pull the latest code from this repo (with `git pull`), and then reinstall the repo following [Installation](#installation) below.
- The training (and fine-tuning) code has been released. See [`training/README.md`](training/README.md) on how to get started.
- The frontend + backend code for the SAM 2 web demo has been released. See [`demo/README.md`](demo/README.md) for details.
...
./download_ckpts.sh && \
cd ..
```

or individually from:

- [sam2.1_hiera_tiny.pt](https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt)
- [sam2.1_hiera_small.pt](https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt)
- [sam2.1_hiera_base_plus.pt](https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt)
- [sam2.1_hiera_large.pt](https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt)

(note that these are the improved checkpoints denoted as SAM 2.1; see [Model Description](#model-description) for details.)
...
### SAM 2.1 checkpoints

The table below shows the improved SAM 2.1 checkpoints released on September 29, 2024.
|      **Model**       | **Size (M)** |    **Speed (FPS)**     | **SA-V test (J&F)** | **MOSE val (J&F)** | **LVOS v2 (J&F)** |
| :------------------: | :----------: | :--------------------: | :-----------------: | :----------------: | :---------------: |
|   sam2.1_hiera_tiny <br /> ([config](sam2/configs/sam2.1/sam2.1_hiera_t.yaml), [checkpoint](https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt))    |     38.9     |          91.2          |        76.5         |        71.8        |       77.3        |
|   sam2.1_hiera_small <br /> ([config](sam2/configs/sam2.1/sam2.1_hiera_s.yaml), [checkpoint](https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt))   |      46      |          84.8          |        76.6         |        73.5        |       78.3        |
...
## License

The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under [Apache 2.0](./LICENSE), however the [Inter Font](https://github.com/rsms/inter?tab=OFL-1.1-1-ov-file) and [Noto Color Emoji](https://github.com/googlefonts/noto-emoji) used in the SAM 2 demo code are made available under the [SIL Open Font License, version 1.1](https://openfontlicense.org/open-font-license-official-text/).

## Contributing

See [contributing](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).

## Contributors

The SAM 2 project was made possible with the help of many contributors (alphabetical):

Karen Bergan, Daniel Bolya, Alex Bosenberg, Kai Brown, Vispi Cassod, Christopher Chedeau, Ida Cheng, Luc Dahlin, Shoubhik Debnath, Rene Martinez Doehner, Grant Gardner, Sahir Gomez, Rishi Godugu, Baishan Guo, Caleb Ho, Andrew Huang, Somya Jain, Bob Kamma, Amanda Kallet, Jake Kinney, Alexander Kirillov, Shiva Koduvayur, Devansh Kukreja, Robert Kuo, Aohan Lin, Parth Malani, Jitendra Malik, Mallika Malhotra, Miguel Martin, Alexander Miller, Sasha Mitts, William Ngan, George Orlin, Joelle Pineau, Kate Saenko, Rodrick Shepard, Azita Shokrpour, David Soofian, Jonathan Torres, Jenny Truong, Sagar Vaze, Meng Wang, Claudette Ward, Pengchuan Zhang.

Third-party code: we use a GPU-based connected component algorithm adapted from [`cc_torch`](https://github.com/zsef123/Connected_components_PyTorch) (with its license in [`LICENSE_cctorch`](./LICENSE_cctorch)) as an optional post-processing step for the mask predictions.
