import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureFirstFrame, tapHintVisible } from '@/lib/firstFrame';

const read = (p: string) => readFileSync(p, 'utf8');

// ── a minimal DOM: just what lib/firstFrame.ts touches ───────────────────────

class FakeVideo extends EventTarget {
  readyState = 1;
  networkState = 1;
  videoWidth = 720;
  videoHeight = 1280;
  currentTime = 0;
  paused = true;
  muted = true;
  error: null = null;
  duration = 15;
  seeking = false;
  ended = false;
  playbackRate = 1;
  seekable = { length: 0 } as unknown as TimeRanges;
  buffered = { length: 0 } as unknown as TimeRanges;
  /** iOS: a frame is decoded only by a play() that starts inside a tap. */
  gesture = false;
  decoded = false;
  currentSrc = 'blob:fake';
  getAttribute(name: string) { return name === 'src' ? 'blob:fake' : null; }
  play() {
    if (!this.gesture) return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
    this.decode();
    return Promise.resolve();
  }
  pause() { this.paused = true; }
  decode() { this.decoded = true; this.readyState = 2; }
}

function installDom() {
  const win = new EventTarget() as EventTarget & { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  (globalThis as Record<string, unknown>).window = win;
  let current: FakeVideo | null = null;
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(256).fill(current?.decoded ? 255 : 0) }),
      }),
    }),
  };
  return { setCurrent: (v: FakeVideo) => { current = v; } };
}

/** Runs the strategies on a never-played video until they give up and wait for a tap (S5). */
async function reachS5() {
  const dom = installDom();
  const video = new FakeVideo();
  dom.setCurrent(video);
  const panel = new EventTarget() as unknown as HTMLElement;
  const events: boolean[] = [];
  let frames = 0;
  const cancel = ensureFirstFrame(video as unknown as HTMLVideoElement, {
    slot: 'T',
    tapTarget: () => panel,
    debug: false,
    onFrame: () => { frames++; },
    onTapNeeded: (n) => events.push(n),
  });
  return { video, panel, events, frames: () => frames, cancel };
}
const until = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

// ── the pure rule ────────────────────────────────────────────────────────────

test('the hint shows only while a tap is awaited, never while loading, and never over the error or Tap to Play screens', () => {
  const base = { waitingForTap: true, hasVideo: true, loadError: false, tapToPlay: false };
  assert.equal(tapHintVisible(base), true);
  assert.equal(tapHintVisible({ ...base, waitingForTap: false }), false, 'loading, or a frame is showing');
  assert.equal(tapHintVisible({ ...base, hasVideo: false }), false);
  assert.equal(tapHintVisible({ ...base, loadError: true }), false);
  assert.equal(tapHintVisible({ ...base, tapToPlay: true }), false);
});

// ── the state, reported by the first-frame code ──────────────────────────────

test('S5: the hint state turns on once the strategies fail, and off as soon as the tap starts a frame', async () => {
  const t = await reachS5();
  // While the strategies are still running (a loading video) nothing is reported.
  assert.deepEqual(t.events, []);
  await until(() => t.events.length > 0);
  assert.deepEqual(t.events, [true], 'on exactly when S5 is armed');
  assert.equal(t.video.decoded, false, 'still no frame: that is the S5 state');

  // The tap: S5's own listener runs play() inside the gesture.
  t.video.gesture = true;
  t.panel.dispatchEvent(new Event('pointerdown'));
  assert.deepEqual(t.events, [true, false], 'off at the tap');
  await until(() => t.frames() === 1);
  assert.equal(t.video.decoded, true);
  assert.deepEqual(t.events, [true, false], 'nothing more is reported once the frame is there');
  t.cancel();
});

test('S5: the hint also goes when a frame arrives by another route, or the coach plays, or the load is cancelled', async () => {
  // another route: a seek paints a frame
  let t = await reachS5();
  await until(() => t.events.length > 0);
  t.video.decode();
  t.video.dispatchEvent(new Event('seeked'));
  assert.deepEqual(t.events, [true, false]);
  t.cancel();

  // the coach presses Play
  t = await reachS5();
  await until(() => t.events.length > 0);
  t.video.paused = false;
  t.video.dispatchEvent(new Event('playing'));
  assert.deepEqual(t.events, [true, false]);
  t.cancel();

  // a new source cancels this load
  t = await reachS5();
  await until(() => t.events.length > 0);
  t.cancel();
  assert.deepEqual(t.events, [true, false]);
});

test('no hint at all when a frame decodes by itself (desktop, or S1 works)', async () => {
  const dom = installDom();
  const video = new FakeVideo();
  video.decode();
  dom.setCurrent(video);
  const events: boolean[] = [];
  let frames = 0;
  const cancel = ensureFirstFrame(video as unknown as HTMLVideoElement, {
    slot: 'T', tapTarget: () => new EventTarget() as unknown as HTMLElement, debug: false, onFrame: () => { frames++; }, onTapNeeded: (n) => events.push(n),
  });
  await until(() => frames === 1);
  assert.deepEqual(events, [], 'never shown');
  cancel();
});

// ── wiring and layout (phone portrait and landscape) ─────────────────────────

test('wiring: the page shows the hint from the S5 state, in the video panel, and the strategies are untouched', () => {
  const page = read('app/analysis/page.tsx');
  assert.ok(page.includes('onTapNeeded: setFirstFrameTapNeededA'));
  assert.match(page, /tapHintVisible\(\{ waitingForTap: firstFrameTapNeededA, hasVideo: !!videoSrc, loadError: !!videoLoadErrorA, tapToPlay: showTapToPlay \}\)/);
  assert.ok(page.includes('<FirstFrameTapHint insetLeft={panelToolbarInset} />'));
  // Same panel as the S5 tap target (`video.parentElement`): the hint sits next to the load-error overlay.
  assert.ok(page.indexOf('<FirstFrameTapHint') > page.indexOf('{videoLoadErrorA ? ('));
  assert.ok(page.includes('tapTarget: () => video.parentElement'));

  const ff = read('lib/firstFrame.ts');
  // The strategies are exactly as before: S1 seek, S4 prime and the S5 retry still read the same.
  for (const needle of ["log('S1 seek 0.001')", "log('S4 prime')", "log('S5 tap: retry S1 + S4 in the gesture')", 'await prime(v, log, started, wasMuted)']) {
    assert.ok(ff.includes(needle), needle);
  }
});

test('layout: a 44 px pill that starts after the toolbar rail and takes no touches outside itself (390x844 and 844x390)', () => {
  const src = read('components/FirstFrameTapHint.tsx');
  assert.ok(src.includes('minHeight: 44') && src.includes('minWidth: 44'));
  assert.ok(src.includes("pointerEvents: 'none'"), 'the wrapper is transparent to touches');
  assert.ok(src.includes("pointerEvents: 'auto'"), 'only the pill takes touches');
  assert.ok(src.includes('left: insetLeft'), 'starts after the toolbar rail');
  assert.ok(src.includes("maxWidth: 'min(100%, 300px)'"), 'fits 390 px wide and never grows to a full-screen layer');
  assert.ok(src.includes('zIndex: 120'), 'below the error and Tap to Play layers (130)');
  assert.ok(src.includes('Tap the video to show it'));
});
