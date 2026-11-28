import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateTrack, INVALID_SCORE } from '../lib/skeletonValidate';

// Real pose output (heavy model, 1280x720 serve clip, first 4 s) with a fast racket-arm swing.
// The temporal-outlier check used to erase wrist/elbow joints the model was 0.7–0.96 sure of.
type Row = { t: number; kps: Array<[string, number, number, number]> };
const rows: Row[] = JSON.parse(fs.readFileSync(new URL('./fixtures/racketSwingHeavy.json', import.meta.url), 'utf8'));
const raw = rows.map((r) => ({ t: r.t, kps: r.kps.map(([name, x, y, score]) => ({ name, x, y, score })) }));

const at = (out: any, t: number, name: string) => {
  const i = raw.findIndex((r) => r.t === t);
  return (out.samples[i].kps as any[]).find((k) => k.name === name).score as number;
};

test('confident racket-arm swing joints (t=1.7-1.867, 0.82-0.96 sure) are kept, not erased as temporal outliers', () => {
  const out = validateTrack(raw as any);
  for (const t of [1.7, 1.8, 1.867]) assert.ok(at(out, t, 'right_wrist') > INVALID_SCORE, `right_wrist t=${t} erased`);
});
