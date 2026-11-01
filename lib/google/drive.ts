/**
 * Server-side Google Drive helpers shared by the Docs/Drive export routes.
 * (P1-1 consolidation seam — routes import from here instead of re-implementing.)
 */
import type { google } from 'googleapis';
import { Readable } from 'stream';

export type DriveClient = ReturnType<typeof google.drive>;

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Find a folder by name under an optional parent, creating it if absent. */
export async function findOrCreateFolder(
  drive: DriveClient,
  name: string,
  parentId?: string,
): Promise<string> {
  const safeName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const list = await drive.files.list({
    q: `name='${safeName}' and mimeType='${FOLDER_MIME}' and trashed=false${parentClause}`,
    fields: 'files(id,name)',
    pageSize: 1,
  });
  const existing = list.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) },
    fields: 'id',
  });
  if (!created.data.id) throw new Error(`Failed to create folder "${name}"`);
  return created.data.id;
}

/** Build the AngleMotion / Players / <Player Name> folder chain, returning the leaf id. */
export async function playerFolderChain(drive: DriveClient, playerName: string): Promise<string> {
  const rootId = await findOrCreateFolder(drive, 'AngleMotion');
  const playersId = await findOrCreateFolder(drive, 'Players', rootId);
  return findOrCreateFolder(drive, playerName, playersId);
}

/** Build the AngleMotion / Reports folder chain (for reports not filed to a player). */
export async function reportsFolderChain(drive: DriveClient): Promise<string> {
  const rootId = await findOrCreateFolder(drive, 'AngleMotion');
  return findOrCreateFolder(drive, 'Reports', rootId);
}

/**
 * Move a Drive file or folder to the Drive TRASH (`trashed: true`), never a permanent
 * delete: Drive keeps trashed items for 30 days, so a mistake can be undone.
 *
 * Under the per-file `drive.file` scope this works for items the app created. For anything
 * else Drive answers 404/403; that is thrown, not swallowed, because "I could not reach it" must
 * never read as "it was removed". Also throws if Drive's reply does not say `trashed`.
 */
export async function trashDriveFile(drive: DriveClient, fileId: string): Promise<void> {
  const res = await drive.files.update({
    fileId,
    requestBody: { trashed: true },
    fields: 'id,trashed',
  });
  if (res.data.trashed !== true) throw new Error('Drive did not confirm the item was moved to the trash');
}

// ── Screenshot destination, with fewer Drive calls (KNOWN_ISSUES 071) ────────
//
// The functions above are unchanged. These add the faster path used by
// POST /api/google/upload-image: use the player's saved folder id instead of
// searching AngleMotion → Players → <Name> on every save, and skip a search
// that cannot find anything.

/** Counts the Drive requests one save makes (timing log; no personal data). */
export type DriveStats = { calls: number };
const tick = (stats?: DriveStats) => { if (stats) stats.calls += 1; };

function folderQuery(name: string, parentId?: string): string {
  const safeName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  return `name='${safeName}' and mimeType='${FOLDER_MIME}' and trashed=false${parentClause}`;
}

/** One search: the id of a live folder with this name under `parentId`, or null. Throws when Drive errors. */
async function findFolder(drive: DriveClient, name: string, parentId: string | undefined, stats?: DriveStats): Promise<string | null> {
  tick(stats);
  const list = await drive.files.list({ q: folderQuery(name, parentId), fields: 'files(id,name)', pageSize: 1 });
  return list.data.files?.[0]?.id ?? null;
}

async function createFolder(drive: DriveClient, name: string, parentId: string | undefined, stats?: DriveStats): Promise<string> {
  tick(stats);
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) },
    fields: 'id',
  });
  if (!created.data.id) throw new Error(`Failed to create folder "${name}"`);
  return created.data.id;
}

/**
 * Like findOrCreateFolder, but a folder that was created a moment ago in this
 * same call cannot contain anything yet, so its child is created without the
 * pointless search (`parentIsNew`).
 */
async function ensureFolder(
  drive: DriveClient, name: string, parentId: string | undefined, parentIsNew: boolean, stats?: DriveStats,
): Promise<{ id: string; created: boolean }> {
  if (!parentIsNew) {
    const existing = await findFolder(drive, name, parentId, stats);
    if (existing) return { id: existing, created: false };
  }
  return { id: await createFolder(drive, name, parentId, stats), created: true };
}

export type ScreenshotPlayer = { id: string; display_name: string; google_folder_id?: string | null };

export type FolderResolution = {
  /** Where the screenshot goes: …/<Player>/Screenshots. */
  screenshotsId: string;
  /** The player's own folder (what players.google_folder_id holds). */
  playerFolderId: string;
  /** True when players.google_folder_id has to be written (new, rebuilt or renamed). */
  saveFolderId: boolean;
  /** saved: the stored folder id was still good · rebuilt: it was missing, trashed or renamed · new: none stored. */
  path: 'saved' | 'rebuilt' | 'new';
};

/**
 * Where a player's screenshots go.
 *
 * Saved id (players.google_folder_id): ONE check that the folder still exists, is not in the
 * trash and still carries the player's name (a renamed player used to get a new folder, found by
 * name; that is kept by falling through to the full path below), in parallel with ONE search for
 * the Screenshots folder under it. Any doubt (a Drive error, a missing or trashed folder, another
 * name) takes the full path, which is the previous behaviour: find or create AngleMotion →
 * Players → <Name> → Screenshots by name, and save the id.
 */
export async function resolvePlayerScreenshotsFolder(
  drive: DriveClient, player: ScreenshotPlayer, stats?: DriveStats,
): Promise<FolderResolution> {
  const saved = player.google_folder_id?.trim() || null;
  if (saved) {
    tick(stats); // files.get; findFolder counts its own search
    const [info, screenshots] = await Promise.all([
      drive.files.get({ fileId: saved, fields: 'id,name,trashed' }).then((r) => r.data, () => null),
      findFolder(drive, 'Screenshots', saved, stats).then((id) => ({ id }), () => null),
    ]);
    // `screenshots` is null when the search itself failed: do not guess "none there" and create a duplicate.
    if (info?.id === saved && info.trashed !== true && info.name === player.display_name && screenshots) {
      const screenshotsId = screenshots.id ?? (await createFolder(drive, 'Screenshots', saved, stats));
      return { screenshotsId, playerFolderId: saved, saveFolderId: false, path: 'saved' };
    }
  }
  const root = await ensureFolder(drive, 'AngleMotion', undefined, false, stats);
  const players = await ensureFolder(drive, 'Players', root.id, root.created, stats);
  const folder = await ensureFolder(drive, player.display_name, players.id, players.created, stats);
  const screenshots = await ensureFolder(drive, 'Screenshots', folder.id, folder.created, stats);
  return { screenshotsId: screenshots.id, playerFolderId: folder.id, saveFolderId: folder.id !== saved, path: saved ? 'rebuilt' : 'new' };
}

export type StoreScreenshotInput = {
  /** The player this is saved to (null: no player, shared folder). */
  player: ScreenshotPlayer | null;
  /** A folder an earlier call of the same batch resolved; used as is. */
  providedFolderId?: string | null;
  name: string;
  mime: string;
  buffer: Buffer;
};

export type StoreScreenshotDeps = {
  /** Writes players.google_folder_id. Errors are logged by the caller's implementation, never thrown. */
  savePlayerFolderId(playerId: string, folderId: string): Promise<void>;
  log(message: string, detail?: unknown): void;
  /** Timing line (no personal data). */
  timing(fields: Record<string, string | number | boolean>): void;
  now(): number;
};

/**
 * The Drive half of POST /api/google/upload-image: pick the folder, upload the image, make it
 * link-readable. The folder id is saved to the player IN PARALLEL with the upload. Throws exactly
 * what Drive threw (the route turns it into the same 500), and
 * `permissions.create(anyone): …` when sharing fails.
 */
export async function storeScreenshotInDrive(
  drive: DriveClient, input: StoreScreenshotInput, deps: StoreScreenshotDeps,
): Promise<{ fileId: string; folderId: string | null }> {
  const stats: DriveStats = { calls: 0 };
  const t0 = deps.now();
  let folderId: string | null = input.providedFolderId ?? null;
  let path: FolderResolution['path'] | 'provided' | 'shared' | 'root' = folderId ? 'provided' : 'shared';
  let saveFolder: Promise<void> = Promise.resolve();

  if (!folderId && input.player?.display_name) {
    try {
      const r = await resolvePlayerScreenshotsFolder(drive, input.player, stats);
      folderId = r.screenshotsId;
      path = r.path;
      if (r.saveFolderId) {
        const playerId = input.player.id;
        saveFolder = deps.savePlayerFolderId(playerId, r.playerFolderId).catch((e) => {
          deps.log('[google/upload-image] saving the player folder id failed:', e instanceof Error ? e.message : e);
        });
      }
    } catch (e) {
      deps.log('[google/upload-image] player folder failed, using shared:', e instanceof Error ? e.message : e);
    }
  }
  if (!folderId) {
    // Best-effort, as before: the search can 403 on restricted accounts; the Drive root beats losing the screenshot.
    path = 'shared';
    try {
      const root = await ensureFolder(drive, 'AngleMotion', undefined, false, stats);
      folderId = (await ensureFolder(drive, 'Screenshots', root.id, root.created, stats)).id;
    } catch (e) {
      deps.log('[google/upload-image] shared folder failed, using Drive root:', e instanceof Error ? e.message : e);
      folderId = null;
      path = 'root';
    }
  }
  const t1 = deps.now();

  try {
    tick(stats);
    const created = await drive.files.create({
      requestBody: { name: input.name, ...(folderId ? { parents: [folderId] } : {}) },
      media: { mimeType: input.mime, body: Readable.from(input.buffer) },
      fields: 'id',
    });
    const fileId = created.data.id;
    if (!fileId) throw new Error('Drive upload failed');
    const t2 = deps.now();
    try {
      tick(stats);
      await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      deps.log('[google/upload-image] permissions.create(anyone) failed — Drive image would not be fetchable by Docs:', msg);
      throw new Error(`permissions.create(anyone): ${msg}`);
    }
    const t3 = deps.now();
    deps.timing({ path, driveCalls: stats.calls, folderMs: t1 - t0, createMs: t2 - t1, shareMs: t3 - t2, totalMs: t3 - t0 });
    return { fileId, folderId };
  } finally {
    await saveFolder; // never rejects; waited for so the function does not end with a write in flight
  }
}
