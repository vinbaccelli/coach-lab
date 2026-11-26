import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packMask, unpackMask, serializeDraft, hasCoachWork, matchFingerprint, averageHash, hammingHex, persistedSizeBytes, type VideoFingerprint } from '../lib/stroMotionDraft/persist';

const grid = (f: (i: number) => number) => Array.from({ length: 256 }, (_, i) => f(i));
const SIG = [0, 1, 2, 3, 4].map((k) => averageHash(grid((i) => ((i * 7 + k * 13) % 11) * 20))).join('');
const fp: VideoFingerprint = { name: 'a.mp4', size: 1000, lastModified: 1, durationSec: 5, width: 1280, height: 720, sig: SIG };

test('mask RLE round-trips exactly, including soft edges, and compresses a typical mask', () => {
  const w = 64, h = 48, data = new Uint8ClampedArray(w * h);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 40; x++) data[y * w + x] = 255;
  data[10 * w + 10] = 128; data[11 * w + 10] = 7;
  const p = packMask({ width: w, height: h, data });
  const back = unpackMask(p)!;
  assert.deepEqual(Array.from(back.data), Array.from(data));
  assert.ok(p.runs.length < data.length / 4);
});
test('all-zero and all-255 masks round-trip; a corrupt record returns null', () => {
  for (const v of [0, 255]) {
    const m = { width: 10, height: 10, data: new Uint8ClampedArray(100).fill(v) };
    assert.deepEqual(Array.from(unpackMask(packMask(m))!.data), Array.from(m.data));
  }
  const p = packMask({ width: 10, height: 10, data: new Uint8ClampedArray(100) });
  assert.equal(unpackMask({ ...p, width: 11 }), null);
  assert.equal(unpackMask({ ...p, runs: p.runs.slice(0, 3) }), null);
});
test('serializeDraft keeps coach work, drops nothing editable, and hasCoachWork gates the offer', () => {
  const m = { width: 4, height: 4, data: new Uint8ClampedArray(16).fill(255) };
  const draft = { objectType: 'racket' as const, backgroundTimeSec: 1, sampleTimes: [1, 2], batchUnitFloorNorm: 0.04,
    frames: [
      { index: 0, timeSec: 1, label: 'A', status: 'ready' as const, selectionBox: { x: 0, y: 0, width: 1, height: 1 }, aiSnapshot: m, working: m, readyMask: m },
      { index: 1, timeSec: 2, label: 'B', status: 'pending' as const, selectionBox: null, aiSnapshot: null, working: null, readyMask: null },
    ] };
  const p = serializeDraft(draft, { fingerprint: fp, startSec: 1, endSec: 2, frameCount: 2, background: 'start', now: 5 });
  assert.equal(p.frames[0].status, 'ready'); assert.equal(p.settings.batchUnitFloorNorm, 0.04);
  assert.ok(hasCoachWork(p)); assert.ok(persistedSizeBytes(p) > 0);
  assert.equal(hasCoachWork({ ...p, frames: [p.frames[1]] }), false);
});
test('fingerprint: an iOS re-export (different bytes/size/name/date, tiny duration drift, a few flipped bits) still matches', () => {
  const flipped = SIG.slice(0, 5) + (SIG[5] === 'f' ? '0' : 'f') + SIG.slice(6); // a handful of bits differ
  assert.deepEqual(matchFingerprint(fp, { ...fp, name: 'UUID.mov', size: 6_200_000, lastModified: 99, durationSec: 5.12, sig: flipped }), { ok: true });
});
test('fingerprint: other resolution, length or picture is rejected with a readable reason', () => {
  const other = [0, 1, 2, 3, 4].map((k) => averageHash(grid((i) => ((i * 5 + k * 3) % 13) * 19))).join('');
  for (const [patch, re] of [[{ width: 640 }, /resolution/], [{ durationSec: 9 }, /length/], [{ sig: other }, /picture content/]] as const) {
    const v = matchFingerprint(fp, { ...fp, ...patch });
    assert.equal(v.ok, false); assert.match((v as { reason: string }).reason, re);
  }
});
test('fingerprint: without a signature it falls back to exact file size', () => {
  assert.deepEqual(matchFingerprint({ ...fp, sig: '' }, { ...fp, sig: '' }), { ok: true });
  assert.equal(matchFingerprint({ ...fp, sig: '' }, { ...fp, sig: '', size: 5 }).ok, false);
});
test('averageHash / hammingHex are deterministic and sensitive', () => {
  const a = grid((i) => i % 2 ? 200 : 10), b = grid((i) => i % 3 ? 200 : 10);
  assert.equal(averageHash(a), averageHash([...a]));
  assert.equal(averageHash(a).length, 64);
  assert.equal(hammingHex(averageHash(a), averageHash(a)), 0);
  assert.ok(hammingHex(averageHash(a), averageHash(b)) > 0);
  assert.equal(hammingHex('ff', 'f'), Number.POSITIVE_INFINITY);
});
