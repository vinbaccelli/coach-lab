import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAnalysisSession } from '../lib/playbackAnalysis';
import { exportButtonLabel } from '../lib/exportOverlay';

/** A fake <video> that records the order of what the session does to it. */
function installFakeDocument(playResult: () => Promise<void>) {
  const calls: string[] = [];
  const video: Record<string, unknown> = {
    set muted(v: boolean) { calls.push(`muted=${v}`); },
    set playsInline(v: boolean) { calls.push(`playsInline=${v}`); },
    set preload(v: string) { calls.push(`preload=${v}`); },
    set loop(v: boolean) { calls.push(`loop=${v}`); },
    set crossOrigin(v: string) { calls.push(`crossOrigin=${v}`); },
    set src(v: string) { calls.push(`src=${v}`); },
    set playbackRate(v: number) { calls.push(`rate=${v}`); },
    play: () => { calls.push('play()'); return playResult(); },
    pause: () => { calls.push('pause()'); },
    removeAttribute: (n: string) => { calls.push(`removeAttribute(${n})`); },
    load: () => { calls.push('load()'); },
  };
  (globalThis as unknown as { document: unknown }).document = { createElement: () => video };
  return calls;
}

test('the analysis player calls play() synchronously, before the session is even returned, and after src is set', async () => {
  const calls = installFakeDocument(() => Promise.resolve());
  const s = openAnalysisSession('blob:abc');
  // Nothing was awaited: play() is already in the call list when openAnalysisSession returns.
  assert.ok(calls.includes('play()'));
  assert.ok(calls.indexOf('src=blob:abc') < calls.indexOf('play()'));
  assert.ok(calls.includes('muted=true') && calls.includes('playsInline=true') && calls.includes('loop=true') && calls.includes('rate=0.25'));
  assert.ok(!calls.some((c) => c.startsWith('crossOrigin')), 'blob URLs need no CORS');
  assert.equal(await s.playOutcome, 'ok');
});

test('a refused play() (iOS NotAllowedError) is reported as "blocked", any other failure as "error"', async () => {
  installFakeDocument(() => Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' })));
  assert.equal(await openAnalysisSession('blob:x').playOutcome, 'blocked');
  installFakeDocument(() => Promise.reject(new Error('boom')));
  assert.equal(await openAnalysisSession('blob:x').playOutcome, 'error');
  const calls = installFakeDocument(() => { throw new Error('sync'); });
  assert.equal(await openAnalysisSession('blob:x').playOutcome, 'error');
  assert.ok(calls.includes('play()'));
});

test('a non-blob URL is read with CORS; close() pauses and unloads', async () => {
  const calls = installFakeDocument(() => Promise.resolve());
  const s = openAnalysisSession('https://example.com/v.mp4');
  assert.ok(calls.includes('crossOrigin=anonymous'));
  await s.playOutcome;
  s.close();
  assert.deepEqual(calls.slice(-3), ['pause()', 'removeAttribute(src)', 'load()']);
});

test('main button label: retry states first, then analyze-first, else Export', () => {
  const base = { panelAnalysis: false, includeSkeleton: true, skeletonState: 'playback' as const, trackedFraction: 0 };
  assert.equal(exportButtonLabel({ ...base, retry: 'analysis' }), 'Tap to start the analysis');
  assert.equal(exportButtonLabel({ ...base, retry: 'export' }), 'Tap to retry the export');
  assert.equal(exportButtonLabel({ ...base, retry: null }), 'Analyze skeleton');
  assert.equal(exportButtonLabel({ ...base, retry: null, trackedFraction: 1, skeletonState: 'ready' }), 'Export');
  assert.equal(exportButtonLabel({ ...base, retry: null, includeSkeleton: false }), 'Export');
  assert.equal(exportButtonLabel({ ...base, retry: null, panelAnalysis: true }), 'Analyze skeleton + export');
});
