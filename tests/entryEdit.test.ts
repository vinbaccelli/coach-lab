import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanNote, deleteEntry, driveIdsOfEntry, editEntryNote, NOTE_MAX, supabaseEntryStore, type EntryRow, type EntryStore } from '@/lib/reports/entryOps';
import { safeHttpUrl } from '@/lib/reports/safeUrl';
import { oneLineNote, saveScreenshotToPlayer, type SaveScreenshotInput } from '@/lib/reports/saveScreenshot';

const read = (p: string) => readFileSync(p, 'utf8');
const DRIVE_A = 'https://drive.google.com/uc?export=view&id=FILEAAAA1234567';
const DRIVE_B = 'https://drive.google.com/uc?export=view&id=FILEBBBB1234567';
const OLD = 'https://x.supabase.co/storage/v1/object/public/player-assets/u/screenshots/1.png';

/** A fake store holding one coach's rows; records the order of every call. */
function fakeStore(rows: Array<EntryRow & { player_id: string; coach_id: string; body_text?: string }>, coachId = 'c1', opts: { deleteError?: string } = {}) {
  const calls: string[] = [];
  const store: EntryStore = {
    async getEntry(playerId, entryId) {
      calls.push(`get:${entryId}`);
      const r = rows.find((x) => x.id === entryId && x.player_id === playerId && x.coach_id === coachId);
      return r ? { id: r.id, category: r.category, screenshots: r.screenshots } : null;
    },
    async updateNote(playerId, entryId, text) {
      calls.push(`update:${entryId}`);
      const r = rows.find((x) => x.id === entryId && x.player_id === playerId && x.coach_id === coachId);
      if (!r) return { error: null, updated: false };
      r.body_text = text;
      return { error: null, updated: true };
    },
    async deleteRow(playerId, entryId) {
      calls.push(`delete:${entryId}`);
      if (opts.deleteError) return { error: opts.deleteError, deleted: false };
      const i = rows.findIndex((x) => x.id === entryId && x.player_id === playerId && x.coach_id === coachId);
      if (i < 0) return { error: null, deleted: false };
      rows.splice(i, 1);
      return { error: null, deleted: true };
    },
  };
  return { store, calls, rows };
}
const row = (id: string, over: Partial<EntryRow & { player_id: string; coach_id: string }> = {}) => ({ id, player_id: 'p1', coach_id: 'c1', category: 'technique', screenshots: [DRIVE_A], body_text: 'Screenshot from analysis session.', ...over });

// ── owner check ─────────────────────────────────────────────────────────────

test('owner check: another coach\'s entry, another player\'s entry and an unknown id are all 404 and nothing is touched', async () => {
  const { store, calls, rows } = fakeStore([row('e1', { coach_id: 'someone-else' }), row('e2', { player_id: 'p2' })]);
  for (const id of ['e1', 'e2', 'nope']) {
    assert.equal((await editEntryNote(store, { playerId: 'p1', entryId: id, note: 'x' })).status, 404, id);
    const trashed: string[] = [];
    const r = await deleteEntry({ store, hasGoogleAccess: true, trashDriveItem: async (f) => { trashed.push(f); }, log() {} }, { playerId: 'p1', entryId: id });
    assert.equal(r.status, 404, id);
    assert.deepEqual(trashed, []);
  }
  assert.equal(rows.length, 2);
  assert.ok(!calls.some((c) => c.startsWith('update') || c.startsWith('delete')));
});

test('the store filters by the URL\'s player AND the coach, on top of RLS (source check)', async () => {
  const src = read('lib/reports/entryOps.ts');
  for (const col of ["'id', entryId", "'player_id', playerId", "'coach_id', coachId"]) assert.ok(src.includes(`.eq(${col})`), col);
  // A real call shape: the helper passes the three filters on the update.
  const seen: string[] = [];
  const chain: any = { eq: (c: string, v: unknown) => (seen.push(`${c}=${v}`), chain), select: () => Promise.resolve({ data: [{ id: 'e1' }], error: null }) };
  const supa = { from: () => ({ select: () => chain, update: () => chain, delete: () => chain }) };
  await supabaseEntryStore(supa as never, 'c1').updateNote('p1', 'e1', 'hi');
  assert.deepEqual(seen, ['id=e1', 'player_id=p1', 'coach_id=c1']);
});

// ── edit ────────────────────────────────────────────────────────────────────

test('edit changes ONLY the note: trimmed, capped, empty allowed; a match entry\'s text is refused', async () => {
  const { store, rows } = fakeStore([row('e1'), row('m1', { category: 'match' })]);
  const ok = await editEntryNote(store, { playerId: 'p1', entryId: 'e1', note: '  Watch the toss\r\nand the shoulder  ' });
  assert.equal(ok.status, 200);
  assert.equal(rows[0].body_text, 'Watch the toss\nand the shoulder');
  assert.equal((await editEntryNote(store, { playerId: 'p1', entryId: 'e1', note: '' })).status, 200);
  assert.equal(rows[0].body_text, '');
  assert.equal((rows[0].screenshots as string[])[0], DRIVE_A, 'the screenshots are untouched');
  assert.equal((await editEntryNote(store, { playerId: 'p1', entryId: 'e1', note: 'x'.repeat(NOTE_MAX + 1) })).status, 400);
  assert.equal((await editEntryNote(store, { playerId: 'p1', entryId: 'e1', note: 42 })).status, 400);
  assert.equal((await editEntryNote(store, { playerId: 'p1', entryId: 'm1', note: 'x' })).status, 400);
  assert.deepEqual(cleanNote('a'), { ok: true, text: 'a' });
});

// ── delete: order and Drive failure ─────────────────────────────────────────

test('delete order: the database row goes first, then each Drive file goes to the TRASH', async () => {
  const { store, calls } = fakeStore([row('e1', { screenshots: [DRIVE_A, DRIVE_B, OLD] })]);
  const order: string[] = [];
  const wrapped: EntryStore = { ...store, deleteRow: async (p, e) => { const r = await store.deleteRow(p, e); order.push('row'); return r; } };
  const r = await deleteEntry({ store: wrapped, hasGoogleAccess: true, trashDriveItem: async (f) => { order.push(`trash:${f}`); }, log() {} }, { playerId: 'p1', entryId: 'e1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.drive, 'trashed');
  assert.deepEqual(order, ['row', 'trash:FILEAAAA1234567', 'trash:FILEBBBB1234567']);
  assert.deepEqual(calls, ['get:e1', 'delete:e1']);
  assert.match(String(r.body.message), /Drive trash/);
});

test('delete: if the row delete fails, STOP: nothing is trashed', async () => {
  const { store } = fakeStore([row('e1')], 'c1', { deleteError: 'permission denied' });
  const trashed: string[] = [];
  const r = await deleteEntry({ store, hasGoogleAccess: true, trashDriveItem: async (f) => { trashed.push(f); }, log() {} }, { playerId: 'p1', entryId: 'e1' });
  assert.equal(r.status, 500);
  assert.deepEqual(trashed, []);
});

test('delete: a Drive failure never undoes the delete; it is logged WITHOUT data and the answer says the image is still in Drive', async () => {
  const { store, rows } = fakeStore([row('e1', { screenshots: [DRIVE_A, DRIVE_B] })]);
  const logs: Array<[string, Record<string, unknown>]> = [];
  const r = await deleteEntry(
    { store, hasGoogleAccess: true, trashDriveItem: async () => { throw new Error('quota for FILEAAAA1234567 user@example.com'); }, log: (m, d) => logs.push([m, d]) },
    { playerId: 'p1', entryId: 'e1' },
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.drive, 'failed');
  assert.equal(rows.length, 0, 'the entry is gone');
  assert.match(String(r.body.message), /still in your Google Drive/);
  assert.equal(logs.length, 1);
  const logged = JSON.stringify(logs);
  assert.deepEqual(logs[0][1], { files: 2, failed: 2 });
  for (const leak of ['FILEAAAA', 'FILEBBBB', 'example.com', 'drive.google.com', 'quota']) assert.equal(logged.includes(leak), false, leak);
});

test('delete: no Google access leaves the Drive file alone and says so; an entry without Drive files says only that it was removed', async () => {
  const a = fakeStore([row('e1')]);
  const ra = await deleteEntry({ store: a.store, hasGoogleAccess: false, trashDriveItem: async () => { throw new Error('must not be called'); }, log() {} }, { playerId: 'p1', entryId: 'e1' });
  assert.equal(ra.body.drive, 'skipped');
  assert.match(String(ra.body.message), /not connected/);
  const b = fakeStore([row('e2', { screenshots: [OLD] })]);
  const rb = await deleteEntry({ store: b.store, hasGoogleAccess: true, trashDriveItem: async () => { throw new Error('must not be called'); }, log() {} }, { playerId: 'p1', entryId: 'e2' });
  assert.equal(rb.body.drive, 'none');
  assert.deepEqual(driveIdsOfEntry([DRIVE_A, DRIVE_A, OLD, 'javascript:alert(1)']), ['FILEAAAA1234567']);
});

// ── link scheme ─────────────────────────────────────────────────────────────

test('link safety: only http and https become links; javascript:, data: and friends do not', () => {
  assert.equal(safeHttpUrl('https://youtu.be/abcdefghijk'), 'https://youtu.be/abcdefghijk');
  assert.equal(safeHttpUrl('  http://example.com/a?b=1 '), 'http://example.com/a?b=1');
  for (const bad of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)', 'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'data:image/svg+xml;base64,PHN2Zz4=', 'vbscript:msgbox(1)', 'file:///etc/passwd',
    '//evil.example/x', '/relative/path', 'youtube.com/watch?v=abcdefghijk', '', '   ', null, undefined, 42, {}, 'https://' + 'a'.repeat(3000),
  ]) assert.equal(safeHttpUrl(bad), null, String(bad));
});

test('link safety is applied everywhere a stored address becomes a link or an image source', () => {
  for (const [file, needle] of [
    ['components/reports/VideoBlock.tsx', 'safeHttpUrl(url)'],
    ['components/reports/DriveImage.tsx', '.map((u) => safeHttpUrl(u))'],
    ['components/players/PlayerProfileClient.tsx', 'safeHttpUrl(e.youtube_url)'],
    ['components/players/PlayerProfileClient.tsx', 'safeHttpUrl(url)'],
    ['components/players/PlayerSessionDetailClient.tsx', 'safeHttpUrl(videoUrl)'],
    ['components/players/PlayerSessionDetailClient.tsx', 'safeHttpUrl(artifact.publicUrl)'],
  ] as const) assert.ok(read(file).includes(needle), `${file}: ${needle}`);
  assert.equal(/href=\{url\}/.test(read('components/reports/VideoBlock.tsx')), false, 'the raw stored address is never an href');
  assert.equal(/href=\{e\.youtube_url\}/.test(read('components/players/PlayerProfileClient.tsx')), false);
});

// ── route wiring, flag, plan ────────────────────────────────────────────────

test('the entry route: 401 first, then the players guard; PATCH and DELETE; off with REPORTS_IN_APP off', () => {
  const src = read('app/api/players/[id]/entries/[entryId]/route.ts');
  for (const method of ['PATCH', 'DELETE']) {
    const start = src.indexOf(`export async function ${method}(`);
    const body = src.slice(start, src.indexOf('export async function', start + 10) < 0 ? undefined : src.indexOf('export async function', start + 10));
    assert.ok(body.indexOf('REPORTS_IN_APP') < body.indexOf('getRouteSession'), `${method}: flag first`);
    assert.ok(body.indexOf('Unauthorized') < body.indexOf("'players'"), `${method}: 401 before the plan guard`);
    assert.ok(body.includes("'players'"));
  }
  assert.ok(src.includes('trashDriveFile'), 'the same Drive-trash helper as delete-player');
  assert.equal(/files\.delete|permanent/i.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), false, 'never a permanent delete');
});

test('the manager is read-only without the player database and absent with REPORTS_IN_APP off', () => {
  const src = read('components/reports/EntryManager.tsx');
  assert.match(src, /if \(!REPORTS_IN_APP \|\| !can\('players'\)\) return null;/);
  assert.match(src, /Your text is still here/, 'a failed save keeps what was typed');
  assert.match(src, /moved to your Drive trash/, 'the confirmation says what happens to the screenshot');
  assert.ok(read('components/reports/ReportViewClient.tsx').includes('<EntryManager'));
});

// ── screenshot note on save (P12's retry behavior is unchanged) ────────────

const base: SaveScreenshotInput = {
  playerId: 'p1', playerName: 'Ana', dataUrl: 'data:image/png;base64,AAAA', googleExports: true, inApp: true,
  folderLabel: 'Analysis', timestampLabel: 'x', fileName: 'a.png',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function fetchFor(entries: unknown[], driveOk: boolean) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/upload-image')) return driveOk ? json(200, { url: DRIVE_A }) : json(500, { error: 'Drive busy' });
    entries.push(JSON.parse(String(init?.body)));
    return json(200, { entry: { id: 'e9' } });
  }) as typeof fetch;
}

test('the save stores the typed note (one line) or the old placeholder when it is empty; a Drive failure keeps working as in P12', async () => {
  const sent: any[] = [];
  const a = await saveScreenshotToPlayer({ ...base, note: '  Serve\n toss   too low ' }, { fetchFn: fetchFor(sent, true) });
  assert.ok(a.ok);
  assert.equal(sent[0].body_text, 'Serve toss too low');
  const sent2: any[] = [];
  await saveScreenshotToPlayer({ ...base, note: '   ' }, { fetchFn: fetchFor(sent2, true) });
  await saveScreenshotToPlayer(base, { fetchFn: fetchFor(sent2, true) });
  assert.deepEqual(sent2.map((e) => e.body_text), ['Screenshot from analysis session.', 'Screenshot from analysis session.']);
  const sent3: any[] = [];
  const failed = await saveScreenshotToPlayer({ ...base, note: 'keep me' }, { fetchFn: fetchFor(sent3, false) });
  assert.equal(failed.ok, false);
  assert.deepEqual(sent3, [], 'no entry after a failed Drive upload');
  assert.equal(oneLineNote('x'.repeat(400)).length, 300);
  // The dialog keeps the note while the capture is kept (cleared only when the capture goes away).
  const page = read('app/analysis/page.tsx');
  assert.ok(page.includes("useEffect(() => { if (!screenshotDataUrl) setScreenshotNote(''); }, [screenshotDataUrl]);"));
  assert.ok(page.includes('...(REPORTS_IN_APP ? { note: screenshotNote } : {})'));
});
