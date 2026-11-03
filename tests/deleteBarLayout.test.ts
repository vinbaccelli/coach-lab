import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The Delete bar (SelectedItemDeleteBar) must never sit on another control.
 * Found on a desktop at 1150x722: anchored bottom-right of the canvas, it covered
 * the Speed and FPS dropdowns and swallowed the clicks.
 */

const SRC = readFileSync(join(__dirname, '..', 'components/metrics/SelectedItemDeleteBar.tsx'), 'utf8');

test('delete bar: anchored at the left edge, vertically centred — not in the bottom-right corner where the playback bar is', () => {
  const base = SRC.slice(SRC.indexOf('const base'), SRC.indexOf('const pill'));
  assert.match(base, /left: 8/);
  assert.match(base, /top: '50%'/);
  assert.doesNotMatch(base, /\bbottom:/, 'a bottom anchor puts it over the playback controls');
  assert.doesNotMatch(base, /\bright:/, 'a right anchor puts it over the zoom cluster / speed controls');
});

test(
  'opt-in browser check: DELETE_BAR_E2E_URL=http://localhost:3000 DELETE_BAR_CLIP=/path/clip.webm — the bar overlaps no control at 1150x722, 1280x800, 390x844, 844x390, and a real click deletes',
  { skip: !(process.env.DELETE_BAR_E2E_URL && process.env.DELETE_BAR_CLIP) && 'needs a running dev server (no Supabase env), a VP9/WebM clip and Playwright (NODE_PATH)' },
  async () => {
    const playwright = 'playwright';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { chromium } = require(playwright) as any;
    const base = process.env.DELETE_BAR_E2E_URL!;
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const failures: string[] = [];
    try {
      for (const [w, h] of [[1150, 722], [1280, 800], [390, 844], [844, 390]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800, isMobile: w < 800 });
        const page = await ctx.newPage();
        await page.addInitScript(() => localStorage.setItem('anglemotion-tour-seen', '1'));
        await page.goto(`${base}/analysis`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
        await page.waitForTimeout(6000);
        await (await page.$('input[type=file]')).setInputFiles(process.env.DELETE_BAR_CLIP!);
        await page.waitForTimeout(5000);
        await page.locator('[data-tour-id="row-met-h"]').first().click({ timeout: 5000 });
        await page.waitForTimeout(800);
        await page.locator('[data-tour-id="row-m-snapshot"]').first().click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        const hits: string[] = await page.evaluate(() => {
          const bar = document.querySelector('[data-selected-item-bar]');
          const del = document.querySelector('[data-delete-selected]');
          if (!bar || !del) return ['no delete bar after Snapshot'];
          const br = bar.getBoundingClientRect();
          const out: string[] = [];
          for (const e of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=slider], [tabindex]:not([tabindex="-1"])')) {
            if (bar.contains(e)) continue;
            const r = e.getBoundingClientRect();
            const cs = getComputedStyle(e);
            if (r.width <= 0 || r.height <= 0 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0 || cs.pointerEvents === 'none') continue;
            if (r.left < br.right && br.left < r.right && r.top < br.bottom && br.top < r.bottom) out.push((e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30));
          }
          return out;
        });
        for (const x of hits) failures.push(`${w}x${h}: bar overlaps "${x}"`);
        const box = await page.locator('[data-delete-selected]').boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(800);
          const deleted = await page.evaluate(() => !!document.querySelector('[data-undo-toast]') && !document.querySelector('[data-delete-selected]'));
          if (!deleted) failures.push(`${w}x${h}: a real click on Delete did not delete`);
        }
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
    assert.deepEqual(failures, []);
  },
);
