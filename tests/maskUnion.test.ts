import test from 'node:test';
import assert from 'node:assert/strict';
import { unionMasks } from '../lib/stroMotionDraft/maskUnion';

const m = (d: number[]) => ({ width: 2, height: 2, data: new Uint8ClampedArray(d) });

test('the union keeps what the earlier click selected and adds the new area', () => {
  const u = unionMasks(m([255, 0, 0, 0]), m([0, 255, 0, 128]));
  assert.deepEqual([...u.data], [255, 255, 0, 128]);
});

test('no earlier mask, or a different size: the new mask as it is', () => {
  const n = m([1, 2, 3, 4]);
  assert.equal(unionMasks(null, n), n);
  assert.equal(unionMasks({ width: 3, height: 1, data: new Uint8ClampedArray(3) }, n), n);
});
