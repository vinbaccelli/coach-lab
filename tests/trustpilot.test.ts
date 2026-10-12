import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  REVIEW_COLLECTOR_ATTRS, REVIEW_COLLECTOR_HEIGHT_PX, TRUSTBOX_BOOTSTRAP_SRC, TRUSTPILOT_PROFILE_URL,
  markCredentialless, renderTrustBox, type TrustpilotGlobal,
} from '@/lib/trustpilot';

/** A fake element: holds an iframe or not. */
const el = (hasIframe: boolean) => ({ querySelector: (sel: string) => (sel === 'iframe' && hasIframe ? ({} as Element) : null) });
function fakeTp() {
  const calls: Array<{ el: unknown; force?: boolean }> = [];
  const tp: TrustpilotGlobal = { loadFromElement: (e, force) => { calls.push({ el: e, force }); } };
  return { tp, calls };
}

test('widget config is the owner\'s snippet; bootstrap is the https v5 TrustBox script', () => {
  assert.deepEqual(REVIEW_COLLECTOR_ATTRS, {
    'data-locale': 'en-US',
    'data-template-id': '56278e9abfbbba0bdcd568bc',
    'data-businessunit-id': '6a99ec11d6c78a72f845bbda',
    'data-style-height': '52px',
    'data-style-width': '100%',
    'data-token': 'ec082cc8-1747-47ed-bf13-28e8101cc854',
  });
  assert.equal(`${REVIEW_COLLECTOR_HEIGHT_PX}px`, REVIEW_COLLECTOR_ATTRS['data-style-height'], 'reserved height = widget height');
  assert.equal(TRUSTBOX_BOOTSTRAP_SRC, 'https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js');
  assert.equal(TRUSTPILOT_PROFILE_URL, 'https://www.trustpilot.com/review/anglemotion.com');
});

test('after client-side navigation (fresh element, script already loaded) the widget is rendered once', () => {
  const { tp, calls } = fakeTp();
  const box = el(false);
  assert.equal(renderTrustBox(box, tp), 'rendered');
  assert.deepEqual(calls, [{ el: box, force: true }]);
});

test('on a full page load the bootstrap already rendered it: no second render', () => {
  const { tp, calls } = fakeTp();
  assert.equal(renderTrustBox(el(true), tp), 'already');
  assert.equal(calls.length, 0);
});

test('script missing or failed, or element gone: nothing happens (the fallback link stays)', () => {
  const { tp, calls } = fakeTp();
  assert.equal(renderTrustBox(el(false), undefined), 'unavailable');
  assert.equal(renderTrustBox(el(false), {} as TrustpilotGlobal), 'unavailable');
  assert.equal(renderTrustBox(null, tp), 'unavailable');
  assert.equal(calls.length, 0);
});

/** A fake iframe recording attribute writes; `supported` = the browser knows the credentialless attribute. */
function fakeIframe(supported: boolean, src: string | null) {
  const attrs = new Map<string, string>(src === null ? [] : [['src', src]]);
  const writes: string[] = [];
  const f = {
    hasAttribute: (n: string) => attrs.has(n),
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => { attrs.set(n, v); writes.push(n); },
    ...(supported ? { credentialless: false } : {}),
  };
  return { f, writes, attrs };
}

test('COEP: the TrustBox iframe is marked credentialless and its load restarted, exactly once', () => {
  const { f, writes, attrs } = fakeIframe(true, 'https://widget.trustpilot.com/trustboxes/x/index.html');
  assert.equal(markCredentialless(f), true);
  assert.deepEqual(writes, ['credentialless', 'src'], 'attribute first, then the src re-set that restarts the load');
  assert.equal(attrs.get('src'), 'https://widget.trustpilot.com/trustboxes/x/index.html');
  assert.equal(markCredentialless(f), false, 'second mutation callback: no second reload');
  assert.deepEqual(writes, ['credentialless', 'src']);
  // No src yet: only marked; the bootstrap's later src assignment loads it credentialless.
  const noSrc = fakeIframe(true, null);
  assert.equal(markCredentialless(noSrc.f), true);
  assert.deepEqual(noSrc.writes, ['credentialless']);
  // A browser without the attribute: left alone.
  const old = fakeIframe(false, 'https://widget.trustpilot.com/a');
  assert.equal(markCredentialless(old.f), false);
  assert.deepEqual(old.writes, []);
});

/** Every .ts/.tsx file under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

test('the widget and its script are only on the public landing — never in /analysis or the app', () => {
  const root = process.cwd();
  const users = [...sources(join(root, 'app')), ...sources(join(root, 'components'))]
    .filter((f) => /TrustpilotReviewCollector|TRUSTBOX_BOOTSTRAP_SRC|tp\.widget\.bootstrap/.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(root.length + 1).replace(/\\/g, '/'))
    .sort();
  assert.deepEqual(users, ['components/LandingPage.tsx', 'components/TrustpilotReviewCollector.tsx']);
  // The landing is rendered only for signed-out visitors, from the root route.
  const landingUsers = sources(join(root, 'app')).filter((f) => /components\/LandingPage'/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(landingUsers.map((f) => f.slice(root.length + 1).replace(/\\/g, '/')), ['app/page.tsx']);
});
