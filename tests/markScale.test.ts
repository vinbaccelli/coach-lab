import test from 'node:test';
import assert from 'node:assert/strict';
import { constantSizeContext, getMarkScale, setMarkScale } from '../lib/markScale';
import { ARROW_HEAD, arrowHeadGeometry, arrowHeadLength } from '../lib/drawingTools';

class FakeCtx {
  lineWidth = 1;
  dash: number[] = [];
  fillStyle = '#000';
  setLineDash(d: number[]) { this.dash = d; }
  save() { return 'saved'; }
}

test('line width and dashes are scaled by the counter-zoom, other state is untouched', () => {
  const raw = new FakeCtx();
  const c = constantSizeContext(raw, 1 / 2.2);
  c.lineWidth = 3;
  c.setLineDash([3, 10]);
  c.fillStyle = '#fff';
  assert.ok(Math.abs(raw.lineWidth - 3 / 2.2) < 1e-9, 'a 3 px line is 3 px on screen at 220 %');
  assert.deepEqual(raw.dash.map((v) => +(v * 2.2).toFixed(6)), [3, 10]);
  assert.equal(raw.fillStyle, '#fff');
  assert.equal(c.save(), 'saved', 'methods still work');
});

test('zoom 1 (and exports) get the real context back', () => {
  const raw = new FakeCtx();
  assert.equal(constantSizeContext(raw, 1), raw);
  assert.equal(constantSizeContext(raw, NaN), raw);
});

test('mark scale holder resets and rejects bad values', () => {
  setMarkScale(0.5); assert.equal(getMarkScale(), 0.5);
  setMarkScale(0); assert.equal(getMarkScale(), 1);
  setMarkScale(1);
});

test('arrow head: still wider than its line for every thickness 1-12, and smaller than before for a thin line', () => {
  for (let lw = 1; lw <= 12; lw++) {
    for (const { min, per } of [ARROW_HEAD.arrow, ARROW_HEAD.swing]) {
      const g = arrowHeadGeometry({ x: 0, y: 0 }, { x: 300, y: 40 }, arrowHeadLength(lw, min, per))!;
      assert.ok(Math.hypot(g.left.x - g.right.x, g.left.y - g.right.y) / 2 > lw / 2, `lw ${lw}`);
    }
  }
  assert.ok(arrowHeadLength(1, ARROW_HEAD.arrow.min, ARROW_HEAD.arrow.per) < 14);
  assert.ok(arrowHeadLength(1, ARROW_HEAD.swing.min, ARROW_HEAD.swing.per) < 12);
});
