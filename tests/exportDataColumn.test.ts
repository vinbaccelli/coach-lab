import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  columnValueText, dataColumnExportStatus, holdColumnRows, includesLabel, includesLabelWithHolds, liveColumnRows, LIVE_ANGLE_ROWS,
} from '../lib/exportOverlay';
import { computeJointAngles } from '../lib/biomechanics/measurements';

/** 17 COCO keypoints, all hidden (score 0) except the ones given. */
function pose(set: Record<number, [number, number]>) {
  return Array.from({ length: 17 }, (_, i) => ({
    x: set[i]?.[0] ?? 0, y: set[i]?.[1] ?? 0, score: set[i] ? 0.9 : 0, name: `k${i}`,
  }));
}
// Left arm bent 90° (shoulder 5, elbow 7, wrist 9); left leg straight (hip 11, knee 13, ankle 15).
const P = pose({ 5: [100, 100], 7: [100, 200], 9: [200, 200], 11: [300, 100], 13: [300, 200], 15: [300, 300] });

test('playback frame: the coach rows, then L/R Elbow, L/R Knee from the shared computeJointAngles', () => {
  const rows = liveColumnRows([{ label: 'Note', value: 0, unit: '' }], P);
  assert.deepEqual(rows.map((r) => r.label), ['Note', 'L Elbow', 'R Elbow', 'L Knee', 'R Knee']);
  const ja = computeJointAngles(P);
  assert.equal(rows[1].value, ja.leftElbowDeg);
  assert.equal(rows[1].value, 90);
  assert.equal(rows[3].value, 180);
  assert.equal(LIVE_ANGLE_ROWS.length, 4);
});

test('missing values are dashes, never numbers: hidden joints, no pose at this time, a non-finite stored value', () => {
  const rows = liveColumnRows([], P);
  assert.equal(rows[1].label, 'R Elbow');
  assert.equal(rows[1].value, null, 'right arm not tracked');
  assert.equal(columnValueText(rows[1]), '—');
  assert.deepEqual(liveColumnRows([], null).map((r) => r.value), [null, null, null, null], 'no baked pose at this time');
  assert.deepEqual(liveColumnRows([], []).map((r) => r.value), [null, null, null, null]);
  assert.equal(liveColumnRows([{ label: 'X', value: Number.NaN, unit: '°' }], null)[0].value, null);
  assert.equal(columnValueText({ label: 'L Elbow', value: 90, unit: '°' }), '90°');
});

test('snapshot hold: its own stored rows, unchanged', () => {
  assert.deepEqual(holdColumnRows([{ label: 'L Knee', value: 142, unit: '°' }, { label: 'Note', value: 0, unit: '' }]),
    [{ label: 'L Knee', value: 142, unit: '°' }, { label: 'Note', value: 0, unit: '' }]);
  assert.deepEqual(holdColumnRows(undefined), []);
});

test('switch: needs the skeleton or a snapshot hold; says what it will show', () => {
  const none = dataColumnExportStatus({ skeleton: false, holds: 0, on: true });
  assert.equal(none.available, false);
  assert.match(none.text, /No values to show/);
  assert.equal(dataColumnExportStatus({ skeleton: true, holds: 0, on: false }).text, 'Off: no data column in the video.');
  assert.match(dataColumnExportStatus({ skeleton: true, holds: 0, on: true }).text, /Joint angles of each frame/);
  assert.match(dataColumnExportStatus({ skeleton: false, holds: 2, on: true }).text, /snapshot’s own values/);
  assert.match(dataColumnExportStatus({ skeleton: true, holds: 1, on: true }).text, /while it plays, each snapshot/);
});

test('summary line: unchanged without the data column, names it when on', () => {
  assert.equal(includesLabel(true, false), 'Includes: video + skeleton');
  assert.equal(includesLabel(true, false, true), 'Includes: video + skeleton + data column');
  assert.equal(includesLabelWithHolds(false, false, 1, true), 'Includes: video + data column + 1 snapshot hold');
});

test('switch off = export unchanged: no dataColumn passed, Canvas draws the column only when asked', () => {
  const panel = readFileSync('components/metrics/MetricsExportPanel.tsx', 'utf8');
  assert.match(panel, /const \[dataColumnWanted, setDataColumnWanted\] = useState\(false\)/, 'off by default');
  assert.match(panel, /overlay\.drawExportOverlay\(ctx, t, w, h, liveDc \? \{ \.\.\.flags, frozen, dataColumn: liveDc \} : \{ \.\.\.flags, frozen \}\)/);
  assert.match(panel, /const liveDc = liveColumn && includeSkeleton \?/, 'playback column only with the skeleton');
  const canvas = readFileSync('components/Canvas.tsx', 'utf8');
  const exp = canvas.slice(canvas.indexOf('drawExportOverlay: (ctx, mediaTime, outW, outH, opts) => {'), canvas.indexOf('startStroMotionRegionSelect: (cb) => {'));
  assert.match(exp, /if \(opts\.dataColumn && hold\.column\) \{/);
  assert.match(exp, /if \(opts\.dataColumn\) \{/);
  assert.equal((exp.match(/drawColumn\(ctx,/g) ?? []).length, 2, 'only those two places draw it');
  // One drawing function for the screen and the video.
  assert.match(canvas, /drawDataColumnBox\(ctx, mcItems, mcTitleRef\.current \|\| 'DATA COLUMN', mcX, mcY, s, true\)/);
  assert.match(exp, /drawDataColumnBox\(c, rows, title, x, y, col\.scale, false\)/);
});
