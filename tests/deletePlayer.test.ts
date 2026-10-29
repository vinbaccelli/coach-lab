import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  collectStoragePaths,
  deletePlayer,
  driveFolderPath,
  namesMatch,
  resultMessage,
  storagePathFromUrl,
  type DeletePlayerDeps,
  type PlayerRow,
  type PlayerDeleteStore,
} from '../lib/players/deletePlayer';

const COACH = 'coach-1';
const PLAYER: PlayerRow = {
  id: 'p1',
  display_name: 'Ana Rossi',
  google_folder_id: 'FOLDER1',
  google_doc_id: 'DOC_T',
  google_match_doc_id: 'DOC_M',
};
const pub = (path: string) => `https://x.supabase.co/storage/v1/object/public/player-assets/${path}`;

/** Everything the delete touches, recorded. No real database, Drive or bucket. */
function harness(over: {
  player?: PlayerRow | null;
  deleteResult?: { error: string | null; deleted: boolean };
  readThrows?: boolean;
  google?: boolean;
  trash?: (id: string) => Promise<void>;
  remove?: (paths: string[]) => Promise<void>;
  entries?: unknown[];
  sessions?: Array<{ artifacts?: unknown; video_ref?: unknown }>;
  others?: unknown[];
} = {}) {
  const log: string[] = [];
  const trashed: string[] = [];
  const removed: string[][] = [];
  const store: PlayerDeleteStore = {
    getPlayer: async (id) => {
      log.push(`getPlayer ${id}`);
      return over.player === undefined ? PLAYER : over.player;
    },
    listEntryScreenshots: async () => {
      if (over.readThrows) throw new Error('read boom');
      return over.entries ?? [[pub(`${COACH}/screenshots/1.png`), 'https://drive.google.com/uc?export=view&id=ABCDEFGHIJKL']];
    },
    listSessionAssets: async () => over.sessions ?? [{ artifacts: [{ storagePath: `${COACH}/p1/s1/a.png` }], video_ref: { storagePath: `${COACH}/p1/s1/v.webm` } }],
    listOtherEntryScreenshots: async () => over.others ?? [],
    deletePlayerRow: async (id) => {
      log.push(`deleteRow ${id}`);
      return over.deleteResult ?? { error: null, deleted: true };
    },
  };
  const deps: DeletePlayerDeps = {
    store,
    coachId: COACH,
    hasGoogleAccess: over.google ?? true,
    trashDriveItem: async (id) => {
      log.push(`trash ${id}`);
      await (over.trash ? over.trash(id) : Promise.resolve());
      trashed.push(id);
    },
    removeStorageObjects: async (paths) => {
      log.push(`remove ${paths.length}`);
      await (over.remove ? over.remove(paths) : Promise.resolve());
      removed.push(paths);
    },
  };
  return { deps, log, trashed, removed };
}

const run = (h: ReturnType<typeof harness>, ...typed: unknown[]) => deletePlayer({ playerId: 'p1', typedName: typed.length ? typed[0] : 'Ana Rossi' }, h.deps);

test('success: rows deleted first, then Drive folder and both Docs trashed, then Storage removed; one clear result', async () => {
  const h = harness();
  const r = await run(h);
  assert.equal(r.status, 200);
  assert.ok('ok' in r.body && r.body.ok);
  if (!('ok' in r.body)) return;
  assert.deepEqual(r.body.drive, { status: 'trashed', items: 3, folderPath: 'AngleMotion / Players / Ana Rossi' });
  assert.deepEqual(r.body.storage, { status: 'removed', count: 3 });
  assert.equal(r.body.complete, true);
  assert.equal(r.body.message, 'Player deleted. The Drive folder is in your Drive trash for 30 days.');
  // Order: database before anything external, Drive before Storage.
  assert.deepEqual(h.log.filter((l) => !l.startsWith('getPlayer')), ['deleteRow p1', 'trash FOLDER1', 'trash DOC_T', 'trash DOC_M', 'remove 3']);
  assert.deepEqual(h.removed[0].sort(), [`${COACH}/p1/s1/a.png`, `${COACH}/p1/s1/v.webm`, `${COACH}/screenshots/1.png`].sort());
});

test('wrong typed name -> 400 and nothing at all is touched (also empty / missing / not a string)', async () => {
  for (const typed of ['Ana', 'Ana Rossi Jr', '', '   ', undefined, 42, null]) {
    const h = harness();
    const r = await run(h, typed);
    assert.equal(r.status, 400, String(typed));
    assert.ok('error' in r.body && r.body.error === 'name_mismatch');
    assert.deepEqual(h.log, ['getPlayer p1'], 'only the lookup ran');
    assert.equal(h.trashed.length + h.removed.length, 0);
  }
});

test('the typed name is compared trimmed, case-insensitive, whitespace collapsed', async () => {
  for (const typed of ['ana rossi', '  ANA ROSSI  ', 'Ana   Rossi']) {
    assert.equal((await run(harness(), typed)).status, 200, typed);
  }
  assert.equal(namesMatch('', ''), false);
  assert.equal(namesMatch(' José ', 'josé'), true);
});

test("another coach's player (or none) -> 404 and nothing is touched", async () => {
  const h = harness({ player: null });
  const r = await run(h);
  assert.equal(r.status, 404);
  assert.deepEqual(h.log, ['getPlayer p1']);
  // The row vanishing between lookup and delete (zero rows deleted) is a 404 too, with no Drive/Storage work.
  const gone = harness({ deleteResult: { error: null, deleted: false } });
  assert.equal((await run(gone)).status, 404);
  assert.equal(gone.trashed.length + gone.removed.length, 0);
});

test('database failure -> 500, nothing else touched (no Drive, no Storage), coach sees the error', async () => {
  const h = harness({ deleteResult: { error: 'permission denied for table players', deleted: false } });
  const r = await run(h);
  assert.equal(r.status, 500);
  assert.ok('error' in r.body && r.body.error === 'database_failed');
  assert.match((r.body as { message: string }).message, /permission denied for table players/);
  assert.equal((r.body as { nothingElseTouched?: boolean }).nothingElseTouched, true);
  assert.equal(h.trashed.length, 0);
  assert.equal(h.removed.length, 0);
  assert.deepEqual(h.log, ['getPlayer p1', 'deleteRow p1']);
});

test('a failed read before deleting -> 500 and the rows are NOT deleted', async () => {
  const h = harness({ readThrows: true });
  const r = await run(h);
  assert.equal(r.status, 500);
  assert.ok(!h.log.some((l) => l.startsWith('deleteRow')));
});

test('Drive failure: reported with the folder path to delete by hand, database stays deleted, Storage still cleaned', async () => {
  const h = harness({ trash: async () => { throw new Error('File not found: FOLDER1'); } });
  const r = await run(h);
  assert.equal(r.status, 200);
  assert.ok('ok' in r.body);
  if (!('ok' in r.body)) return;
  assert.equal(r.body.drive.status, 'failed');
  assert.equal(r.body.complete, false);
  assert.match(r.body.message, /Player deleted from AngleMotion, but the Drive folder could not be moved to your Drive trash/);
  assert.match(r.body.message, /Delete it by hand in Google Drive: AngleMotion \/ Players \/ Ana Rossi\./);
  assert.doesNotMatch(r.body.message, /in your Drive trash for 30 days/);
  assert.equal(r.body.storage.status, 'removed');
  assert.ok(h.log.includes('deleteRow p1'));
});

test('no Google access (expired sign-in): Drive is not attempted, the message says so and names the folder', async () => {
  const h = harness({ google: false });
  const r = await run(h);
  assert.ok('ok' in r.body);
  if (!('ok' in r.body)) return;
  assert.equal(r.body.drive.status, 'failed');
  assert.match(r.body.message, /sign out and sign in again/);
  assert.match(r.body.message, /AngleMotion \/ Players \/ Ana Rossi/);
  assert.equal(h.trashed.length, 0);
});

test('Drive partly fails (a Doc, not the folder): still reported as failed, never as complete', async () => {
  const h = harness({ trash: async (id) => { if (id === 'DOC_M') throw new Error('403 insufficientPermissions'); } });
  const r = await run(h);
  assert.ok('ok' in r.body);
  if (!('ok' in r.body)) return;
  assert.deepEqual([r.body.drive.status, (r.body.drive as { failedItems: number }).failedItems], ['failed', 1]);
  assert.equal(r.body.complete, false);
  assert.deepEqual(h.trashed, ['FOLDER1', 'DOC_T']);
});

test('no Drive folder or Docs recorded: nothing to trash, said plainly', async () => {
  const h = harness({ player: { id: 'p1', display_name: 'Ana Rossi' } });
  const r = await run(h);
  assert.ok('ok' in r.body);
  if (!('ok' in r.body)) return;
  assert.equal(r.body.drive.status, 'none');
  assert.equal(r.body.complete, true);
  assert.match(r.body.message, /No Drive folder was recorded/);
  assert.equal(h.trashed.length, 0);
});

test('Storage failure: reported, database and Drive results stay', async () => {
  const h = harness({ remove: async () => { throw new Error('storage unavailable'); } });
  const r = await run(h);
  assert.ok('ok' in r.body);
  if (!('ok' in r.body)) return;
  assert.deepEqual(r.body.storage, { status: 'failed', reason: 'storage unavailable', count: 3 });
  assert.equal(r.body.complete, false);
  assert.match(r.body.message, /Some stored images could not be removed \(storage unavailable\)/);
  assert.match(r.body.message, /Drive folder is in your Drive trash/);
  assert.equal(r.body.drive.status, 'trashed');
});

test('both Drive and Storage failing say both', () => {
  const m = resultMessage('Ana Rossi', { status: 'failed', reason: 'x', failedItems: 1 }, { status: 'failed', reason: 'y', count: 2 });
  assert.equal(m.complete, false);
  assert.match(m.message, /by hand in Google Drive: AngleMotion \/ Players \/ Ana Rossi/);
  assert.match(m.message, /stored images could not be removed \(y\)/);
});

test('Storage paths: only the coach\'s own, never another player\'s still-used image, never outside the folder', () => {
  const mine = `${COACH}/screenshots/a.png`;
  const shared = `${COACH}/screenshots/shared.png`;
  const paths = collectStoragePaths(
    COACH,
    [[pub(mine), pub(shared), pub('other-coach/screenshots/x.png'), pub(`${COACH}/../escape.png`)], JSON.stringify([{ url: pub(`${COACH}/screenshots/b.png`) }]), 'not json'],
    [{ artifacts: [{ storagePath: `${COACH}/p1/s/1.png` }, { storagePath: 'other/p1/s/2.png' }, {}], video_ref: { storagePath: `${COACH}/p1/s/v.mp4` } }, { artifacts: null, video_ref: null }],
    [[pub(shared)]],
  ).sort();
  assert.deepEqual(paths, [mine, `${COACH}/screenshots/b.png`, `${COACH}/p1/s/1.png`, `${COACH}/p1/s/v.mp4`].sort());
  assert.equal(storagePathFromUrl('https://drive.google.com/uc?id=1'), null);
  assert.equal(storagePathFromUrl(pub('a%20b/c.png?t=1')), 'a b/c.png');
  assert.equal(driveFolderPath('  Ana Rossi '), 'AngleMotion / Players / Ana Rossi');
});

test('the route: signed-in only, NOT behind the Pro plan, never permanent delete', () => {
  const src = readFileSync('app/api/players/[id]/route.ts', 'utf8');
  const del = src.slice(src.indexOf('export async function DELETE('));
  assert.match(del, /Unauthorized/);
  assert.doesNotMatch(del, /requireFeature/);
  assert.match(del, /confirm_name/);
  const drive = readFileSync('lib/google/drive.ts', 'utf8');
  const trash = drive.slice(drive.indexOf('export async function trashDriveFile'));
  assert.match(trash, /trashed: true/);
  assert.doesNotMatch(trash, /files\.delete|emptyTrash/);
  // GET and PATCH keep their plan behaviour.
  assert.match(src.slice(src.indexOf('export async function PATCH('), src.indexOf('export async function DELETE(')), /requireFeature/);
});
