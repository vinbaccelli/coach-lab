import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_MS, INFO_MS, UNTRACKED_PROGRESS_MS, statusKind, statusLifetimeMs } from '@/lib/statusToast';

test('finished messages are info and go after 4 s', () => {
  for (const m of [
    'AI Track ready — 118 frame-exact poses locked. Play at any speed.',
    'AI Track cancelled',
    'AI Track cleared — live tracking resumed',
    'Skeleton ready — press play',
    'Skeleton analyzed for the export — 120 frame-exact poses.',
  ]) {
    assert.equal(statusKind(m), 'info', m);
    assert.equal(statusLifetimeMs('info', false), INFO_MS);
  }
});

test('errors get a close button lifetime of 10 s', () => {
  for (const m of [
    'AI Track found no skeleton in that range',
    'Skeleton analysis found no player in that range',
    'Could not start video capture — try again',
    'Skeleton load failed — check your connection',
    'AI Track stopped: your locked player was not found at 2.10 s (0 people detected there). Lock the player again, then retry.',
  ]) assert.equal(statusKind(m), 'error', m);
  assert.equal(statusLifetimeMs('error', true), ERROR_MS);
  assert.equal(statusLifetimeMs('error', false), ERROR_MS);
});

test('progress messages stay while their task runs and go after the task ends', () => {
  for (const m of ['Loading precision tracking model…', 'AI-tracking… 42% (0.5× · real feet)', 'Preparing perfect skeleton for the recording…']) {
    assert.equal(statusKind(m), 'progress', m);
  }
  assert.equal(statusLifetimeMs('progress', true), null);
  assert.equal(statusLifetimeMs('progress', false), UNTRACKED_PROGRESS_MS);
});

test('an unrecognised plain message is info', () => {
  assert.equal(statusKind('Load a video first'), 'info');
  assert.equal(statusKind('Enable Skeleton first, then run AI Track'), 'info');
});
