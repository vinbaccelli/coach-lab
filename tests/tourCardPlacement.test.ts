import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Guided tours: the card never covers the control a step asks the coach to use,
 * and every step shows an animated arrow.
 *
 * The engine imports react-dom, which cannot load under this suite's
 * `--conditions=react-server`, so the geometry is exercised in a child node
 * process (same TypeScript, normal conditions). The arrow rules are also
 * checked on the real tour data and the engine's source. A real-browser walk of
 * every tour is the opt-in last test (TOUR_E2E_URL).
 */

const ROOT = join(__dirname, '..');
const ENGINE = readFileSync(join(ROOT, 'components/GuidedTourEngine.tsx'), 'utf8');

/** Runs `body` (which may use M = the engine's exports) in a plain node process; returns its JSON. */
function inEngine<T>(body: string): T {
  const code = `
    import * as E from '@/components/GuidedTourEngine';
    import * as TT from '@/components/tours';
    const M = E.default ?? E;
    const T = TT.default ?? TT;
    const out = (() => { ${body} })();
    process.stdout.write('@@' + JSON.stringify(out));
  `;
  const stdout = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout.slice(stdout.lastIndexOf('@@') + 2)) as T;
}

const VIEWPORTS = [
  [360, 640],
  [390, 844],
  [844, 390],
  [768, 1024],
  [1280, 800],
  [320, 568],
  [414, 896],
  [896, 414],
];

test('placement: on a step that asks for something, the card never covers the target (any viewport, size, position)', () => {
  const res = inEngine<{ cases: number; infeasible: number; violations: string[] }>(`
    const vps = ${JSON.stringify(VIEWPORTS)};
    const cardHs = [150, 240, 330, 520];
    const sizes = [[44,44],[60,60],[120,40],[180,48],[300,60],[386,290],[250,520],[700,110]];
    const placements = [undefined,'top','bottom','left','right','center'];
    const advances = [{kind:'click'},{kind:'visible',selector:'x'},{kind:'signal',name:'n'},{kind:'next'}];
    const MARGIN = 12, PAD = 8, MIN_H = 120, MIN_W = 168;
    let cases = 0, infeasible = 0; const violations = [];
    for (const [vw, vh] of vps) for (const [tw, th] of sizes) for (const ch of cardHs)
      for (const placement of placements) for (const advance of advances) {
        // a coarse grid of positions, including partly off-screen controls
        for (let fx = 0; fx <= 4; fx++) for (let fy = 0; fy <= 4; fy++) {
          const target = { x: Math.round((vw - tw) * fx / 4), y: Math.round((vh - th) * fy / 4), w: tw, h: th };
          const step = { id: 's', title: 't', body: 'b', target: 'x', placement, advance };
          const W = Math.min(340, vw - 24);
          const p = M.resolveTooltipPos(target, { w: W, h: ch }, step, { w: vw, h: vh });
          const gap = advance.kind === 'next' ? 14 : 40;
          const t = { x: target.x - PAD, y: target.y - PAD, w: tw + PAD * 2, h: th + PAD * 2 };
          // Independent oracle: is there ANY free band of a usable size around the padded target?
          const room = { top: t.y - gap - MARGIN, bottom: vh - (t.y + t.h) - gap - MARGIN, left: t.x - gap - MARGIN, right: vw - (t.x + t.w) - gap - MARGIN };
          const feasible = Math.max(room.top, room.bottom) >= MIN_H || Math.max(room.left, room.right) >= MIN_W;
          cases++;
          const w = p.w ?? W, h = Math.min(ch, p.maxH ?? ch);
          const card = { x: p.x, y: p.y, w, h };
          const hit = card.x < t.x + t.w && t.x < card.x + card.w && card.y < t.y + t.h && t.y < card.y + card.h;
          const inside = card.x >= -0.5 && card.y >= -0.5 && card.x + card.w <= vw + 0.5 && card.y + card.h <= vh + 0.5;
          const label = vw + 'x' + vh + ' card ' + ch + ' target ' + JSON.stringify(target) + ' ' + advance.kind + ' ' + placement;
          if (!feasible) { infeasible++; if (!inside) violations.push('off-screen (target fills screen): ' + label); continue; }
          if (hit) violations.push('covers target: ' + label + ' card ' + JSON.stringify(card));
          else if (!inside) violations.push('off-screen: ' + label + ' card ' + JSON.stringify(card));
        }
      }
    return { cases, infeasible, violations: violations.slice(0, 20) };
  `);
  assert.ok(res.cases > 50_000, 'the sweep ran');
  assert.deepEqual(res.violations, [], `${res.violations.length}+ placements cover the target or leave the screen`);
});

test('placement: a step with a target is never centred over it (placement "center" is ignored when there is a target)', () => {
  const res = inEngine<{ covers: boolean }>(`
    const target = { x: 500, y: 300, w: 80, h: 60 };
    const step = { id: 's', title: 't', body: 'b', target: 'x', placement: 'center', advance: { kind: 'click' } };
    const p = M.resolveTooltipPos(target, { w: 340, h: 260 }, step, { w: 1280, h: 800 });
    const t = { x: 492, y: 292, w: 96, h: 76 };
    return { covers: p.x < t.x + t.w && t.x < p.x + 340 && p.y < t.y + t.h && t.y < p.y + 260 };
  `);
  assert.equal(res.covers, false);
});

test('arrow: toward a control / an area spot, it stays on screen, ends outside the target and has a real length', () => {
  const res = inEngine<{ n: number; bad: string[] }>(`
    const vps = ${JSON.stringify(VIEWPORTS)};
    const bad = []; let n = 0;
    for (const [vw, vh] of vps) {
      const vp = { w: vw, h: vh };
      for (const [tw, th] of [[44,44],[180,48],[386,290],[2,2]]) for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) {
        const target = { x: Math.round((vw - tw) * fx), y: Math.round((vh - th) * fy), w: tw, h: th };
        for (const card of [
          { x: 12, y: 12, w: Math.min(340, vw - 24), h: 160 },
          { x: 12, y: vh - 172, w: Math.min(340, vw - 24), h: 160 },
          { x: vw / 2 - 100, y: vh / 2 - 80, w: 200, h: 160 },
          { x: target.x, y: target.y, w: tw, h: th }, // card on top of the target: still an arrow
        ]) for (const gap of [14, 18]) {
          n++;
          const s = M.arrowToward(card, target, vp, gap);
          const label = vw + 'x' + vh + ' ' + JSON.stringify({ target, card, gap });
          if (!s) { bad.push('no arrow: ' + label); continue; }
          const pts = [[s.x1, s.y1], [s.x2, s.y2]];
          if (pts.some(([x, y]) => !(x >= 0 && x <= vw && y >= 0 && y <= vh))) bad.push('off-screen: ' + label + JSON.stringify(s));
          if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 12) bad.push('too short: ' + label + JSON.stringify(s));
          // the tip must not be inside the control it points at (unless the control fills the screen)
          const inTarget = s.x2 > target.x && s.x2 < target.x + target.w && s.y2 > target.y && s.y2 < target.y + target.h;
          const fills = target.w >= vw - 8 || target.h >= vh - 8;
          if (inTarget && !fills && tw > 2) bad.push('tip inside target: ' + label + JSON.stringify(s));
        }
      }
    }
    return { n, bad: bad.slice(0, 15) };
  `);
  assert.ok(res.n > 500);
  assert.deepEqual(res.bad, []);
});

test('arrow: every step of every tour gets one — target, area spot or the card\'s own button', () => {
  type Row = { tour: string; step: string; kind: string; advance: string; area: boolean; target: boolean; placement?: string; pointAt?: { x: number; y: number } };
  const rows = inEngine<Row[]>(`
    return T.ALL_TOURS.flatMap((tour) => tour.steps.map((step) => ({
      tour: tour.id, step: step.id, kind: M.arrowKind(step, { missing: false, reviewing: false }),
      advance: step.advance.kind, area: !!step.area, target: !!step.target, placement: step.placement, pointAt: step.pointAt,
    })));
  `);
  assert.ok(rows.length > 50, 'read the tours');
  const byKind: Record<string, number> = { target: 0, area: 0, next: 0 };
  for (const r of rows) {
    const id = `${r.tour}/${r.step}`;
    assert.notEqual(r.kind, 'none', `${id} has no arrow`);
    byKind[r.kind] += 1;
    if (r.advance === 'next') assert.equal(r.kind, 'next', `${id}: explanation steps point at Next`);
    else if (r.area) assert.equal(r.kind, 'area', id);
    else {
      assert.equal(r.kind, 'target', id);
      assert.ok(r.target, `${id}: a step that waits for the coach needs a target to point at`);
    }
    if (!r.target) assert.equal(r.advance, 'next', `${id}: an untargeted card ends on its own button`);
    if (r.pointAt) {
      assert.ok(r.area, `${id}: pointAt is for area steps`);
      assert.ok(r.pointAt.x >= 0 && r.pointAt.x <= 1 && r.pointAt.y >= 0 && r.pointAt.y <= 1, `${id}: pointAt is a fraction of the area`);
    }
    if (r.target && r.advance !== 'next' && !r.area) assert.notEqual(r.placement, 'center', `${id}: a click step is never placed centred`);
  }
  assert.ok(byKind.target > 0 && byKind.area > 0 && byKind.next > 0, JSON.stringify(byKind));
});

test('arrow: the engine renders it, animated, on every kind, still under reduced motion, and never catches taps', () => {
  assert.match(ENGINE, /data-tour-pointer-arrow=\{kind\}/, 'target / area arrow');
  assert.match(ENGINE, /data-tour-next-arrow=""/, 'arrow at the main button');
  assert.match(ENGINE, /animation: 'anglemotion-tour-nudge 1\.2s ease-in-out infinite'/);
  assert.match(ENGINE, /animation: 'anglemotion-tour-nudge-down 1\.2s ease-in-out infinite'/);
  assert.match(ENGINE, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.anglemotion-tour-anim \{ animation: none !important; \}/);
  // both arrow elements are inert and carry the animated class
  const arrowSvgs = ENGINE.match(/<svg[^>]*data-tour-(?:pointer|next)-arrow[\s\S]*?style=\{\{[\s\S]*?\}\}/g) ?? [];
  assert.equal(arrowSvgs.length, 2);
  for (const svg of arrowSvgs) assert.match(svg, /pointerEvents: 'none'/);
});

test('card: it is placed at once — no position transition that lets it slide across the control', () => {
  const card = ENGINE.slice(ENGINE.indexOf('data-tour-card={step.id}'), ENGINE.indexOf('data-tour-card={step.id}') + 1800);
  assert.doesNotMatch(card, /transition:\s*'(?:top|left)/, 'a sliding card crossed the target on a busy phone for a second');
});

test('arrow: area steps point at pointAt or the centre of the area', () => {
  const res = inEngine<{ c: { x: number; y: number }; p: { x: number; y: number }; bad: { x: number; y: number } }>(`
    const area = { x: 100, y: 50, w: 400, h: 200 };
    return { c: M.areaPoint(area), p: M.areaPoint(area, { x: 0.25, y: 0.75 }), bad: M.areaPoint(area, { x: 9, y: -3 }) };
  `);
  assert.deepEqual(res.c, { x: 300, y: 150 });
  assert.deepEqual(res.p, { x: 200, y: 200 });
  assert.deepEqual(res.bad, { x: 500, y: 50 }, 'clamped to the area');
});

test('opt-in browser walk: TOUR_E2E_URL=http://localhost:3000 npm test opens every analysis tour at five viewports', { skip: !process.env.TOUR_E2E_URL && 'set TOUR_E2E_URL to a running dev server (no Supabase env) to run the real-browser walk' }, async () => {
  // Not a project dependency: resolved at run time from the environment's Playwright
  // (run with NODE_PATH=$(npm root -g) or wherever Playwright is installed).
  const playwright = 'playwright';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { chromium } = require(playwright) as any; // NODE_PATH must point at the global modules
  const base = process.env.TOUR_E2E_URL!;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const failures: string[] = [];
  try {
    for (const [w, h] of [[360, 640], [390, 844], [844, 390], [768, 1024], [1280, 800]]) {
      for (const id of ['intro', 'draw', 'ruler']) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800, isMobile: w < 800 });
        const page = await ctx.newPage();
        await page.addInitScript((tourId: string) => {
          localStorage.setItem('anglemotion-tour-seen', '1');
          if (!sessionStorage.getItem('__started')) {
            sessionStorage.setItem('__started', '1');
            sessionStorage.setItem('anglemotion-tour-active', JSON.stringify({ id: tourId, step: 0 }));
          }
        }, id);
        await page.goto(`${base}/analysis`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
        await page.waitForTimeout(6000);
        const seen = new Set<string>();
        for (let i = 0; i < 40; i++) {
          const m = await page.evaluate(() => {
            const card = document.querySelector('[data-tour-card]');
            if (!card) return null;
            const ring = document.querySelector('[data-tour-pointer-ring]')?.getBoundingClientRect();
            const c = card.getBoundingClientRect();
            const tid = card.getAttribute('data-tour-target');
            // Same test the engine uses: a target that is not on screen (no clip loaded, panel closed) has nothing to point at.
            const targetOnScreen = [...(tid ? document.querySelectorAll(`[data-tour-id="${tid}"]`) : [])].some((e) => {
              const r = e.getBoundingClientRect();
              const cs = getComputedStyle(e);
              return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
            });
            return {
              id: card.getAttribute('data-tour-card')!,
              advance: card.getAttribute('data-tour-advance')!,
              hasTarget: !!tid,
              targetOnScreen,
              card: { x: c.left, y: c.top, w: c.width, h: c.height },
              spot: ring ? { x: ring.left + 3, y: ring.top + 3, w: ring.width - 6, h: ring.height - 6 } : null,
              arrow: document.querySelectorAll('[data-tour-pointer-arrow], [data-tour-next-arrow]').length,
            };
          });
          if (!m) break;
          await page.waitForTimeout(600);
          if (!seen.has(m.id)) {
            seen.add(m.id);
            const hit = m.spot && m.card.x < m.spot.x + m.spot.w && m.spot.x < m.card.x + m.card.w && m.card.y < m.spot.y + m.spot.h && m.spot.y < m.card.y + m.card.h;
            if (hit) failures.push(`${w}x${h} ${id}/${m.id}: card covers the target`);
            if (m.arrow < 1 && (!m.hasTarget || m.targetOnScreen || m.advance === 'next')) failures.push(`${w}x${h} ${id}/${m.id}: no arrow`);
          }
          await page.locator('[data-tour-card] button[aria-label="Skip this step"], [data-tour-card] button[aria-label="Next step"], [data-tour-card] button[aria-label="Finish tour"]').first().click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(300);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(failures, []);
});
