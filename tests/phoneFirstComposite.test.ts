import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { upscaleAlphaMask } from '@/lib/stroMotionDraft/phoneBudget';
import {
  PhoneFirstComposite, upscaleAlphaMaskSliced, clearMarkerWhenFirstLayersDrawn,
  FIRST_LAYERS_DRAWN_EVENT, OPENING_EDITOR_FAILSAFE_MS,
} from '@/lib/stroMotionDraft/phoneFinalize';

// ── sliced upscale ──────────────────────────────────────────────────────────

function randomMask(w: number, h: number, seed: number) {
  let s = seed;
  const data = new Uint8ClampedArray(w * h);
  for (let i = 0; i < data.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; data[i] = s >>> 24; }
  return { width: w, height: h, data };
}

test('sliced upscale is byte-identical to the one-pass upscale', async () => {
  for (const [sw, sh, dw, dh] of [[7, 5, 20, 11], [64, 36, 192, 108], [33, 17, 100, 51], [1, 1, 9, 9]]) {
    const m = randomMask(sw, sh, sw * 31 + sh);
    const one = upscaleAlphaMask(m, dw, dh);
    const sliced = await upscaleAlphaMaskSliced(m, dw, dh, { budgetMs: 3, now: (() => { let t = 0; return () => t++; })(), yieldFn: async () => {} });
    assert.equal(sliced.width, one.width);
    assert.equal(sliced.height, one.height);
    assert.deepEqual(Array.from(sliced.data), Array.from(one.data));
  }
});

test('sliced upscale: same size returns the mask itself', async () => {
  const m = randomMask(8, 8, 1);
  assert.equal(await upscaleAlphaMaskSliced(m, 8, 8), m);
});

test('sliced upscale yields, and no slice runs past the budget plus one row', async () => {
  const m = randomMask(16, 9, 5);
  let clock = 0;
  const now = () => clock;
  // Each row "costs" 1 unit; the clock is advanced by the work loop via now() calls.
  let yields = 0;
  let longest = 0;
  let sliceStart = 0;
  const budget = 10;
  // now() is called once per row after the row's work: advance 1 unit per call.
  const ticking = () => { clock += 1; return now(); };
  const out = await upscaleAlphaMaskSliced(m, 160, 90, {
    budgetMs: budget,
    now: ticking,
    yieldFn: async () => { yields++; longest = Math.max(longest, clock - sliceStart); sliceStart = clock; },
  });
  assert.equal(out.height, 90);
  assert.ok(yields >= 80 / budget - 1, `expected several yields, got ${yields}`);
  assert.ok(longest <= budget + 1, `slice ${longest} exceeded budget ${budget}+1`);
});

// ── crash marker timing ─────────────────────────────────────────────────────

test('marker is held until the first layers are drawn, then cleared once', () => {
  const target = new EventTarget();
  let cleared = 0;
  const timers: { cb: (() => void) | null } = { cb: null };
  clearMarkerWhenFirstLayersDrawn(() => { cleared++; }, target as never, 1000, {
    set: (cb) => { timers.cb = cb; return 1; }, clear: () => { timers.cb = null; },
  });
  assert.equal(cleared, 0, 'not cleared by the commit itself');
  target.dispatchEvent(new Event(FIRST_LAYERS_DRAWN_EVENT));
  assert.equal(cleared, 1);
  target.dispatchEvent(new Event(FIRST_LAYERS_DRAWN_EVENT));
  assert.equal(cleared, 1, 'only once');
  assert.equal(timers.cb, null, 'failsafe cancelled');
});

test('marker failsafe releases it if the layers are never drawn', () => {
  const target = new EventTarget();
  let cleared = 0;
  let fire: (() => void) | null = null;
  let ms = 0;
  clearMarkerWhenFirstLayersDrawn(() => { cleared++; }, target as never, OPENING_EDITOR_FAILSAFE_MS, {
    set: (cb, t) => { fire = cb; ms = t; return 1; }, clear: () => {},
  });
  assert.equal(ms, OPENING_EDITOR_FAILSAFE_MS);
  assert.equal(cleared, 0);
  fire!();
  assert.equal(cleared, 1);
  target.dispatchEvent(new Event(FIRST_LAYERS_DRAWN_EVENT));
  assert.equal(cleared, 1);
});

test('the returned function clears at once', () => {
  const target = new EventTarget();
  let cleared = 0;
  const now = clearMarkerWhenFirstLayersDrawn(() => { cleared++; }, target as never, 1000, { set: () => 1, clear: () => {} });
  now();
  assert.equal(cleared, 1);
});

// ── first composite, one layer per frame ────────────────────────────────────

type Call = { overlayMode: boolean | undefined; passed: number[] };

function fakeCtx(w = 100, h = 60, t = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) {
  const ops: string[] = [];
  const ctx = {
    canvas: { width: w, height: h },
    getTransform: () => t,
    setTransform: () => { ops.push('setTransform'); },
    save: () => { ops.push('save'); }, restore: () => { ops.push('restore'); },
    drawImage: () => { ops.push('drawImage'); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

function fixture(nFrames = 4) {
  const frames = Array.from({ length: nFrames }, (_, i) => ({ index: i, sourceFrame: {} as ImageBitmap, working: { width: 1, height: 1, data: new Uint8ClampedArray([255]) } }));
  const draft = { frames } as never;
  const calls: Call[] = [];
  let offscreens = 0;
  let opening = 0, drawn = 0;
  const pc = new PhoneFirstComposite({
    render: (_ctx, d, o) => {
      const passed: number[] = [];
      for (const f of (d as { frames: { index: number }[] }).frames) if (o.resolveMask?.(f as never)) passed.push(f.index);
      calls.push({ overlayMode: o.overlayMode, passed });
    },
    createOffscreen: (w, h) => { offscreens++; const c = fakeCtx(w, h); return { canvas: c.ctx.canvas, ctx: c.ctx }; },
    pickMask: (f) => (f as never as { working: never }).working,
    announceOpening: () => { opening++; },
    announceDrawn: () => { drawn++; },
  });
  return { draft, calls, pc, count: () => ({ offscreens, opening, drawn }) };
}

const opts = (over: Record<string, unknown> = {}) => ({ dest: { x: 0, y: 0, w: 100, h: 60 }, visibleCount: 4, ...over }) as never;

test('first composite: background first, then one layer per call in ascending index order', () => {
  const { draft, calls, pc, count } = fixture();
  const { ctx } = fakeCtx();
  let requested = 0;
  const run = () => pc.draw(ctx, draft, opts(), () => { requested++; });
  assert.equal(run(), true);
  assert.deepEqual(calls[0], { overlayMode: false, passed: [] }, 'background plate only');
  for (let i = 0; i < 4; i++) assert.equal(run(), true);
  assert.deepEqual(calls.slice(1).map((c) => c.passed), [[0], [1], [2], [3]]);
  assert.ok(calls.slice(1).every((c) => c.overlayMode === true));
  assert.equal(calls.length, 5, 'exactly 1 + layers calls');
  assert.equal(requested, 4, 'asks for another frame until complete');
  assert.deepEqual(count(), { offscreens: 1, opening: 1, drawn: 1 });
  // finished: reused with no more drawing
  assert.equal(run(), true);
  assert.equal(calls.length, 5);
});

test('reverse order and visible window follow the one-pass paint order', () => {
  const { draft, calls, pc } = fixture(4);
  const { ctx } = fakeCtx();
  const o = opts({ videoOrder: 'reverse', visibleStart: 1, visibleCount: 3 });
  for (let i = 0; i < 6; i++) pc.draw(ctx, draft, o, () => {});
  // reversed = [3,2,1,0]; slice(1,3) = [2,1]; painted ascending = [1,2]
  assert.deepEqual(calls.slice(1).map((c) => c.passed), [[1], [2]]);
});

test('overlay mode is never built progressively', () => {
  const { draft, calls, pc, count } = fixture();
  const { ctx } = fakeCtx();
  assert.equal(pc.draw(ctx, draft, opts({ overlayMode: true }), () => {}), false);
  assert.equal(calls.length, 0);
  assert.deepEqual(count(), { offscreens: 0, opening: 0, drawn: 0 });
});

test('options changing mid-build hands back to the original one-pass call', () => {
  const { draft, pc, count } = fixture();
  const { ctx } = fakeCtx();
  assert.equal(pc.draw(ctx, draft, opts(), () => {}), true);
  assert.equal(pc.draw(ctx, draft, opts({ opacity: 0.3, fadeMode: 'uniform' }), () => {}), false);
  assert.equal(count().drawn, 1, 'the notice is released');
  // and it does not start over for the same draft
  assert.equal(pc.draw(ctx, draft, opts(), () => {}), false);
});

test('after it finishes, a change goes back to the original call; a new draft builds again', () => {
  const { draft, pc } = fixture();
  const { ctx } = fakeCtx();
  for (let i = 0; i < 5; i++) pc.draw(ctx, draft, opts(), () => {});
  assert.equal(pc.draw(ctx, draft, opts({ visibleCount: 2 }), () => {}), false);
  const next = { frames: (draft as { frames: unknown[] }).frames.map((f) => ({ ...(f as object) })) } as never;
  assert.equal(pc.draw(ctx, next, opts(), () => {}), true);
});

test('a zoom or pan change (different transform) is not served from the cache', () => {
  const { draft, pc } = fixture();
  const a = fakeCtx();
  for (let i = 0; i < 5; i++) pc.draw(a.ctx, draft, opts(), () => {});
  const b = fakeCtx(100, 60, { a: 2, b: 0, c: 0, d: 2, e: -50, f: -30 });
  assert.equal(pc.draw(b.ctx, draft, opts(), () => {}), false);
});

// ── wiring (source) ─────────────────────────────────────────────────────────

test('Canvas: the progressive path is gated by the phone check and falls back to the original call', () => {
  const src = readFileSync('components/Canvas.tsx', 'utf8');
  assert.match(src, /isPhoneBudgetActive\(\) && \(phoneFirstCompositeRef/);
  assert.match(src, /renderStroMotionDraftComposite\(ctx, stroDraft, stroCompositeOptions\)/);
});

test('hook: desktop returns the inner pass unchanged; the phone marker waits for the layers', () => {
  const src = readFileSync('hooks/useStroMotion.ts', 'utf8');
  assert.match(src, /if \(!phone\) return autoProcessFramesInner\(specs, onProgress, false\);/);
  assert.match(src, /clearMarkerWhenFirstLayersDrawn\(markAutoDetectFinished\)/);
  assert.match(src, /if \(!held\) markAutoDetectFinished\(\)/);
});

test('finalize announces first and slices the upscale', () => {
  const src = readFileSync('lib/stroMotionDraft/phoneFinalize.ts', 'utf8');
  assert.ok(src.indexOf('announceOpeningEditor();') < src.indexOf('captureVideoFrameAtTime(video, t)'));
  assert.match(src, /await upscaleAlphaMaskSliced\(b\.aiSnapshot/);
  assert.doesNotMatch(src, /[^a-zA-Z]upscaleAlphaMask\(b\./);
});
