const { rss, launch } = require('./lib.cjs'); const fs = require('fs');
(async () => { const { b, p } = await launch(); const info = await p.evaluate(() => ready()); console.log(info);
  console.log('load dfine ms', await p.evaluate(() => startWorker('dfine')));
  const res = []; for (let t = 0.5; t < info.dur - 0.3; t += 0.5) { await p.evaluate((t) => grab(t), t); const hits = await p.evaluate((t) => detect(t), t); hits.sort((a, c) => c.score - a.score); res.push({ t, hits }); console.log(t, hits.slice(0, 2).map(h => h.score.toFixed(2) + ' ' + h.box.map(x => Math.round(x)).join(',')).join(' | ')); await p.evaluate(t => delete frames[t], t); }
  fs.writeFileSync('detections.json', JSON.stringify(res)); await b.close(); })();
