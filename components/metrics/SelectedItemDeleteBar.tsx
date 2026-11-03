'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import { deleteBarState } from '@/lib/metrics/deleteSelected';

/**
 * A small floating bar with one clear Delete control for the item the coach has selected
 * (a snapshot, or an AI-detected angle line), and a short "Deleted. Undo" toast after a delete.
 *
 * It holds no analysis state of its own: the page passes what is selected, what to do, and what
 * was just deleted. Nothing here runs during recording or playback (it only renders when something is selected).
 */

const base: React.CSSProperties = {
  // Left edge, vertically centred: nothing else lives there (the playback bar is along the bottom, the
  // Remove A / Add B buttons top right, the zoom cluster right). Never over a control.
  position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
  pointerEvents: 'none', maxWidth: 'calc(100% - 16px)',
};
const pill: React.CSSProperties = {
  pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 14px', borderRadius: 12,
  background: 'rgba(20,20,24,0.92)', color: '#fff', fontSize: 14, fontWeight: 600, border: '1px solid rgba(255,255,255,0.18)',
};

export default function SelectedItemDeleteBar({
  selectedLabel,
  blockedReason,
  onDelete,
  deletedLabel,
  onUndo,
}: {
  /** What is selected, e.g. "Snapshot 2" or "Shoulder (L→R)". Null: nothing selected, no Delete control. */
  selectedLabel: string | null;
  /** When set, Delete is disabled and this says why (an open export or Generate uses the item). */
  blockedReason?: string | null;
  onDelete: () => void;
  /** What was just deleted; shows the Undo toast while set. */
  deletedLabel: string | null;
  onUndo: () => void;
}) {
  const v = deleteBarState({ selectedLabel, blockedReason, deletedLabel });
  if (!v.visible) return null;
  return (
    <div style={base} data-selected-item-bar>
      {deletedLabel && (
        <div role="status" style={pill} data-undo-toast>
          <span>Deleted {deletedLabel}.</span>
          <button
            type="button"
            onClick={onUndo}
            style={{ minHeight: v.minTouchPx, minWidth: v.minTouchPx, padding: '0 8px', background: 'none', border: 'none', color: '#4DA3FF', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            Undo
          </button>
        </div>
      )}
      {selectedLabel && (
        <div style={{ ...pill, flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '6px 14px' }}>
          <button
            type="button"
            data-delete-selected
            onClick={onDelete}
            disabled={v.deleteDisabled}
            aria-label={`Delete ${selectedLabel}`}
            style={{
              minHeight: v.minTouchPx, display: 'inline-flex', alignItems: 'center', gap: 8, padding: 0, background: 'none', border: 'none',
              color: blockedReason ? 'rgba(255,255,255,0.4)' : '#FF6B60', fontSize: 14, fontWeight: 700, cursor: blockedReason ? 'default' : 'pointer',
            }}
          >
            <Trash2 size={16} aria-hidden /> Delete {selectedLabel}
          </button>
          {blockedReason && <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.7)', paddingBottom: 6 }}>{blockedReason}</span>}
        </div>
      )}
    </div>
  );
}
