import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateDraftBitmaps } from '../lib/stroMotionDraft/exportDraft';
import type { StroMotionDraft, StroMotionFrameDraft } from '../lib/stroMotionDraft/types';

const W = 1920, H = 1080;
const video = { videoWidth: W, videoHeight: H } as unknown as HTMLVideoElement;
const bmp = (w = W, h = H) => ({ width: w, height: h, close() { (this as { width: number }).width = 0; (this as { height: number }).height = 0; } }) as unknown as ImageBitmap;
const closed = () => bmp(0, 0);
const frame = (index: number, sourceFrame: ImageBitmap | null): StroMotionFrameDraft => ({
  index, timeSec: index * 0.5, label: '', status: 'ready', selectionBox: null, sourceFrame, aiSnapshot: null, working: null, readyMask: null,
} as StroMotionFrameDraft);
const draftOf = (plate: ImageBitmap, frames: StroMotionFrameDraft[], vw = W, vh = H) =>
  ({ schemaVersion: '1.1-coach-override', objectType: 'player', backgroundTimeSec: 0, backgroundPlate: plate, frames, sampleTimes: [], videoWidth: vw, videoHeight: vh } as unknown as StroMotionDraft);
const counting = () => { const calls: number[] = []; return { calls, capture: async (_v: HTMLVideoElement, t: number) => { calls.push(t); return bmp(); } }; };

test('live, native-size bitmaps are reused: nothing is captured and the SAME draft object comes back', async () => {
  const d = draftOf(bmp(), [frame(1, bmp()), frame(2, bmp())]);
  const c = counting();
  const r = await hydrateDraftBitmaps(video, d, c.capture);
  assert.equal(c.calls.length, 0);
  assert.equal(r.draft, d, 'same object ⇒ the caller can skip setDraft');
  assert.equal(r.created.length, 0);
});

test('a closed bitmap is re-captured (the original safety), the live ones are kept', async () => {
  const live = bmp();
  const d = draftOf(bmp(), [frame(1, live), frame(2, closed()), frame(3, null)]);
  const c = counting();
  const r = await hydrateDraftBitmaps(video, d, c.capture);
  assert.deepEqual(c.calls, [1.0, 1.5], 'only frames 2 (closed) and 3 (missing)');
  assert.equal(r.draft.frames[0].sourceFrame, live, 'the live bitmap is untouched');
  assert.notEqual(r.draft, d);
  assert.equal(r.created.length, 2);
});

test('a closed plate is re-captured at the draft background time', async () => {
  const d = draftOf(closed(), [frame(1, bmp())]);
  const c = counting();
  const r = await hydrateDraftBitmaps(video, d, c.capture);
  assert.deepEqual(c.calls, [0]);
  assert.equal(r.created.length, 1);
  assert.ok(r.draft.backgroundPlate.width === W);
});

test('a bitmap of another size (phone-capped capture) is re-captured at native size', async () => {
  const d = draftOf(bmp(1280, 720), [frame(1, bmp(1280, 720))], 1280, 720);
  const c = counting();
  const r = await hydrateDraftBitmaps(video, d, c.capture);
  assert.equal(c.calls.length, 2, 'plate + frame');
  assert.equal(r.draft.videoWidth, W);
  assert.equal(r.draft.videoHeight, H);
});

test('a failed capture keeps the old frame (as before) and does not throw', async () => {
  const old = closed();
  const d = draftOf(bmp(), [frame(1, old)]);
  const r = await hydrateDraftBitmaps(video, d, async () => { throw new Error('seek failed'); });
  assert.equal(r.draft, d, 'nothing changed ⇒ same draft');
  assert.equal(r.draft.frames[0].sourceFrame, old);
});

test('a video that is not ready (0x0) returns the draft untouched', async () => {
  const d = draftOf(closed(), [frame(1, closed())]);
  const c = counting();
  const r = await hydrateDraftBitmaps({ videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement, d, c.capture);
  assert.equal(c.calls.length, 0);
  assert.equal(r.draft, d);
});
