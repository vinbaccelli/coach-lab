import { driveFileId } from '@/lib/reports/driveId';
import { readScreenshotUrls } from '@/lib/reports/deriveBlocks';

/**
 * Edit a note / delete an entry: the logic behind PATCH and DELETE
 * /api/players/[id]/entries/[entryId]. Pure orchestration over injected parts (the data store through
 * the coach's own RLS session, a Drive "move to trash", a logger), so tests never touch a database or Drive.
 *
 * EDIT changes ONLY `body_text`, and only on a `technique` entry (a match entry's text is the compiled
 * report that its structured data falls back to).
 *
 * DELETE order (safest first):
 *   1. Look the entry up through the coach's session client (RLS) and the player id from the URL:
 *      not theirs, or not that player's → 404, nothing touched.
 *   2. Delete the database row. If that fails, STOP: nothing else is touched.
 *   3. Move each Drive screenshot to the Drive TRASH (never a permanent delete), best effort. A failure here
 *      never undoes the row delete; it is logged WITHOUT data (counts only, no ids, names or URLs) and the
 *      answer says the file is still in Drive.
 * Images stored earlier in AngleMotion's own bucket are NOT removed (only Drive files are handled here).
 */

export const NOTE_MAX = 2000;

export interface EntryRow {
  id: string;
  category: string;
  screenshots: unknown;
}

export interface EntryStore {
  /** Through the coach's session client: another coach's (or another player's) entry is simply not found. */
  getEntry(playerId: string, entryId: string): Promise<EntryRow | null>;
  updateNote(playerId: string, entryId: string, text: string): Promise<{ error: string | null; updated: boolean }>;
  deleteRow(playerId: string, entryId: string): Promise<{ error: string | null; deleted: boolean }>;
}

export interface EntryResult {
  status: number;
  body: Record<string, unknown>;
}

/** The note text as it is saved: trimmed, line endings normalised, capped. Empty is allowed (clears the note). */
export function cleanNote(raw: unknown): { ok: true; text: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: 'note must be text' };
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (text.length > NOTE_MAX) return { ok: false, message: `The note is too long (max ${NOTE_MAX} characters)` };
  return { ok: true, text };
}

export async function editEntryNote(
  store: EntryStore,
  input: { playerId: string; entryId: string; note: unknown },
): Promise<EntryResult> {
  const cleaned = cleanNote(input.note);
  if (!cleaned.ok) return { status: 400, body: { error: cleaned.message } };
  const entry = await store.getEntry(input.playerId, input.entryId);
  if (!entry) return { status: 404, body: { error: 'Not found' } };
  if (entry.category !== 'technique') {
    return { status: 400, body: { error: 'Only the notes of a technique entry can be edited' } };
  }
  const res = await store.updateNote(input.playerId, input.entryId, cleaned.text);
  if (res.error) return { status: 500, body: { error: res.error } };
  if (!res.updated) return { status: 404, body: { error: 'Not found' } };
  return { status: 200, body: { ok: true, body_text: cleaned.text } };
}

/** Drive file ids of an entry's screenshots, de-duplicated, in order. Other URLs (the old public bucket) give none. */
export function driveIdsOfEntry(screenshots: unknown): string[] {
  const ids: string[] = [];
  for (const url of readScreenshotUrls(screenshots)) {
    const id = driveFileId(url);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface DeleteEntryDeps {
  store: EntryStore;
  /** False when the session carries no Google access token. */
  hasGoogleAccess: boolean;
  /** Move one Drive item to the trash; throws on any failure. */
  trashDriveItem(fileId: string): Promise<void>;
  /** Log without data: pass counts and statuses only. */
  log(message: string, detail: Record<string, unknown>): void;
}

export async function deleteEntry(
  deps: DeleteEntryDeps,
  input: { playerId: string; entryId: string },
): Promise<EntryResult> {
  const entry = await deps.store.getEntry(input.playerId, input.entryId);
  if (!entry) return { status: 404, body: { error: 'Not found' } };
  const driveIds = driveIdsOfEntry(entry.screenshots);

  // 2 — the database row first.
  const del = await deps.store.deleteRow(input.playerId, input.entryId);
  if (del.error) return { status: 500, body: { error: del.error } };
  if (!del.deleted) return { status: 404, body: { error: 'Not found' } };

  // 3 — the Drive files to the TRASH, best effort.
  if (driveIds.length === 0) {
    return { status: 200, body: { ok: true, drive: 'none', message: 'The entry was removed.' } };
  }
  if (!deps.hasGoogleAccess) {
    deps.log('[entries] delete: no Google access, Drive files left in place', { files: driveIds.length });
    return {
      status: 200,
      body: { ok: true, drive: 'skipped', message: 'The entry was removed. Google is not connected, so its image is still in your Google Drive: delete it there if you want it gone.' },
    };
  }
  let failed = 0;
  for (const id of driveIds) {
    try {
      await deps.trashDriveItem(id);
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) {
    deps.log('[entries] delete: some Drive files were not moved to the trash', { files: driveIds.length, failed });
    return {
      status: 200,
      body: { ok: true, drive: 'failed', message: 'The entry was removed, but its image could not be moved to your Drive trash. It is still in your Google Drive: delete it there if you want it gone.' },
    };
  }
  return {
    status: 200,
    body: { ok: true, drive: 'trashed', message: 'The entry was removed and its image moved to your Google Drive trash. You can restore it from the trash until you empty it.' },
  };
}

/** The store over the coach's own session client (RLS): `owned by coach` AND `belongs to this player`. */
export function supabaseEntryStore(
  supabase: {
    from(table: string): {
      select(cols: string): any;
      update(values: Record<string, unknown>): any;
      delete(): any;
    };
  },
  coachId: string,
): EntryStore {
  return {
    async getEntry(playerId, entryId) {
      const { data } = await supabase
        .from('player_entries')
        .select('id, category, screenshots')
        .eq('id', entryId)
        .eq('player_id', playerId)
        .eq('coach_id', coachId)
        .maybeSingle();
      return (data as EntryRow | null) ?? null;
    },
    async updateNote(playerId, entryId, text) {
      const { data, error } = await supabase
        .from('player_entries')
        .update({ body_text: text })
        .eq('id', entryId)
        .eq('player_id', playerId)
        .eq('coach_id', coachId)
        .select('id');
      return { error: error ? error.message : null, updated: Array.isArray(data) && data.length > 0 };
    },
    async deleteRow(playerId, entryId) {
      const { data, error } = await supabase
        .from('player_entries')
        .delete()
        .eq('id', entryId)
        .eq('player_id', playerId)
        .eq('coach_id', coachId)
        .select('id');
      return { error: error ? error.message : null, deleted: Array.isArray(data) && data.length > 0 };
    },
  };
}
