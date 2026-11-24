import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canUse, FEATURES, NO_ENTITLEMENT } from '@/lib/entitlements';
import { entryImages, deriveBlocks, type EntryLike } from '@/lib/reports/deriveBlocks';

const read = (p: string) => readFileSync(p, 'utf8');
const route = read('app/api/google/upload-image/route.ts');
const saveLib = read('lib/reports/saveScreenshot.ts');
const analysis = read('app/analysis/page.tsx');

const who = {
  none: { ...NO_ENTITLEMENT },
  light: { ...NO_ENTITLEMENT, plan: 'light' as const, interval: 'month' as const },
  pro: { ...NO_ENTITLEMENT, plan: 'pro' as const, interval: 'month' as const },
  academy: { ...NO_ENTITLEMENT, plan: 'academy' as const, interval: 'year' as const },
};

test('the Drive upload for a screenshot is gated by saveToPlayer, which Light, Pro and Academy have and an unpaid account does not', () => {
  assert.equal(FEATURES.saveToPlayer.plan, 'light');
  for (const k of ['light', 'pro', 'academy'] as const) assert.equal(canUse('saveToPlayer', who[k]), true, k);
  assert.equal(canUse('saveToPlayer', who.none), false);
  const handler = route.slice(route.indexOf('export async function POST('));
  assert.match(handler, /requireFeature\(session\.supabase, \{ id: session\.userId, email: session\.email \}, 'saveToPlayer'\)/);
  assert.equal(handler.includes("'docsExport'"), false, 'the Pro-only Docs gate is gone from this route');
});

test('the upload route tells the app when reconnecting Google is the fix', () => {
  assert.match(route, /code: 'google_not_connected'/);
  assert.match(route, /code: 'google_reauth'/);
  assert.match(route, /status: 401/);
});

test('no Supabase fallback for new screenshots: not in the save logic, not in the analysis app', () => {
  assert.equal(/uploadFallback|player-assets|storage: 'supabase'/.test(saveLib.replace(/\/\*[\s\S]*?\*\//, '')), false);
  assert.equal(analysis.includes('uploadFallback'), false);
  assert.equal(/uploadDataUrl\('player-assets'/.test(analysis), false);
});

test('a failed save keeps the capture in memory and offers "Reconnect Google Drive"', () => {
  const start = analysis.indexOf('const result = await saveScreenshotToPlayer(');
  const end = analysis.indexOf('const handleScreenshotCreateAndSave');
  const handler = analysis.slice(start, end);
  const failure = handler.slice(handler.indexOf('if (!result.ok) {'), handler.indexOf('if (result.linkUrl)'));
  assert.ok(failure.includes('reconnect: result.reconnect'));
  assert.equal(/setScreenshotDataUrl\(null\)|setScreenshotPickerOpen\(false\)/.test(failure), false, 'the capture and the picker stay');
  assert.ok(analysis.includes('Reconnect Google Drive'));
  assert.ok(analysis.includes('skipBrowserRedirect: true'), 'reconnect opens a new tab, the page (and its capture) is not reloaded');
});

test('old screenshots already in the public bucket (or on Drive) still become report images; nothing rewrites them', () => {
  const OLD = 'https://x.supabase.co/storage/v1/object/public/player-assets/u/screenshots/1.png';
  const DRIVE = 'https://drive.google.com/uc?export=view&id=FILEID1234567';
  const entry = (id: string, shots: string[]): EntryLike => ({
    id, category: 'technique', folder_label: 'Analysis', body_text: 'Screenshot from analysis session.',
    youtube_url: null, opponent_name: null, match_date: null, screenshots: shots, metadata: {}, created_at: '2026-10-27T10:00:00Z',
  } as EntryLike);
  assert.deepEqual(entryImages(entry('a', [OLD])).map((i) => i.url), [OLD]);
  const blocks = deriveBlocks([entry('a', [OLD]), entry('b', [DRIVE])], 'technical');
  const shots = blocks.find((b) => b.type === 'screenshots');
  assert.ok(shots && shots.type === 'screenshots');
  assert.deepEqual(shots.images.map((i) => i.url).sort(), [DRIVE, OLD].sort());
  // Deleting a player still cleans up bucket images (the old-bucket dependency is untouched).
  assert.ok(read('lib/players/deletePlayer.ts').includes('/storage/v1/object/public/player-assets/'));
});
