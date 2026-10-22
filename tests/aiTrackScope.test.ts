import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockLabel, defaultScope, scopeChoiceLabels, selectedSection } from '@/lib/aiTrackScope';

test('a section shorter than the video is offered; none or the whole video is not', () => {
  assert.deepEqual(selectedSection(2, 9, 20), { start: 2, end: 9 });
  assert.deepEqual(selectedSection(0, 9, 20), { start: 0, end: 9 });
  assert.deepEqual(selectedSection(5, 20, 20), { start: 5, end: 20 });
  // No section, or one that spans the clip: nothing to choose.
  assert.equal(selectedSection(null, null, 20), null);
  assert.equal(selectedSection(2, null, 20), null);
  assert.equal(selectedSection(0, 20, 20), null);
  assert.equal(selectedSection(0.02, 19.98, 20), null);
  // The default section that appears when Skeleton turns on is the whole video.
  assert.equal(selectedSection(0, 20, 20), null);
});

test('the section is clamped to the video and bad input gives none', () => {
  assert.deepEqual(selectedSection(-3, 9, 20), { start: 0, end: 9 });
  assert.deepEqual(selectedSection(4, 40, 20), { start: 4, end: 20 });
  assert.equal(selectedSection(9, 4, 20), null);
  assert.equal(selectedSection(NaN, 4, 20), null);
  assert.equal(selectedSection(1, 4, 0), null);
});

test('a section set by the snapshots (not dragged) counts like any other', () => {
  // Snapshots at 6.2 s and 11 s give 5.9 .. 11.3 on a 30 s clip.
  assert.deepEqual(selectedSection(5.9, 11.3, 30), { start: 5.9, end: 11.3 });
});

test('choice labels and defaults', () => {
  assert.deepEqual(scopeChoiceLabels(7.2), { section: 'Selected section (0:07)', all: 'Whole video' });
  assert.equal(scopeChoiceLabels(65).section, 'Selected section (1:05)');
  assert.equal(clockLabel(0), '0:00');
  assert.equal(defaultScope(7), 'section');
  assert.equal(defaultScope(null), 'all');
});

test('the export panel starts on the section only when AI Track covered it but not the whole video', async () => {
  const { defaultExportRange } = await import('@/lib/aiTrackScope');
  const sec = { start: 2.6, end: 6 };
  assert.deepEqual(defaultExportRange(9, sec, true, false), { start: 2.6, end: 6 });
  // Whole video tracked, section not tracked, or no section: whole video, as before.
  assert.deepEqual(defaultExportRange(9, sec, true, true), { start: 0, end: 9 });
  assert.deepEqual(defaultExportRange(9, sec, false, false), { start: 0, end: 9 });
  assert.deepEqual(defaultExportRange(9, null, false, false), { start: 0, end: 9 });
  assert.deepEqual(defaultExportRange(9, null, true, false), { start: 0, end: 9 });
});
