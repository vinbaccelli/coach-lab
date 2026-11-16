// Prints trackStats for every sequence in a run.js output file.
//   npx tsx scripts/skeleton-bench/analyze.ts bench-out/heavy_s1.json
import { readFileSync } from 'node:fs';
import { trackStats, crossClassJumps, type Seq } from '../../lib/skeletonBench/metrics';

const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(`video ${d.W}x${d.H} from ${d.t0}s, frames ${d.n}, ms/frame full ${d.ms.full.toFixed(0)} roi ${d.ms.roi.toFixed(0)}`);
const rows: Record<string, unknown> = {};
for (const key of Object.keys(d).filter((k) => Array.isArray(d[k]))) {
  const s = trackStats(d[key] as Seq);
  rows[key] = {
    frames: s.frames, missing: s.missing, bodyPx: Math.round(s.bodyHeightPx),
    jumpRate: (s.jumpRate * 100).toFixed(2) + '%', swaps: s.swaps, maxStep: s.maxStep.toFixed(2),
    jerkP95: s.jerkP95.toFixed(4), jerkP99: s.jerkP99.toFixed(4),
    boneCV: s.boneLengthCV.toFixed(3), boneViol: (s.boneViolationRate * 100).toFixed(2) + '%',
    armLegSwaps: (() => { const c = crossClassJumps(d[key] as Seq); return c.armToLeg + c.legToArm; })(),
  };
}
console.table(rows);
if (d.trackCounts) console.log('tracked path:', JSON.stringify(d.trackCounts));
