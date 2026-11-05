import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SEEK_CAP_MS, SEEK_FRAME_FALLBACK_MS, waitForSeek, type SeekWaitVideo } from '../lib/seekWait';

/** A fake <video>: `seekAfter` = ms until 'seeked' fires for a seek (null = never); `frameAfter` = ms after 'seeked' until the frame callback (null = never; undefined = no rVFC). */
function fakeVideo(opts: { seekAfter: number | null; frameAfter?: number | null; seekingAtStart?: boolean }) {
  const listeners = new Set<() => void>();
  let seeking = !!opts.seekingAtStart;
  const issued: number[] = [];
  const fireSeeked = () => { seeking = false; [...listeners].forEach((fn) => fn()); };
  const v = {
    currentTime: 0,
    get seeking() { return seeking; },
    addEventListener: (_t: 'seeked', fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_t: 'seeked', fn: () => void) => { listeners.delete(fn); },
    requestVideoFrameCallback: opts.frameAfter === undefined ? undefined : (cb: () => void) => {
      if (opts.frameAfter !== null) setTimeout(cb, opts.frameAfter);
      return 1;
    },
  } as SeekWaitVideo & { currentTime: number };
  let ct = 0;
  Object.defineProperty(v, 'currentTime', {
    get: () => ct,
    set: (t: number) => {
      ct = t; issued.push(t); seeking = true;
      if (opts.seekAfter !== null) setTimeout(fireSeeked, opts.seekAfter);
    },
  });
  return { v, issued, fireSeeked };
}

/** The wait exactly as it was before this change (page.tsx seekTo): 'seeked' → one frame callback, 300 ms from the seek as the safety net. */
function oldSeekTo(vv: SeekWaitVideo, t: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (Math.abs(vv.currentTime - t) < 0.0005 && !vv.seeking) { resolve(); return; }
    let done = false;
    const fin = () => { if (!done) { done = true; vv.removeEventListener('seeked', onSeeked); resolve(); } };
    const rvfc = vv.requestVideoFrameCallback;
    const onSeeked = () => { if (rvfc) rvfc.call(vv, () => fin()); else fin(); };
    vv.addEventListener('seeked', onSeeked, { once: true });
    vv.currentTime = t;
    setTimeout(fin, 300);
  });
}

/** Virtual ms (ticks of 1 ms) after which `p` has resolved. */
async function timeOf(t: { tick: (n: number) => void }, p: Promise<unknown>, limit = 6000): Promise<number | null> {
  let resolved = false;
  void p.then(() => { resolved = true; });
  for (let elapsed = 1; elapsed <= limit; elapsed++) {
    t.tick(1);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    if (resolved) return elapsed;
  }
  return null;
}

const cases: Array<{ name: string; seekAfter: number; frameAfter: number | null | undefined }> = [
  { name: 'seeked 20 ms, frame 5 ms later', seekAfter: 20, frameAfter: 5 },
  { name: 'seeked 120 ms, frame 40 ms later', seekAfter: 120, frameAfter: 40 },
  { name: 'seeked 20 ms, frame callback never comes', seekAfter: 20, frameAfter: null },
  { name: 'seeked 250 ms, frame callback never comes', seekAfter: 250, frameAfter: null },
  { name: 'no requestVideoFrameCallback, seeked 60 ms', seekAfter: 60, frameAfter: undefined },
];

for (const c of cases) {
  test(`fast path timing is unchanged: ${c.name}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const a = fakeVideo({ seekAfter: c.seekAfter, frameAfter: c.frameAfter });
    const b = fakeVideo({ seekAfter: c.seekAfter, frameAfter: c.frameAfter });
    const oldAt = await timeOf(t.mock.timers, oldSeekTo(a.v, 1.5));
    const newRun = waitForSeek(b.v, 1.5);
    const newAt = await timeOf(t.mock.timers, newRun);
    assert.notEqual(oldAt, null);
    assert.equal(newAt, oldAt, 'same moment as the old wait');
    assert.equal((await newRun).stalled, false);
    assert.deepEqual(b.issued, [1.5]);
  });
}

test('already on the requested time: returns at once without seeking', async () => {
  const f = fakeVideo({ seekAfter: 10 });
  f.v.currentTime = 2; f.fireSeeked(); f.issued.length = 0;
  const r = await waitForSeek(f.v, 2);
  assert.equal(r.stalled, false);
  assert.deepEqual(f.issued, []);
});

test('a slow seek (1.2 s) is waited for, not cut at 300 ms', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fakeVideo({ seekAfter: 1200, frameAfter: 10 });
  const p = waitForSeek(f.v, 3);
  const at = await timeOf(t.mock.timers, p);
  assert.equal(at, 1210);
  assert.equal((await p).stalled, false);
});

test('a slow seek whose frame callback never comes ends 300 ms after seeked', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fakeVideo({ seekAfter: 2000, frameAfter: null });
  const p = waitForSeek(f.v, 3);
  assert.equal(await timeOf(t.mock.timers, p), 2000 + SEEK_FRAME_FALLBACK_MS);
});

test('a seek that never completes stalls at the cap', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fakeVideo({ seekAfter: null, frameAfter: 5 });
  const p = waitForSeek(f.v, 3);
  assert.equal(await timeOf(t.mock.timers, p), SEEK_CAP_MS);
  assert.equal((await p).stalled, true);
});

test('a seek still pending is finished before the next one is issued', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fakeVideo({ seekAfter: 100, frameAfter: 5, seekingAtStart: true });
  const p = waitForSeek(f.v, 4);
  t.mock.timers.tick(50);
  await Promise.resolve();
  assert.deepEqual(f.issued, [], 'no second seek while one is pending');
  f.fireSeeked(); // the pending one completes
  assert.deepEqual(f.issued, [4]);
  const at = await timeOf(t.mock.timers, p);
  assert.ok(at !== null && at <= 120);
  assert.equal((await p).stalled, false);
});

test('a pending seek that never completes stalls without issuing a new seek', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fakeVideo({ seekAfter: null, seekingAtStart: true });
  const p = waitForSeek(f.v, 4);
  assert.equal(await timeOf(t.mock.timers, p), SEEK_CAP_MS);
  assert.equal((await p).stalled, true);
  assert.deepEqual(f.issued, []);
});
