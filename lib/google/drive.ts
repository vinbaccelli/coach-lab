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
