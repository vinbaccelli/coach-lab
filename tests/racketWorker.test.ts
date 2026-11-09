import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCanvasLike } from '../lib/stroMotionDraft/frameCanvas';

const worker = readFileSync(new URL('../lib/stroMotionDraft/racketWorker.ts', import.meta.url), 'utf8');
const pass = readFileSync(new URL('../lib/stroMotionDraft/autoRacketPass.ts', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../hooks/useStroMotion.ts', import.meta.url), 'utf8');
const detect = readFileSync(new URL('../lib/stroMotionDraft/racketDetect.ts', import.meta.url), 'utf8');
const sam = readFileSync(new URL('../lib/stroMotionDraft/samRacket.ts', import.meta.url), 'utf8');

test('isCanvasLike duck-types a canvas and rejects a bitmap', () => {
  assert.equal(isCanvasLike({ getContext() { return null; } } as never), true);
  assert.equal(isCanvasLike({ width: 1, height: 1, close() {} } as never), false);
});

test('the model modules no longer use instanceof HTMLCanvasElement / document.createElement (neither exists in a worker)', () => {
  assert.doesNotMatch(detect, /instanceof HTMLCanvasElement/);
  assert.doesNotMatch(sam, /instanceof HTMLCanvasElement/);
  assert.doesNotMatch(detect, /document\.createElement/);
  assert.doesNotMatch(sam, /document\.createElement/);
});

test('the worker shims window BEFORE it imports the model modules (Next defines typeof window as "object")', () => {
  const shim = worker.indexOf('(globalThis as { window?: unknown }).window = globalThis');
  const firstImport = worker.indexOf("await import('@/lib/stroMotionDraft/racketDetect')");
  assert.ok(shim > 0 && firstImport > shim);
});

test('the pass falls back to the in-page path when the worker fails, and terminates the SAM worker at the end', () => {
  assert.match(pass, /worker detection unavailable — using the in-page detector/);
  assert.match(pass, /SAM worker unavailable — using the in-page SAM/);
  assert.match(hook, /finishRacketSegmentation\(\)/);
});
