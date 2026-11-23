// Spike worker: one model family per worker, terminated between runs (mirrors racketWorker.ts).
import * as ort from 'onnxruntime-web';
let tjs = null;
const PHONE_ORT = { enableCpuMemArena: false, enableMemPattern: false };
const MIN_PLAUSIBLE = 0.002, MAX_PLAUSIBLE = 12, MIN_IN_BOX = 0.5;
let S = {}; // model state
const out = (m, t) => postMessage(m, t || []);

function rgbaTo(imgData, W, H) { return { data: imgData, W, H }; }

// ---- selection identical to samRacket.decodeRacketMaskFromBox (area veto, in-box >=0.5, best iou score) ----
function pickFromMasks(masks, scores, nCand, mw, mh, box) {
  const per = mw * mh;
  const bx0 = Math.max(0, Math.floor(box.x1)), by0 = Math.max(0, Math.floor(box.y1));
  const bx1 = Math.min(mw, Math.ceil(box.x2)), by1 = Math.min(mh, Math.ceil(box.y2));
  const cands = [];
  for (let c = 0; c < nCand; c++) {
    const off = c * per; let on = 0, inBox = 0;
    for (let y = 0; y < mh; y++) { const yIn = y >= by0 && y < by1; for (let x = 0; x < mw; x++) if (masks[off + y * mw + x] > 0) { on++; if (yIn && x >= bx0 && x < bx1) inBox++; } }
    const areaPct = on / per * 100, frac = on ? inBox / on : 0;
    let veto = null;
    if (areaPct > MAX_PLAUSIBLE) veto = 'area'; else if (areaPct < MIN_PLAUSIBLE) veto = 'speck'; else if (frac < MIN_IN_BOX) veto = 'outside-box';
    cands.push({ score: scores[c], areaPct, veto });
  }
  const ok = cands.map((c, i) => ({ c, i })).filter(x => !x.c.veto).sort((a, b) => b.c.score - a.c.score);
  const chosen = ok.length ? ok[0].i : -1;
  let bin = null;
  if (chosen >= 0) { bin = new Uint8Array(per); const off = chosen * per; for (let p = 0; p < per; p++) bin[p] = masks[off + p] > 0 ? 1 : 0; }
  return { chosen, cands, bin, mw, mh };
}

function sam1Pre(rgba, W, H) { // standard SAM preprocessing: resize long edge 1024, normalise, zero-pad
  const sc = 1024 / Math.max(W, H), nw = Math.round(W * sc), nh = Math.round(H * sc);
  const c = new OffscreenCanvas(nw, nh), g = c.getContext('2d'); const src = new OffscreenCanvas(W, H);
  src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), W, H), 0, 0);
  g.drawImage(src, 0, 0, nw, nh); const px = g.getImageData(0, 0, nw, nh).data;
  const mean = [123.675, 116.28, 103.53], std = [58.395, 57.12, 57.375];
  const t = new Float32Array(3 * 1024 * 1024);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let k = 0; k < 3; k++) t[k * 1024 * 1024 + y * 1024 + x] = (px[(y * nw + x) * 4 + k] - mean[k]) / std[k];
  return { t, sc };
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      globalThis.window = globalThis;
      ort.env.wasm.wasmPaths = '/ort/'; ort.env.wasm.numThreads = 1; // app is not crossOriginIsolated (COEP unsafe-none) => 1 thread
      S.model = m.model; S.phone = m.phone; S.squash = !!m.squash; return out({ id: m.id, ok: true });
    }
    if (m.type === 'load') {
      const t0 = performance.now(); const so = S.phone ? PHONE_ORT : {};
      if (S.model === 'sam2' || S.model.startsWith('slimsam') || S.model === 'dfine') {
        tjs = await import('@huggingface/transformers'); const { env, Sam2Model, SamModel, AutoProcessor, AutoModelForObjectDetection } = tjs;
        env.allowLocalModels = true; env.allowRemoteModels = false; env.localModelPath = '/'; env.backends.onnx.wasm.wasmPaths = '/ort/'; env.backends.onnx.wasm.numThreads = 1;
        if (S.model === 'sam2') { S.m = await Sam2Model.from_pretrained('sam2', { dtype: 'q4f16', device: 'wasm', session_options: so }); S.p = await AutoProcessor.from_pretrained('sam2'); }
        else if (S.model === 'dfine') { S.m = await AutoModelForObjectDetection.from_pretrained('dfine-n', { dtype: 'q4f16', device: 'wasm', session_options: { graphOptimizationLevel: 'basic', ...so } }); S.p = await AutoProcessor.from_pretrained('dfine-n'); S.id2label = S.m.config.id2label; }
        else { S.m = await SamModel.from_pretrained(S.model, { dtype: m.dtype || 'q8', device: 'wasm', session_options: so }); S.p = await AutoProcessor.from_pretrained(S.model); }
      } else if (S.model === 'mobilesam') {
        const o = { executionProviders: ['wasm'], ...so };
        S.enc = await ort.InferenceSession.create('/mobilesam/mobile_sam_image_encoder.onnx', o);
        S.dec = await ort.InferenceSession.create('/mobilesam/sam_mask_decoder_multi.onnx', o);
      } else if (S.model === 'efficientsam') {
        const o = { executionProviders: ['wasm'], ...so };
        S.enc = await ort.InferenceSession.create('/efficientsam/efficientsam_ti_encoder.onnx', o);
        S.dec = await ort.InferenceSession.create('/efficientsam/efficientsam_ti_decoder.onnx', o);
      }
      return out({ id: m.id, ok: true, ms: performance.now() - t0 });
    }
    if (m.type === 'detect') {
      const { RawImage } = tjs; const c = new OffscreenCanvas(m.W, m.H); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.rgba), m.W, m.H), 0, 0);
      const img = RawImage.fromCanvas(c).rgb(); const inputs = await S.p(img); const o = await S.m(inputs);
      const fn = S.p.post_process_object_detection?.bind(S.p) ?? S.p.image_processor.post_process_object_detection.bind(S.p.image_processor);
      const { boxes, classes, scores } = fn(o, 0.1, [[m.H, m.W]])[0];
      const hits = []; for (let i = 0; i < scores.length; i++) { const cls = S.id2label[String(classes[i])]; if (cls === 'tennis racket') hits.push({ score: scores[i], box: boxes[i] }); }
      return out({ id: m.id, ok: true, hits });
    }
    if (m.type === 'encode') {
      const t0 = performance.now(); const { rgba, W, H } = m; S.W = W; S.H = H;
      if (S.model === 'sam2' || S.model.startsWith('slimsam')) {
        const { RawImage } = tjs; const c = new OffscreenCanvas(W, H); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), W, H), 0, 0);
        const img = RawImage.fromCanvas(c).rgb();
        if (S.model === 'sam2') { S.proc = await S.p(img); S.emb = await S.m.get_image_embeddings({ pixel_values: S.proc.pixel_values }); }
        else { S.proc = await S.p(img); S.emb = await S.m.get_image_embeddings(S.proc); }
      } else if (S.model === 'mobilesam') {
        // Acly export: HWC float 0..255; normalise+pad are inside the graph but the caller must resize the long edge to 1024 (measured: native-size input gives offset masks)
        const sc0 = 1024 / Math.max(W, H), nw = Math.round(W * sc0), nh = Math.round(H * sc0);
        const src = new OffscreenCanvas(W, H); src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), W, H), 0, 0);
        const rc = new OffscreenCanvas(nw, nh), rg = rc.getContext('2d'); rg.imageSmoothingQuality = 'high'; rg.drawImage(src, 0, 0, nw, nh); const u = rg.getImageData(0, 0, nw, nh).data;
        const t = new Float32Array(nw * nh * 3); for (let i = 0; i < nw * nh; i++) { t[i * 3] = u[i * 4]; t[i * 3 + 1] = u[i * 4 + 1]; t[i * 3 + 2] = u[i * 4 + 2]; }
        S.sc = sc0; S.sx = sc0; S.sy = sc0;
        const r = await S.enc.run({ input_image: new ort.Tensor('float32', t, [nh, nw, 3]) }); S.emb = r.image_embeddings;
      } else if (S.model === 'efficientsam') {
        const c = new OffscreenCanvas(1024, 1024), g = c.getContext('2d'); const src = new OffscreenCanvas(W, H);
        src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), W, H), 0, 0); g.drawImage(src, 0, 0, 1024, 1024);
        const px = g.getImageData(0, 0, 1024, 1024).data; const t = new Float32Array(3 * 1024 * 1024);
        for (let i = 0; i < 1024 * 1024; i++) { t[i] = px[i * 4] / 255; t[1024 * 1024 + i] = px[i * 4 + 1] / 255; t[2 * 1024 * 1024 + i] = px[i * 4 + 2] / 255; }
        const r = await S.enc.run({ batched_images: new ort.Tensor('float32', t, [1, 3, 1024, 1024]) }); S.emb = r.image_embeddings;
      }
      return out({ id: m.id, ok: true, ms: performance.now() - t0 });
    }
    if (m.type === 'decode') { // m.box {x1..}, m.mode 'box'|'point'|'box+point'
      const { box, mode } = m; const W = S.W, H = S.H; const t0 = performance.now(); let masks, scores, nCand, mw = W, mh = H;
      const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
      if (S.model === 'sam2') {
        let o;
        if (mode === 'box') { const ib = S.p.reshape_input_points([[[box.x1, box.y1, box.x2, box.y2]]], S.proc.original_sizes, S.proc.reshaped_input_sizes, true); o = await S.m({ ...S.emb, input_boxes: ib }); }
        else { const ip = S.p.reshape_input_points([[[[cx, cy]]]], S.proc.original_sizes, S.proc.reshaped_input_sizes); const il = S.p.image_processor.add_input_labels([[[1]]], ip); o = await S.m({ ...S.emb, input_points: ip, input_labels: il }); }
        const up = await S.p.post_process_masks(o.pred_masks, S.proc.original_sizes, S.proc.reshaped_input_sizes, { binarize: false });
        const t = up[0]; nCand = t.dims[1]; mh = t.dims[2]; mw = t.dims[3]; masks = t.data; scores = Array.from(o.iou_scores.data).slice(0, nCand);
      } else if (S.model.startsWith('slimsam')) {
        // Xenova ONNX decoder has points only (input_points,input_labels): box -> corner points labels 2,3 (SAM convention); 'point' -> centre
        let pts, lab;
        const sc = 1024 / Math.max(W, H);
        if (mode === 'box') { pts = [[box.x1 * sc, box.y1 * sc], [box.x2 * sc, box.y2 * sc]]; lab = [2n, 3n]; }
        else { pts = [[cx * sc, cy * sc]]; lab = [1n]; }
        const n = pts.length;
        const o = await S.m({ ...S.emb, input_points: new tjs.Tensor('float32', Float32Array.from(pts.flat()), [1, 1, n, 2]), input_labels: new tjs.Tensor('int64', BigInt64Array.from(lab), [1, 1, n]) });
        const up = await S.p.post_process_masks(o.pred_masks, S.proc.original_sizes, S.proc.reshaped_input_sizes, { binarize: false });
        const t = up[0]; nCand = t.dims[1]; mh = t.dims[2]; mw = t.dims[3]; masks = t.data; scores = Array.from(o.iou_scores.data).slice(0, nCand);
      } else if (S.model === 'mobilesam') {
        const sx = S.sx, sy = S.sy; let pts, lab;
        if (mode === 'box') { pts = [box.x1 * sx, box.y1 * sy, box.x2 * sx, box.y2 * sy]; lab = [2, 3]; } else { pts = [cx * sx, cy * sy, 0, 0]; lab = [1, -1]; }
        const n = lab.length;
        const o = await S.dec.run({ image_embeddings: S.emb, point_coords: new ort.Tensor('float32', Float32Array.from(pts), [1, n, 2]), point_labels: new ort.Tensor('float32', Float32Array.from(lab), [1, n]), mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]), has_mask_input: new ort.Tensor('float32', [0], [1]), orig_im_size: new ort.Tensor('float32', [H, W], [2]) });
        const d = o.masks.dims; nCand = d[1]; mh = d[2]; mw = d[3]; masks = o.masks.data; scores = Array.from(o.iou_predictions.data).slice(0, nCand);
      } else if (S.model === 'efficientsam') {
        let pts, lab; if (mode === 'box') { pts = [box.x1, box.y1, box.x2, box.y2]; lab = [2, 3]; } else { pts = [cx, cy]; lab = [1]; }
        const n = lab.length;
        const o = await S.dec.run({ image_embeddings: S.emb, batched_point_coords: new ort.Tensor('float32', Float32Array.from(pts), [1, 1, n, 2]), batched_point_labels: new ort.Tensor('float32', Float32Array.from(lab), [1, 1, n]), orig_im_size: new ort.Tensor('int64', BigInt64Array.from([BigInt(H), BigInt(W)]), [2]) });
        const d = o.output_masks.dims; nCand = d[2]; mh = d[3]; mw = d[4]; masks = o.output_masks.data; scores = Array.from(o.iou_predictions.data).slice(0, nCand);
      }
      const r = pickFromMasks(masks, scores, nCand, mw, mh, box);
      return out({ id: m.id, ok: true, ms: performance.now() - t0, chosen: r.chosen, cands: r.cands, mw, mh, bin: r.bin }, r.bin ? [r.bin.buffer] : []);
    }
    if (m.type === 'drop') { try { for (const k of Object.keys(S.emb || {})) S.emb[k]?.dispose?.(); if (S.emb?.dispose) S.emb.dispose(); } catch {} S.emb = null; return out({ id: m.id, ok: true }); }
  } catch (err) { out({ id: m.id, ok: false, error: String(err && err.stack || err).slice(0, 800) }); }
};
