import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { restoreAt } from '@/lib/metrics/deleteSelected';

/*
 * Undo after deleting the selected snapshot must bring back everything the coach had: the newest
 * drawings, column and pose (which live on the canvas until the snapshot is next saved), and the
 * selection itself. Found when an independent test saw Undo not bring the snapshot back.
 */

const PAGE = readFileSync(join(__dirname, '..', 'app/analysis/page.tsx'), 'utf8');

function body(start: string, end: string): string {
  const a = PAGE.indexOf(start);
  assert.ok(a >= 0, `found ${start}`);
  const b = PAGE.indexOf(end, a);
  assert.ok(b > a, `found ${end}`);
  return PAGE.slice(a, b);
}

test('delete: the active snapshot is captured from the canvas before it is removed, so Undo restores the newest edits', () => {
  const del = body('const deleteSelected = useCallback', 'const undoDelete = useCallback');
  const snapBranch = del.slice(del.indexOf('if (activeSnapshot)'));
  for (const read of ['exportStrokes', 'getOverlayAdjustments', 'getSkeletonKeypoints', 'measurementColumnRef.current', 'showMeasurementOverlaysStateRef.current']) {
    assert.ok(snapBranch.includes(read), `reads ${read}`);
  }
  assert.ok(snapBranch.indexOf('exportStrokes') < snapBranch.indexOf('deleteSnapshot(activeSnapshot.id)'), 'captured BEFORE the delete clears the canvas');
  assert.match(snapBranch, /wasActive:/);
});

test('undo: a restored snapshot that was selected is selected again with its drawings, column, overlays, pose and frame', () => {
  const undo = body('const undoDelete = useCallback', 'Why the export outcome needs');
  for (const step of ['setBiomechSelectedPhaseId(snap.id)', 'setMeasurementColumn(', 'setShowMeasurementOverlays(snap.overlaysOn)', 'importStrokes?.(snap.drawingsJson', 'setOverlayAdjustments?.(', "setSkeletonKeypoints?.(snap.skeleton ?? null, 'snapshot')", 'currentTime = snap.timeSec']) {
    assert.ok(undo.includes(step), `restores ${step}`);
  }
  // does not steal the selection if the coach picked another snapshot meanwhile
  assert.match(undo, /d\.wasActive && !biomechSelectedPhaseIdRef\.current/);
});

test('restoreAt: the snapshot returns to its old place in the order; a second delete and Undo give the same list', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  const list = [a, b, c];
  const without = list.filter((x) => x.id !== 'b');
  assert.deepEqual(restoreAt(without, b, 1), list);
  const again = restoreAt(without, b, 1).filter((x) => x.id !== 'b');
  assert.deepEqual(restoreAt(again, b, 1), list);
  assert.deepEqual(restoreAt(list, b, 1), list, 'never duplicates');
});

test(
  'opt-in browser check: UNDO_E2E_URL=http://localhost:3000 UNDO_E2E_CLIP=/path/clip.webm — a stroke drawn on a snapshot comes back after delete and Undo, at 1150x722 and 390x844',
  { skip: !(process.env.UNDO_E2E_URL && process.env.UNDO_E2E_CLIP) && 'needs a running build (no Supabase env), a VP9/WebM clip and Playwright (NODE_PATH)' },
  async () => {
    const playwright = 'playwright';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { chromium } = require(playwright) as any;
    const base = process.env.UNDO_E2E_URL!;
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const failures: string[] = [];
    try {
      const page0 = await (await browser.newContext()).newPage();
      await page0.goto('about:blank');
      for (const [w, h] of [[1150, 722], [390, 844]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800, isMobile: w < 800 });
        const page = await ctx.newPage();
        await page.addInitScript(() => localStorage.setItem('anglemotion-tour-seen', '1'));
        await page.goto(`${base}/analysis`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
        await page.waitForTimeout(6000);
        await (await page.$('input[type=file]')).setInputFiles(process.env.UNDO_E2E_CLIP!);
        await page.waitForTimeout(5000);
        const tap = async (sel: string) => { await page.locator(sel).first().click({ timeout: 5000 }); await page.waitForTimeout(900); };
        await tap('[data-tour-id="row-met-h"]');
        await tap('[data-tour-id="row-m-snapshot"]');
        await page.waitForTimeout(7000);
        const marker = async () => (await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Fit' && b.getBoundingClientRect().width > 0)));
        const cv = await page.locator('[data-tour-id="tour-canvas"]').first().boundingBox();
        const clip = { x: Math.round(cv.x + cv.width * 0.5), y: Math.round(cv.y + cv.height * 0.2), width: Math.round(cv.width * 0.45), height: Math.round(cv.height * 0.5) };
        const snap = async () => (await page.screenshot({ clip })).toString('base64');
        // Passed as source text: tsx's helper wrappers do not exist inside the page.
        const DIFF_SRC = `async ([x, y]) => {
          const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
          const [A, B] = await Promise.all([load(x), load(y)]);
          const px = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
          const da = px(A), db = px(B);
          let n = 0;
          for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) n++;
          return n;
        }`;
        const changed = async (a: string, b2: string): Promise<number> => page0.evaluate(`(${DIFF_SRC})(${JSON.stringify([a, b2])})`);
        const baseShot = await snap();
        await tap('[data-tour-id="row-m-draw"]');
        await tap('[data-tour-id="row-pen"]');
        const sx = clip.x + clip.width * 0.2, sy = clip.y + clip.height * 0.3;
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        for (let i = 1; i <= 20; i++) await page.mouse.move(sx + i * clip.width * 0.03, sy + Math.sin(i / 3) * 40);
        await page.mouse.up();
        await page.waitForTimeout(800);
        const drawn = await changed(baseShot, await snap());
        if (drawn < 200) { failures.push(`${w}x${h}: the test could not draw (${drawn} px)`); await ctx.close(); continue; }
        const clickBar = async (sel: string) => { const bx = await page.locator(sel).first().boundingBox(); await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.waitForTimeout(1200); };
        for (const round of [1, 2]) {
          await clickBar('[data-delete-selected]');
          if (await marker()) failures.push(`${w}x${h} round ${round}: Fit still shown after delete`);
          await clickBar('[data-undo-toast] button');
          if (!(await marker())) failures.push(`${w}x${h} round ${round}: Fit not back after Undo`);
          if (!(await page.locator('[data-delete-selected]').count())) failures.push(`${w}x${h} round ${round}: snapshot not selected again after Undo`);
          const back = await changed(baseShot, await snap());
          if (back < drawn * 0.5) failures.push(`${w}x${h} round ${round}: the drawing did not come back (${back} px vs ${drawn} px before)`);
        }
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
    assert.deepEqual(failures, []);
  },
);
