import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packMask, unpackMask, serializeDraft, hasCoachWork, matchFingerprint, hashBytes, persistedSizeBytes, type VideoFingerprint } from '../lib/stroMotionDraft/persist';

const fp: VideoFingerprint = { name: 'a.mp4', size: 1000, lastModified: 1, durationSec: 5, width: 1280, height: 720, sample: 'abcd1234' };

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
test('fingerprint: same video matches even if name/date change; other video is rejected with a reason', () => {
  assert.deepEqual(matchFingerprint(fp, { ...fp, name: 'copy (1).mp4', lastModified: 99 }), { ok: true });
  for (const [patch, re] of [[{ width: 640 }, /resolution/], [{ durationSec: 9 }, /length/], [{ size: 1 }, /size/], [{ sample: 'zz' }, /content/]] as const) {
    const v = matchFingerprint(fp, { ...fp, ...patch });
    assert.equal(v.ok, false); assert.match((v as { reason: string }).reason, re);
  }
});
test('hashBytes is deterministic and sensitive to a single byte', () => {
  const a = new Uint8Array([1, 2, 3, 4]), b = new Uint8Array([1, 2, 3, 5]);
  assert.equal(hashBytes(a), hashBytes(new Uint8Array(a))); assert.notEqual(hashBytes(a), hashBytes(b));
});
