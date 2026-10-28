import test from 'node:test';
import assert from 'node:assert/strict';
import { saveScreenshotToPlayer, type SaveScreenshotInput } from '../lib/reports/saveScreenshot';
import { saveReportToPlayers } from '../lib/matchAnalysis/exportToDocs';

type Call = { url: string; body: unknown };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake server: route handlers by URL; records every call. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    return routes[key]();
  }) as typeof fetch;
  return { fn, calls };
}

const base: SaveScreenshotInput = {
  playerId: 'p1',
  playerName: 'Ana',
  dataUrl: 'data:image/png;base64,AAAA',
  googleExports: true,
  inApp: true,
  folderLabel: 'Analysis 2026-10-27 10:00',
  timestampLabel: '2026-10-27 10:00',
  fileName: 'Ana-1.png',
};
const DRIVE = 'https://drive.google.com/uc?export=view&id=FILEID1234567';
const SUPABASE = 'https://x.supabase.co/storage/v1/object/public/player-assets/u/screenshots/1.png';

test('in-app success: Drive upload, entry saved, no Google Doc call, link to the report', async () => {
  const { fn, calls } = fakeFetch({
    '/api/google/upload-image': () => json(200, { url: DRIVE }),
    '/entries': () => json(200, { entry: { id: 'e9' } }),
  });
  let fallbackUsed = false;
  const r = await saveScreenshotToPlayer(base, { fetchFn: fn, uploadFallback: async () => ((fallbackUsed = true), SUPABASE) });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.storage, 'drive');
  assert.equal(r.imageUrl, DRIVE);
  assert.equal(r.linkUrl, '/players/p1/reports/e9');
  assert.equal(r.message, 'Saved to report — Ana');
  assert.equal(fallbackUsed, false);
  assert.ok(!calls.some((c) => c.url.includes('google-doc')), 'no Google Doc write');
  const entry = calls.find((c) => c.url.endsWith('/entries'))!.body as Record<string, unknown>;
  assert.equal(entry.category, 'technique');
  assert.deepEqual(entry.screenshots, [DRIVE]);
});

test('in-app: Drive upload fails (500) -> Supabase fallback, saved, and says why', async () => {
  const { fn, calls } = fakeFetch({
    '/api/google/upload-image': () => json(500, { error: 'Drive storage is full' }),
    '/entries': () => json(200, { entry: { id: 'e1' } }),
  });
  const r = await saveScreenshotToPlayer(base, { fetchFn: fn, uploadFallback: async () => SUPABASE });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.storage, 'supabase');
  assert.equal(r.imageUrl, SUPABASE);
  assert.equal(r.driveError, 'Drive storage is full');
  assert.match(r.message, /Saved to report/);
  assert.match(r.message, /Drive storage is full/);
  assert.deepEqual((calls.find((c) => c.url.endsWith('/entries'))!.body as { screenshots: string[] }).screenshots, [SUPABASE]);
});

test('in-app: Google token missing (403) -> Supabase fallback, and the network throwing does too', async () => {
  const forbidden = fakeFetch({
    '/api/google/upload-image': () => json(403, { error: 'Google access not granted — sign out and sign in again' }),
    '/entries': () => json(200, { entry: { id: 'e2' } }),
  });
  const a = await saveScreenshotToPlayer(base, { fetchFn: forbidden.fn, uploadFallback: async () => SUPABASE });
  assert.ok(a.ok && a.storage === 'supabase');
  assert.match((a as { message: string }).message, /sign out and sign in again/);

  const offline = fakeFetch({
    '/api/google/upload-image': () => {
      throw new TypeError('Failed to fetch');
    },
    '/entries': () => json(200, { entry: { id: 'e3' } }),
  });
  const b = await saveScreenshotToPlayer(base, { fetchFn: offline.fn, uploadFallback: async () => SUPABASE });
  assert.ok(b.ok && b.storage === 'supabase' && b.driveError === 'Failed to fetch');
});

test('in-app: both uploads fail -> failure with the real reason, no entry written', async () => {
  const { fn, calls } = fakeFetch({
    '/api/google/upload-image': () => json(403, { error: 'Google access not granted' }),
  });
  const r = await saveScreenshotToPlayer(base, { fetchFn: fn, uploadFallback: async () => null });
  assert.equal(r.ok, false);
  assert.match(r.message, /Google access not granted/);
  assert.ok(!calls.some((c) => c.url.endsWith('/entries')), 'nothing is saved after a failed upload');
});

test('in-app: the entry save failing is reported with the server reason, never as success', async () => {
  const { fn } = fakeFetch({
    '/api/google/upload-image': () => json(200, { url: DRIVE }),
    '/entries': () => json(403, { error: 'plan_required' }),
  });
  const r = await saveScreenshotToPlayer(base, { fetchFn: fn, uploadFallback: async () => SUPABASE });
  assert.equal(r.ok, false);
  assert.match(r.message, /plan_required/);
});

test('Google exports off + in-app: straight to Supabase, no Drive call', async () => {
  const { fn, calls } = fakeFetch({ '/entries': () => json(200, { entry: { id: 'e4' } }) });
  const r = await saveScreenshotToPlayer({ ...base, googleExports: false }, { fetchFn: fn, uploadFallback: async () => SUPABASE });
  assert.ok(r.ok && r.storage === 'supabase');
  assert.ok(!calls.some((c) => c.url.includes('upload-image')));
});

test('switch OFF: Drive upload, entry, then the Google Doc append — messages unchanged', async () => {
  const off = { ...base, inApp: false };
  const ok = fakeFetch({
    '/api/google/upload-image': () => json(200, { url: DRIVE }),
    '/entries': () => json(200, { entry: { id: 'e5' } }),
    '/google-doc': () => json(200, { documentId: 'D', url: 'https://docs.google.com/document/d/D/edit' }),
  });
  const a = await saveScreenshotToPlayer(off, { fetchFn: ok.fn, uploadFallback: async () => SUPABASE });
  assert.ok(a.ok);
  if (a.ok) {
    assert.equal(a.message, 'Saved to Ana + Google Doc');
    assert.equal(a.linkUrl, 'https://docs.google.com/document/d/D/edit');
  }
  const docCall = ok.calls.find((c) => c.url.includes('google-doc'))!;
  assert.deepEqual(docCall.body, { imageUrl: DRIVE, timestampLabel: '2026-10-27 10:00' });

  const docFails = fakeFetch({
    '/api/google/upload-image': () => json(200, { url: DRIVE }),
    '/entries': () => json(200, { entry: { id: 'e6' } }),
    '/google-doc': () => json(403, { error: 'Google access not granted' }),
  });
  const b = await saveScreenshotToPlayer(off, { fetchFn: docFails.fn, uploadFallback: async () => SUPABASE });
  assert.ok(b.ok);
  assert.equal(b.message, 'Saved to Ana — Google Doc failed: Google access not granted');

  const uploadDown = fakeFetch({ '/api/google/upload-image': () => json(500, { error: 'x' }) });
  const c = await saveScreenshotToPlayer(off, { fetchFn: uploadDown.fn, uploadFallback: async () => null });
  assert.deepEqual(c, { ok: false, message: 'Upload failed — try again' });

  const entryDown = fakeFetch({
    '/api/google/upload-image': () => json(200, { url: DRIVE }),
    '/entries': () => json(500, { error: 'boom' }),
  });
  const d = await saveScreenshotToPlayer(off, { fetchFn: entryDown.fn, uploadFallback: async () => SUPABASE });
  assert.deepEqual(d, { ok: false, message: 'Failed to save screenshot — try again' });
});

test('decoder save: each outcome carries the in-app report link; a failure carries its error', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/players/bad/')) return json(403, { error: 'plan_required' });
    return json(200, { entry: { id: url.includes('/p1/') ? 'eA' : 'eB' } });
  }) as typeof fetch;
  try {
    const out = await saveReportToPlayers(
      [
        { playerId: 'p1', displayName: 'Ana' },
        { playerId: 'p2', displayName: 'Bo' },
        { playerId: 'bad', displayName: 'Cy' },
      ],
      [{ heading: 'Side A', headingLevel: 'h2' }],
      'Decoder',
      'summary',
    );
    assert.equal(out[0].ok && out[0].reportUrl, '/players/p1/reports/eA');
    assert.equal(out[1].ok && out[1].reportUrl, '/players/p2/reports/eB');
    assert.equal(out[2].ok, false);
    assert.equal(out[2].error, 'plan_required');
    assert.equal(out[2].reportUrl, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the decoder save sends the structured report in metadata; the stage callback reports progress', async () => {
  const realFetch = globalThis.fetch;
  let sent: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_i: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return json(200, { entry: { id: 'eZ' } });
  }) as typeof fetch;
  try {
    const md = { decoderReport: { version: 1, scope: 'A', reports: [], integrityWarnings: [] } };
    await saveReportToPlayers([{ playerId: 'p1', displayName: 'Ana' }], [], 'Decoder', 'summary', undefined, md);
    assert.deepEqual((sent as unknown as { metadata: unknown }).metadata, md);
    await saveReportToPlayers([{ playerId: 'p1', displayName: 'Ana' }], [], 'Decoder', 'summary');
    assert.equal('metadata' in ((sent as unknown) as object), false, 'no metadata key when none is given');
  } finally {
    globalThis.fetch = realFetch;
  }

  const stages: string[] = [];
  const { fn } = fakeFetch({
    '/api/google/upload-image': () => json(200, { url: DRIVE }),
    '/entries': () => json(200, { entry: { id: 'e1' } }),
  });
  await saveScreenshotToPlayer(base, { fetchFn: fn, uploadFallback: async () => SUPABASE, onStage: (s) => stages.push(s) });
  assert.deepEqual(stages, ['uploading', 'saving']);
});
