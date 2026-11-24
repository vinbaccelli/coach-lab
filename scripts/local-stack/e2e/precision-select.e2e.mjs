// With Precision on, choosing Select lets every kind of mark be grabbed and moved; dragging empty video with Select
// never moves the video (only the hand in the zoom panel does).
import { createHash } from 'node:crypto';
import { phoneSession } from '../phone.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const { b, p, drag } = await phoneSession();
p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });
const strokes = () => p.evaluate(() => {
  for (const c of document.querySelectorAll('canvas')) {
    const k = Object.keys(c).find((x) => x.startsWith('__reactFiber$'));
    for (let f = k ? c[k] : null; f; f = f.return) {
      const r = f.ref;
      if (r && r.current && typeof r.current.exportStrokes === 'function') return JSON.parse(r.current.exportStrokes());
    }
  }
  return [];
});
const centre = (s) => (s.p1 && s.p2 ? [(s.p1.x + s.p2.x) / 2, (s.p1.y + s.p2.y) / 2] : s.pts ? [s.pts[Math.floor(s.pts.length / 2)].x, s.pts[Math.floor(s.pts.length / 2)].y] : [s.cx, s.cy]);
const tool = async (n) => { await p.locator(`button[aria-label="${n}"]`).tap(); await p.waitForTimeout(350); };
const videoHash = async () => createHash('md5').update(await p.screenshot({ clip: { x: 60, y: 330, width: 330, height: 190 } })).digest('hex');

await p.locator('button[aria-label="Metrics"]').tap(); await p.waitForTimeout(1200);
await p.locator('button[aria-label="Draw"]').first().tap(); await p.waitForTimeout(1200);
await p.mouse.click(350, 500).catch(() => {});
await tool('Line');      await drag([130, 400], [250, 400]);
await tool('Arrow');     await drag([130, 440], [250, 440]);
await tool('Rectangle'); await drag([300, 380], [360, 420]);
await tool('Circle');    await drag([300, 440], [350, 480]);
await tool('Pen');       await drag([100, 360], [200, 360]);
const names = ['line', 'arrow', 'rect', 'circle', 'pen'];
const probes = [[190, 400], [190, 440], [300, 380], [325, 440], [150, 360]];

await tool('Precision'); await p.getByRole('button', { name: 'Got it', exact: true }).first().tap().catch(() => {});
await p.waitForTimeout(400);
await p.locator('button[aria-label="Select"]').first().tap(); await p.waitForTimeout(500);
for (let i = 0; i < names.length; i++) {
  const c0 = centre((await strokes())[i]);
  await drag(probes[i], [probes[i][0], probes[i][1] + 25]);
  const c1 = centre((await strokes())[i]);
  ok(Math.abs(c1[1] - c0[1] - 25) < 4, `Precision on + Select: the ${names[i]} moves with the finger (${(c1[1] - c0[1]).toFixed(0)} px)`);
}

await p.locator('button[aria-label="Clear all"]').first().tap().catch(() => {}); await p.waitForTimeout(600);
await p.getByRole('button', { name: /^(Clear|Yes|Confirm|OK)/ }).first().tap({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(400);
// The video stays put with Select (zoomed in, precision on); only the hand moves it.
for (let i = 0; i < 6; i++) { await p.touchscreen.tap(360, 512); await p.waitForTimeout(400); }
await p.waitForTimeout(600);
const h0 = await videoHash();
await drag([200, 500], [260, 505]);
ok((await videoHash()) === h0, 'Select + Precision, zoomed in: dragging empty video does not move it');
await p.locator('button[aria-label="Drag the video (hand)"]').tap(); await p.waitForTimeout(400);
const h1 = await videoHash();
await drag([200, 420], [260, 470]);
ok((await videoHash()) !== h1, 'the hand in the zoom panel does move the video');

await b.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
