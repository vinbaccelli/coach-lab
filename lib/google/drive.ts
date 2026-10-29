/**
 * Server-side Google Drive helpers shared by the Docs/Drive export routes.
 * (P1-1 consolidation seam — routes import from here instead of re-implementing.)
 */
import type { google } from 'googleapis';

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
