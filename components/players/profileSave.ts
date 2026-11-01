import { labelsChanged, parseTechnicalSheet, defaultTechnicalSheet, type TechnicalSheetRow } from '@/lib/players/technicalSheet';

/**
 * Save logic of the grouped player profile (PlayerProfileView), kept free of React so it can be
 * tested. Everything the coach can edit lives in ONE draft; one PATCH carries what changed.
 *
 * Rules the tests pin:
 *  - a save that fails changes nothing: the draft (what the coach typed) is never touched, the
 *    saved copy stays as it was, and the profile stays "unsaved" so it can be tried again;
 *  - only what changed is sent;
 *  - the saved copy becomes exactly what was SENT, so keystrokes made while the request was
 *    running still count as unsaved.
 */

export type PlayingHand = 'unknown' | 'right' | 'left';

export interface ProfileDraft {
  photo_url: string;
  date_of_birth: string;
  nationality: string;
  playing_hand: PlayingHand;
  notes: string;
  sheet: TechnicalSheetRow[];
}

/** The fields of the player row this page edits (as GET /api/players/[id] returns them). */
export interface PlayerFields {
  photo_url?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  playing_hand?: string | null;
  notes?: string | null;
  technical_sheet?: unknown;
}

export function draftFromPlayer(p: PlayerFields): ProfileDraft {
  const hand = p.playing_hand === 'right' || p.playing_hand === 'left' ? p.playing_hand : 'unknown';
  return {
    photo_url: p.photo_url ?? '',
    date_of_birth: p.date_of_birth?.slice(0, 10) ?? '',
    nationality: p.nationality ?? '',
    playing_hand: hand,
    notes: p.notes ?? '',
    // A player whose sheet was never saved shows the built-in rows; nothing is stored until they save.
    sheet: parseTechnicalSheet(p.technical_sheet) ?? defaultTechnicalSheet(),
  };
}

const sheetKey = (rows: readonly TechnicalSheetRow[]) => JSON.stringify(rows.map((r) => [r.label, r.value]));

/** Which parts differ between the saved copy and the draft. */
export function changedParts(base: ProfileDraft, draft: ProfileDraft) {
  return {
    photo_url: base.photo_url !== draft.photo_url,
    date_of_birth: base.date_of_birth !== draft.date_of_birth,
    nationality: base.nationality !== draft.nationality,
    playing_hand: base.playing_hand !== draft.playing_hand,
    notes: base.notes !== draft.notes,
    sheet: sheetKey(base.sheet) !== sheetKey(draft.sheet),
  };
}

export function isDirty(base: ProfileDraft, draft: ProfileDraft): boolean {
  return Object.values(changedParts(base, draft)).some(Boolean);
}

/** The body of the PATCH: only the changed fields, with empty text sent as null (the same as the old profile did). */
export function buildPatch(base: ProfileDraft, draft: ProfileDraft): Record<string, unknown> {
  const c = changedParts(base, draft);
  const patch: Record<string, unknown> = {};
  if (c.photo_url) patch.photo_url = draft.photo_url || null;
  if (c.date_of_birth) patch.date_of_birth = draft.date_of_birth || null;
  if (c.nationality) patch.nationality = draft.nationality || null;
  if (c.playing_hand) patch.playing_hand = draft.playing_hand || 'unknown';
  if (c.notes) patch.notes = draft.notes || null;
  if (c.sheet) patch.technical_sheet = draft.sheet;
  return patch;
}

export type SaveResult =
  | { ok: true; base: ProfileDraft; templateLabels: string[] | null }
  | { ok: false; base: ProfileDraft; error: string };

/**
 * Saves the draft through `send` (which does the PATCH and throws an Error with the server's message
 * when it fails). Returns the new saved copy, or the old one plus the error. It never receives a way
 * to change the draft, so a failure cannot lose what was typed.
 *
 * `templateLabels` is set when rows were added, removed or renamed: the coach's default sheet for
 * new players follows (the caller sends it; a failure there is not a failed save).
 */
export async function runSave(
  base: ProfileDraft,
  draft: ProfileDraft,
  send: (patch: Record<string, unknown>) => Promise<void>,
): Promise<SaveResult> {
  const patch = buildPatch(base, draft);
  if (Object.keys(patch).length === 0) return { ok: true, base, templateLabels: null };
  // A snapshot: later keystrokes must not change what "was saved".
  const sent: ProfileDraft = { ...draft, sheet: draft.sheet.map((r) => ({ ...r })) };
  try {
    await send(patch);
  } catch (e) {
    return { ok: false, base, error: e instanceof Error && e.message ? e.message : 'Could not save the profile' };
  }
  return {
    ok: true,
    base: sent,
    templateLabels: labelsChanged(base.sheet, sent.sheet) ? sent.sheet.map((r) => r.label) : null,
  };
}

/** The PATCH, as the page sends it: the existing /api/players/[id] route, unchanged. */
export async function sendPatch(playerId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/players/${playerId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(data.message ?? data.error ?? `Could not save the profile (HTTP ${res.status})`);
  }
}

/** The coach's default sheet for NEW players follows structural changes (labels only; never the values). */
export function syncTemplate(labels: string[]): void {
  void fetch('/api/coach-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ technicalSheetTemplate: labels }),
  }).catch(() => {});
}
