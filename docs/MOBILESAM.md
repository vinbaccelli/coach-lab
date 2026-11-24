# MobileSAM — licensing and provenance dossier

**Status: Pending legal review. Integration paused. Nothing from MobileSAM is shipped, committed or enabled by this PR** (no code, no `.onnx`, no weights). Written 2026-11-24 (sources first read 2026-11-23, re-read 2026-11-24 with identical revisions/hashes). Not legal advice and no legal conclusion is drawn. Register: [`THIRD_PARTY_LICENSE_AUDIT.md`](THIRD_PARTY_LICENSE_AUDIT.md). Evidence index (URL, date, SHA-256 of each saved file): [`evidence/README.md`](evidence/README.md).

Code licence and weights licence are **separate questions**; the Apache-2.0 licence of the repository is **not** assumed to resolve the licence of separately distributed model weights.

## 1. Verified facts (source · date read · revision)

### 1.1 Official code repository
1. Repository: `github.com/ChaoningZhang/MobileSAM` (default branch `master`). **Commit SHA: not read** — `api.github.com` and `github.com` were refused by the egress proxy; files were read from `raw.githubusercontent.com` on 2026-11-24. Saved copies are identified by SHA-256 (evidence index).
2. `LICENSE` = Apache License 2.0, 201 lines; the appendix is the **unfilled template** (`Copyright [yyyy] [name of copyright owner]`). The file names **no copyright holder**. Complete text: Appendix A below and `evidence/mobilesam-github-LICENSE.txt`.
3. The repo's `scripts/export_onnx_model.py` begins with *"Copyright (c) Meta Platforms, Inc. and affiliates. All rights reserved. This source code is licensed under the license found in the LICENSE file in the root directory of this source tree."* (`evidence/mobilesam-github-export-script-header.txt`) — i.e. at least some files carry Meta's copyright header while the repo LICENSE names no holder.
4. Official README (`evidence/mobilesam-github-README-excerpt.txt`): *"MobileSAM is trained on a single GPU with 100k datasets (1% of the original images) for less than a day."* It does not name the dataset in the lines read; the "original images" reading as SA-1B is from the MobileSAM paper abstract/context and **was not verified here** (arXiv unreachable). The README states the ONNX export command `python scripts/export_onnx_model.py --checkpoint ./weights/mobile_sam.pt --model-type vit_t --output ./mobile_sam.onnx` and recommends `onnx==1.12.0` and `onnxruntime==1.13.1`. The README heading in the current default branch reads "Faster Segment Anything (MobileSAM) and Everything (MobileSAMv2)".
5. The export script's own description: *"Export the SAM prompt encoder and mask decoder to an ONNX model."* No image-encoder export script was found in the files read from the official repo (README documents only this one).

### 1.2 Original weights checkpoint — Hugging Face `dhkim2810/MobileSAM`
1. Revision **`4e2e5245fe9dc63096d575d36e70eb39b03b3aba`**; created 2023-06-28T04:10:23Z, last modified 2023-06-29T09:34:09Z; author/uploader on the Hub: `dhkim2810` (`evidence/mobilesam-hf-dhkim2810-api.json`, read 2026-11-24).
2. Tags: `arxiv:2306.14289`, `arxiv:2304.02643`, **`license:mit`**; card YAML header (as read): `---\nlicense: mit\n---`. Files: `.gitattributes`, `README.md`, `mobile_sam.pt` (40,728,226 bytes, LFS sha256 `6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f`). **No LICENSE file.**
3. Card text (`evidence/mobilesam-hf-dhkim2810-README.md`): title "Faster Segement Anything (MobileSAM)"; links the GitHub repository, paper, demo; parameter/speed tables; BibTeX; cites SAM (`facebookresearch/segment-anything`) and TinyViT (`microsoft/Cream`). **Not stated:** the training-data licence, why MIT was chosen, whether the uploader is the copyright holder, any relation of the MIT tag to the GitHub Apache-2.0 LICENSE.

### 1.3 Third-party ONNX conversion — Hugging Face `Acly/MobileSAM` (the files we downloaded and tested)
1. Revision **`0d3b403339b4674a82493d5e97964dd78089ddc8`**; created 2023-08-03T15:43:37Z, last modified 2023-08-03T16:01:55Z; uploader `Acly` (`evidence/mobilesam-hf-Acly-api.json`, read 2026-11-24).
2. Tags: `onnx`, **`license:mit`**; YAML header `---\nlicense: mit\n---`. **No LICENSE file.** Files and LFS SHA-256 (sizes from the API; the two we downloaded were also hashed locally on 2026-11-23 and match):

| file | bytes | sha256 |
|---|---|---|
| `mobile_sam_image_encoder.onnx` | 28,157,093 | `580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749` |
| `sam_mask_decoder_multi.onnx` | 16,496,559 | `8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe` |
| `sam_mask_decoder_single.onnx` (not downloaded) | 16,501,323 | `93915fc7c993ab9d59ab8c9ccd3bce37f7509c81ab4150a74abd4d2abbd8570d` |
| `mobile_sam_encoder_onnx/export_image_encoder.py`, `onnx_image_encoder.py`, `README.md`, `.gitignore` | 6,057 / 1,732 / 712 / 11 | not LFS |

3. Card text, verbatim (`evidence/mobilesam-hf-Acly-README.md`): "ONNX models for MobileSAM · Original repository: MobileSAM (Github) · Original weights: MobileSam (HuggingFace) [link to `dhkim2810/MobileSAM`] · mobile_sam_image_encoder.onnx — Image encoder created from MobileSAM weights · sam_mask_decoder_single.onnx — Mask decoder for SegmentAnything, returns a single mask · sam_mask_decoder_multi.onnx — Mask decoder for SegmentAnything, returns 4 masks · Export: The image encoder was exported with `export_image_enoder.py` found in this repository. The mask decoders were exported with `export_models.py` from the MobileSAM repository."
4. **Not stated** in the card or repo: that the converter had the right to redistribute the weights; any licence of the converter's own export scripts (`export_image_encoder.py` has no licence header in the part read); the basis for tagging the conversion MIT; the library versions used; the exact upstream revision converted. The card names `export_models.py` while the official repo's script is `scripts/export_onnx_model.py` (not reconciled).

### 1.4 SA-1B (training images of SAM; MobileSAM's own README says it used a 1 % subset of "the original images")
1. The only SA-1B licence text read is a pointer: the `facebookresearch/segment-anything` README states *"By downloading the datasets you agree that you have read and accepted the terms of the SA-1B Dataset Research License."* and its License section says *"The model is licensed under the Apache 2.0 license."* (`evidence/segment-anything-github-README-dataset-and-license.txt`, default branch, read 2026-11-24).
2. **The terms of the "SA-1B Dataset Research License" themselves could not be read** — `ai.meta.com` (the dataset page and download page) was refused by the egress proxy (HTTP 403), as was `arxiv.org`. They are therefore **not quoted here** and are an open question. No part of SA-1B (images, masks, annotations) is in this repository or in anything this repository ships.

### 1.5 What was measured (engineering, not licensing)
Desktop Chromium only, one clip, two frames: MobileSAM as the Object-select segmenter had ~30 % lower peak renderer RSS than the current SAM 2 path (1079 MB vs 1519–1538 MB), mean mask IoU 0.90 against SAM 2, encode ~4–7 s vs 13–15 s. Nothing was measured on an iPhone. The integration code and measurements are not part of this PR; this is recorded only so the legal review is weighed against what the feature would buy.

## 2. Unresolved legal questions for counsel (MobileSAM)
1. **Which licence governs the weights?** Two Hugging Face repos tag them MIT (neither has a LICENSE file); the official code repo is Apache-2.0 (no copyright holder named); some files carry a Meta copyright header. Is the MIT tag by the uploader (`dhkim2810`) effective for a checkpoint trained on Meta's SA-1B and distilled from SAM? Is a copyright notice for MIT purposes available anywhere?
2. **SA-1B terms.** What do the SA-1B Dataset Research License terms say (not read — please obtain from Meta), and do they restrict commercial use of models trained on SA-1B or redistribution of such weights? Does "research license" in that name restrict our use?
3. **Does the Apache-2.0 code licence say anything about the separately distributed weights?** We have not assumed it does.
4. **Third-party conversion.** The Acly ONNX files are a conversion by a third party that states no redistribution right and no licence file. May we redistribute them? Is a conversion of an MIT/Apache checkpoint a derivative requiring its own notice?
5. **Recommended alternative (see §3):** if we re-export from the official checkpoint ourselves, who must confirm the official checkpoint's provenance (the Hub copy `dhkim2810/MobileSAM` is not the GitHub repo owner's account — is the Hub copy authoritative; is there an official checkpoint release linked from the GitHub README?).
6. **Which SAM data is "the original images"?** The README's "1 % of the original images" was not tied to a named dataset in the lines read; confirm it is SA-1B and the exact subset.
7. **Attribution** needed for Apache-2.0/MIT/SA-1B (licence text, notices, citation) if ever shipped, and where to display it.
8. Same-class questions apply to the SAM 2 files we already ship (see audit register Part A); MobileSAM is not shown to be better or worse on provenance than SAM 2.

## 3. Recommendation and conversion procedure (not executed; nothing built or committed)
**Prefer converting the official checkpoint ourselves over relying on the Acly files**, unless counsel confirms the third-party distribution right is sufficiently documented (question 4). The official repo documents only the **decoder** export; the **image-encoder** export script exists only in the third-party repo, so a self-conversion needs a small export wrapper written/reviewed by us (or counsel-approved reuse of the Acly script).

Procedure (to be run by someone with GitHub access; pin and record every version in the audit register at that time):
1. Obtain the official checkpoint `mobile_sam.pt` from the source counsel accepts (currently found at `dhkim2810/MobileSAM` @ `4e2e5245…`, sha256 `6dbb9052…2c0d`, linked from the official README? — **not verified**, the README excerpt read does not show a checkpoint link; confirm).
2. Check out `ChaoningZhang/MobileSAM` at a **pinned commit SHA** (record it; not readable here) in a clean virtualenv with `onnx==1.12.0` and `onnxruntime==1.13.1` (the README's tested pair) plus a pinned `torch` and `torchvision` version (record them).
3. Decoder: `python scripts/export_onnx_model.py --checkpoint ./weights/mobile_sam.pt --model-type vit_t --output ./mobile_sam.onnx` (official command; README). Check the flags `--return-single-mask` / multimask behaviour in the script's help before choosing which variant matches the app's candidate handling (the app was tested with a 4-mask decoder).
4. Encoder: export `sam.image_encoder` (TinyViT) with `torch.onnx.export` at a recorded opset (Acly's script defaults to 17), input NHWC float 0–255 resized by the caller to 1024 on the long edge (this is the behaviour the tested Acly encoder has; verify against the original), with normalisation inside the graph.
5. Verify numerically against the PyTorch model on a fixed image (IoU ≥ agreed threshold), record SHA-256 of both outputs, record the exact versions, and add a row to `THIRD_PARTY_LICENSE_AUDIT.md` with status `Pending legal review`. **Do not commit or ship the converted weights** until counsel signs off.

## 4. Decision record
- Current deployed models are unchanged. MobileSAM integration is paused by the owner's decision pending this review. Re-opening it requires counsel's written answer to §2 questions 1–4 recorded in the audit register with date and name.

## Appendix A — complete official MobileSAM `LICENSE` (Apache License 2.0), saved verbatim from `ChaoningZhang/MobileSAM` default branch on 2026-11-24 (file sha256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`)

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
