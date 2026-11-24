// Sync accuracy + decoder memory of the look-ahead video in real Chromium.
//   CLIP=… node scripts/skeleton-bench/server.js &  then  NODE_PATH=… RATES=1,0.5,0.25 RTT=100 node scripts/skeleton-bench/lookahead.js
// Memory = summed RSS of the browser's processes (Chromium VP9 software decode: an upper-bound-style PROXY, NOT an iPhone number).
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const rss = () => { try { return Math.round(execSync("ps -eo rss,args | grep -E 'chrome|headless_shell' | grep -v grep | awk '{s+=$1} END {print s/1024}'").toString().trim()); } catch { return NaN; } };
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
(async () => {
  for (const rate of (process.env.RATES || '1,0.5,0.25').split(',').map(Number)) {
    const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    const p = await b.newPage(); await p.goto('http://localhost:3099/lookahead.html'); await p.waitForFunction(() => window.READY);
    const base = rss();
    const out = await p.evaluate((c) => window.run(c), { rate, rtt: +(process.env.RTT || 100), ms: +(process.env.MS || 12000) });
    const during = rss();
    const warm = out.errs.filter((e) => e.t > 3000).map((e) => Math.abs(e.err)).sort((x, y) => x - y);
    await p.evaluate(() => window.release()); await p.waitForTimeout(1500); const after = rss();
    console.log(`rate ${rate}x  ${out.W}x${out.H}  lead ${out.leadMs.toFixed(0)} ms  ready after ${out.readyAtMs && out.readyAtMs.toFixed(0)} ms  failed=${out.failed}${out.failReason ? ' (' + out.failReason + ')' : ''}  |lead error| median ${pct(warm, 0.5).toFixed(1)} p95 ${pct(warm, 0.95).toFixed(1)} max ${warm[warm.length - 1].toFixed(1)} ms  | RSS MB: before ${base}, both playing ${during}, after release ${after}`);
    await b.close();
  }
})().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
