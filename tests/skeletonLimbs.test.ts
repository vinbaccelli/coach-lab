// Within-frame limb assignment (lib/skeletonValidate.ts step 0, KNOWN_ISSUES 081): genuine crossing is
// never "repaired". Corrected fixtures: the shins really cross, the folded forearms really point at the
// other elbow, bone lengths are kept, and the track must come back unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrack } from '../lib/skeletonValidate';
import { compareToTruth, type Seq } from '../lib/skeletonBench/metrics';
import { synthSwing, toTrackSamples, fromTrackSamples } from '../lib/skeletonBench/synthetic';

const truth = (kind: 'forehand' | 'lateral', fps = 60) => synthSwing({ kind, frames: Math.round(1.5 * fps), fps }) as Seq;
const run = (s: Seq, fps = 60) => validateTrack(toTrackSamples(s, fps));
const back = (r: ReturnType<typeof run>) => fromTrackSamples(r.samples);
type Pt = { x: number; y: number };
const orient = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const shinsCross = (p: Seq[number]) => {
  if (!p) return false;
  const [a, b, c, d] = [p.left_knee, p.left_ankle, p.right_knee, p.right_ankle];
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
};
const wideStance = (t: Seq): Seq => t.map((p) => {
  if (!p) return p;
  const q = JSON.parse(JSON.stringify(p)) as NonNullable<typeof p>;
  const BH = 600, cx = (p.left_hip.x + p.right_hip.x) / 2, hy = (p.left_hip.y + p.right_hip.y) / 2;
  for (const [side, s] of [['left', -1], ['right', 1]] as const) {
    q[`${side}_hip`].x = cx + s * 0.09 * BH; q[`${side}_hip`].y = hy;
    q[`${side}_knee`].x = cx + s * 0.25 * BH; q[`${side}_knee`].y = hy + 0.27 * BH;
    q[`${side}_ankle`].x = cx + s * 0.375 * BH; q[`${side}_ankle`].y = hy + 0.64 * BH;
  }
  return q;
}) as Seq;

test('a crossover step (shins really cross, bone lengths kept) is left exactly as detected', () => {
  const legs = wideStance(truth('lateral')).map((p) => {
    if (!p) return p;
    const q = JSON.parse(JSON.stringify(p)) as NonNullable<typeof p>;
    for (const [side, other] of [['left', 'right'], ['right', 'left']] as const) {
      const kn = q[`${side}_knee`], an = q[`${side}_ankle`], target = q[`${other}_knee`].x;
      const vx = an.x - kn.x, vy = an.y - kn.y, th = (80 * Math.PI) / 180;
      const rot = (a: number) => ({ x: kn.x + vx * Math.cos(a) - vy * Math.sin(a), y: kn.y + vx * Math.sin(a) + vy * Math.cos(a) });
      const best = [th, -th].map(rot).sort((m, n) => Math.abs(m.x - target) - Math.abs(n.x - target))[0];
      an.x = best.x; an.y = best.y;
    }
    return q;
  }) as Seq;
  assert.equal(legs.filter(shinsCross).length, legs.length, 'the fixture crosses the shins on every frame');
  const r = run(legs);
  assert.equal(r.report.swapsFixed, 0);
  assert.equal(compareToTruth(back(r), legs).meanError, 0);
});

test('folded arms (each forearm points at the other elbow, length kept) are left exactly as detected', () => {
  const folded = truth('forehand').map((p) => {
    if (!p) return p;
    const q = JSON.parse(JSON.stringify(p)) as NonNullable<typeof p>;
    for (const [side, other] of [['left', 'right'], ['right', 'left']] as const) {
      const el = q[`${side}_elbow`], wr = q[`${side}_wrist`], oe = q[`${other}_elbow`];
      const len = Math.hypot(wr.x - el.x, wr.y - el.y), w = Math.hypot(oe.x - el.x, oe.y - el.y) || 1;
      wr.x = el.x + ((oe.x - el.x) / w) * len; wr.y = el.y + ((oe.y - el.y) / w) * len;
    }
    return q;
  }) as Seq;
  const r = run(folded);
  assert.equal(r.report.swapsFixed, 0);
  assert.equal(compareToTruth(back(r), folded).meanError, 0);
});
