import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source guards for the Auto Detect racket switch and the phone preload change (no browser tests exist for the analysis UI).
const page = readFileSync(new URL('../app/analysis/page.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../components/StroMotionPanel.tsx', import.meta.url), 'utf8');
const flags = readFileSync(new URL('../lib/stroMotionDraft/autoRacketFlags.ts', import.meta.url), 'utf8');

test('the switch writes the SAME localStorage key the detection pass reads', () => {
  assert.match(flags, /getItem\('autoRacket'\)/);
  assert.match(flags, /setItem\('autoRacket', on \? '1' : '0'\)/);
});
test('the compact (shipping) panel renders the switch with a phone warning', () => {
  assert.match(panel, /data-testid="racket-detect-switch"/);
  assert.match(panel, /data-testid="racket-detect-warning"/);
  assert.match(panel, /role="switch"/);
});
test('the switch renders in BOTH panel modes (icon strip and labelled list) — it was missing from the labelled list in build 1', () => {
  const uses = panel.split('{racketSwitch}').length - 1;
  assert.equal(uses, 2);
  const labelled = panel.slice(panel.indexOf('Labeled mode: frame buttons + actions with text'));
  assert.match(labelled, /label="AI auto-detect"[\s\S]{0,200}\{racketSwitch\}/);
});
