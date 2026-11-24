---
library_name: transformers.js
base_model: ustc-community/dfine_n_coco
---

https://huggingface.co/ustc-community/dfine_n_coco with ONNX weights to be compatible with Transformers.js.


### Transformers.js

If you haven't already, you can install the [Transformers.js](https://huggingface.co/docs/transformers.js) JavaScript library from [NPM](https://www.npmjs.com/package/@huggingface/transformers) using:
```bash
npm i @huggingface/transformers
```

You can then use the model like this:
```js
import { pipeline } from "@huggingface/transformers";

const detector = await pipeline("object-detection", "onnx-community/dfine_n_coco-ONNX");

const image = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/cats.jpg";
const output = await detector(image, { threshold: 0.5 });
console.log(output);
```

Note: Having a separate repo for ONNX weights is intended to be a temporary solution until WebML gains more traction. If you would like to make your models web-ready, we recommend converting to ONNX using [🤗 Optimum](https://huggingface.co/docs/optimum/index) and structuring your repo like this one (with ONNX weights located in a subfolder named `onnx`).