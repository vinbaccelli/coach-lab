import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOLD_TO_GRAB_MS, PRESS_SLOP_PX, ballPressHold, ballPressMove, pressOnPlayheadBall, startBallPress, type BallPress,
} from '@/lib/timelinePress';
import { TRACK_INSET_PX, resolveView, timeAtClientX, type TimeRange } from '@/lib/timelineView';

type Ev = { type: 'move'; x: number; at: number } | { type: 'up'; at: number };

/**
 * Plays one press on the playhead ball while a frame stop sits under it, the way
 * PreciseTimeline does: undecided until it moves past the slop (playhead scrub)
 * or is held (frame-stop grab). Returns what the press became and, for a scrub,
 * the time the playhead is dropped at (the pointer's time on release).
 */
function play(events: Ev[], x0: number, map: (x: number) => number) {
  let p: BallPress = startBallPress(x0, 0);
  let lastX = x0;
  for (const e of events) {
    if (e.type === 'up') {
      p = ballPressHold(p, e.at);
      break;
    }
    lastX = e.x;
    p = ballPressMove(p, e.x, e.at);
  }
  return { phase: p.phase, dropT: p.phase === 'scrub' ? map(lastX) : null };
}

/** A mouse drag: few, large moves straight away. */
const mouseDrag = (x0: number, x1: number): Ev[] => [
  ...Array.from({ length: 8 }, (_, i) => ({ type: 'move' as const, x: x0 + ((x1 - x0) * (i + 1)) / 8, at: 16 * (i + 1) })),
  { type: 'up', at: 200 },
];
/** A finger drag: a tremble inside the slop first, then the drag. */
const touchDrag = (x0: number, x1: number): Ev[] => [
  { type: 'move', x: x0 + 2, at: 20 },
  { type: 'move', x: x0 - 3, at: 45 },
  { type: 'move', x: x0 + 1, at: 70 },
  ...Array.from({ length: 12 }, (_, i) => ({ type: 'move' as const, x: x0 + ((x1 - x0) * (i + 1)) / 12, at: 90 + 16 * i })),
  { type: 'up', at: 400 },
];

test('drag and release on the playhead ball over a frame stop: the playhead goes where the pointer lets go, mouse and touch', () => {
  // 390 px phone (26 px ball) and 1440 px desktop (24 px ball); whole clip, zoomed, and scrolled views.
  for (const [width, ball] of [[370, 26], [1400, 24]] as const) {
    const rect = { left: 10, width };
    const dur = 1800;
    for (const view of [null, { start: 300, end: 420 }, { start: 1200, end: 1203 }] as (TimeRange | null)[]) {
      const v = resolveView(view, dur);
      const map = (x: number) => timeAtClientX(x, rect, v, dur);
      // The playhead (and Frame stop 1) at the view start, i.e. "time 0 / selection start".
      const x0 = rect.left + TRACK_INSET_PX;
      assert.ok(pressOnPlayheadBall(x0 + 3, x0, ball), 'the press is on the ball');
      const x1 = rect.left + TRACK_INSET_PX + (width - 2 * TRACK_INSET_PX) * 0.7;
      for (const [kind, evs] of [['mouse', mouseDrag(x0, x1)], ['touch', touchDrag(x0, x1)]] as const) {
        const r = play(evs, x0, map);
        assert.equal(r.phase, 'scrub', `${kind} @ ${width}px ${JSON.stringify(view)}: the ball, not the frame stop`);
        const want = v.start + 0.7 * (v.end - v.start);
        assert.ok(Math.abs(r.dropT! - want) < 1e-9, `${kind}: dropped at ${r.dropT}, pointer at ${want}`);
        assert.notEqual(r.dropT, 0, 'never back to 0');
        assert.notEqual(r.dropT, v.start, 'never back to the start');
      }
      // Dragging left past where the previous frame stop would be: still free.
      const back = play(mouseDrag(x1, x0 + 5), x1, map);
      assert.equal(back.phase, 'scrub');
    }
  }
});

test('hold still on the ball first: the frame stop under it is grabbed (the old drag-to-adjust), mouse and touch', () => {
  const held: Ev[] = [{ type: 'move', x: 101, at: HOLD_TO_GRAB_MS + 10 }, { type: 'move', x: 160, at: HOLD_TO_GRAB_MS + 40 }, { type: 'up', at: 900 }];
  assert.equal(play(held, 100, (x) => x).phase, 'frame-stop');
  // The hold timer fires with no move at all.
  assert.equal(ballPressHold(startBallPress(100, 0), HOLD_TO_GRAB_MS).phase, 'frame-stop');
  assert.equal(ballPressHold(startBallPress(100, 0), HOLD_TO_GRAB_MS - 1).phase, 'pending');
  // A finger trembling inside the slop during the hold is still a hold.
  const tremble: Ev[] = [{ type: 'move', x: 103, at: 100 }, { type: 'move', x: 97, at: 250 }, { type: 'move', x: 160, at: HOLD_TO_GRAB_MS + 5 }];
  assert.equal(play(tremble, 100, (x) => x).phase, 'frame-stop');
  // Once decided, the press does not change its mind.
  const scrub = ballPressMove(startBallPress(100, 0), 100 + PRESS_SLOP_PX + 1, 10);
  assert.equal(ballPressMove(scrub, 100, HOLD_TO_GRAB_MS * 3).phase, 'scrub');
  assert.equal(ballPressHold(scrub, HOLD_TO_GRAB_MS * 3).phase, 'scrub');
});

test('a quick tap on the ball stays a tap on the frame stop (select it, as before)', () => {
  assert.equal(play([{ type: 'up', at: 120 }], 100, (x) => x).phase, 'pending');
  assert.equal(play([{ type: 'move', x: 100 + PRESS_SLOP_PX, at: 30 }, { type: 'up', at: 150 }], 100, (x) => x).phase, 'pending');
});

test('only a press ON the drawn ball is the ball: a frame stop elsewhere drags at once, as before', () => {
  assert.ok(pressOnPlayheadBall(213, 200, 26));
  assert.ok(!pressOnPlayheadBall(214, 200, 26));
  assert.ok(pressOnPlayheadBall(188, 200, 24));
  assert.ok(!pressOnPlayheadBall(187, 200, 24));
});

test('PreciseTimeline routes a frame-stop press on the ball through this rule and hands a move to the playhead scrub', () => {
  const src = readFileSync(join(process.cwd(), 'components/PreciseTimeline.tsx'), 'utf8');
  assert.match(src, /if \(r && pressOnPlayheadBall\(e\.clientX, ballX, thumbSize\)\) \{/);
  assert.match(src, /bp\.press = ballPressMove\(bp\.press, e\.clientX, performance\.now\(\)\);\s*if \(bp\.press\.phase === 'scrub'\) \{/);
  assert.match(src, /beginScrub\(e\.pointerId, e\.clientX\);/);
  // The playhead ball itself still takes no pointer events (the track scrubs).
  assert.match(src, /boxShadow: `0 0 0 3px \$\{accent\}, 0 2px 8px rgba\(0,0,0,0\.35\)`,\s*pointerEvents: 'none',/);
});
