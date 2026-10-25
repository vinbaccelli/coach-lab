import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_FAILED_TEXT, analysisCleanup, analysisFailedText, analysisProgress, analysisSampleTimes, checkAnalyzedTrack, drawingsExportStatus,
  dockAnalysisBar, meanAbsDiff, poseRegion, poseShift, skeletonFollowsVideo, toGrey, includesLabel, mapPoint, overlayTransform, parsePassProgress, skeletonExportStatus,
  trackedFraction, untrackedIntervals,
  clampHoldSec, formatHoldSec, holdSchedule, drawingsDefaultOn, analysisBlockedReason, pageZoomed, includesLabelWithHolds, outputProgress, snapshotsExportStatus, snapshotsSwitchText,
  HOLD_DEFAULT_SEC, HOLD_FRAME_SEC, HOLD_MAX_SEC, HOLD_MIN_SEC, PANEL_SKELETON_ANALYSIS,
  holdSeekLanded, holdResumeSeek, resumeAction, emptyExportError, RESUME_GIVE_UP_MS, RESUME_RETRY_MS,
} from '@/lib/exportOverlay';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('the on-screen video box maps onto the whole output frame', () => {
  // 1920x1080 video letterboxed at (40, 0) size 800x450 in a 880x450 canvas.
  const t = overlayTransform({ dx: 40, dy: 0, dw: 800, dh: 450 }, 1920, 1080)!;
  const tl = mapPoint(t, { x: 40, y: 0 });
  const br = mapPoint(t, { x: 840, y: 450 });
  close(tl.x, 0); close(tl.y, 0);
  close(br.x, 1920); close(br.y, 1080);
  const mid = mapPoint(t, { x: 440, y: 225 });
  close(mid.x, 960); close(mid.y, 540);
});

test('the same drawing keeps its place and proportion at 720p, 1080p and Original', () => {
  const box = { dx: 12, dy: 30, dw: 640, dh: 360 };
  const line = [{ x: 172, y: 120 }, { x: 492, y: 300 }]; // a line in logical px
  for (const [w, h] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
    const t = overlayTransform(box, w, h)!;
    const [a, b] = line.map((p) => mapPoint(t, p));
    // Relative position inside the frame is identical at every size.
    close(a.x / w, (172 - 12) / 640); close(a.y / h, (120 - 30) / 360);
    close(b.x / w, (492 - 12) / 640); close(b.y / h, (300 - 30) / 360);
    // Uniform scale (aspect kept): a line's width scales with the frame.
    close(t.sx, t.sy, 1e-9);
  }
});

test('a portrait clip maps the same way', () => {
  const t = overlayTransform({ dx: 300, dy: 0, dw: 253.125, dh: 450 }, 1080, 1920)!;
  const p = mapPoint(t, { x: 300 + 253.125 / 2, y: 450 / 4 });
  close(p.x, 540, 1e-6); close(p.y, 480, 1e-6);
  close(t.sx, t.sy, 1e-9);
});

test('a degenerate box or output gives no transform', () => {
  assert.equal(overlayTransform({ dx: 0, dy: 0, dw: 0, dh: 450 }, 1920, 1080), null);
  assert.equal(overlayTransform({ dx: 0, dy: 0, dw: 800, dh: 450 }, 0, 1080), null);
});

test('trackedFraction: whole, none, half, and a gap', () => {
  assert.equal(trackedFraction(0, 10, () => true), 1);
  assert.equal(trackedFraction(0, 10, () => false), 0);
  assert.equal(trackedFraction(0, 10, (t) => t < 5), 0.5);
  close(trackedFraction(2, 12, (t) => t < 4 || t >= 9), 0.5, 0.011);
  assert.equal(trackedFraction(5, 5, () => true), 0);
  assert.equal(trackedFraction(5, 4, () => true), 0);
});

test('trackedFraction caps the number of samples on a long range', () => {
  let calls = 0;
  trackedFraction(0, 7200, () => { calls++; return true; }, 600);
  assert.equal(calls, 600);
  calls = 0;
  trackedFraction(0, 2, () => { calls++; return true; });
  assert.equal(calls, 20);
});

test('with the panel analysis enabled (PANEL_SKELETON_ANALYSIS), untracked or partly tracked ranges are analyzed first', () => {
  assert.deepEqual(skeletonExportStatus(false, 1), { state: 'ready', text: 'Skeleton ready.' });
  assert.deepEqual(skeletonExportStatus(false, 0, false, false, true), {
    state: 'analyze', text: 'Not analyzed yet. The skeleton will be analyzed first when you export, which adds time.',
  });
  assert.equal(skeletonExportStatus(false, 0.42, false, false, true).text, 'Skeleton covers 42% of this range. The rest will be analyzed first when you export, which adds time.');
  assert.equal(skeletonExportStatus(false, 0.42, false, false, true).state, 'analyze');
  // Partial never reads 0% or 100%.
  assert.match(skeletonExportStatus(false, 0.001, false, false, true).text, /covers 1% /);
  assert.match(skeletonExportStatus(false, 0.996, false, false, true).text, /covers 99% /);
});

test('skeleton switch waits only for an AI Track already running', () => {
  assert.deepEqual(skeletonExportStatus(true, 1), { state: 'busy', text: 'AI Track is running. Wait for it to finish, then export.' });
  assert.equal(skeletonExportStatus(true, 0).state, 'busy');
});

test('untrackedIntervals: nothing tracked → the whole range (inset)', () => {
  const r = untrackedIntervals(2, 6, () => false);
  assert.equal(r.length, 1);
  close(r[0].start, 2.05, 1e-9); close(r[0].end, 5.95, 1e-9);
});

test('untrackedIntervals: fully tracked → nothing to analyze', () => {
  assert.deepEqual(untrackedIntervals(0, 9, () => true), []);
});

test('untrackedIntervals: gaps between tracks stay clear of the neighbouring tracks', () => {
  // A track [0, 3] and a track [6, 9]; the look-up reaches 0.1 s past each.
  const tracked = (t: number) => (t >= -0.1 && t <= 3.1) || (t >= 5.9 && t <= 9.1);
  const r = untrackedIntervals(0, 9, tracked);
  assert.equal(r.length, 1);
  // finishBakeCapture drops tracks with end >= start - 0.05 (or start <= end + 0.05):
  assert.ok(3 < r[0].start - 0.05, `left track kept (gap starts ${r[0].start})`);
  assert.ok(6 > r[0].end + 0.05, `right track kept (gap ends ${r[0].end})`);
  // ...and the 0.1 s look-up reach still covers the inset on both sides.
  assert.ok(r[0].start - 0.1 <= 3.1 + 1e-9);
  assert.ok(r[0].end + 0.1 >= 5.9 - 1e-9);
});

test('untrackedIntervals: tiny gaps are skipped, bad ranges give nothing', () => {
  const tracked = (t: number) => !(t > 4.0 && t < 4.15);
  assert.deepEqual(untrackedIntervals(0, 9, tracked), []);
  assert.deepEqual(untrackedIntervals(5, 5, () => false), []);
  assert.deepEqual(untrackedIntervals(5, 4, () => false), []);
});

test('parsePassProgress reads the AI Track pass status line', () => {
  assert.equal(parsePassProgress('AI-tracking… 42% (0.5× · real feet)'), 0.42);
  assert.equal(parsePassProgress('AI-tracking… 100% (0.5×)'), 1);
  assert.equal(parsePassProgress('Loading precision tracking model…'), null);
  assert.equal(parsePassProgress(null), null);
});

test('analysisProgress spans several intervals by their length', () => {
  const iv = [{ start: 0, end: 2 }, { start: 5, end: 11 }];
  assert.equal(analysisProgress(iv, 0, 0), 0);
  assert.equal(analysisProgress(iv, 0, 1), 0.25);
  assert.equal(analysisProgress(iv, 1, 0.5), 0.625);
  assert.equal(analysisProgress(iv, 2, 0), 1);
  assert.equal(analysisProgress([], 0, 0.5), 0);
});

test('drawings switch: never dead — usable whenever there are drawings, LIVE or SNAPSHOT; says what is exported', () => {
  // SNAPSHOT mode with strokes: usable (it was a disabled 'snapshot' state before — the dead switch).
  const snap = drawingsExportStatus(true, 4);
  assert.equal(snap.state, 'ready');
  assert.equal(snap.text, "This snapshot's 4 drawings, shown on every frame.");
  assert.equal(drawingsExportStatus(true, 1, true).text, "This snapshot's 1 drawing, shown on every frame except snapshot holds.");
  // LIVE mode.
  assert.equal(drawingsExportStatus(false, 1).text, '1 drawing on the video, shown on every frame.');
  assert.equal(drawingsExportStatus(false, 3, true).text, '3 drawings on the video, shown on every frame except snapshot holds.');
  // Disabled only with nothing to draw, and it says why.
  assert.deepEqual(drawingsExportStatus(false, 0), { state: 'none', text: 'No drawings on the video. Draw on the video to include them.' });
  assert.deepEqual(drawingsExportStatus(true, 0), { state: 'none', text: 'No drawings on this snapshot. Draw on it to include them.' });
  // Default: on in LIVE, off in SNAPSHOT (that snapshot's hold already shows them).
  assert.equal(drawingsDefaultOn(false), true);
  assert.equal(drawingsDefaultOn(true), false);
});

test('skeleton analysis is not started on a zoomed page', () => {
  assert.equal(analysisBlockedReason(1), null);
  assert.equal(analysisBlockedReason(1.01), null);
  assert.equal(analysisBlockedReason(null), null);
  assert.equal(analysisBlockedReason(undefined), null);
  assert.match(analysisBlockedReason(1.5)!, /^The page is zoomed in \(150%\)\. Pinch out to 100% first/);
  assert.equal(pageZoomed(2), true);
  assert.equal(pageZoomed(Number.NaN), false);
});

test('includes label', () => {
  assert.equal(includesLabel(true, true), 'Includes: video + skeleton + drawings');
  assert.equal(includesLabel(false, true), 'Includes: video + drawings');
  assert.equal(includesLabel(true, false), 'Includes: video + skeleton');
  assert.equal(includesLabel(false, false), 'Includes: video');
});

// A 17-joint pose: a standing figure about 100 px tall, shifted by (dx, dy), the right wrist raised by `wrist`.
const pose = (dx = 0, dy = 0, wrist = 0) => Array.from({ length: 17 }, (_, j) => ({
  x: 100 + dx + (j % 2 ? 20 : -20), y: 50 + dy + j * 6 - (j === 10 ? wrist : 0), score: 0.9, name: String(j),
}));

test('checkAnalyzedTrack: a moving player passes', () => {
  const poses = Array.from({ length: 20 }, (_, i) => pose(i * 2, 0, i));
  const r = checkAnalyzedTrack(58, 1.9, poses);
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
  assert.ok(r.motion > 0.1, `motion ${r.motion}`);
  close(r.posesPerSec, 58 / 1.9, 1e-9);
});

test('checkAnalyzedTrack: the same pose on every frame is a frozen skeleton', () => {
  const p = pose(5, 5);
  const r = checkAnalyzedTrack(58, 1.9, Array.from({ length: 20 }, () => p.map((k) => ({ ...k }))));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'static');
  assert.equal(r.motion, 0);
});

test('checkAnalyzedTrack: a still player with normal detection jitter still passes', () => {
  // ±0.5 px of jitter on a ~117 px body (the smallest real motion the pass reports).
  const poses = Array.from({ length: 20 }, (_, i) => pose(i % 2 ? 0.5 : -0.5, i % 3 ? 0.4 : 0));
  assert.equal(checkAnalyzedTrack(58, 1.9, poses).ok, true);
});

test('checkAnalyzedTrack: too few poses for the analyzed time is too sparse', () => {
  const moving = Array.from({ length: 20 }, (_, i) => pose(i * 3));
  assert.equal(checkAnalyzedTrack(1, 2, moving).reason, 'sparse');
  assert.equal(checkAnalyzedTrack(5, 9, moving).reason, 'sparse'); // 0.6 poses/s from a 30 fps pass
  assert.equal(checkAnalyzedTrack(30, 2, [pose()]).reason, 'sparse'); // one pose across the range
  assert.equal(checkAnalyzedTrack(30, 2, [null, null]).reason, 'sparse');
  assert.equal(checkAnalyzedTrack(0, 0, []).reason, 'sparse');
  assert.equal(checkAnalyzedTrack(27, 9, moving).ok, true); // 3 poses/s is enough
});

test('checkAnalyzedTrack: low-score joints are ignored', () => {
  // Only the hidden joints "move"; the visible body is frozen.
  const poses = Array.from({ length: 10 }, (_, i) => pose().map((k, j) => (j >= 13 ? { ...k, x: k.x + i * 10, score: 0.1 } : k)));
  assert.equal(checkAnalyzedTrack(58, 1.9, poses).reason, 'static');
});

test('the analysis failure message, and the switch after a failed analysis', () => {
  assert.equal(ANALYSIS_FAILED_TEXT, 'Skeleton could not be analyzed on this video');
  // The failed track covers the range, but it is not offered as "ready".
  assert.deepEqual(skeletonExportStatus(false, 1, true), { state: 'failed', text: 'Skeleton could not be analyzed on this video.' });
  assert.equal(skeletonExportStatus(true, 1, true).state, 'failed');
  assert.equal(skeletonExportStatus(false, 1, false).state, 'ready');
});

test('analysisSampleTimes: spread over the analyzed intervals, capped', () => {
  const one = analysisSampleTimes([{ start: 0.05, end: 1.95 }]);
  assert.equal(one.length, 19);
  assert.ok(one.every((t) => t > 0.05 && t < 1.95));
  const two = analysisSampleTimes([{ start: 0, end: 1 }, { start: 5, end: 8 }]);
  assert.ok(two.filter((t) => t < 1).length >= 2 && two.filter((t) => t >= 5).length >= 2);
  assert.ok(two.every((t) => (t > 0 && t < 1) || (t > 5 && t < 8)));
  assert.equal(analysisSampleTimes([{ start: 0, end: 7200 }]).length, 300);
  assert.deepEqual(analysisSampleTimes([]), []);
});

// ── The holes in the first guard (c8c72033), reproduced ──

test('hole 1: a fresh picture only once a second (same pose in between) is refused as repeated', () => {
  // 9 s at 30 poses/s; the pose changes every 30 frames and is identical in between.
  // The first guard passed this (motion 155%, 30 poses/s): it looks frozen, then jumps.
  const poses = Array.from({ length: 270 }, (_, i) => pose(Math.floor(i / 30) * 15));
  const r = checkAnalyzedTrack(268, 8.9, poses);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'repeated');
  assert.ok(r.repeatShare > 0.9, `repeatShare ${r.repeatShare}`);
});

test('a real track repeats a frame now and then and still passes', () => {
  // A third of the steps repeated (what the toolbar pass measured in the test browser), the rest moving.
  const poses = Array.from({ length: 90 }, (_, i) => pose((i - Math.floor(i / 3)) * 0.8)); // 0,1,2,2,3,4,4,…
  const r = checkAnalyzedTrack(88, 3, poses);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.repeatShare > 0.2 && r.repeatShare < 0.5, `repeatShare ${r.repeatShare}`);
});

test('hole 2: a stale picture with detector noise passes the pose-only check, and the render check refuses it', () => {
  // Same picture every time + ±0.1–0.3 px of detector noise on a ~77 px body: never repeats
  // exactly, and its motion (~0.6%) clears the first guard's 0.1% bar.
  const noise = (n: number) => pose().map((k, j) => ({ ...k, x: k.x + Math.sin(j * 7 + n) * n }));
  const poses = Array.from({ length: 90 }, (_, i) => noise(0.1 * ((i % 3) + 1)));
  assert.equal(checkAnalyzedTrack(58, 1.9, poses).ok, true); // the pose alone cannot tell
  // The render sees the player move (picture changes around the skeleton) while the skeleton stays put.
  const steps = poses.slice(0, 8).map((p, i) => ({ image: 18, pose: poseShift(poses[i + 1], p) ?? 0 }));
  const v = skeletonFollowsVideo(steps);
  assert.equal(v.ok, false);
  assert.equal(v.moved, 8);
  assert.equal(v.still, 8);
});

test('render check: a skeleton that moves with the picture passes; a still scene is not evidence', () => {
  assert.equal(skeletonFollowsVideo(Array.from({ length: 12 }, () => ({ image: 20, pose: 0.06 }))).ok, true);
  // Player standing still: picture and skeleton both quiet → no verdict, never a refusal.
  const quiet = skeletonFollowsVideo(Array.from({ length: 40 }, () => ({ image: 1.5, pose: 0.002 })));
  assert.deepEqual(quiet, { ok: null, moved: 0, still: 0 });
  // Too few moving steps to decide yet.
  assert.equal(skeletonFollowsVideo([{ image: 20, pose: 0 }, { image: 20, pose: 0 }, { image: 20, pose: 0 }]).ok, null);
  // A short frozen stretch inside a moving export (e.g. the player out of view at the end) is tolerated.
  const mixed = [...Array.from({ length: 10 }, () => ({ image: 20, pose: 0.05 })), ...Array.from({ length: 4 }, () => ({ image: 20, pose: 0 }))];
  assert.equal(skeletonFollowsVideo(mixed).ok, true);
});

test('poseShift is relative to body size', () => {
  close(poseShift(pose(), pose(10))!, 10 / Math.hypot(40, 66), 1e-9);
  assert.equal(poseShift(pose(), pose()), 0);
  assert.equal(poseShift(null, pose()), null);
});

test('poseRegion: the joint box grown by half its size, clamped to the frame', () => {
  // Joints 5–16 of pose(): x 80..120, y 80..146 (video px); output at 2×.
  const r = poseRegion(pose(), 2, 2, 1000, 1000)!;
  assert.deepEqual(r, { x: 120, y: 94, w: 160, h: 264 });
  const c = poseRegion(pose(-90, -60), 1, 1, 100, 100)!; // near the corner
  assert.equal(c.x, 0); assert.equal(c.y, 0);
  assert.equal(poseRegion(null, 1, 1, 100, 100), null);
});

test('grey thumbnails and their difference', () => {
  assert.deepEqual([...toGrey([255, 255, 255, 255, 0, 0, 0, 255])], [255, 0]);
  assert.equal(meanAbsDiff([0, 10, 20], [0, 10, 20]), 0);
  assert.equal(meanAbsDiff([0, 10, 20], [6, 16, 26]), 6);
});

test('the failure line carries the numbers', () => {
  const pre = checkAnalyzedTrack(268, 8.9, Array.from({ length: 270 }, (_, i) => pose(Math.floor(i / 30) * 15)));
  assert.equal(analysisFailedText(pre, 268, 8.9, null),
    `Skeleton could not be analyzed on this video (268 poses in 8.9 s (30.1/s) · motion ${(pre.motion * 100).toFixed(1)}% · repeated ${Math.round(pre.repeatShare * 100)}%).`);
  assert.equal(analysisFailedText(null, 0, 0, { moved: 9, still: 8 }), 'Skeleton could not be analyzed on this video (video moved 9×, skeleton still 8×).');
  // Render check after the export's own analysis: both sets of numbers.
  const ok = checkAnalyzedTrack(268, 8.9, Array.from({ length: 270 }, (_, i) => pose(i * 0.5, 0, i % 7)));
  assert.match(analysisFailedText(ok, 268, 8.9, { moved: 6, still: 6 }),
    /^Skeleton could not be analyzed on this video \(268 poses in 8\.9 s \(30\.1\/s\) · motion [\d.]+% · repeated \d+% · video moved 6×, skeleton still 6×\)\.$/);
});

const overlaps = (a: { left: number; top: number; width: number }, h: number, v: { x: number; y: number; w: number; h: number }) =>
  a.left < v.x + v.w && a.left + a.width > v.x && a.top < v.y + v.h && a.top + h > v.y;

test('dockAnalysisBar: the bar never covers the picture when there is room', () => {
  // Phone 375×812, landscape clip letterboxed in the middle (measured in the app).
  const phone = { x: 60, y: 317, w: 315, h: 177 };
  const a = dockAnalysisBar({ w: 375, h: 812 }, phone, 110);
  assert.equal(a.side, 'below'); assert.equal(overlaps(a, 110, phone), false);
  assert.ok(a.left >= 0 && a.left + a.width <= 375 && a.top + 110 <= 812);
  // Phone, portrait 9:16 clip: 315×560 from y 126 — 126 px free above and below.
  const tall = { x: 60, y: 126, w: 315, h: 560 };
  const b = dockAnalysisBar({ w: 375, h: 812 }, tall, 110);
  assert.equal(overlaps(b, 110, tall), false);
  // Desktop, portrait clip filling the height: docks to a side.
  const desk = { x: 587, y: 0, w: 506, h: 900 };
  const c = dockAnalysisBar({ w: 1440, h: 900 }, desk, 120);
  assert.equal(c.side, 'right'); assert.equal(overlaps(c, 120, desk), false);
  assert.ok(c.left + c.width <= 1440 - 8);
  // Desktop landscape (measured): room below.
  const d = dockAnalysisBar({ w: 1440, h: 900 }, { x: 240, y: 113, w: 1200, h: 675 }, 96);
  assert.equal(d.side, 'below'); assert.equal(overlaps(d, 96, { x: 240, y: 113, w: 1200, h: 675 }), false);
});

test('dockAnalysisBar: a picture that fills the screen gets the bottom edge and says how much it covers', () => {
  const full = { x: 0, y: 0, w: 375, h: 812 };
  const r = dockAnalysisBar({ w: 375, h: 812 }, full, 110);
  assert.equal(r.side, 'edge');
  assert.equal(r.overlap, r.width * 110);
  assert.equal(dockAnalysisBar({ w: 375, h: 812 }, null, 110).side, 'edge');
});

test('054: while our own cancelled pass winds down the switch says "Stopping the analysis…", never "AI Track is running"', () => {
  // trackRunning is still true until the pass settles; our own pass wins.
  assert.deepEqual(skeletonExportStatus(true, 0, false, true), { state: 'stopping', text: 'Stopping the analysis…' });
  assert.deepEqual(skeletonExportStatus(true, 1, true, true), { state: 'stopping', text: 'Stopping the analysis…' });
  // Settled: back to normal.
  assert.equal(skeletonExportStatus(false, 0, false, false, true).state, 'analyze');
  assert.equal(skeletonExportStatus(false, 1, false, false).state, 'ready');
  // Someone else's pass (the toolbar) still reads as busy.
  assert.equal(skeletonExportStatus(true, 0.5, false, false).state, 'busy');
});

test('failed or cancelled analysis: clear only when there was no track before it', () => {
  assert.deepEqual(analysisCleanup(false), { clear: true, note: 'The unfinished skeleton analysis was removed.' });
  const kept = analysisCleanup(true);
  assert.equal(kept.clear, false);
  assert.match(kept.note, /earlier AI Track was left as it is/);
});

// ── Snapshot holds ──────────────────────────────────────────────────────────

const snaps = (...ts: number[]) => ts.map((timeSec, i) => ({ id: `s${i + 1}`, timeSec }));

test('hold schedule: only snapshots inside the range, in time order, at their own time', () => {
  // Range 2–10 s; snapshots at 4 s, 12 s (outside), 3 s.
  const plan = holdSchedule(snaps(4, 12, 3), 2, 10, 2);
  assert.deepEqual(plan.holds, [{ at: 3, seconds: 2, id: 's3' }, { at: 4, seconds: 2, id: 's1' }]);
  assert.equal(plan.inRange, 2);
  assert.equal(plan.total, 3);
  assert.equal(plan.totalHoldSec, 4);
  // Just outside either end (by more than the 1 ms tolerance): no hold.
  assert.equal(holdSchedule(snaps(1.99, 10.01), 2, 10, 2).inRange, 0);
  // Non-finite times are not snapshots for the export.
  assert.equal(holdSchedule([{ id: 'x', timeSec: Number.NaN }], 0, 10, 2).total, 0);
  // An empty or reversed range holds nothing.
  assert.equal(holdSchedule(snaps(1), 5, 5, 2).holds.length, 0);
});

test('hold schedule: a snapshot at the very start is held at the in-point, one at the very end one frame before the out-point', () => {
  const plan = holdSchedule(snaps(2, 10), 2, 10, 1);
  assert.equal(plan.holds[0].at, 2);
  close(plan.holds[1].at, 10 - HOLD_FRAME_SEC);
  // Within the 1 ms tolerance of the ends still counts, clamped onto the range.
  const edge = holdSchedule(snaps(1.9995, 10.0005), 2, 10, 1);
  assert.equal(edge.holds[0].at, 2);
  close(edge.holds[1].at, 10 - HOLD_FRAME_SEC);
  // A range shorter than a frame: the end clamp never goes before the start.
  assert.equal(holdSchedule(snaps(0.02), 0, 0.02, 1).holds[0].at, 0);
});

test('hold schedule: close or identical snapshots are not merged — each keeps its own hold, ties in order', () => {
  const plan = holdSchedule(snaps(5, 5, 5.01), 0, 10, 2);
  assert.deepEqual(plan.holds.map((h) => h.id), ['s1', 's2', 's3']);
  assert.deepEqual(plan.holds.map((h) => h.at), [5, 5, 5.01]);
  assert.equal(plan.totalHoldSec, 6);
  // Two snapshots at the very end both land on the last frame, one after the other.
  const end = holdSchedule(snaps(10, 9.99), 0, 10, 1);
  assert.deepEqual(end.holds.map((h) => h.id), ['s2', 's1']);
  close(end.holds[0].at, 10 - HOLD_FRAME_SEC);
  close(end.holds[1].at, 10 - HOLD_FRAME_SEC);
});

test('hold length: 0.5–5 s in 0.5 s steps, default 2 s', () => {
  assert.equal(HOLD_DEFAULT_SEC, 2);
  assert.equal(clampHoldSec(0.1), HOLD_MIN_SEC);
  assert.equal(clampHoldSec(9), HOLD_MAX_SEC);
  assert.equal(clampHoldSec(1.3), 1.5);
  assert.equal(clampHoldSec(Number.NaN), 2);
  assert.equal(holdSchedule(snaps(1), 0, 2, 99).holds[0].seconds, 5);
  assert.equal(formatHoldSec(4), '4 s');
  assert.equal(formatHoldSec(1.5), '1.5 s');
});

test('snapshots status lines', () => {
  const none = snapshotsExportStatus(holdSchedule([], 0, 10, 2), true);
  assert.equal(none.state, 'none');
  assert.match(none.text, /No snapshots yet/);
  const outside = snapshotsExportStatus(holdSchedule(snaps(12, 14), 0, 10, 2), true);
  assert.equal(outside.state, 'outside');
  assert.equal(outside.text, 'None of your 2 snapshots are in this range. Move the trim to include one.');
  const ready = snapshotsExportStatus(holdSchedule(snaps(1, 2, 12), 0, 10, 2), true);
  assert.deepEqual(ready, { state: 'ready', text: '2 of 3 snapshots are in this range · +4 s of holds' });
  assert.equal(snapshotsExportStatus(holdSchedule(snaps(1, 12), 0, 10, 1.5), true).text, '1 of 2 snapshots is in this range · +1.5 s of holds');
  assert.match(snapshotsExportStatus(holdSchedule(snaps(1), 0, 10, 2), false).text, /^1 of 1 snapshot is in this range\. Turn on/);
  // The switch's own line.
  assert.match(snapshotsSwitchText('none', false, 2), /No snapshots yet/);
  assert.equal(snapshotsSwitchText('outside', true, 2), 'No snapshot in this range.');
  assert.equal(snapshotsSwitchText('ready', true, 2.5), 'The video freezes 2.5 s on each, with its drawings and pose.');
  assert.equal(snapshotsSwitchText('ready', false, 2), 'Off: the video plays straight through.');
});

test('output progress counts hold seconds, so a hold moves the bar and never reads as a stall', () => {
  // 9 s range + 2 holds of 2 s = 13 s of output.
  close(outputProgress(0, 0, 9, 4), 0);
  close(outputProgress(3, 0, 9, 4), 3 / 13);
  // During the first hold the video stands still at 3 s; progress keeps moving.
  close(outputProgress(3, 1, 9, 4), 4 / 13);
  close(outputProgress(3, 2, 9, 4), 5 / 13);
  close(outputProgress(9, 4, 9, 4), 1);
  // Clamped: overshoot past the out-point or the holds never passes 1.
  close(outputProgress(9.2, 5, 9, 4), 1);
  // No holds: the plain media fraction (the Recording Hub / Snapshots-off path).
  close(outputProgress(4.5, 0, 9, 0), 0.5);
  assert.equal(outputProgress(1, 1, 0, 0), 0);
});

test('a snapshot drawn at one panel width lines up after a resize when its own box is used', () => {
  // 1920x1080 video. Drawn while the video sat at (40, 0) 800x450; a stroke on
  // the player's hand at video pixel (960, 540) is at logical (440, 225).
  const drawnBox = { dx: 40, dy: 0, dw: 800, dh: 450 };
  const drawnPoint = { x: 40 + 960 * (800 / 1920), y: 540 * (450 / 1080) };
  // After a resize the video sits at (0, 60) 1200x675.
  const nowBox = { dx: 0, dy: 60, dw: 1200, dh: 675 };
  const out = { w: 1280, h: 720 };
  const right = mapPoint(overlayTransform(drawnBox, out.w, out.h)!, drawnPoint);
  close(right.x, 640, 1e-6);
  close(right.y, 360, 1e-6);
  // The box of today's canvas (old snapshots without drawingsBox) puts it elsewhere.
  const wrong = mapPoint(overlayTransform(nowBox, out.w, out.h)!, drawnPoint);
  assert.ok(Math.abs(wrong.x - 640) > 100 || Math.abs(wrong.y - 360) > 100);
});

test('includes label with holds', () => {
  assert.equal(includesLabelWithHolds(true, false, 2), 'Includes: video + skeleton + 2 snapshot holds');
  assert.equal(includesLabelWithHolds(false, false, 1), 'Includes: video + 1 snapshot hold');
  assert.equal(includesLabelWithHolds(false, true, 0), 'Includes: video + drawings');
});

test('a hold seek counts only when it reported seeked, has a frame, and is at the hold time', () => {
  assert.equal(holdSeekLanded(true, 4, 2.5, 2.5), true);
  assert.equal(holdSeekLanded(true, 2, 2.56, 2.5), true);
  // iOS: no 'seeked' at all, no decodable frame, or the element reads 0.000.
  assert.equal(holdSeekLanded(false, 4, 2.5, 2.5), false);
  assert.equal(holdSeekLanded(true, 1, 2.5, 2.5), false);
  assert.equal(holdSeekLanded(true, 4, 0, 2.5), false);
  assert.equal(holdSeekLanded(true, 4, NaN, 2.5), false);
});

test('after a hold, playback continues in place, or from the hold time when the video lost its place', () => {
  assert.equal(holdResumeSeek(2.5, 2.5), null);
  assert.equal(holdResumeSeek(2.6, 2.5), null); // the frame the hold started on, just past it
  assert.equal(holdResumeSeek(0, 2.5), 2.5);   // "media t stuck at 0.000"
  assert.equal(holdResumeSeek(NaN, 2.5), 2.5);
});

test('after a hold, play() is retried until media time moves, then the export fails clearly', () => {
  assert.equal(resumeAction(100, 100), 'wait');
  assert.equal(resumeAction(RESUME_RETRY_MS, RESUME_RETRY_MS), 'retry');
  assert.equal(resumeAction(2000, RESUME_RETRY_MS - 1), 'wait');
  assert.equal(resumeAction(RESUME_GIVE_UP_MS, 0), 'fail');
});

test('an export with no frame or no bytes is an error, never an empty file', () => {
  assert.equal(emptyExportError(300, 1_000_000, 2), null);
  assert.match(emptyExportError(0, 1_000_000, 2)!, /no video frames were recorded.*turn Snapshots off/);
  assert.match(emptyExportError(300, 0, 0)!, /no video frames were recorded/);
  assert.doesNotMatch(emptyExportError(300, 0, 0)!, /Snapshots/);
});

test('panel analysis is off for the release: skeleton only when a track covers the range', () => {
  assert.equal(PANEL_SKELETON_ANALYSIS, false);
  assert.deepEqual(skeletonExportStatus(false, 1), { state: 'ready', text: 'Skeleton ready.' });
  assert.deepEqual(skeletonExportStatus(false, 0, false, false, false, false), { state: 'unavailable', text: 'Run AI Track from the toolbar first, then the skeleton can be included.' });
  // A track for part of the range: say so (KNOWN_ISSUES 065), still unavailable.
  assert.deepEqual(skeletonExportStatus(false, 0.4, false, false, false, false), {
    state: 'unavailable',
    text: 'AI Track covers 40% of this range. Choose “Use section” if you tracked a section, or run AI Track on this range, then the skeleton can be included.',
  });
  // The analysis states are still there behind the constant.
  assert.equal(skeletonExportStatus(false, 0, false, false, true).state, 'analyze');
  assert.equal(skeletonExportStatus(false, 0.4, false, false, true).state, 'analyze');
  // A toolbar AI Track running still says to wait.
  assert.equal(skeletonExportStatus(true, 0).state, 'busy');
});

import { LIVE_EXPORT_POSE, runOverlay } from '../lib/exportOverlay';

test('runOverlay: no overlay (the Recording Hub) does nothing; a hold call has exactly the five arguments it always had', () => {
  const ctx = {} as CanvasRenderingContext2D;
  assert.doesNotThrow(() => runOverlay(undefined, ctx, 1, 2, 3, null));
  const calls: unknown[][] = [];
  const fn = (...a: unknown[]) => { calls.push(a); };
  runOverlay(fn as never, ctx, 1.5, 720, 1280, 2);
  assert.equal(calls[0].length, 5);
  assert.deepEqual(calls[0].slice(1), [1.5, 720, 1280, 2]);
});

test('runOverlay: a live frame also gets the export video; an overlay that throws never stops the frame', () => {
  const ctx = {} as CanvasRenderingContext2D;
  const video = { tag: 'v' } as unknown as HTMLVideoElement;
  let got: unknown[] = [];
  runOverlay(((...a: unknown[]) => { got = a; }) as never, ctx, 0.5, 10, 20, null, video);
  assert.equal(got.length, 6);
  assert.equal(got[5], video);
  assert.doesNotThrow(() => runOverlay((() => { throw new Error('boom'); }) as never, ctx, 0, 1, 1, null, video));
});

test('live export skeleton (LIVE_EXPORT_POSE): no AI Track needed, a partial track says what is left', () => {
  assert.equal(LIVE_EXPORT_POSE, true);
  assert.deepEqual(skeletonExportStatus(false, 1), { state: 'ready', text: 'Skeleton ready.' });
  assert.deepEqual(skeletonExportStatus(false, 0), { state: 'live', text: 'The skeleton is detected while the video is exported. No AI Track needed.' });
  assert.deepEqual(skeletonExportStatus(false, 0.4), { state: 'live', text: 'AI Track covers 40% of this range; the rest is detected while the video is exported.' });
  // An AI Track running from the toolbar, or a failed/stopping analysis, still wins.
  assert.equal(skeletonExportStatus(true, 0).state, 'busy');
  assert.equal(skeletonExportStatus(false, 0, true).state, 'failed');
  assert.equal(skeletonExportStatus(false, 0, false, true).state, 'stopping');
});
