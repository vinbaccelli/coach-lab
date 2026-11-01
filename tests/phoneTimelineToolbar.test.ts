import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { phoneTabGrabHeight, tabGrabClearsBall, TAB_TRACK_GRAB_PX } from '../lib/timelinePress';
import { overlayBottomInset } from '../lib/timelineView';

test('phone trim tab: grab area at least 44 px tall, and it never reaches the playhead ball', () => {
  assert.ok(phoneTabGrabHeight(34) >= 44, `${phoneTabGrabHeight(34)} px`);
  // Phone track 56 px, ball 26 px: the ball starts 15 px below the track top.
  assert.equal(tabGrabClearsBall(56, 26), true);
  assert.ok(TAB_TRACK_GRAB_PX <= 15);
});

test('expanded phone toolbar stops above the timeline under it; reaches the bottom otherwise', () => {
  const rail = { left: 0, bottom: 844 };
  assert.equal(overlayBottomInset(rail, 196, { left: 60, right: 390, top: 690 }), 154, 'portrait: timeline below the video');
  assert.equal(overlayBottomInset({ left: 0, bottom: 390 }, 196, { left: 60, right: 844, top: 237 }), 153, 'landscape: timeline over the video');
  assert.equal(overlayBottomInset(rail, 196, { left: 300, right: 390, top: 690 }), 0, 'timeline not under the overlay');
  assert.equal(overlayBottomInset(rail, 196, null), 0);
  assert.equal(overlayBottomInset(rail, 196, { left: 60, right: 390, top: 900 }), 0, 'timeline below the rail');
});

test('wiring: phone tabs get the in-track grab band; the toolbar overlays instead of pushing', () => {
  const tl = readFileSync('components/PreciseTimeline.tsx', 'utf8');
  assert.equal((tl.match(/data-tab-grab="(start|end)"/g) ?? []).length, 2);
  const page = readFileSync('app/analysis/page.tsx', 'utf8');
  assert.match(page, /if \(compactToolbarRail\) return TOOLBAR_MOBILE_W;/);
  assert.match(page, /bottom: toolbarOverlayBottom,/);
  const tp = readFileSync('components/ToolPalette.tsx', 'utf8');
  assert.match(tp, /const phoneExpanded = Boolean\(compactToolbarChrome && toolbarLabelsExpanded\);/);
  assert.match(tp, /\[data-phone-expanded\]>\.anglemotion-toolbar-scroll\{display:contents!important\}/);
});
