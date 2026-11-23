const fs = require('fs'); const un = (b64, n) => { const buf = Buffer.from(b64, 'base64'); const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = (buf[i >> 3] >> (i & 7)) & 1; return o; };
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const x = a[k], y = b[k]; i += x & y; u += x | y; } return u ? i / u : NaN; };
const tags = ['sam2', 'mobilesam', 'efficientsam', 'slimsam77', 'slimsam50'].filter(t => fs.existsSync(`res_${t}.json`)); const R = Object.fromEntries(tags.map(t => [t, JSON.parse(fs.readFileSync(`res_${t}.json`))]));
const FR = Object.keys(R.sam2 ? R.sam2.box : R[tags[0]].box); const N = 1280 * 720; const out = {};
const area = (m) => { let s = 0; for (const v of m) s += v; return s; };
for (const t of tags) { out[t] = {}; for (const mode of ['box', 'point']) {
  const ious = [], ref = []; let none = 0;
  for (const f of FR) { const d = R[t].decode[mode][f]; const r = R.sam2?.decode.box[f];
    if (!d.bits) { none++; ious.push(0); continue; }
    if (r && r.bits) ious.push(iou(un(d.bits, N), un(r.bits, N))); }
  out[t][mode] = { none, ious: ious.map(x => +x.toFixed(3)), mean: +(ious.reduce((a, b) => a + b, 0) / ious.length).toFixed(3) }; } }
for (const t of Object.keys(out)) for (const m of Object.keys(out[t])) console.log(t.padEnd(13), m.padEnd(6), "none", out[t][m].none, "mean", out[t][m].mean, out[t][m].ious.join(" ")); console.log(JSON.stringify(Object.fromEntries(tags.map(t => [t, R[t].decode.box && Object.values(R[t].decode.box).map(d => d.ms | 0)]))));
