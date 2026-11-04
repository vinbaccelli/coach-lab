import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRAIL_KEY, ERROR_BLAME_WINDOW_MS, classifyRestart, installRestartBreadcrumb, readTrail, type Trail,
} from '@/lib/restartBreadcrumb';
import { AUTODETECT_KILLED_NOTICE } from '@/lib/stroMotionDraft/phoneBudget';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
function envOf(storage: ReturnType<typeof mem> | null, navType: string | undefined, visibility = 'visible', t = { now: 1000 }) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: visibility });
  return { win, doc, t, env: { win: win as never, doc: doc as never, storage, navType, now: () => t.now } };
}

// ── a normal load ───────────────────────────────────────────────────────────

test('first load: no verdict, record written as running', () => {
  const s = mem();
  const { env } = envOf(s, 'navigate');
  const { verdict } = installRestartBreadcrumb(env);
  assert.equal(verdict, null);
  assert.equal(readTrail(s)?.state, 'running');
});

test('normal exit then a normal load: no notice', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.win.dispatchEvent(new Event('pagehide'));
  assert.equal(readTrail(s)?.state, 'leaving');
  const b = envOf(s, 'navigate');
  assert.equal(installRestartBreadcrumb(b.env).verdict, null);
});

test('backgrounded then foregrounded and left normally: no notice', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.doc.visibilityState = 'hidden'; a.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(readTrail(s)?.state, 'hidden');
  a.doc.visibilityState = 'visible'; a.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(readTrail(s)?.state, 'running');
  a.win.dispatchEvent(new Event('pagehide'));
  assert.equal(installRestartBreadcrumb(envOf(s, 'navigate').env).verdict, null);
});

test('pagehide followed by a hidden visibilitychange still counts as leaving', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.win.dispatchEvent(new Event('pagehide'));
  a.doc.visibilityState = 'hidden'; a.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(readTrail(s)?.state, 'leaving');
  assert.equal(installRestartBreadcrumb(envOf(s, 'navigate').env).verdict, null);
  a.win.dispatchEvent(new Event('pageshow'));
  assert.equal(readTrail(s)?.state, 'running');
});

// ── a reload ────────────────────────────────────────────────────────────────

test('a reload: pagehide was seen, the new load is type reload', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.win.dispatchEvent(new Event('pagehide'));
  const v = installRestartBreadcrumb(envOf(s, 'reload').env).verdict;
  assert.equal(v?.reason, 'reload');
  assert.match(v!.text, /^The page restarted\. Reason: a reload/);
});

// ── an unclean exit ─────────────────────────────────────────────────────────

test('unclean exit while visible: killed by the phone', () => {
  const s = mem();
  installRestartBreadcrumb(envOf(s, 'navigate').env); // never fires pagehide
  const v = installRestartBreadcrumb(envOf(s, 'reload').env).verdict;
  assert.equal(v?.reason, 'killed');
  assert.match(v!.text, /killed by the phone/);
});

test('unclean exit while in the background: says so', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.doc.visibilityState = 'hidden'; a.doc.dispatchEvent(new Event('visibilitychange'));
  const v = installRestartBreadcrumb(envOf(s, 'reload').env).verdict;
  assert.equal(v?.reason, 'killed');
  assert.match(v!.text, /in the background/);
});

test('page cached for back/forward (persisted pagehide) is not "leaving"', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.win.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  assert.equal(readTrail(s)?.state, 'hidden');
  a.win.dispatchEvent(new Event('pageshow'));
  assert.equal(readTrail(s)?.state, 'running');
});

// ── a script error ──────────────────────────────────────────────────────────

test('a script error just before the end is named', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.t.now = 5000;
  a.win.dispatchEvent(Object.assign(new Event('error'), { message: 'boom' }));
  const v = installRestartBreadcrumb(envOf(s, 'reload').env).verdict;
  assert.equal(v?.reason, 'script-error');
  assert.match(v!.text, /a script error \(boom\)/);
});

test('an unhandled rejection is recorded the same way', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('nope') }));
  assert.match(installRestartBreadcrumb(envOf(s, 'reload').env).verdict!.text, /\(nope\)/);
});

test('an old error is not blamed for a later kill', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.win.dispatchEvent(Object.assign(new Event('error'), { message: 'old' }));
  a.t.now += ERROR_BLAME_WINDOW_MS + 1;
  a.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(installRestartBreadcrumb(envOf(s, 'reload').env).verdict?.reason, 'killed');
});

test('error then a reload (for example the error screen button): script error wins', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  installRestartBreadcrumb(a.env);
  a.win.dispatchEvent(Object.assign(new Event('error'), { message: 'bad' }));
  a.win.dispatchEvent(new Event('pagehide'));
  assert.equal(installRestartBreadcrumb(envOf(s, 'reload').env).verdict?.reason, 'script-error');
});

// ── never blocks ────────────────────────────────────────────────────────────

test('blocked storage or a corrupt record never throws', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => installRestartBreadcrumb({ ...envOf(null, 'reload').env, storage: bad }));
  assert.doesNotThrow(() => installRestartBreadcrumb(envOf(null, 'reload').env));
  const s = mem(); s.m.set(TRAIL_KEY, '{not json');
  assert.equal(installRestartBreadcrumb(envOf(s, 'reload').env).verdict, null);
  s.m.set(TRAIL_KEY, JSON.stringify({ state: 'weird', at: 1 }));
  assert.equal(classifyRestart(readTrail(s), 'reload'), null);
});

test('dispose removes the listeners', () => {
  const s = mem();
  const a = envOf(s, 'navigate');
  const { dispose } = installRestartBreadcrumb(a.env);
  dispose();
  a.win.dispatchEvent(new Event('pagehide'));
  assert.equal(readTrail(s)?.state, 'running');
});

test('classifyRestart: a normal navigation after a clean exit is silent', () => {
  const t: Trail = { state: 'leaving', at: 1, lastError: null };
  assert.equal(classifyRestart(t, 'navigate'), null);
  assert.equal(classifyRestart(t, 'back_forward'), null);
  assert.equal(classifyRestart(null, 'reload'), null);
});

// ── wording and wiring ──────────────────────────────────────────────────────

test('the Auto-detect kill notice has the requested wording and no clip-length advice', () => {
  assert.equal(AUTODETECT_KILLED_NOTICE, "Auto-detect was stopped by your phone's memory. Close other tabs and apps, then run it again.");
  assert.doesNotMatch(AUTODETECT_KILLED_NOTICE, /shorter|clip/i);
});

test('page: the breadcrumb and the toolbar overlay are phone-gated; off a phone the rail is unchanged', () => {
  const src = readFileSync('app/analysis/page.tsx', 'utf8');
  assert.match(src, /if \(!isPhoneBudgetActive\(\)\) return;\n\s+setPhoneGate\(true\);/);
  assert.match(src, /const railOverlay = phoneGate && compactToolbarRail;/);
  assert.match(src, /width: railOverlay \? TOOLBAR_MOBILE_W : toolbarWidthPx,/);
  assert.match(src, /transition: railOverlay \? 'none' : 'width 200ms ease',/);
  assert.match(src, /overflow: railOverlay \? 'visible' : 'hidden',/);
});
