const { chromium } = require('playwright'); const { execSync } = require('child_process');
function rss() { const o = execSync('ps -eo rss,args').toString().split('\n'); let rend = 0, total = 0, n = 0;
  for (const l of o) { if (!/chrom/.test(l) || /ps -eo/.test(l)) continue; const kb = parseInt(l.trim().split(/\s+/)[0]); if (!(kb > 0)) continue; total += kb; if (/--type=renderer/.test(l)) rend += kb; n++; }
  return { rend: rend / 1024, total: total / 1024 }; }
async function launch() { const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }); const p = await b.newPage({ viewport: { width: 400, height: 800 } });
  p.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 300))); p.on('console', m => { const t = m.text(); if (/error|fail/i.test(t)) console.log('CONSOLE', t.slice(0, 300)); });
  await p.goto('http://localhost:8123/index.html'); return { b, p }; }
module.exports = { rss, launch };
