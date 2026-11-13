import test from 'node:test';
import assert from 'node:assert/strict';
import { moveItem, applyManualOrder, parseOrder } from '../lib/players/reorder';

test('moveItem moves down, up, and ignores no-ops', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveItem(['a', 'b'], 1, 1), ['a', 'b']);
  assert.deepEqual(moveItem(['a', 'b'], 0, 5), ['a', 'b']);
});

test('applyManualOrder: no order keeps date order', () => {
  const items = [{ key: 'x' }, { key: 'y' }];
  assert.deepEqual(applyManualOrder(items, null), items);
  assert.deepEqual(applyManualOrder(items, []), items);
});

test('applyManualOrder: saved order wins, new items stay on top, stale keys ignored', () => {
  const items = [{ key: 'new' }, { key: 'a' }, { key: 'b' }, { key: 'c' }];
  const out = applyManualOrder(items, ['gone', 'c', 'a', 'b']).map((i) => i.key);
  assert.deepEqual(out, ['new', 'c', 'a', 'b']);
});

test('parseOrder rejects non-arrays and drops bad entries', () => {
  assert.equal(parseOrder('x'), null);
  assert.deepEqual(parseOrder(['a', 3, '', 'b']), ['a', 'b']);
});
