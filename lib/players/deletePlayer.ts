/**
 * Delete a player and everything of theirs — the logic behind DELETE /api/players/[id].
 *
 * Pure orchestration over injected parts (the data store, a Drive "move to trash", a Storage
 * remover), so tests never touch a real database, Drive or bucket. No server-only imports here:
 * the browser also uses `namesMatch` and `driveFolderPath`.
 *
 * ORDER (safest first):
 *   1. Look the player up through the coach's own session client (RLS): not theirs → 404.
 *   2. The typed name must match (trimmed, case-insensitive) → else 400, nothing touched.
 *   3. READ everything that is needed later (Drive ids, Storage paths) BEFORE deleting rows.
 *   4. Delete the database rows (entries and sessions go with the player: ON DELETE CASCADE).
 *      If this fails, STOP: nothing else is touched, the error is returned.
 *   5. Move the Drive folder (and the two Docs) to the Drive trash: best effort, never permanent.
 *   6. Remove the player's Storage objects: best effort.
 *   7. One result with each step's outcome and a message that never claims more than happened.
 *
 * Not plan-gated (the route does not call requireFeature): a coach who stopped paying must
 * still be able to delete their players.
 */

export interface PlayerRow {
  id: string;
  display_name: string;
  google_folder_id?: string | null;
  google_doc_id?: string | null;
  google_match_doc_id?: string | null;
}

export interface PlayerDeleteStore {
  /** Through the coach's session client: another coach's player is simply not found. */
  getPlayer(id: string): Promise<PlayerRow | null>;
  /** `screenshots` values of this player's entries. */
  listEntryScreenshots(playerId: string): Promise<unknown[]>;
  /** `{ artifacts, video_ref }` of this player's sessions. */
  listSessionAssets(playerId: string): Promise<Array<{ artifacts?: unknown; video_ref?: unknown }>>;
  /** `screenshots` values of the coach's OTHER players' entries (their images must survive). */
  listOtherEntryScreenshots(playerId: string): Promise<unknown[]>;
  /** Deletes the player row (entries and sessions cascade). `deleted` is false when no row went. */
  deletePlayerRow(id: string): Promise<{ error: string | null; deleted: boolean }>;
}

export interface DeletePlayerDeps {
  store: PlayerDeleteStore;
  coachId: string;
  /** False when the session carries no Google access token. */
  hasGoogleAccess: boolean;
  /** Move one Drive item to the trash; throws on any failure. */
  trashDriveItem(fileId: string): Promise<void>;
  /** Remove objects from the `player-assets` bucket; throws on failure. */
  removeStorageObjects(paths: string[]): Promise<void>;
}

export type DriveOutcome =
  | { status: 'none' }
  | { status: 'trashed'; items: number }
  | { status: 'failed'; reason: string; failedItems: number };

export type StorageOutcome =
  | { status: 'none' }
  | { status: 'removed'; count: number }
  | { status: 'failed'; reason: string; count: number };

export interface DeleteResult {
  status: number;
  body:
    | { error: string; message: string; nothingElseTouched?: boolean }
    | {
        ok: true;
        player: { id: string; name: string };
        database: { ok: true };
        drive: DriveOutcome & { folderPath: string };
        storage: StorageOutcome;
        /** True only when nothing is left for the coach to clean up by hand. */
        complete: boolean;
        message: string;
      };
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The typed confirmation: trimmed, case-insensitive, whitespace collapsed. Empty never matches. */
export function namesMatch(typed: string, actual: string): boolean {
  const t = norm(typed ?? '');
  return t.length > 0 && t === norm(actual ?? '');
}

/** Where the player's folder is in the coach's Drive. */
export function driveFolderPath(playerName: string): string {
  return `AngleMotion / Players / ${playerName.trim()}`;
}

const PUBLIC_MARK = '/storage/v1/object/public/player-assets/';

/** Storage path inside `player-assets` for a public URL, or null when it is not one. */
export function storagePathFromUrl(url: unknown): string | null {
  const raw = typeof url === 'string' ? url : typeof (url as { url?: unknown } | null)?.url === 'string' ? (url as { url: string }).url : '';
  const i = raw.indexOf(PUBLIC_MARK);
  if (i === -1) return null;
  const rest = raw.slice(i + PUBLIC_MARK.length).split('?')[0].split('#')[0];
  try {
    return decodeURIComponent(rest) || null;
  } catch {
    return null;
  }
}

function urlList(value: unknown): unknown[] {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return [v];
    }
  }
  return Array.isArray(v) ? v : [];
}

/**
 * The player's objects in `player-assets`: session artifacts / video (`storagePath`) and the
 * Supabase copies of entry screenshots (those are NOT under the player's folder). Only paths
 * inside the coach's own folder, and never one another player's entry still points at.
 */
export function collectStoragePaths(
  coachId: string,
  entryScreenshots: unknown[],
  sessionAssets: Array<{ artifacts?: unknown; video_ref?: unknown }>,
  otherEntryScreenshots: unknown[],
): string[] {
  const found = new Set<string>();
  const add = (p: unknown) => {
    if (typeof p === 'string' && p.startsWith(`${coachId}/`) && !p.includes('..')) found.add(p);
  };
  for (const shots of entryScreenshots) for (const u of urlList(shots)) add(storagePathFromUrl(u));
  for (const s of sessionAssets) {
    for (const a of urlList(s.artifacts)) add((a as { storagePath?: unknown } | null)?.storagePath);
    add((s.video_ref as { storagePath?: unknown } | null)?.storagePath);
  }
  const keep = new Set<string>();
  for (const shots of otherEntryScreenshots) for (const u of urlList(shots)) {
    const p = storagePathFromUrl(u);
    if (p) keep.add(p);
  }
  return [...found].filter((p) => !keep.has(p));
}

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function resultMessage(name: string, drive: DriveOutcome, storage: StorageOutcome): { message: string; complete: boolean } {
  const path = driveFolderPath(name);
  const parts: string[] = [];
  let complete = true;

  if (drive.status === 'trashed') {
    parts.push('Player deleted. The Drive folder is in your Drive trash for 30 days.');
  } else if (drive.status === 'none') {
    parts.push('Player deleted. No Drive folder was recorded for this player, so there was nothing to move to the trash.');
  } else {
    complete = false;
    parts.push(
      `Player deleted from AngleMotion, but the Drive folder could not be moved to your Drive trash (${drive.reason}). ` +
        `Delete it by hand in Google Drive: ${path}.`,
    );
  }
  if (storage.status === 'failed') {
    complete = false;
    parts.push(`Some stored images could not be removed (${storage.reason}).`);
  }
  return { message: parts.join(' '), complete };
}

export async function deletePlayer(
  input: { playerId: string; typedName: unknown },
  deps: DeletePlayerDeps,
): Promise<DeleteResult> {
  const { store } = deps;

  const player = await store.getPlayer(input.playerId);
  if (!player) return { status: 404, body: { error: 'not_found', message: 'Player not found.' } };

  if (typeof input.typedName !== 'string' || !namesMatch(input.typedName, player.display_name)) {
    return {
      status: 400,
      body: { error: 'name_mismatch', message: 'The typed name does not match the player’s name. Nothing was deleted.', nothingElseTouched: true },
    };
  }

  // Everything that is needed later is read BEFORE the rows are gone.
  let storagePaths: string[];
  try {
    const [own, sessions, others] = await Promise.all([
      store.listEntryScreenshots(player.id),
      store.listSessionAssets(player.id),
      store.listOtherEntryScreenshots(player.id),
    ]);
    storagePaths = collectStoragePaths(deps.coachId, own, sessions, others);
  } catch (e) {
    return {
      status: 500,
      body: { error: 'read_failed', message: `Could not read the player’s data, so nothing was deleted (${errText(e, 'unknown error')}).`, nothingElseTouched: true },
    };
  }
  const driveIds = [player.google_folder_id, player.google_doc_id, player.google_match_doc_id].filter(
    (id, i, all): id is string => typeof id === 'string' && id.trim() !== '' && all.indexOf(id) === i,
  );

  // The database first. A failure here stops everything.
  const del = await store.deletePlayerRow(player.id);
  if (del.error) {
    return {
      status: 500,
      body: { error: 'database_failed', message: `The player could not be deleted (${del.error}). Nothing else was touched.`, nothingElseTouched: true },
    };
  }
  if (!del.deleted) {
    return { status: 404, body: { error: 'not_found', message: 'Player not found.' } };
  }

  // Drive: trash, best effort.
  let drive: DriveOutcome;
  if (driveIds.length === 0) {
    drive = { status: 'none' };
  } else if (!deps.hasGoogleAccess) {
    drive = { status: 'failed', reason: 'Google access is missing or expired — sign out and sign in again', failedItems: driveIds.length };
  } else {
    let failed = 0;
    let firstReason = '';
    for (const id of driveIds) {
      try {
        await deps.trashDriveItem(id);
      } catch (e) {
        failed++;
        if (!firstReason) firstReason = errText(e, 'Drive refused');
      }
    }
    drive = failed === 0 ? { status: 'trashed', items: driveIds.length } : { status: 'failed', reason: firstReason, failedItems: failed };
  }

  // Storage: best effort.
  let storage: StorageOutcome;
  if (storagePaths.length === 0) {
    storage = { status: 'none' };
  } else {
    try {
      for (let i = 0; i < storagePaths.length; i += 100) await deps.removeStorageObjects(storagePaths.slice(i, i + 100));
      storage = { status: 'removed', count: storagePaths.length };
    } catch (e) {
      storage = { status: 'failed', reason: errText(e, 'Storage refused'), count: storagePaths.length };
    }
  }

  const { message, complete } = resultMessage(player.display_name, drive, storage);
  return {
    status: 200,
    body: {
      ok: true,
      player: { id: player.id, name: player.display_name },
      database: { ok: true },
      drive: { ...drive, folderPath: driveFolderPath(player.display_name) },
      storage,
      complete,
      message,
    },
  };
}

/** The real store, over the coach's session Supabase client (so RLS applies to every query). */
export function supabaseDeleteStore(supabase: {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
}, coachId: string): PlayerDeleteStore {
  return {
    async getPlayer(id) {
      const { data } = await supabase
        .from('players')
        .select('id, display_name, google_folder_id, google_doc_id, google_match_doc_id')
        .eq('id', id)
        .maybeSingle();
      return (data as PlayerRow | null) ?? null;
    },
    async listEntryScreenshots(playerId) {
      const { data, error } = await supabase.from('player_entries').select('screenshots').eq('player_id', playerId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ screenshots: unknown }>).map((r) => r.screenshots);
    },
    async listSessionAssets(playerId) {
      const { data, error } = await supabase.from('player_sessions').select('artifacts, video_ref').eq('player_id', playerId);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ artifacts?: unknown; video_ref?: unknown }>;
    },
    async listOtherEntryScreenshots(playerId) {
      const { data, error } = await supabase.from('player_entries').select('screenshots').eq('coach_id', coachId).neq('player_id', playerId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ screenshots: unknown }>).map((r) => r.screenshots);
    },
    async deletePlayerRow(id) {
      const { data, error } = await supabase.from('players').delete().eq('id', id).select('id');
      if (error) return { error: error.message as string, deleted: false };
      return { error: null, deleted: Array.isArray(data) && data.length > 0 };
    },
  };
}
