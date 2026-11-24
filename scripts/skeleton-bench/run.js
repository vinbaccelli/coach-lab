// Runs the in-page benchmark (full-frame vs fixed-ROI crop, MediaPipe IMAGE mode, CPU delegate).
//   NODE_PATH=/opt/node-tools/node_modules MODEL=heavy T0=2 N=90 FPS=60 PAD=0.5 node scripts/skeleton-bench/run.js
// Writes bench-out/<TAG or model>.json (git-ignored). Analyse with:
//   npx tsx scripts/skeleton-bench/analyze.ts bench-out/<file>.json
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('console', (m) => { const t = m.text(); if (/error|fail/i.test(t)) console.log('console:', t.slice(0, 120)); });
  await p.goto('http://localhost:3099/harness.html');
  await p.waitForFunction(() => window.READY, null, { timeout: 30000 });
  const cfg = { model: process.env.MODEL || 'heavy', t0: +(process.env.T0 || 2), n: +(process.env.N || 90), fps: +(process.env.FPS || 60), pad: +(process.env.PAD || 0.5), scale: +(process.env.SCALE || 1), tracked: process.env.TRACKED !== '0' };
  // Small-player simulation: SCALE<1 shrinks the video inside the frame; SEED_FROM = a full-scale run's JSON whose first pose seeds the crop (as the on-screen skeleton does in the app).
  if (cfg.scale !== 1 && process.env.SEED_FROM) {
    const ref = JSON.parse(fs.readFileSync(process.env.SEED_FROM, 'utf8')).full[0]; const o = {}; const W = 1920, H = 1080, SC = cfg.scale;
    if (ref) { for (const [n, k] of Object.entries(ref)) o[n] = { x: (W - W * SC) / 2 + k.x * SC, y: H - H * SC - 20 + k.y * SC, vis: k.vis }; cfg.seed = o; }
  }
  const out = await p.evaluate((c) => window.run(c), cfg);
  const dir = path.resolve(__dirname, '..', '..', 'bench-out'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, (process.env.TAG || cfg.model + '_s' + cfg.scale) + '.json');
  fs.writeFileSync(f, JSON.stringify(out));
  console.log('wrote', f, out.W + 'x' + out.H, 'ms/frame full', out.ms.full.toFixed(0), 'roi', out.ms.roi.toFixed(0));
  await b.close();
})().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
