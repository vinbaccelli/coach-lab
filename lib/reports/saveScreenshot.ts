/**
 * Saving an analysis screenshot to a player — the logic behind
 * `handleScreenshotSaveToPlayer` in app/analysis/page.tsx, lifted out so it can be
 * tested against a mocked fetch, Drive and Supabase.
 *
 * Order (unchanged from before the in-app reports):
 *   1. Upload the image to the coach's own Drive (/api/google/upload-image), when
 *      Google exports are enabled. ANY failure falls back to step 2.
 *   2. Fallback: the caller's Supabase `player-assets` upload.
 *   3. Create the `technique` entry (/api/players/[id]/entries).
 *   4. `inApp` on  → no Google Doc write; the result carries a link to the in-app
 *      report. `inApp` off → the old best-effort /api/players/[id]/google-doc append.
 *
 * Every failure carries the real reason. With `inApp` off the messages are the
 * ones the app has always shown, word for word.
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
  /** Supabase `player-assets` upload; resolves a public URL, or null when it failed. */
  uploadFallback: (dataUrl: string) => Promise<string | null>;
}

export type SaveScreenshotResult =
  | {
      ok: true;
      /** Status line for the coach. */
      message: string;
      imageUrl: string;
      storage: 'drive' | 'supabase';
      /** Why Drive was skipped for the fallback, when it was tried and failed. */
      driveError?: string;
      /** The id of the saved entry, when the server returned it. */
      entryId?: string;
      /** In-app mode: the report. Off mode: the Google Doc. Opens in a new tab. */
      linkUrl?: string;
    }
  | { ok: false; message: string };

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

  // 1 — Drive
  let imageUrl: string | null = null;
  let storage: 'drive' | 'supabase' = 'drive';
  let driveError: string | undefined;
  if (input.googleExports) {
    try {
      const driveRes = await fetchFn('/api/google/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: input.dataUrl, name: input.fileName, playerId }),
      });
      if (driveRes.ok) {
        const body = (await driveRes.json()) as { url?: string };
        imageUrl = body.url ?? null;
        if (!imageUrl) driveError = 'Drive returned no image link';
      } else {
        driveError = await readError(driveRes);
      }
    } catch (e) {
      driveError = e instanceof Error ? e.message : 'Drive upload failed';
    }
  }

  // 2 — Supabase fallback
  if (!imageUrl) {
    storage = 'supabase';
    try {
      imageUrl = await deps.uploadFallback(input.dataUrl);
    } catch {
      imageUrl = null;
    }
  }
  if (!imageUrl) {
    if (!inApp) return { ok: false, message: 'Upload failed — try again' };
    return {
      ok: false,
      message: driveError
        ? `Upload failed — Drive: ${driveError}; the backup storage also failed. Try again.`
        : 'Upload failed — try again',
    };
  }

  // 3 — the entry
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

  // 4a — in-app: done, hand back the report link
  if (inApp) {
    const saved = (await entryRes.json().catch(() => ({}))) as { entry?: { id?: string } };
    const entryId = saved.entry?.id;
    const where = storage === 'drive' ? '' : ` (kept in AngleMotion — Drive unavailable${driveError ? `: ${driveError}` : ''})`;
    return {
      ok: true,
      message: `Saved to report — ${playerName}${where}`,
      imageUrl,
      storage,
      ...(driveError ? { driveError } : {}),
      ...(entryId ? { entryId, linkUrl: `/players/${playerId}/reports/${entryId}` } : {}),
    };
  }

  // 4b — switch off: the Google Doc append, exactly as before
  if (!input.googleExports) {
    return { ok: true, message: `Saved to ${playerName}`, imageUrl, storage };
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
        storage,
        ...(docBody.url ? { linkUrl: docBody.url } : {}),
      };
    }
    const docErr = (await docRes.json().catch(() => ({}))) as { error?: string };
    return { ok: true, message: `Saved to ${playerName} — Google Doc failed: ${docErr.error ?? `HTTP ${docRes.status}`}`, imageUrl, storage };
  } catch {
    return { ok: true, message: `Saved to ${playerName} (Google Doc skipped)`, imageUrl, storage };
  }
}
