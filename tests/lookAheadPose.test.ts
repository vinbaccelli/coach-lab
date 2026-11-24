import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AheadBuffer, leadSeconds, driftAction, type AheadKp } from '../lib/lookAheadPose';

const P = (x: number, y = 0, score = 0.9): AheadKp[] => [{ name: 'right_wrist', x, y, score }];

test('lookup interpolates by VIDEO time between neighbours', () => {
  const b = new AheadBuffer();
  b.push(1.0, P(100)); b.push(1.1, P(200));
  assert.equal(Math.round(b.lookup(1.05)![0].x), 150);
  assert.equal(b.lookup(1.0)![0].x, 100);
});

test('results may arrive out of order and a repeated time replaces', () => {
  const b = new AheadBuffer();
  b.push(1.2, P(300)); b.push(1.0, P(100)); b.push(1.1, P(200)); b.push(1.1, P(250));
  assert.equal(b.size, 3);
  assert.equal(Math.round(b.lookup(1.15)![0].x), 275);
});

test('no result close enough ⇒ null (caller falls back); newest held only briefly', () => {
  const b = new AheadBuffer();
  assert.equal(b.lookup(1), null);
  b.push(1.0, P(100)); b.push(1.1, P(200));
  assert.equal(b.lookup(1.1 + 0.1)![0].x, 200, 'held ≤ 120 ms');
  assert.equal(b.lookup(1.1 + 0.5), null, 'not extrapolated');
  assert.equal(b.lookup(0.5), null, 'before anything we know');
});

test('large gaps are not interpolated across', () => {
  const b = new AheadBuffer();
  b.push(1.0, P(100)); b.push(2.0, P(900));
  assert.equal(b.lookup(1.5), null);
  assert.equal(b.lookup(1.1)![0].x, 100, 'snaps to the near sample inside 250 ms');
});

test('prune keeps one sample at/behind the cut and bounds memory', () => {
  const b = new AheadBuffer();
  for (let i = 0; i < 400; i++) b.push(i * 0.05, P(i));
  assert.ok(b.size <= 240);
  b.prune(100);
  assert.ok(b.size >= 1 && b.size < 240);
});

test('interpolation keeps min score and matches joints by name', () => {
  const b = new AheadBuffer();
  b.push(0, [{ name: 'a', x: 0, y: 0, score: 0.9 }, { name: 'b', x: 0, y: 0, score: 0.9 }]);
  b.push(0.2, [{ name: 'b', x: 10, y: 0, score: 0.4 }, { name: 'a', x: 20, y: 0, score: 0.9 }]);
  const r = b.lookup(0.1)!;
  assert.equal(r.find((k) => k.name === 'a')!.x, 10);
  assert.equal(r.find((k) => k.name === 'b')!.x, 5);
  assert.equal(r.find((k) => k.name === 'b')!.score, 0.4);
});

test('lead = one round trip + margin in VIDEO seconds, scaled by speed and bounded', () => {
  assert.ok(Math.abs(leadSeconds(100, 1) - 0.14) < 1e-9);
  assert.ok(Math.abs(leadSeconds(100, 0.25) - 0.035) < 0.01 || leadSeconds(100, 0.25) === 0.04);
  assert.equal(leadSeconds(5000, 1), 0.8);
  assert.equal(leadSeconds(0, 0.05), 0.04);
});

test('drift: on target ⇒ main rate; small error ⇒ bounded nudge; big error ⇒ seek', () => {
  assert.deepEqual(driftAction(11.14, 11.0, 0.14, 1), { kind: 'rate', rate: 1 });
  const slow = driftAction(11.04, 11.0, 0.14, 1) as { kind: 'rate'; rate: number }; // 100 ms behind target
  assert.ok(slow.rate > 1 && slow.rate <= 1.1);
  const fast = driftAction(11.30, 11.0, 0.14, 1) as { kind: 'rate'; rate: number }; // too far ahead
  assert.ok(fast.rate < 1 && fast.rate >= 0.9);
  assert.deepEqual(driftAction(15, 11, 0.14, 1), { kind: 'seek', to: 11.14 });
  const slowMo = driftAction(11.0 + 0.035, 11.0, 0.035, 0.25) as { kind: 'rate'; rate: number };
  assert.equal(slowMo.rate, 0.25);
});
