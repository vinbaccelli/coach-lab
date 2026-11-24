// The data column must be grabbed and moved by touch when the video is zoomed in, as at 100%.
import { phoneSession } from '../phone.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const { b, p, drag } = await phoneSession();
p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });
// The column's position (fractions of the canvas) as the page holds it, read from the Canvas props.
const colPos = () => p.evaluate(() => {
  for (const c of document.querySelectorAll('canvas')) {
    const k = Object.keys(c).find((x) => x.startsWith('__reactFiber$'));
    for (let f = k ? c[k] : null; f; f = f.return) {
      const mp = f.memoizedProps;
      if (mp && typeof mp === 'object' && 'measurementColumnPos' in mp && mp.measurementColumnPos) return mp.measurementColumnPos;
    }
  }
  return null;
});

await p.locator('button[aria-label="Metrics"]').tap(); await p.waitForTimeout(1200);
await p.locator('button[aria-label="Activate Data Column"]').tap(); await p.waitForTimeout(1000);
await p.mouse.click(350, 500).catch(() => {});
const start = await colPos();
ok(!!start, `the page holds a column position (${JSON.stringify(start)})`);

const canvasRect = () => p.evaluate(() => { const c = [...document.querySelectorAll('canvas')].sort((m, n) => n.width * n.height - m.width * m.height)[0]; const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; });
// Drag the column by (dx, dy) screen px from a point inside it, wherever it is now; return how far it moved (canvas fractions).
async function dragColumn(dx, dy) {
  const r = await canvasRect(); const from = await colPos();
  const g = [r.left + from.x * r.w + 25, r.top + from.y * r.h + 42];
  await drag(g, [g[0] + dx, g[1] + dy]);
  const to = await colPos();
  return { moved: { x: to.x - from.x, y: to.y - from.y }, want: { x: dx / r.w, y: dy / r.h } };
}
const close = (m, w) => Math.abs(m.x - w.x) < 0.04 && Math.abs(m.y - w.y) < 0.04;

const a = await dragColumn(-100, 100);
ok(close(a.moved, a.want), `at 100% a touch drag moves the column with the finger (moved ${a.moved.x.toFixed(2)},${a.moved.y.toFixed(2)}, wanted ${a.want.x.toFixed(2)},${a.want.y.toFixed(2)})`);

for (let i = 0; i < 12; i++) { await p.touchscreen.tap(360, 512); await p.waitForTimeout(400); }
await p.waitForTimeout(800);
ok((await p.getByText('Reset zoom').count()) > 0, 'the video is zoomed in (the Reset zoom button is showing)');
const z = await dragColumn(30, 50);
ok(close(z.moved, z.want), `zoomed in, the column still follows the finger (moved ${z.moved.x.toFixed(2)},${z.moved.y.toFixed(2)}, wanted ${z.want.x.toFixed(2)},${z.want.y.toFixed(2)})`);

await b.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
