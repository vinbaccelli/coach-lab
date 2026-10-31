import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayedSection, metricsSectionShown, motionSectionShown, selectedSection } from '../lib/aiTrackScope';
import { includesLabelWithHolds } from '../lib/exportOverlay';

// ── Section selector ─────────────────────────────────────────────────────────

const base = { stroMotionActive: false, html5: true, snapshots: false, skeleton: false, metricsOpened: false };

test('Metrics section: shown as soon as Metrics was opened, as before with snapshots or skeleton', () => {
  assert.equal(metricsSectionShown(base), false, 'nothing yet: hidden, as before');
  assert.equal(metricsSectionShown({ ...base, metricsOpened: true }), true);
  assert.equal(metricsSectionShown({ ...base, snapshots: true }), true);
  assert.equal(metricsSectionShown({ ...base, skeleton: true }), true);
  assert.equal(metricsSectionShown({ ...base, metricsOpened: true, stroMotionActive: true }), false, 'Motion Layer owns the timeline');
  assert.equal(metricsSectionShown({ ...base, metricsOpened: true, html5: false }), false, 'YouTube/embed: no section');
});

test('Motion Layer section: shown as soon as the section exists, not only after the draft', () => {
  assert.equal(motionSectionShown(0, 3), true);
  assert.equal(motionSectionShown(0, 0), false, 'duration not read yet');
  assert.equal(motionSectionShown(2, 1), false);
  assert.equal(motionSectionShown(Number.NaN, 3), false);
});

test('the default section (whole clip) does not change what AI Track offers', () => {
  assert.equal(selectedSection(0, 12, 12), null, 'whole clip = "whole video", as with no section');
});

test('default: the whole clip is shown, not stored; a stored section (dragged, snapshots, skeleton) wins', () => {
  assert.deepEqual(displayedSection(null, null, 12), { start: 0, end: 12 });
  assert.deepEqual(displayedSection(2, 5, 12), { start: 2, end: 5 }, 'the last section used is kept');
  assert.equal(displayedSection(null, null, 0), null, 'Metrics not opened, or duration not read yet');
});

test('wiring: opening Metrics sets the flag; it never writes the section (snapshot/skeleton defaults unchanged)', () => {
  const page = readFileSync('app/analysis/page.tsx', 'utf8');
  assert.match(page, /screen === 'aimetrics'\) \{\s*setStroMotionActive\(false\);\s*setMetricsSectionOpened\(true\);/);
  assert.match(page, /trimRange: displayedSection\(metricsSectionStart, metricsSectionEnd, metricsSectionOpened \? stroVideoDuration : 0\)/);
  assert.match(page, /if \(!skeletonEnabled\) \{ setMetricsSectionStart\(null\); setMetricsSectionEnd\(null\); \}/);
});

// ── Generate decisions ───────────────────────────────────────────────────────

test('summary: nothing included → just the video; each toggle alone names itself', () => {
  assert.equal(includesLabelWithHolds(false, false, 0), 'Includes: video');
  assert.equal(includesLabelWithHolds(true, false, 0), 'Includes: video + skeleton');
  assert.equal(includesLabelWithHolds(false, true, 0), 'Includes: video + drawings');
  assert.equal(includesLabelWithHolds(false, false, 2), 'Includes: video + 2 snapshot holds');
});

test('nothing included: no overlay pass, no block on the Export button (plain section video)', () => {
  const panel = readFileSync('components/metrics/MetricsExportPanel.tsx', 'utf8');
  // The overlay is built only when something is included; otherwise only the watermark is drawn.
  assert.match(panel, /if \(overlay && \(includeSkeleton \|\| includeDrawings \|\| holds\.length\)\) \{/);
  // The Export button is gated by quality / stopping / zoom only, never by the include switches.
  const btn = panel.slice(panel.indexOf('onClick={() => { void startExport(); }}') - 400, panel.indexOf('onClick={() => { void startExport(); }}'));
  assert.doesNotMatch(btn, /includeSkeleton|includeDrawings|includeSnapshots/);
});

test('phone layout: one full-screen sheet with the Generate actions pinned at the bottom', () => {
  const panel = readFileSync('components/metrics/MetricsExportPanel.tsx', 'utf8');
  assert.match(panel, /data-testid="export-actions" style=\{\{\s*\/\/ Always reachable[^\n]*\n\s*position: 'sticky', bottom: 0/);
  assert.match(panel, /width: isMobile \? '100%'/);
  assert.match(panel, /<section aria-label="Sound"/);
});
