import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TOURS_URL_PARAM, resolveToursEnabled } from '@/lib/toursSwitch';

test('switch off: tours hidden by default (no param, no opt-in)', () => {
  assert.deepEqual(resolveToursEnabled(false, '', false), { enabled: false, store: null });
  assert.deepEqual(resolveToursEnabled(false, '?playerId=abc', false), { enabled: false, store: null });
  // Anything but exactly "1" does not opt in.
  for (const v of ['true', 'yes', '2', '', ' 1']) {
    assert.equal(resolveToursEnabled(false, `?tours=${encodeURIComponent(v)}`, false).enabled, false, `?tours=${v}`);
  }
});

test('switch off: ?tours=1 shows them and remembers it for the session', () => {
  assert.equal(TOURS_URL_PARAM, 'tours');
  assert.deepEqual(resolveToursEnabled(false, '?tours=1', false), { enabled: true, store: 'set' });
  assert.deepEqual(resolveToursEnabled(false, '?playerId=abc&tours=1', false), { enabled: true, store: 'set' });
  // Later pages of the same session, without the param: still on.
  assert.deepEqual(resolveToursEnabled(false, '', true), { enabled: true, store: null });
  assert.deepEqual(resolveToursEnabled(false, '?tours=1', true), { enabled: true, store: null });
  // ?tours=0 turns it off and forgets the opt-in.
  assert.deepEqual(resolveToursEnabled(false, '?tours=0', true), { enabled: false, store: 'clear' });
  assert.deepEqual(resolveToursEnabled(false, '?tours=0', false), { enabled: false, store: null });
});

test('switch on: tours shown for everyone, whatever the URL or session says', () => {
  for (const [search, optedIn] of [['', false], ['?tours=0', false], ['?tours=0', true], ['?tours=1', false]] as const) {
    assert.deepEqual(resolveToursEnabled(true, search, optedIn), { enabled: true, store: null }, `${search} ${optedIn}`);
  }
});

/** Every .ts/.tsx file under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

test('every entry point to the tours goes through the switch', () => {
  const root = process.cwd();
  const rel = (f: string) => f.slice(root.length + 1).replace(/\\/g, '/');
  // Screens mount the gate; the gate loads the engine only when enabled.
  const gate = readFileSync(join(root, 'components/GuidedTour.tsx'), 'utf8');
  assert.match(gate, /dynamic\(\(\) => import\('@\/components\/GuidedTourEngine'\)/);
  assert.match(gate, /const enabled = useToursEnabled\(\);\s*return enabled \? <GuidedTourEngine \{\.\.\.props\} \/> : null;/);
  const files = [...sources(join(root, 'app')), ...sources(join(root, 'components'))];
  const engineUsers = files.filter((f) => /GuidedTourEngine['"]/.test(readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(engineUsers, ['components/GuidedTour.tsx'], 'only the gate imports the engine');
  // The only other way in is the ? in the /analysis zoom cluster: its prop follows the switch.
  const helpProp = files.filter((f) => /showTourHelpInZoomCluster/.test(readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(helpProp, ['app/analysis/page.tsx', 'components/Canvas.tsx']);
  const page = readFileSync(join(root, 'app/analysis/page.tsx'), 'utf8');
  assert.deepEqual(page.match(/showTourHelpInZoomCluster[^\n]*/g), ['showTourHelpInZoomCluster={toursEnabled}']);
  assert.match(page, /const toursEnabled = useToursEnabled\(\);/);
  // Nothing else opens the engine directly.
  const openers = files.filter((f) => /anglemotion-open-guided-tour/.test(readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(openers, ['components/Canvas.tsx', 'components/GuidedTourEngine.tsx']);
});
