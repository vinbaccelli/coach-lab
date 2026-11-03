import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deleteBarState, deleteBlockedReason, removeById, restoreAt, rowForOverlay, OVERLAY_ROW_CODE } from '@/lib/metrics/deleteSelected';

const read = (p: string) => readFileSync(p, 'utf8');
const page = read('app/analysis/page.tsx');
const canvas = read('components/Canvas.tsx');

const rows = [
  { id: 'ai-le-1', label: 'L Elbow', value: 120, unit: '°', type: 'angle' },
  { id: 'ai-sa-1', label: 'Shoulder (L→R)', value: 12, unit: '°', type: 'arrowAngle' },
  { id: 'ai-ha-1', label: 'Hip (L→R)', value: 8, unit: '°', type: 'arrowAngle' },
  { id: 'ai-shd-1', label: 'Shoulder-Hip Diff', value: 4, unit: '°', type: 'differential' },
];

test('an AI overlay line maps to its own data-column row by the stable id prefix, never to a look-alike', () => {
  assert.deepEqual(rowForOverlay(rows, 'shoulder')?.row.id, 'ai-sa-1');
  assert.equal(rowForOverlay(rows, 'shoulder')?.index, 1);
  assert.equal(rowForOverlay(rows, 'hip')?.row.id, 'ai-ha-1');
  assert.equal(rowForOverlay(rows, 'racket'), null, 'no such row');
  assert.equal(rowForOverlay(rows, 'not-a-line'), null);
  assert.deepEqual(Object.keys(OVERLAY_ROW_CODE).sort(), ['head', 'hip', 'lfoot', 'racket', 'rfoot', 'shoulder']);
  // 'ai-shd-' (Shoulder-Hip Diff) is not the shoulder line's row.
  assert.notEqual(rowForOverlay([rows[3]], 'shoulder')?.row.id, 'ai-shd-1');
});

test('delete removes only that item; undo puts it back where it was; nothing else moves', () => {
  const after = removeById(rows, 'ai-sa-1');
  assert.deepEqual(after.map((r) => r.id), ['ai-le-1', 'ai-ha-1', 'ai-shd-1']);
  assert.deepEqual(after[0], rows[0], 'other rows are the same objects/values');
  const back = restoreAt(after, rows[1], 1);
  assert.deepEqual(back.map((r) => r.id), rows.map((r) => r.id));
  assert.deepEqual(restoreAt(back, rows[1], 0).map((r) => r.id), rows.map((r) => r.id), 'restoring twice does not duplicate');
  assert.deepEqual(restoreAt([], rows[0], 5).map((r) => r.id), ['ai-le-1'], 'index is clamped');
  assert.deepEqual(removeById(rows, 'nope'), rows);
});

test('deleting is blocked while an export, Generate, a replay or a recording is using the snapshots', () => {
  assert.equal(deleteBlockedReason({ exportOpen: false, generateOpen: false, replaying: false, recording: false }), null);
  assert.match(deleteBlockedReason({ exportOpen: true, generateOpen: false, replaying: false, recording: false }) ?? '', /Close Generate or the export/);
  assert.match(deleteBlockedReason({ exportOpen: false, generateOpen: true, replaying: false, recording: false }) ?? '', /Close Generate or the export/);
  assert.match(deleteBlockedReason({ exportOpen: false, generateOpen: false, replaying: true, recording: false }) ?? '', /replay or recording/);
  assert.match(deleteBlockedReason({ exportOpen: false, generateOpen: false, replaying: false, recording: true }) ?? '', /replay or recording/);
});

test('the control: nothing selected and nothing deleted shows nothing; selected shows a 44px Delete; blocked disables it; the toast has Undo', () => {
  assert.equal(deleteBarState({ selectedLabel: null, deletedLabel: null }).visible, false);
  const sel = deleteBarState({ selectedLabel: 'Snapshot 2', deletedLabel: null });
  assert.equal(sel.visible, true);
  assert.equal(sel.deleteLabel, 'Delete Snapshot 2');
  assert.equal(sel.minTouchPx, 44);
  assert.equal(sel.deleteDisabled, false);
  assert.equal(sel.toast, null);
  const msg = 'Close Generate or the export first: it is using this.';
  const blocked = deleteBarState({ selectedLabel: 'Snapshot 2', blockedReason: msg, deletedLabel: null });
  assert.equal(blocked.deleteDisabled, true);
  assert.equal(blocked.reason, msg);
  const toast = deleteBarState({ selectedLabel: null, deletedLabel: 'Snapshot 2' });
  assert.equal(toast.toast, 'Deleted Snapshot 2.');
  assert.equal(toast.undoLabel, 'Undo');
  assert.equal(toast.showDelete, false);
  // The component renders from that state (44px sizes, disabled, toast, Undo button).
  const src = readFileSync('components/metrics/SelectedItemDeleteBar.tsx', 'utf8');
  for (const needle of ['deleteBarState(', 'v.minTouchPx', 'disabled={v.deleteDisabled}', 'role="status"', 'Undo']) assert.ok(src.includes(needle), needle);
});

test('page wiring: the bar is mounted, selection comes from the canvas, only the selected item is deleted', () => {
  assert.ok(page.includes('<SelectedItemDeleteBar'));
  assert.ok(page.includes('onActiveOverlayChange={setSelectedOverlayId}'));
  assert.ok(page.includes('hiddenOverlayIds={hiddenOverlayIds}'));
  // A snapshot delete goes through the existing deleteSnapshot (removes that id, returns cleanly to live if it was active).
  assert.ok(page.includes('deleteSnapshot(activeSnapshot.id)'));
  const del = page.slice(page.indexOf('const deleteSnapshot = useCallback('), page.indexOf('// ── Generate: capture phase screenshots'));
  assert.ok(del.includes('setSnapshots(prev => prev.filter(s => s.id !== id))'));
  assert.ok(del.includes('setBiomechSelectedPhaseId(null)'), 'selection is cleaned up when the active snapshot goes');
  // The selection is cleared after an angle delete, and the toast self-dismisses.
  const block = page.slice(page.indexOf('const deleteSelected = useCallback('), page.indexOf('const undoDelete'));
  assert.ok(block.includes('setSelectedOverlayId(null)'));
  assert.ok(page.includes('setTimeout(() => setLastDeleted(null), 6000)'));
});

test('existing undo behaviour and snapshot creation are untouched', () => {
  assert.ok(page.includes("onUndoMeasurement:               () => {"));
  assert.ok(page.includes("const aiTypes = new Set(['angle', 'arrowAngle', 'differential', 'ruler']);"));
  assert.ok(page.includes('setSnapshots(prev => [...prev, snap]);'), 'snapshot creation still has no undo entry');
});

test('canvas: a deleted AI line is neither drawn nor grabbable; selection is reported through one helper', () => {
  assert.ok(canvas.includes('if (hiddenOverlayIdsRef.current?.has(id)) return; // a deleted AI angle'));
  assert.ok(canvas.includes('overlayEndpoints.splice(i, 1)'));
  assert.equal(/activeOverlayIdRef\.current = (eid|bestLineId|null)/.test(canvas.replace(/const setActiveOverlay[\s\S]*?\n    };/, '')), false, 'every selection change goes through setActiveOverlay');
  assert.equal((canvas.match(/setActiveOverlay\(/g) ?? []).length, 4, 'the four selection sites');
});
