const { rss, launch } = require('./lib.cjs'); const fs = require('fs');
const model = process.argv[2], dtype = process.argv[3] || undefined, tag = process.argv[4] || model;
const det = JSON.parse(fs.readFileSync('detections.json'));
const FR = [1, 2, 3, 4, 9, 10, 13.5, 14];
const boxOf = t => { const h = det.find(d => d.t === t).hits[0].box; return { x1: h[0], y1: h[1], x2: h[2], y2: h[3] }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const { b, p } = await launch(); await p.evaluate(() => ready()); if (process.env.SQUASH) await p.evaluate(() => { window.__squash = true; });
  let peak = 0, peakTot = 0; const iv = setInterval(() => { const r = rss(); if (r.rend > peak) peak = r.rend; if (r.total > peakTot) peakTot = r.total; }, 250);
  const stage = async (name, out) => { await sleep(1500); const r = rss(); out[name] = { rend: +r.rend.toFixed(0), total: +r.total.toFixed(0), peakRend: +peak.toFixed(0), peakTotal: +peakTot.toFixed(0) }; };
  const R = { model: tag, dtype, stages: {}, encMs: [], decode: {} };
  await stage('idle', R.stages);
  for (const t of FR) await p.evaluate(t => grab(t), t);
  await stage('frames', R.stages);
  R.loadMs = await p.evaluate(([m, d]) => startWorker(m, d), [model, dtype]); await stage('afterLoad', R.stages);
  for (let i = 0; i < FR.length; i++) {
    const t = FR[i]; const box = boxOf(t);
    R.encMs.push(Math.round(await p.evaluate(t => encode(t), t)));
    for (const mode of ['box', 'point']) { const d = await p.evaluate(([b, m]) => decode(b, m), [box, mode]); (R.decode[mode] ||= {})[t] = d; }
    if (i === 0) await stage('after1', R.stages); if (i === 4) await stage('after5', R.stages);
    await p.evaluate(() => drop());
  }
  await stage('after8', R.stages);
  clearInterval(iv); R.box = Object.fromEntries(FR.map(t => [t, boxOf(t)]));
  fs.writeFileSync(`res_${tag}.json`, JSON.stringify(R)); console.log(tag, JSON.stringify(R.stages), 'enc', R.encMs.join(','), 'load', Math.round(R.loadMs));
  await b.close();
})().catch(e => { console.log('FAIL', model, String(e).slice(0, 600)); process.exit(1); });
