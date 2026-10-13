import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tourWaitPhase } from '@/lib/tourWait';
import { readTourState, reportTourState } from '@/lib/tourSignals';
import { INTRO_TOUR } from '@/components/tours/introTour';

const SLOW = 15_000;
const at = (state: Parameters<typeof tourWaitPhase>[0]['state'], elapsedMs: number, readyPromptVisible = false) =>
  tourWaitPhase({ state, readyPromptVisible, elapsedMs, slowAfterMs: SLOW });

test('loading: while the skeleton loads (or before any report) the step shows the waiting state', () => {
  assert.equal(at('loading', 0), 'loading');
  assert.equal(at('loading', SLOW - 1), 'loading');
  assert.equal(at(null, 2_000), 'loading', 'no report yet counts as still loading');
});

test('ready: the skeleton is ready, or the app asks "Is the skeleton over the player?"', () => {
  assert.equal(at('ready', 0), 'ready');
  assert.equal(at('ready', 60_000), 'ready');
  assert.equal(at('loading', 3_000, true), 'ready', 'the question on screen wins');
  assert.equal(at(null, 0, true), 'ready');
  assert.equal(at('failed', 20_000, true), 'ready');
});

test('timeout: still loading after 15 s shows the fallback line too', () => {
  assert.equal(at('loading', SLOW), 'slow');
  assert.equal(at('loading', 90_000), 'slow');
  assert.equal(at(null, SLOW), 'slow');
  // A late success still switches to the instructions.
  assert.equal(at('ready', 90_000), 'ready');
});

test('failure: a reported load failure shows the fallback line at once', () => {
  assert.equal(at('failed', 0), 'failed');
  assert.equal(at('failed', SLOW + 1), 'failed');
});

test('the app state store: last report wins, repeats are no-ops', () => {
  reportTourState('skeleton', 'loading');
  assert.equal(readTourState('skeleton'), 'loading');
  reportTourState('skeleton', 'loading');
  reportTourState('skeleton', 'failed');
  assert.equal(readTourState('skeleton'), 'failed');
  reportTourState('skeleton', 'ready');
  assert.equal(readTourState('skeleton'), 'ready');
});

test('Getting started step 7 waits on the skeleton, holds back Yes / No, never advances by itself', () => {
  const i = INTRO_TOUR.steps.findIndex((s) => s.id === 'skeleton-check');
  assert.equal(i, 6, 'it is step 7');
  const s = INTRO_TOUR.steps[i];
  assert.equal(s.title, 'Check it found your player');
  assert.deepEqual(s.advance, { kind: 'next' }, 'only the coach moves on (Next / Skip / Back)');
  assert.ok(s.wait);
  assert.equal(s.wait.state, 'skeleton');
  assert.equal(s.wait.readySelector, '[data-tour-id="skeleton-confirm"]');
  assert.equal(s.wait.loadingText, 'Loading the skeleton, this can take a few seconds…');
  assert.equal(s.wait.slowText, 'Still loading. If nothing appears, tap Skeleton again or reload the page.');
  assert.equal(s.wait.slowAfterMs, 15_000);
  assert.doesNotMatch(s.wait.loadingText + s.wait.slowText, /\b(Yes|No)\b/, 'no Yes / No while loading');
  assert.match(s.body, /answer Yes/);
  assert.match(s.body, /answer No, then click your player/);
});

test('the app reports the skeleton where it already detects it, and the question carries the tour id', () => {
  const root = process.cwd();
  const canvas = readFileSync(join(root, 'components/Canvas.tsx'), 'utf8');
  assert.match(canvas, /drawCanvasHint\(ctx, dx, dy, dw, 'Preparing the skeleton…'\);\s*reportTourState\('skeleton', 'loading'\)/);
  assert.match(canvas, /bridge\.onReady\(\(\) => \{\s*onProcessingStatus\?\.\('Skeleton ready — press play'\);\s*reportTourState\('skeleton', 'ready'\)/);
  assert.match(canvas, /startsWith\('Skeleton load failed'\)\) reportTourState\('skeleton', 'failed'\)/);
  const bridge = readFileSync(join(root, 'lib/poseWorkerBridge.ts'), 'utf8');
  assert.match(bridge, /statusCb\?\.\(`Skeleton load failed:/, 'the failure message the Canvas check relies on');
  const page = readFileSync(join(root, 'app/analysis/page.tsx'), 'utf8');
  assert.match(page, /\{skeletonConfirmOpen && createPortal\(\s*<div\s*data-tour-id="skeleton-confirm"/);
});
