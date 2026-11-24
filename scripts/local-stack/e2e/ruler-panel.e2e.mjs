// The measurement ruler panel gets small once a calibration type is chosen (it used to stay tall and cover the video).
import { phoneSession } from '../phone.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const { b, p } = await phoneSession();
p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });
await p.locator('button[aria-label="Metrics"]').tap(); await p.waitForTimeout(1200);
await p.locator('button[aria-label="Draw"]').first().tap(); await p.waitForTimeout(1200);
await p.mouse.click(350, 500).catch(() => {});
await p.locator('button[aria-label="Ruler"]').tap(); await p.waitForTimeout(1200);
const size = () => p.evaluate(() => { const r = document.querySelector('[data-tour-id="ruler-panel"]')?.getBoundingClientRect(); return r ? { w: r.width, h: r.height } : null; });
const before = await size();
ok(!!before, `the ruler panel is open at the preset list (${Math.round(before?.w)}x${Math.round(before?.h)})`);
await p.locator('[data-tour-id^="ruler-preset-"]').first().tap(); await p.waitForTimeout(800);
const after = await size();
ok(after.h < before.h * 0.45 && after.h < 320, `after choosing the type the panel is much smaller (${Math.round(after.w)}x${Math.round(after.h)})`);
ok(after.w < before.w, `and narrower (${Math.round(after.w)} < ${Math.round(before.w)})`);
const units = await p.getByText('Units', { exact: true }).count();
ok(units === 0, 'the units row and the tips are gone while pointing');
await b.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
