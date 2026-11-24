import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { footLineChecked, posesHaveFeet, sampleTimes } from '../lib/aiTrackFootLines';

const coco = [{ name: 'nose', score: 0.9 }, { name: 'left_ankle', score: 0.9 }];
const withToe = (score: number) => [...coco, { name: 'left_foot_index', score }];

test('sampleTimes: evenly spaced, both ends included, at least two', () => {
  assert.deepEqual(sampleTimes(1, 3, 3), [1, 2, 3]);
  assert.deepEqual(sampleTimes(0, 1, 1), [0, 1]);
  assert.equal(sampleTimes(0, 10).length, 15);
});

test('posesHaveFeet: a real toe above the draw bar counts; COCO-17 only (MoveNet fallback bake) never does', () => {
  assert.equal(posesHaveFeet([null, coco, null]), false, 'MoveNet fallback bake has no feet');
  assert.equal(posesHaveFeet([]), false);
  assert.equal(posesHaveFeet([coco, withToe(0.1)]), false, 'a toe below 0.3 is not drawn, so it does not enable the lines');
  assert.equal(posesHaveFeet([coco, withToe(0.3)]), true);
  assert.equal(posesHaveFeet([null, [{ name: 'right_foot_index', score: 0.8 }]]), true);
  assert.equal(posesHaveFeet([[{ score: 0.9 }]]), false, 'unnamed keypoints are ignored');
});

test('footLineChecked: without a baked track it is the live flag only; with one, either system', () => {
  assert.equal(footLineChecked({ liveFlag: false, aiTrackFlag: true, bakedReady: false }), false, 'a stale AI Track flag does not tick the live opt-in');
  assert.equal(footLineChecked({ liveFlag: true, aiTrackFlag: false, bakedReady: false }), true);
  assert.equal(footLineChecked({ liveFlag: false, aiTrackFlag: true, bakedReady: true }), true);
  assert.equal(footLineChecked({ liveFlag: true, aiTrackFlag: false, bakedReady: true }), true);
  assert.equal(footLineChecked({ liveFlag: false, aiTrackFlag: false, bakedReady: true }), false);
});

// The non-negotiable: AI Track's flag must never take part in choosing the live pose engine.
test('Canvas: the live-engine choice reads only the live flag, never the AI Track one', () => {
  const src = readFileSync(new URL('../components/Canvas.tsx', import.meta.url), 'utf8');
  const block = (start: string) => {
    const i = src.indexOf(start);
    assert.ok(i > 0, `${start} not found`);
    return src.slice(i, i + 420);
  };
  for (const start of ['const useMediaPipeLive = () =>', 'const useRtmposeLive = () =>']) {
    assert.doesNotMatch(block(start), /aiTrackFootLines|footLinesDrawOn/, `${start} must not read the AI Track flag`);
  }
  assert.match(block('const useMediaPipeLive = () =>'), /skeletonShowFootLineRef\.current/);
  assert.match(block('const useRtmposeLive = () =>'), /!skeletonShowFootLineRef\.current/);
  // the landmarker preload effect is keyed on the live flag alone
  assert.match(src, /\}, \[skeletonShowFootLine\]\);\s*\n\s*useEffect\(\(\) => \(\) => \{\s*\n\s*void import\('@\/lib\/mediapipePose'\)\.then\(\(m\) => m\.disposeLiveLandmarker/);
});
