// Measured-lag compensation sweep (harness only). Cadence/latency come from the real-phone trace (rtt ~48 ms, ~20 Hz).
import { synthSwing } from '../../lib/skeletonBench/synthetic';
import { simulateLive, liveScore, type LiveMode } from '../../lib/skeletonBench/liveSim';
import { SPORT_ONE_EURO } from '../../lib/keypointSmooth';

const truth = synthSwing({ frames: 480, fps: 240 } as never);
const base = { truth, truthFps: 240, latencyMs: 48, overheadMs: 3, noisePx: 3, seed: 3 };
const rows: Array<[string, LiveMode]> = [['continue (shipped)', { kind: 'continue' }]];
for (const share of [0.5, 1]) for (const cap of [50, 80, 120])
  rows.push([`predict share=${share} cap=${cap}ms`, { kind: 'predict', oneEuro: SPORT_ONE_EURO, capMs: cap, latencyShare: share }]);
console.log('mode'.padEnd(30), 'lagMs meanErr p95Err maxErr peakRatio frozen');
for (const [name, mode] of rows) {
  const { shown, times } = simulateLive({ ...base, mode });
  const s = liveScore(truth, 240, shown, times);
  console.log(name.padEnd(30), s.lagMs, s.meanErr.toFixed(4), s.p95Err.toFixed(4), s.maxErr.toFixed(4), s.peakRatio.toFixed(2), s.frozenFrac.toFixed(2));
}
