import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guards for KNOWN_ISSUES 077: AI Track must free the RTMPose live engine, and an init still in flight must not re-fill it.
const src = readFileSync(new URL('../components/Canvas.tsx', import.meta.url), 'utf8');

test('startBakeCapture releases the RTMPose live engine before the bake flag is set', () => {
  const i = src.indexOf('startBakeCapture: (collectFromBridge = true) => {');
  assert.ok(i > 0);
  const body = src.slice(i, i + 400);
  assert.ok(body.indexOf('releaseRtmposeLive()') > 0, 'must call releaseRtmposeLive()');
  assert.ok(body.indexOf('releaseRtmposeLive()') < body.indexOf('bakingRef.current = true'), 'release comes first');
});

test('release drops the engine and the pending init, and an init that lands after a release is discarded', () => {
  const r = src.slice(src.indexOf('const releaseRtmposeLive = () => {'), src.indexOf('const releaseRtmposeLive = () => {') + 700);
  for (const piece of ['R.gen++', 'R.eng = null', 'R.initP = null', 'eng.dispose()']) assert.ok(r.includes(piece), `release must contain ${piece}`);
  assert.match(src, /const gen = R\.gen;[\s\S]{0,600}if \(gen !== R\.gen\) \{ eng\.dispose\(\); return false; \}/);
});
