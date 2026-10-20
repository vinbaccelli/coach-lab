import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureFirstFrame, firstFrameLog, firstFrameLogLines, firstFrameState, ignoreLoadError, srcKind } from '@/lib/firstFrame';

test('error safety net: ignored only after a strategy touched a video that had loaded metadata', () => {
  assert.equal(ignoreLoadError({ touched: true, reachedMetadata: true }), true);
  // The file never loaded (readyState never reached 1): main's error is shown.
  assert.equal(ignoreLoadError({ touched: true, reachedMetadata: false }), false);
  // Nothing of ours ran: main's error is shown.
  assert.equal(ignoreLoadError({ touched: false, reachedMetadata: true }), false);
  assert.equal(ignoreLoadError(null), false);
});

test('src kind for the diagnostic', () => {
  assert.equal(srcKind('blob:https://x/1'), 'blob');
  assert.equal(srcKind('blob:https://x/1#t=0.001'), 'blob#frag');
  assert.equal(srcKind('/api/video-proxy?u=1'), 'stream');
  assert.equal(srcKind(null), 'none');
});

/** A <video> stand-in that records every write that could restart or change a load. */
class FakeVideo extends EventTarget {
  readyState = 0;
  error: { code: number } | null = null;
  paused = true;
  muted = true;
  videoWidth = 0;
  videoHeight = 0;
  networkState = 1;
  currentSrc = 'blob:https://x/1';
  parentElement = null;
  writes: string[] = [];
  private t = 0;
  get currentTime() { return this.t; }
  set currentTime(v: number) { this.t = v; setTimeout(() => this.dispatchEvent(new Event('seeked')), 5); }
  set src(v: string) { this.writes.push(`src=${v}`); }
  get src() { return this.currentSrc; }
  set preload(v: string) { this.writes.push(`preload=${v}`); }
  get preload() { return 'auto'; }
  load() { this.writes.push('load()'); }
  setAttribute(n: string, v: string) { this.writes.push(`setAttribute(${n},${v})`); }
  removeAttribute(n: string) { this.writes.push(`removeAttribute(${n})`); }
  getAttribute(n: string) { return n === 'src' ? this.currentSrc : null; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

test('ensureFirstFrame never changes the src, preload or load; does nothing before metadata; restores muted', async () => {
  const g = globalThis as unknown as { window?: unknown };
  const hadWindow = 'window' in g;
  g.window = { setTimeout, addEventListener: () => {}, removeEventListener: () => {} };
  try {
    const v = new FakeVideo();
    v.muted = false;
    const cancel = ensureFirstFrame(v as unknown as HTMLVideoElement, { slot: 'A', tapTarget: () => null, debug: false });
    await new Promise((r) => setTimeout(r, 50));
    // No metadata yet: nothing touched.
    assert.equal(v.currentTime, 0);
    assert.equal(firstFrameState(v as unknown as HTMLVideoElement)?.touched, false);
    // Metadata arrives: S1 seek, then S4 prime (no frame in this fake), then waits for a tap.
    v.readyState = 1;
    v.dispatchEvent(new Event('loadedmetadata'));
    await new Promise((r) => setTimeout(r, 1500));
    const st = firstFrameState(v as unknown as HTMLVideoElement)!;
    assert.equal(st.touched, true);
    assert.equal(st.reachedMetadata, true);
    assert.equal(v.currentTime, 0.001);
    assert.equal(v.paused, true);
    assert.equal(v.muted, false, 'muted restored');
    assert.deepEqual(v.writes, [], 'no src / preload / load() / attribute writes');
    cancel();
  } finally {
    if (!hadWindow) delete g.window;
  }
});

test('ensureFirstFrame leaves a video that errored alone', async () => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = { setTimeout, addEventListener: () => {}, removeEventListener: () => {} };
  try {
    const v = new FakeVideo();
    v.readyState = 1;
    v.error = { code: 4 };
    const cancel = ensureFirstFrame(v as unknown as HTMLVideoElement, { slot: 'A', tapTarget: () => null, debug: false });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(v.currentTime, 0);
    assert.equal(firstFrameState(v as unknown as HTMLVideoElement)?.touched, false);
    cancel();
  } finally {
    delete g.window;
  }
});

test('the analysis videos set src exactly once, to the raw URL (as on main)', () => {
  const page = readFileSync(new URL('../app/analysis/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('src={videoSrc ?? undefined}'), 'slot A video src is the raw state');
  assert.ok(page.includes('src={videoSrcB ?? undefined}'), 'slot B video src is the raw state');
  assert.ok(!/#t=0\.001/.test(page), 'no media fragment appended anywhere');
  assert.ok(!page.includes('withFirstFrameFragment'), 'fragment helper gone');
});

test('vdebug log: per-seek lines never push out the export analysis lines', () => {
  firstFrameLog('analysis', 'start 0.050–3.950 s');
  for (let k = 0; k < 500; k++) firstFrameLog('main', `event seeked #${k}`);
  firstFrameLog('analysis', 'analysis end');
  const lines = firstFrameLogLines();
  const analysis = lines.filter((l) => l.slot === 'analysis').map((l) => l.text);
  assert.deepEqual(analysis.slice(-2), ['start 0.050–3.950 s', 'analysis end']);
  assert.equal(lines.filter((l) => l.slot !== 'analysis').length, 80);
  assert.equal(lines.at(-1)?.text, 'analysis end'); // still in time order
  // The analysis lines have their own cap.
  for (let k = 0; k < 100; k++) firstFrameLog('analysis', `seek #${k}`);
  assert.equal(firstFrameLogLines().filter((l) => l.slot === 'analysis').length, 60);
});
