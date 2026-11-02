/**
 * Pure helpers for deleting a selected snapshot or AI-detected angle, and for undoing it.
 * Kept out of the analysis page so they can be tested without a browser.
 */

/** AI overlay line id (as the canvas names it) → the stable id prefix of its data-column row (`ai-<code>-<time>`). */
export const OVERLAY_ROW_CODE: Record<string, string> = {
  shoulder: 'sa', hip: 'ha', head: 'hd', lfoot: 'lf', rfoot: 'rf', racket: 'ra',
};

export const OVERLAY_LABEL: Record<string, string> = {
  shoulder: 'Shoulder (L→R)', hip: 'Hip (L→R)', head: 'Head Direction', lfoot: 'L Foot', rfoot: 'R Foot', racket: 'Racket Angle',
};

export interface ColumnRow { id: string; label: string; value: number; unit: string; type: string }

/** The data-column row that belongs to an AI overlay line, or null (also for ids the canvas does not name). */
export function rowForOverlay<T extends { id: string }>(rows: readonly T[], overlayId: string): { row: T; index: number } | null {
  const code = OVERLAY_ROW_CODE[overlayId];
  if (!code) return null;
  const index = rows.findIndex((r) => r.id.startsWith(`ai-${code}-`));
  return index < 0 ? null : { row: rows[index], index };
}

/** Remove one item by id; every other item is kept as is, in order. */
export function removeById<T extends { id: string }>(items: readonly T[], id: string): T[] {
  return items.filter((x) => x.id !== id);
}

/** Put a removed item back at its old position (clamped), unless it is already there. */
export function restoreAt<T extends { id: string }>(items: readonly T[], item: T, index: number): T[] {
  if (items.some((x) => x.id === item.id)) return [...items];
  const at = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, at), item, ...items.slice(at)];
}

/** What blocks deleting right now: an open export, Generate or replay uses the snapshots. Null when free. */
export function deleteBlockedReason(state: { exportOpen: boolean; generateOpen: boolean; replaying: boolean; recording: boolean }): string | null {
  if (state.generateOpen || state.exportOpen) return 'Close Generate or the export first: it is using this.';
  if (state.replaying || state.recording) return 'Wait for the replay or recording to finish.';
  return null;
}

/** What the delete bar shows. Pure, so it is tested without rendering. */
export function deleteBarState(p: { selectedLabel: string | null; blockedReason?: string | null; deletedLabel: string | null }) {
  return {
    visible: Boolean(p.selectedLabel || p.deletedLabel),
    showDelete: Boolean(p.selectedLabel),
    deleteLabel: p.selectedLabel ? `Delete ${p.selectedLabel}` : null,
    deleteDisabled: Boolean(p.blockedReason),
    reason: p.selectedLabel && p.blockedReason ? p.blockedReason : null,
    toast: p.deletedLabel ? `Deleted ${p.deletedLabel}.` : null,
    undoLabel: p.deletedLabel ? 'Undo' : null,
    minTouchPx: 44,
  };
}
