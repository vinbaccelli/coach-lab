import test from 'node:test';
import assert from 'node:assert/strict';
import { dataColumnHit } from '../lib/drawingTools';

const col = { x: 200, y: 50, w: 150, h: 120 };

test('with body on, a press anywhere on the column grabs it (like the webcam picture)', () => {
  const o = { headerH: 26, touch: false, selected: false, body: true };
  assert.equal(dataColumnHit({ x: 260, y: 140 }, col, o), 'body', 'a row, far below the 26 px header');
  assert.equal(dataColumnHit({ x: 260, y: 60 }, col, o), 'header', 'the header still reports header');
  assert.equal(dataColumnHit({ x: 199, y: 140 }, col, o), null, 'just left of the column');
  assert.equal(dataColumnHit({ x: 260, y: 171 }, col, o), null, 'just below the column');
});

test('the resize corner still wins over the body while the column is selected', () => {
  const o = { headerH: 26, touch: true, selected: true, body: true };
  assert.equal(dataColumnHit({ x: 350, y: 170 }, col, o), 'resize');
  assert.equal(dataColumnHit({ x: 300, y: 120 }, col, o), 'body');
});

test('without the body option nothing changes: a press below the header grabs nothing', () => {
  const o = { headerH: 26, touch: false, selected: false };
  assert.equal(dataColumnHit({ x: 260, y: 140 }, col, o), null);
});
