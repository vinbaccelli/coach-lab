/**
 * Saving an analysis screenshot to a player — the logic behind
 * `handleScreenshotSaveToPlayer` in app/analysis/page.tsx, lifted out so it can be
 * tested against a mocked fetch, Drive and Supabase.
 *
 * Order:
 *   1. Upload the image to the coach's own Drive (/api/google/upload-image).
 *      Screenshots are DRIVE-ONLY on every plan: there is no Supabase fallback for
 *      new screenshots. If Drive is not connected or the upload fails, NOTHING is
 *      saved (no entry is created), the result says why, and the caller keeps the
 *      captured image so the coach can retry without taking it again.
 *      (Screenshots saved earlier into the public `player-assets` bucket are
 *      untouched and still render: they are plain URLs in old entries.)
 *   2. Create the `technique` entry (/api/players/[id]/entries).
 *   3. `inApp` on  → no Google Doc write; the result carries a link to the in-app
 *      report. `inApp` off → the old best-effort /api/players/[id]/google-doc append.
 *
 * Every failure carries the real reason. With `inApp` off the generic messages are
 * the ones the app has always shown.
 */

export interface SaveScreenshotInput {
  playerId: string;
  playerName: string;
  dataUrl: string;
  /** ENABLE_GOOGLE_EXPORTS */
  googleExports: boolean;
  /** REPORTS_IN_APP */
  inApp: boolean;
  /** Folder label of the new entry, e.g. "Analysis 2026-10-27 14:05". */
  folderLabel: string;
  /** Label for the Doc timestamp (off mode only). */
  timestampLabel: string;
  /** File name for the Drive upload. */
  fileName: string;
}

export interface SaveScreenshotDeps {
  fetchFn: typeof fetch;
  /** Called as each step starts, so the UI can say what it is doing during a slow save. */
  onStage?: (stage: 'uploading' | 'saving') => void;
}

export type SaveScreenshotResult =
  | {
      ok: true;
      /** Status line for the coach. */
      message: string;
      imageUrl: string;
      /** Always Drive: new screenshots have no other storage. */
      storage: 'drive';
      /** The id of the saved entry, when the server returned it. */
      entryId?: string;
      /** In-app mode: the report. Off mode: the Google Doc. Opens in a new tab. */
      linkUrl?: string;
    }
  | {
      ok: false;
      message: string;
      /** True when the fix is to reconnect Google (not connected, or Google refused the token): the UI offers "Reconnect Google Drive". */
      reconnect?: boolean;
    };

export interface PlayerRef {
  id: string;
  display_name: string;
}

export type CreatePlayerResult = { ok: true; player: PlayerRef } | { ok: false; message: string };

/**
 * Create a player from the analysis app's picker. The id that comes back is the one
 * the save must use, so it is checked here: a reply without a real id (an error body
 * with a 200, e.g. the service worker's offline stand-in, or a malformed row) is a
 * failure with its reason, never an empty `playerId` handed on to the save.
 */
export async function createPlayer(fetchFn: typeof fetch, displayName: string): Promise<CreatePlayerResult> {
  const name = displayName.trim();
  if (!name) return { ok: false, message: 'Enter a player name' };
  let res: Response;
  try {
    res = await fetchFn('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: name }),
    });
  } catch (e) {
    return { ok: false, message: `Could not create the player — ${e instanceof Error ? e.message : 'network error'}` };
  }
  const body = (await res.json().catch(() => ({}))) as { player?: { id?: unknown; display_name?: unknown }; error?: string; message?: string };
  if (!res.ok) return { ok: false, message: `Could not create the player — ${body.error ?? body.message ?? `HTTP ${res.status}`}` };
  const id = body.player?.id;
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, message: `Could not create the player — ${body.error ?? 'the server did not return the new player'}` };
  }
  return { ok: true, player: { id, display_name: typeof body.player?.display_name === 'string' && body.player.display_name ? body.player.display_name : name } };
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return body.error ?? body.message ?? `HTTP ${res.status}`;
}

export async function saveScreenshotToPlayer(
  input: SaveScreenshotInput,
  deps: SaveScreenshotDeps,
): Promise<SaveScreenshotResult> {
  const { fetchFn } = deps;
  const { playerId, playerName, inApp } = input;

  // 1 — Drive (the only place a new screenshot is stored)
  deps.onStage?.('uploading');
  if (!input.googleExports) {
    return { ok: false, message: 'Saving screenshots to a player needs Google Drive, which is turned off here. Use Download.' };
  }
  let imageUrl: string | null = null;
  let driveError: string | undefined;
  let reconnect = false;
  try {
    const driveRes = await fetchFn('/api/google/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: input.dataUrl, name: input.fileName, playerId }),
    });
    if (driveRes.ok) {
      const body = (await driveRes.json().catch(() => ({}))) as { url?: string };
      imageUrl = body.url ?? null;
      if (!imageUrl) driveError = 'Drive returned no image link';
    } else {
      const body = (await driveRes.json().catch(() => ({}))) as { error?: string; message?: string; code?: string };
      driveError = body.error ?? body.message ?? `HTTP ${driveRes.status}`;
      reconnect = body.code === 'google_not_connected' || body.code === 'google_reauth';
    }
  } catch (e) {
    driveError = e instanceof Error ? e.message : 'Drive upload failed';
  }
  if (!imageUrl) {
    // Nothing is saved: no entry, no half-saved report. The caller still holds the capture.
    if (!inApp) return { ok: false, message: 'Upload failed — try again', ...(reconnect ? { reconnect } : {}) };
    return reconnect
      ? { ok: false, reconnect: true, message: 'Google Drive is not connected. Reconnect it, then press the player again. Your screenshot is kept.' }
      : { ok: false, message: `Could not save to your Google Drive — ${driveError ?? 'try again'}. Your screenshot is kept: try again.` };
  }

  // 2 — the entry
  deps.onStage?.('saving');
  const entryRes = await fetchFn(`/api/players/${playerId}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: 'technique',
      folder_label: input.folderLabel,
      body_text: 'Screenshot from analysis session.',
      screenshots: [imageUrl],
      source: 'analysis-screenshot',
    }),
  });
  if (!entryRes.ok) {
    if (!inApp) return { ok: false, message: 'Failed to save screenshot — try again' };
    return { ok: false, message: `Failed to save screenshot — ${await readError(entryRes)}` };
  }

  // 3a — in-app: done, hand back the report link
  if (inApp) {
    const saved = (await entryRes.json().catch(() => ({}))) as { entry?: { id?: string } };
    const entryId = saved.entry?.id;
    if (!entryId) {
      // A 2xx with no entry is not a confirmed save; never show it as one.
      return { ok: false, message: 'Not confirmed — the server did not return the saved report. Check the player’s reports before saving again.' };
    }
    return {
      ok: true,
      message: `Saved to report — ${playerName}`,
      imageUrl,
      storage: 'drive',
      entryId,
      linkUrl: `/players/${playerId}/reports/${entryId}`,
    };
  }

  // 3b — switch off: the Google Doc append, exactly as before
  if (!input.googleExports) {
    return { ok: true, message: `Saved to ${playerName}`, imageUrl, storage: 'drive' };
  }
  try {
    const docRes = await fetchFn(`/api/players/${playerId}/google-doc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, timestampLabel: input.timestampLabel }),
    });
    if (docRes.ok) {
      const docBody = (await docRes.json().catch(() => ({}))) as { url?: string };
      return {
        ok: true,
        message: `Saved to ${playerName} + Google Doc`,
        imageUrl,
        storage: 'drive',
        ...(docBody.url ? { linkUrl: docBody.url } : {}),
      };
    }
    const docErr = (await docRes.json().catch(() => ({}))) as { error?: string };
    return { ok: true, message: `Saved to ${playerName} — Google Doc failed: ${docErr.error ?? `HTTP ${docRes.status}`}`, imageUrl, storage: 'drive' };
  } catch {
    return { ok: true, message: `Saved to ${playerName} (Google Doc skipped)`, imageUrl, storage: 'drive' };
  }
}
