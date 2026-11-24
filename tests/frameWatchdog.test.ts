import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithWatchdog, StepTimedOut } from '../lib/stroMotionDraft/frameWatchdog';

const never = () => new Promise<number>(() => { /* hangs */ });

test('a step that answers in time is returned untouched and never recovered', async () => {
  let recovered = 0;
  assert.equal(await runWithWatchdog(async () => 7, { timeoutMs: 50, recover: async () => { recovered++; } }), 7);
  assert.equal(recovered, 0);
});

test('a hung first attempt is recovered once and the retry result is used', async () => {
  let calls = 0, recovered = 0;
  const v = await runWithWatchdog(() => (++calls === 1 ? never() : Promise.resolve(42)), { timeoutMs: 30, recover: async () => { recovered++; } });
  assert.equal(v, 42);
  assert.equal(calls, 2);
  assert.equal(recovered, 1);
});

test('two hangs in a row throw StepTimedOut so the caller can skip the frame', async () => {
  const seen: number[] = [];
  await assert.rejects(runWithWatchdog(never, { timeoutMs: 20, onTimeout: (n) => seen.push(n) }), StepTimedOut);
  assert.deepEqual(seen, [1, 2]);
});

test('a real error is not retried', async () => {
  let calls = 0;
  await assert.rejects(runWithWatchdog(async () => { calls++; throw new Error('boom'); }, { timeoutMs: 50 }), /boom/);
  assert.equal(calls, 1);
});
