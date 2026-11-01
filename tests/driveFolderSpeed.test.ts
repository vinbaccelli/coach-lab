import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOLDER_MIME, findOrCreateFolder, playerFolderChain, storeScreenshotInDrive,
  type DriveClient, type ScreenshotPlayer, type StoreScreenshotDeps,
} from '@/lib/google/drive';

// ── an in-memory Drive: folders and files, trash, call log. No real Drive call. ──
type Node = { id: string; name: string; parents: string[]; trashed: boolean; folder: boolean };

function fakeDrive(opts: { driveFull?: boolean; failShare?: boolean; failListUnder?: string; failTimes?: number; onFileCreate?: () => void } = {}) {
  let listFailures = opts.failTimes ?? Infinity;
  const nodes = new Map<string, Node>();
  const calls: string[] = [];
  let seq = 0;
  const shared: string[] = [];
  const effTrashed = (n: Node): boolean => n.trashed || n.parents.some((p) => { const x = nodes.get(p); return x ? effTrashed(x) : false; });
  const add = (name: string, parents: string[], folder = true, trashed = false) => {
    const id = `id${++seq}`;
    nodes.set(id, { id, name, parents, trashed, folder });
    return id;
  };
  const drive = {
    files: {
      async list({ q }: { q: string }) {
        calls.push('list');
        const name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
        const parent = /'([^']+)' in parents/.exec(q)?.[1];
        if (parent && parent === opts.failListUnder && listFailures-- > 0) throw new Error('Drive 500');
        const files = [...nodes.values()].filter((n) => n.folder && n.name === name && !effTrashed(n) && (!parent || n.parents.includes(parent)));
        return { data: { files: files.slice(0, 1).map((n) => ({ id: n.id, name: n.name })) } };
      },
      async get({ fileId }: { fileId: string }) {
        calls.push('get');
        const n = nodes.get(fileId);
        if (!n) throw Object.assign(new Error('File not found'), { code: 404 });
        return { data: { id: n.id, name: n.name, trashed: effTrashed(n) } };
      },
      async create({ requestBody }: { requestBody: { name: string; mimeType?: string; parents?: string[] } }) {
        const isFolder = requestBody.mimeType === FOLDER_MIME;
        calls.push(isFolder ? 'create-folder' : 'create-file');
        if (!isFolder) {
          opts.onFileCreate?.();
          if (opts.driveFull) throw Object.assign(new Error("The user's Drive storage quota has been exceeded."), { code: 403 });
        }
        return { data: { id: add(requestBody.name, requestBody.parents ?? [], isFolder) } };
      },
    },
    permissions: {
      async create({ fileId }: { fileId: string }) {
        calls.push('share');
        if (opts.failShare) throw new Error('The caller does not have permission');
        shared.push(fileId);
        return { data: {} };
      },
    },
  };
  return { drive: drive as unknown as DriveClient, nodes, calls, shared, add };
}

function deps(over: Partial<StoreScreenshotDeps> = {}) {
  const saved: Array<[string, string]> = [];
  const logs: unknown[][] = [];
  const timings: Array<Record<string, string | number | boolean>> = [];
  let t = 0;
  const d: StoreScreenshotDeps = {
    async savePlayerFolderId(id, folder) { saved.push([id, folder]); },
    log: (...a) => { logs.push(a); },
    timing: (f) => { timings.push(f); },
    now: () => (t += 10),
    ...over,
  };
  return { d, saved, logs, timings };
}

const PLAYER = (over: Partial<ScreenshotPlayer> = {}): ScreenshotPlayer => ({ id: 'p1', display_name: 'Ana Rossi', google_folder_id: null, ...over });
const input = (player: ScreenshotPlayer | null, extra: Record<string, unknown> = {}) =>
  ({ player, name: 'shot.png', mime: 'image/png', buffer: Buffer.from('x'), ...extra });

/** The folder tree a coach who already has players has: AngleMotion / Players, plus optionally Ana's folders. */
function seed(f: ReturnType<typeof fakeDrive>, withPlayer = false) {
  const am = f.add('AngleMotion', []);
  const players = f.add('Players', [am]);
  if (!withPlayer) return { am, players };
  const ana = f.add('Ana Rossi', [players]);
  const shots = f.add('Screenshots', [ana]);
  return { am, players, ana, shots };
}

/** The previous algorithm, on the same fake: the "before" call count. */
async function legacy(drive: DriveClient, player: ScreenshotPlayer) {
  const playerFolder = await playerFolderChain(drive, player.display_name);
  const folderId = await findOrCreateFolder(drive, 'Screenshots', playerFolder);
  await drive.files.create({ requestBody: { name: 'shot.png', parents: [folderId] }, fields: 'id' });
  await drive.permissions.create({ fileId: 'x', requestBody: { role: 'reader', type: 'anyone' } });
}
const driveCalls = (calls: string[]) => calls.length;

test('existing player (saved folder id): 4 Drive calls instead of 6, nothing written to the player', async () => {
  const f = fakeDrive();
  const t = seed(f, true);
  const { d, saved, timings } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER({ google_folder_id: t.ana })), d);
  assert.deepEqual(f.calls.slice().sort(), ['create-file', 'get', 'list', 'share']);
  assert.equal(out.folderId, t.shots);
  assert.equal(f.nodes.get(out.fileId)?.parents[0], t.shots);
  assert.deepEqual(f.shared, [out.fileId]);
  assert.deepEqual(saved, [], 'the saved id was right: no write');
  assert.equal(timings[0].path, 'saved');
  assert.equal(timings[0].driveCalls, 4);
  // Before, on the same tree:
  const old = fakeDrive(); seed(old, true);
  await legacy(old.drive, PLAYER());
  assert.equal(driveCalls(old.calls), 6);
});

test('existing player whose Screenshots folder is missing: created once, not duplicated', async () => {
  const f = fakeDrive();
  const t = seed(f, true);
  f.nodes.delete(t.shots!);
  const { d } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER({ google_folder_id: t.ana })), d);
  assert.equal(f.calls.filter((c) => c === 'create-folder').length, 1);
  assert.equal([...f.nodes.values()].filter((n) => n.name === 'Screenshots').length, 1);
  assert.equal(f.nodes.get(out.folderId!)?.parents[0], t.ana);
});

test('new player, coach already has AngleMotion/Players: 7 calls instead of 8; folder id saved', async () => {
  const f = fakeDrive();
  seed(f);
  const { d, saved, timings } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER()), d);
  assert.equal(driveCalls(f.calls), 7);
  assert.deepEqual(f.calls.filter((c) => c === 'list').length, 3, 'AngleMotion, Players, the name: Screenshots needs no search');
  const ana = [...f.nodes.values()].find((n) => n.name === 'Ana Rossi')!;
  assert.equal(f.nodes.get(out.folderId!)?.parents[0], ana.id);
  assert.deepEqual(saved, [['p1', ana.id]]);
  assert.equal(timings[0].path, 'new');
  const old = fakeDrive(); seed(old);
  await legacy(old.drive, PLAYER());
  assert.equal(driveCalls(old.calls), 8);
});

test('brand-new coach (no folders at all): 7 calls instead of 10, the whole chain is built', async () => {
  const f = fakeDrive();
  const { d, saved } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER()), d);
  assert.equal(driveCalls(f.calls), 7);
  const names = [...f.nodes.values()].filter((n) => n.folder).map((n) => n.name);
  assert.deepEqual(names, ['AngleMotion', 'Players', 'Ana Rossi', 'Screenshots']);
  assert.equal(saved.length, 1);
  assert.ok(out.fileId && out.folderId);
  const old = fakeDrive();
  await legacy(old.drive, PLAYER());
  assert.equal(driveCalls(old.calls), 10);
});

test('missing folder id but the folders exist: reused by name (as before), id saved, no new folder', async () => {
  const f = fakeDrive();
  const t = seed(f, true);
  const { d, saved } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER({ google_folder_id: null })), d);
  assert.equal(f.calls.filter((c) => c === 'create-folder').length, 0);
  assert.equal(out.folderId, t.shots);
  assert.deepEqual(saved, [['p1', t.ana]]);
});

test('trashed folder: rebuilt once, new id saved, the trashed one untouched', async () => {
  const f = fakeDrive();
  const t = seed(f, true);
  f.nodes.get(t.ana!)!.trashed = true; // the player's folder is in the Drive trash (its children with it)
  const { d, saved, timings } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER({ google_folder_id: t.ana })), d);
  const fresh = [...f.nodes.values()].find((n) => n.name === 'Ana Rossi' && !n.trashed)!;
  assert.notEqual(fresh.id, t.ana);
  assert.equal(f.nodes.get(out.folderId!)?.parents[0], fresh.id);
  assert.deepEqual(saved, [['p1', fresh.id]]);
  assert.equal(f.nodes.get(t.ana!)!.trashed, true);
  assert.equal(timings[0].path, 'rebuilt');
});

test('deleted folder (Drive answers 404): rebuilt, no error', async () => {
  const f = fakeDrive();
  const t = seed(f, true);
  f.nodes.delete(t.ana!); f.nodes.delete(t.shots!);
  const { d, saved } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER({ google_folder_id: t.ana })), d);
  assert.ok(out.fileId);
  assert.equal(saved.length, 1);
  assert.notEqual(saved[0][1], t.ana);
});

test('renamed player: the saved folder carries the old name, so the folder is found or made by the NEW name, as before', async () => {
  const f = fakeDrive();
  const t = seed(f, true);
  const { d, saved } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER({ display_name: 'Ana Bianchi', google_folder_id: t.ana })), d);
  const neu = [...f.nodes.values()].find((n) => n.name === 'Ana Bianchi')!;
  assert.equal(f.nodes.get(out.folderId!)?.parents[0], neu.id);
  assert.deepEqual(saved, [['p1', neu.id]]);
  assert.equal(f.nodes.get(t.ana!)!.name, 'Ana Rossi', 'the old folder is left alone');
});

test('a one-time search error on the saved path does not create a duplicate Screenshots folder', async () => {
  const f = fakeDrive({ failListUnder: 'id3', failTimes: 1 }); // id3 = Ana's folder in the seeded tree
  const t = seed(f, true);
  assert.equal(t.ana, 'id3');
  const { d } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER({ google_folder_id: t.ana })), d);
  assert.equal(f.calls.filter((c) => c === 'create-folder').length, 0, 'the existing Screenshots folder was found on the full path');
  assert.equal(out.folderId, t.shots);
  assert.equal([...f.nodes.values()].filter((n) => n.name === 'Screenshots').length, 1);
});

test('a search error that keeps happening ends in the shared folder, as the old code did', async () => {
  const f = fakeDrive({ failListUnder: 'id3' });
  const t = seed(f, true);
  const { d, logs } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER({ google_folder_id: t.ana })), d);
  assert.notEqual(out.folderId, t.shots);
  assert.equal(f.nodes.get(out.folderId!)?.name, 'Screenshots');
  assert.match(String(logs[0][0]), /player folder failed, using shared/);
});

test('a folder id handed in by the same batch is used as is: no folder lookups at all', async () => {
  const f = fakeDrive();
  const { d, saved } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER(), { providedFolderId: 'given' }), d);
  assert.deepEqual(f.calls, ['create-file', 'share']);
  assert.equal(out.folderId, 'given');
  assert.deepEqual(saved, []);
});

test('no player: the shared AngleMotion/Screenshots folder, as before', async () => {
  const f = fakeDrive();
  const { d, timings } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(null), d);
  const names = [...f.nodes.values()].filter((n) => n.folder).map((n) => n.name);
  assert.deepEqual(names, ['AngleMotion', 'Screenshots']);
  assert.ok(out.folderId);
  assert.equal(timings[0].path, 'shared');
});

test('player folder failure falls back to the shared folder, and the failure is logged, not thrown', async () => {
  const f = fakeDrive();
  const real = f.drive.files.list.bind(f.drive.files);
  let n = 0;
  // The first search (AngleMotion, for the player chain) fails; the shared-folder search works.
  (f.drive.files as unknown as { list: unknown }).list = async (a: { q: string }) => { if (++n === 1) throw new Error('403 restricted'); return real(a as never); };
  const { d, logs } = deps();
  const out = await storeScreenshotInDrive(f.drive, input(PLAYER()), d);
  assert.ok(out.fileId);
  assert.match(String(logs[0][0]), /player folder failed, using shared/);
});

test('Drive full: the error from Drive is thrown as it is (the route answers 500 with it); the folder id is still saved', async () => {
  const f = fakeDrive({ driveFull: true });
  seed(f);
  const { d, saved } = deps();
  await assert.rejects(storeScreenshotInDrive(f.drive, input(PLAYER()), d), /Drive storage quota has been exceeded/);
  assert.equal(saved.length, 1, 'the write that ran in parallel is not lost');
  assert.equal(f.shared.length, 0);
});

test('sharing fails: the same permissions.create(anyone) error as before', async () => {
  const f = fakeDrive({ failShare: true });
  seed(f, true);
  const { d, logs } = deps();
  await assert.rejects(storeScreenshotInDrive(f.drive, input(null), d), /^Error: permissions\.create\(anyone\): The caller does not have permission$/);
  assert.match(String(logs.at(-1)![0]), /permissions\.create\(anyone\) failed/);
});

test('the folder-id write runs IN PARALLEL with the upload, not before it', async () => {
  const f = fakeDrive();
  seed(f);
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const f2 = fakeDrive({ onFileCreate: () => release() });
  seed(f2);
  const events: string[] = [];
  const { d } = deps({
    async savePlayerFolderId() { events.push('save:start'); await gate; events.push('save:end'); },
  });
  // The save only finishes once the file upload has been issued. If the upload waited for the save, this would never settle.
  const out = await Promise.race([
    storeScreenshotInDrive(f2.drive, input(PLAYER()), d),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('deadlock: upload waited for the save')), 1000)),
  ]);
  assert.ok(out.fileId);
  assert.deepEqual(events, ['save:start', 'save:end']);
  assert.ok(f2.calls.indexOf('create-file') > -1);
});

test('the timing line has counts and milliseconds only: no player name, id or folder id', async () => {
  const f = fakeDrive();
  seed(f, true);
  const { d, timings } = deps();
  await storeScreenshotInDrive(f.drive, input(PLAYER({ google_folder_id: 'id3' })), d);
  assert.deepEqual(Object.keys(timings[0]).sort(), ['createMs', 'driveCalls', 'folderMs', 'path', 'shareMs', 'totalMs']);
  assert.equal(JSON.stringify(timings[0]).includes('Ana'), false);
});

test('route: no Google token → 403 before any Drive work; responses and the 500 are unchanged', () => {
  const route = readFileSync('app/api/google/upload-image/route.ts', 'utf8');
  const tokenAt = route.indexOf('if (!session.googleAccessToken)');
  assert.ok(tokenAt !== -1 && tokenAt < route.indexOf('google.drive(') && tokenAt < route.indexOf('storeScreenshotInDrive('));
  assert.ok(route.includes("{ error: 'Google access not granted — sign out and sign in again.' },\n      { status: 403 }"));
  assert.ok(route.includes("{ error: 'dataUrl (image) is required' }, { status: 400 }") && route.includes("{ error: 'Invalid data URL' }, { status: 400 }"));
  for (const key of ['fileId,', 'url: `https://drive.google.com/uc?export=view&id=${fileId}`', 'webViewUrl: `https://drive.google.com/file/d/${fileId}/view`', '...(folderId ? { folderId } : {})']) {
    assert.ok(route.includes(key), key);
  }
  assert.ok(route.includes("const msg = e instanceof Error ? e.message : 'Drive upload failed';") && route.includes('{ error: msg }, { status: 500 }'));
  assert.ok(route.includes('.select(\'id, display_name, google_folder_id\')'));
  // The player lookup is skipped when the batch already gave a folder.
  assert.ok(route.includes('if (!providedFolderId && playerId)'));
});
