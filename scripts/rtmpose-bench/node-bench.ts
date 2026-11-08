// Desktop (node, onnxruntime-node CPU) RTMPose run over raw RGBA frames. DESKTOP NUMBERS ONLY — not a phone result.
// usage: tsx node-bench.ts <models-dir> <frames.rgba> <w> <h> <out.json> [model=rtmpose-s] [detEvery=0]
import * as ort from 'onnxruntime-node';
import { readFileSync, writeFileSync } from 'node:fs';
import { cropFromBox, cropToTensor, decodeSimcc, boxFromKeypoints, letterboxYolox, bestPerson, type Box, type Kp } from '../../lib/rtmpose/core';

const [dir, framesPath, W, H, outPath, modelName = 'rtmpose-s', detEveryArg = '0'] = process.argv.slice(2);
const w = Number(W), h = Number(H), detEvery = Number(detEveryArg);
const buf = readFileSync(framesPath);
const frameBytes = w * h * 4, n = Math.floor(buf.length / frameBytes);

(async () => {
  const opts = { executionProviders: ['cpu'], graphOptimizationLevel: 'all' as const };
  const pose = await ort.InferenceSession.create(`${dir}/${modelName}.onnx`, opts);
  const det = await ort.InferenceSession.create(`${dir}/yolox-tiny.onnx`, opts);
  const frames: Array<{ i: number; kps: Kp[] | null; box: Box | null; ms: { det: number; pre: number; infer: number; post: number }; detected: boolean }> = [];
  let box: Box | null = null;
  for (let i = 0; i < n; i++) {
    const rgba = new Uint8Array(buf.buffer, buf.byteOffset + i * frameBytes, frameBytes);
    const ms = { det: 0, pre: 0, infer: 0, post: 0 };
    let detected = false;
    if (!box || (detEvery > 0 && i % detEvery === 0)) {
      const t0 = performance.now();
      const lb = letterboxYolox(rgba, w, h);
      const r = await det.run({ input: new ort.Tensor('float32', lb.tensor, [1, 3, 416, 416]) });
      const b = bestPerson(r.dets.data as Float32Array, r.labels.data as BigInt64Array, lb.scale, 0.3, box ?? undefined);
      ms.det = performance.now() - t0;
      if (b) { box = b; detected = true; }
    }
    if (!box) { frames.push({ i, kps: null, box: null, ms, detected }); continue; }
    const crop = cropFromBox(box);
    let t0 = performance.now();
    const tensor = cropToTensor(rgba, w, h, crop);
    ms.pre = performance.now() - t0;
    t0 = performance.now();
    const out = await pose.run({ input: new ort.Tensor('float32', tensor, [1, 3, 256, 192]) });
    ms.infer = performance.now() - t0;
    t0 = performance.now();
    const kps = decodeSimcc(out.simcc_x.data as Float32Array, out.simcc_y.data as Float32Array, crop);
    ms.post = performance.now() - t0;
    frames.push({ i, kps, box, ms, detected });
    box = boxFromKeypoints(kps) ?? null; // tracked box for the next frame; null ⇒ re-detect
  }
  writeFileSync(outPath, JSON.stringify({ model: modelName, w, h, n, detEvery, frames }));
  const inf = frames.filter((f) => f.ms.infer > 0).map((f) => f.ms.infer).sort((a, b) => a - b);
  const q = (p: number) => inf[Math.floor(inf.length * p)]?.toFixed(1);
  console.log(`${modelName}: ${n} frames, infer p50 ${q(0.5)} p95 ${q(0.95)} ms, detections ${frames.filter((f) => f.detected).length}, no-pose ${frames.filter((f) => !f.kps).length}`);
})();
