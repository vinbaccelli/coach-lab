import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_TRACK_USE_LOCK, MAX_TRACK_POSES, followStep, gateRadius, lockForPass, matchAtLock, passPlan,
  poseBox, splitAtGaps, startFollow, inSection, type LockTarget, type TrackKp,
} from '@/lib/aiTrackLock';

const FRAME = { w: 1920, h: 1080 };
/** A standing body: 6 confident joints spanning a box centred on (cx, cy), h tall. */
function body(cx: number, cy: number, h = 400, score = 0.9): TrackKp[] {
  const w = h * 0.35;
  return [
    { x: cx, y: cy - h / 2, score, name: 'nose' },
    { x: cx - w / 2, y: cy - h / 4, score, name: 'left_shoulder' },
    { x: cx + w / 2, y: cy - h / 4, score, name: 'right_shoulder' },
    { x: cx - w / 3, y: cy + h / 8, score, name: 'left_hip' },
    { x: cx + w / 3, y: cy + h / 8, score, name: 'right_hip' },
    { x: cx - w / 3, y: cy + h / 2, score, name: 'left_ankle' },
    { x: cx + w / 3, y: cy + h / 2, score, name: 'right_ankle' },
  ];
}
const NEAR = body(500, 600, 420, 0.6); // the locked player (less confident)
const FAR = body(1400, 500, 300, 0.99); // the other player (more confident)

test('switch and lock presence decide the path: no lock → null → today\'s pass', () => {
  assert.equal(AI_TRACK_USE_LOCK, true);
  assert.ok(MAX_TRACK_POSES >= 2);
  const target: LockTarget = { t: 1, point: { x: 0.26, y: 0.55 }, box: null, kps: null };
  assert.equal(lockForPass(true, true, target), target);
  assert.equal(lockForPass(false, true, target), null, 'switch off → exactly as before');
  assert.equal(lockForPass(true, false, target), null, 'not locked → as before');
  assert.equal(lockForPass(true, true, null), null, 'nothing stored → as before');
  assert.equal(lockForPass(true, true, { t: 1, point: null, box: null, kps: null }), null);
});

test('lock frame: the clicked player wins even when another is more confident', () => {
  const lock: LockTarget = { t: 2, point: { x: 500 / 1920, y: 600 / 1080 }, box: null, kps: null };
  assert.equal(matchAtLock([FAR, NEAR], lock, FRAME), 1);
  assert.equal(matchAtLock([NEAR, FAR], lock, FRAME), 0);
});

test('lock frame without a click ("Yes ✓"): the shown skeleton\'s box decides', () => {
  const lock: LockTarget = { t: 2, point: null, box: poseBox(body(510, 605, 410)), kps: null };
  assert.equal(matchAtLock([FAR, NEAR], lock, FRAME), 1);
});

test('"Yes ✓" when only the head of the shown skeleton was confident: still the right player', () => {
  // Measured: the live pose at "Yes ✓" had a 17×34 px box (head only).
  const head = { x0: 490, y0: 390, x1: 510, y1: 420 };
  const lock: LockTarget = { t: 2, point: null, box: head, kps: null };
  assert.equal(matchAtLock([FAR, NEAR], lock, FRAME), 1);
  // A box straddling both players (a merged single-person pose) matches nobody.
  assert.equal(matchAtLock([FAR, NEAR], { ...lock, box: { x0: 400, y0: 300, x1: 1500, y1: 800 } }, FRAME), -1);
});

test('lock frame: the locked player missing → -1 (the pass stops, never picks someone else)', () => {
  const clickOnEmpty: LockTarget = { t: 2, point: { x: 0.05, y: 0.1 }, box: null, kps: null };
  assert.equal(matchAtLock([FAR, NEAR], clickOnEmpty, FRAME), -1);
  const boxGone: LockTarget = { t: 2, point: null, box: poseBox(body(500, 600, 420)), kps: null };
  assert.equal(matchAtLock([FAR], boxGone, FRAME), -1);
  assert.equal(matchAtLock([], boxGone, FRAME), -1);
});

test('following: continues from the previous box, never the most confident person', () => {
  let s = startFollow(poseBox(NEAR)!, 2);
  for (let k = 1; k <= 10; k++) {
    const me = body(500 + k * 12, 600, 420, 0.5);
    const r = followStep(s, [FAR, me], 2 + k / 30);
    assert.equal(r.index, 1, `frame ${k}`);
    s = r.state;
  }
  // The other player walking past nearby but at a clearly different size is not taken.
  const decoy = body(640, 600, 250, 0.99);
  assert.equal(followStep(s, [decoy], s.lastSeenT + 1 / 30).index, -1);
});

test('player leaves the frame: gap frames return -1 and keep the last sighting', () => {
  const s = startFollow(poseBox(NEAR)!, 2);
  const r = followStep(s, [FAR], 2.1);
  assert.equal(r.index, -1);
  assert.deepEqual({ box: r.state.box, lastSeenT: r.state.lastSeenT }, { box: s.box, lastSeenT: s.lastSeenT }, 'last sighting kept during a gap');
});

test('re-entry: accepted only near the last position, with the radius growing over time', () => {
  const s = startFollow(poseBox(NEAR)!, 2);
  const back = body(500 + 900, 600, 420); // re-enters 900 px away
  assert.ok(gateRadius(s, 2.1) < 900, 'too far right after leaving');
  assert.equal(followStep(s, [back], 2.1).index, -1);
  assert.ok(gateRadius(s, 3.5) >= 900, 'search area has grown');
  assert.equal(followStep(s, [back], 3.5).index, 0);
  // Same place, wrong body size (a smaller, farther player): still rejected.
  assert.equal(followStep(s, [body(1400, 600, 250)], 3.5).index, -1);
  // Radius growth is capped.
  assert.equal(gateRadius(s, 100), gateRadius(s, 1000));
});

test('the other player, visible while ours is out of view, is never adopted', () => {
  // Two players of the SAME size (same distance from camera). Ours leaves; the
  // other stays in view and keeps moving. Ours comes back two seconds later.
  const other0 = body(1000, 600, 420);
  let s = startFollow(poseBox(NEAR)!, 0, [poseBox(other0)!]);
  for (let k = 1; k <= 60; k++) {
    const t = k / 30;
    const other = body(1000 - k * 3, 600, 420); // drifts toward where ours was
    const r = followStep(s, [other], t);
    assert.equal(r.index, -1, `t=${t.toFixed(2)}: the other player was taken`);
    s = r.state;
  }
  assert.ok(gateRadius(s, 2) > 500, 'search area has grown past the other player');
  const back = body(470, 600, 410);
  const r = followStep(s, [body(820, 600, 420), back], 2 + 1 / 30);
  assert.equal(r.index, 1, 'ours is re-acquired, the other is not');
});

test('pass plan: starts at the lock frame, walks forward to the end and back to the start', () => {
  const p = passPlan(0, 1, 0.5, 0.25);
  assert.deepEqual(p.forward, [0.75, 1]);
  assert.deepEqual(p.backward, [0.25, 0]);
  // Lock on the start frame: everything is forward.
  assert.deepEqual(passPlan(0, 0.5, 0, 0.25), { forward: [0.25, 0.5], backward: [] });
  // Lock AFTER the section: walk back through it; frames past the end are tracked, not recorded.
  const after = passPlan(1, 2, 2.5, 0.25);
  assert.deepEqual(after.forward, []);
  assert.deepEqual(after.backward, [2.25, 2, 1.75, 1.5, 1.25, 1]);
  assert.deepEqual(after.backward.filter((t) => inSection(t, 1, 2)), [2, 1.75, 1.5, 1.25, 1]);
  // Lock BEFORE the section.
  assert.deepEqual(passPlan(1, 1.5, 0.5, 0.25).forward, [0.75, 1, 1.25, 1.5]);
});

test('gaps stay gaps: samples split where the player was out of view', () => {
  const s = [0, 0.03, 0.06, 0.6, 0.63, 2, 2.03].map((t) => ({ t }));
  assert.deepEqual(splitAtGaps(s, 0.25).map((g) => g.map((x) => x.t)), [[0, 0.03, 0.06], [0.6, 0.63], [2, 2.03]]);
  assert.deepEqual(splitAtGaps([], 0.25), []);
});

test('poseBox ignores low-confidence joints and needs a body', () => {
  assert.equal(poseBox(body(0, 0, 100, 0.1)), null);
  assert.deepEqual(poseBox([{ x: 1, y: 1, score: 1 }, { x: 3, y: 5, score: 1 }, { x: 2, y: 2, score: 1 }, { x: 9, y: 9, score: 0.1 }, { x: 0, y: 4, score: 1 }]), { x0: 0, y0: 1, x1: 3, y1: 5 });
});
