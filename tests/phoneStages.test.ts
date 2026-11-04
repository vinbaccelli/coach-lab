import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installRestartBreadcrumb, recordStage, readTrail } from '@/lib/restartBreadcrumb';
import {
  combineStorages, markAutoDetectStarted, markAutoDetectFinished, consumeAutoDetectKilled, AUTODETECT_MARKER_KEY,
} from '@/lib/stroMotionDraft/phoneBudget';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
function envOf(storage: ReturnType<typeof mem> | null, navType: string | undefined) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  return { win, doc, env: { win: win as never, doc: doc as never, storage, navType, now: () => 1000 } };
}

test('stage trail: the restart line names the last step', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  const { dispose } = installRestartBreadcrumb(a.env);
  recordStage('Auto-detect: racket segmentation, frame 2');
  assert.equal(readTrail(s)?.stage, 'Auto-detect: racket segmentation, frame 2');
  const v = installRestartBreadcrumb(envOf(s, 'reload').env).verdict;
  assert.match(v!.text, /killed by the phone/);
  assert.match(v!.text, /Last step: Auto-detect: racket segmentation, frame 2\.$/);
  dispose();
});

test('stage trail: recordStage is a no-op before install and after dispose', () => {
  const s = mem();
  recordStage('nothing installed');
  assert.equal(readTrail(s), null);
  const { dispose } = installRestartBreadcrumb(envOf(s, 'navigate').env);
  dispose();
  recordStage('after dispose');
  assert.notEqual(readTrail(s)?.stage, 'after dispose');
});

test('stage trail: the editor events record where the page was', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.win.dispatchEvent(new Event('stro:opening-editor'));
  assert.equal(readTrail(s)?.stage, 'opening the editor (finalize)');
  a.win.dispatchEvent(new Event('stro:first-layers-drawn'));
  assert.equal(readTrail(s)?.stage, 'editor open, first layers drawn');
});

test('stage trail: a normal exit after stages stays silent', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  recordStage('Auto-detect: committing frames');
  a.win.dispatchEvent(new Event('pagehide'));
  assert.equal(installRestartBreadcrumb(envOf(s, 'navigate').env).verdict, null);
});

test('kill marker survives when localStorage is empty but sessionStorage kept it', () => {
  const session = mem();
  const local = mem();
  const both = combineStorages([session, local])!;
  markAutoDetectStarted(both, 1000);
  assert.ok(session.m.has(AUTODETECT_MARKER_KEY) && local.m.has(AUTODETECT_MARKER_KEY));
  local.m.clear(); // a private tab that did not keep localStorage across the kill
  assert.equal(consumeAutoDetectKilled(combineStorages([session, local]), 2000), true);
  assert.equal(session.m.size, 0, 'cleared everywhere once shown');
  assert.equal(consumeAutoDetectKilled(combineStorages([session, local]), 2000), false);
});

test('kill marker: finished clears every store; a blocked store never throws', () => {
  const a = mem(); const b = mem();
  const both = combineStorages([a, b])!;
  markAutoDetectStarted(both, 1);
  markAutoDetectFinished(both);
  assert.equal(a.m.size + b.m.size, 0);
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  const mixed = combineStorages([bad, a])!;
  assert.doesNotThrow(() => markAutoDetectStarted(mixed, 5));
  assert.equal(consumeAutoDetectKilled(mixed, 10), true);
  assert.equal(combineStorages([null, null]), null);
});

test('wiring: marker starts at the click, stages at every phase, COCO warm-up sequenced on phones only', () => {
  const page = readFileSync('app/analysis/page.tsx', 'utf8');
  assert.match(page, /const phoneRun = isPhoneBudgetActive\(\);\n\s+if \(phoneRun\) \{ markAutoDetectStarted\(\);/);
  assert.match(page, /phoneHeld = ok > 0;/);
  assert.match(page, /if \(phoneRun && !phoneHeld\) markAutoDetectFinished\(\);/);
  assert.match(page, /if \(!isPhoneBudgetActive\(\)\) \{\n\s+void import\('@\/lib\/racketCocoDetect'\)\.then\(\(m\) => m\.preloadRacketDetector\(\)\);\n\s+return;/);
  assert.match(page, /while \(!cancelled && stroAutoSelectBusyRef\.current\) await sleep\(1000\);/);
  assert.match(page, /PREPARING_MOTION_LAYER_TEXT/);
  const hook = readFileSync('hooks/useStroMotion.ts', 'utf8');
  for (const needle of ['foot pose, frame', 'racket detector (loading', 'removing background, frame', 'racket segmentation (loading', 'committing frames', 'native-size finalize']) {
    assert.ok(hook.includes(needle), `stage missing: ${needle}`);
  }
});
