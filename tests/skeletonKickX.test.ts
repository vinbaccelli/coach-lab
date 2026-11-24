// Regression: the serve kick-back showed the shins in an X (a knee joined to the OTHER leg's ankle)
// when the clip had normal frames first. Pose read off a user export (frame ~2.3 s of the serve).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrack } from '../lib/skeletonValidate';

type Pts = Record<string, [number, number]>;
const stand: Pts = { left_shoulder: [170, 72], right_shoulder: [237, 57], left_elbow: [183, 123], left_wrist: [205, 158], left_hip: [258, 163], right_hip: [303, 143], left_knee: [250, 260], right_knee: [300, 250], left_ankle: [240, 380], right_ankle: [300, 385] };
// Detector labels at the kick: each knee sits on one leg, each ankle on the other.
const kick: Pts = { ...stand, left_knee: [362, 193], right_knee: [237, 262], left_ankle: [230, 390], right_ankle: [418, 252] };
const sample = (t: number, p: Pts) => ({ t, kps: Object.entries(p).map(([name, [x, y]]) => ({ name, x, y, score: 0.9 })) });
const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test('after a normal stance, the kick-back legs are not left in an X', () => {
  const track = [...Array.from({ length: 20 }, (_, i) => sample(i / 30, stand)), ...Array.from({ length: 10 }, (_, i) => sample((20 + i) / 30, kick))];
  const out = validateTrack(track).samples;
  for (const s of out.slice(21)) {
    const k = (n: string) => s.kps.find((q) => q.name === n)!;
    for (const side of ['left', 'right']) {
      const own = d(k(`${side}_knee`), k(`${side}_ankle`));
      const other = d(k(`${side}_knee`), k(`${side === 'left' ? 'right' : 'left'}_ankle`));
      assert.ok(own < other, `${side} knee is joined to its own ankle (${Math.round(own)} vs ${Math.round(other)})`);
    }
  }
});
