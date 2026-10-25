import test from 'node:test';
import assert from 'node:assert/strict';
import {
  frameTimeMoved, pixelsDiffer, probeFrames, probeTimes, probeVerdict, type ProbeDeps, type SeekResult,
} from '../lib/frameProbe';

const px = (n: number) => new Array(16).fill(n);

/** Fake video: `pic(t)` is the picture shown after seeking to t, `shown(t)` the presented frame time. */
function fake(opts: {
  pic: (t: number, calls: number) => number[] | null;
  shown?: (t: number, calls: number) => number | null;
  seeked?: (calls: number) => boolean;
  primeFixes?: boolean;
  hasRvfc?: boolean;
  abortAfterSeeks?: number;
}) {
  const log: string[] = [];
  let calls = 0;
  let cur = 0;
  let primed = false;
  const deps: ProbeDeps = {
    async seek(t) {
      calls++;
      cur = t;
      const dead = !(primed && opts.primeFixes);
      const r: SeekResult = {
        seeked: opts.seeked ? opts.seeked(calls) : true,
        presented: dead && opts.shown === undefined ? t : (opts.shown ? opts.shown(t, calls) : t),
        hasRvfc: opts.hasRvfc ?? true,
        ms: 5,
      };
      return r;
    },
    sample: () => opts.pic(cur, primed && opts.primeFixes ? -1 : calls),
    async prime() { primed = true; return 'muted play/pause done'; },
    log: (l) => log.push(l),
    aborted: () => opts.abortAfterSeeks !== undefined && calls >= opts.abortAfterSeeks,
  };
  return { deps, log, primedRef: () => primed };
}

const live = (t: number) => px(Math.round(t * 100));

test('healthy video: ok, no prime, logs every signal and the label', async () => {
  const f = fake({ pic: live });
  const r = await probeFrames(f.deps, 2, 8, 'strategy=S1 720x404');
  assert.deepEqual(r, { ok: true, primed: false, aborted: false, slowMs: null, tooSlow: false });
  const text = f.log.join('\n');
  assert.match(text, /strategy=S1 720x404/);
  assert.match(text, /seeked fired=yes/);
  assert.match(text, /frame time moved=yes/);
  assert.match(text, /pixels changed=yes/);
  assert.match(text, /result: ok, primed=no/);
});

test('dead video that a prime fixes: ok after prime', async () => {
  const f = fake({
    pic: (t, calls) => (calls === -1 ? live(t) : px(7)),
    shown: (t, calls) => (calls > 3 ? t : 0.04),
    primeFixes: true,
  });
  const r = await probeFrames(f.deps, 0, 10, 'strategy=S4 1920x1080');
  assert.equal(r.ok, true);
  assert.equal(r.primed, true);
  assert.match(f.log.join('\n'), /attempt 1:.*DEAD/);
  assert.match(f.log.join('\n'), /result: ok after prime, primed=yes/);
});

test('dead after the prime: not ok, says so', async () => {
  const f = fake({ pic: () => px(7), shown: () => 0.04 });
  const r = await probeFrames(f.deps, 0, 10, 'strategy=S5 720x1280');
  assert.deepEqual(r, { ok: false, primed: true, aborted: false, slowMs: null, tooSlow: false });
  assert.match(f.log.join('\n'), /DEAD after prime: no pass, no track/);
  assert.match(f.log.join('\n'), /strategy=S5 720x1280/);
});

test('still scene: same picture at B but different a second later is ok', async () => {
  const f = fake({ pic: (t) => (t > 0.5 ? px(90) : px(10)), shown: (t) => t });
  const r = await probeFrames(f.deps, 0, 10, 'x');
  assert.equal(r.ok, true);
  assert.equal(r.primed, false);
  assert.match(f.log.join('\n'), /again at/);
});

test('unreadable pixels with seeked and frame time ok: ok', async () => {
  const f = fake({ pic: () => null });
  assert.equal((await probeFrames(f.deps, 0, 10, 'x')).ok, true);
  assert.match(f.log.join('\n'), /pixels changed=n\/a/);
});

test('no requestVideoFrameCallback: frame time n/a, pixels decide', async () => {
  const f = fake({ pic: live, hasRvfc: false });
  assert.equal((await probeFrames(f.deps, 0, 10, 'x')).ok, true);
  assert.match(f.log.join('\n'), /frame time moved=n\/a/);
  const g = fake({ pic: () => px(3), hasRvfc: false });
  assert.equal((await probeFrames(g.deps, 0, 10, 'x')).ok, false);
});

test('seeked never fires: dead', async () => {
  const f = fake({ pic: live, seeked: () => false });
  const r = await probeFrames(f.deps, 0, 10, 'x');
  assert.equal(r.ok, false);
  assert.match(f.log.join('\n'), /seeked fired=NO/);
});

test('abort stops the probe without a verdict', async () => {
  const f = fake({ pic: live, abortAfterSeeks: 1 });
  const r = await probeFrames(f.deps, 0, 10, 'x');
  assert.equal(r.aborted, true);
  assert.equal(r.ok, false);
});

test('probeTimes stays inside a short range', () => {
  const { a, b, c } = probeTimes(1, 1.3);
  assert.ok(a >= 1 && a < b && b <= c && c <= 1.3 + 1e-9);
  assert.deepEqual(probeTimes(0, 10), { a: 0.04, b: 0.29, c: 1.04 });
});

test('frameTimeMoved / pixelsDiffer / probeVerdict', () => {
  assert.equal(frameTimeMoved(false, 1, 1, 0.25), null);
  assert.equal(frameTimeMoved(true, null, 1, 0.25), false);
  assert.equal(frameTimeMoved(true, 0.04, 0.04, 0.25), false);
  assert.equal(frameTimeMoved(true, 0.04, 0.29, 0.25), true);
  assert.equal(pixelsDiffer(null, px(1)), null);
  assert.equal(pixelsDiffer(px(1), px(1)), false);
  assert.equal(pixelsDiffer(px(1), px(9)), true);
  assert.equal(probeVerdict(true, null, null), true);
  assert.equal(probeVerdict(false, true, true), false);
  assert.equal(probeVerdict(true, false, true), false);
  assert.equal(probeVerdict(true, true, false), false);
});

test('the "cannot analyze" message shows as a closable error', async () => {
  const { statusKind } = await import('../lib/statusToast');
  const { PROBE_DEAD_TEXT } = await import('../lib/frameProbe');
  assert.equal(statusKind(PROBE_DEAD_TEXT), 'error');
});

import { SEEK_STALL_TEXT, seekClass, slowEstimateSec, slowNoteText } from '../lib/frameProbe';

test('seek latency classes: fast < 300 ms ≤ slow ≤ 4 s < too slow; no seeked = dead', () => {
  assert.equal(seekClass(true, 40), 'fast');
  assert.equal(seekClass(true, 300), 'slow');
  assert.equal(seekClass(true, 4000), 'slow');
  assert.equal(seekClass(true, 4001), 'too slow');
  assert.equal(seekClass(false, 5000), 'dead');
});

test('a slow but working clip passes the probe with its latency, and logs it', async () => {
  const slow = (t: number) => px(Math.round(t * 100));
  const log: string[] = [];
  let cur = 0;
  const deps: ProbeDeps = {
    async seek(t) { cur = t; return { seeked: true, presented: t, hasRvfc: true, ms: 1800 }; },
    sample: () => slow(cur),
    async prime() { return 'x'; },
    log: (l) => log.push(l),
    aborted: () => false,
  };
  const r = await probeFrames(deps, 0, 10, 'strategy=S4 720x1280');
  assert.equal(r.ok, true);
  assert.equal(r.primed, false);
  assert.equal(r.slowMs, 1800);
  assert.match(log.join('\n'), /1800 ms: slow/);
  assert.match(log.join('\n'), /slow: 1800 ms per seek/);
});

test('a fast clip reports no slow note', async () => {
  const f = fake({ pic: live });
  const r = await probeFrames(f.deps, 0, 10, 'x');
  assert.equal(r.slowMs, null);
  assert.equal(r.tooSlow, false);
});

test('seeks that complete only after the pass cap are not ok (too slow), with a clear log', async () => {
  let cur = 0;
  const log: string[] = [];
  const deps: ProbeDeps = {
    async seek(t) { cur = t; return { seeked: true, presented: t, hasRvfc: true, ms: 4500 }; },
    sample: () => live(cur),
    async prime() { return 'x'; },
    log: (l) => log.push(l),
    aborted: () => false,
  };
  const r = await probeFrames(deps, 0, 10, 'x');
  assert.equal(r.ok, false);
  assert.equal(r.tooSlow, true);
  assert.match(log.join('\n'), /4500 ms: too slow/);
});

test('slow estimate and the one-line note', async () => {
  // 20 s at 30 fps = 600 frames × (1000 + 500) ms = 900 s.
  assert.equal(slowEstimateSec(1000, 20, 30), 900);
  assert.equal(slowNoteText(90), 'This video seeks slowly: analysis may take about 90 s…');
  assert.equal(slowNoteText(900), 'This video seeks slowly: analysis may take about 15 min…');
  const { statusKind } = await import('../lib/statusToast');
  assert.equal(statusKind(slowNoteText(90)), 'progress');
  assert.equal(statusKind(SEEK_STALL_TEXT), 'error');
});
