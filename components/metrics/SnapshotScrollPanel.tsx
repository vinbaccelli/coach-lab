'use client';

import React from 'react';
import { X, Download, Play } from 'lucide-react';
import type { Snapshot } from '@/lib/snapshots';

interface SnapshotScrollPanelProps {
  snapshots: Snapshot[];
  activeIndex: number | null;
  onSelectIndex: (index: number) => void;
  onClose: () => void;
  onReplay?: () => void;
  onDownloadVideo?: () => void;
  replaying?: boolean;
  videoUrl?: string | null;
}

/**
 * Horizontal strip of phase screenshots shown after Generate.
 * Highlights the active snapshot during replay; click a card to jump to it.
 */
export default function SnapshotScrollPanel({
  snapshots,
  activeIndex,
  onSelectIndex,
  onClose,
  onReplay,
  onDownloadVideo,
  replaying = false,
  videoUrl,
}: SnapshotScrollPanelProps) {
  if (!snapshots.length) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9400,
        width: 'min(960px, 96vw)',
        background: 'rgba(10,10,16,0.92)',
        backdropFilter: 'blur(16px)',
        borderRadius: 16,
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
          Phase Sequence · {snapshots.length} {snapshots.length === 1 ? 'phase' : 'phases'}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onReplay && (
            <button
              type="button"
              onClick={onReplay}
              disabled={replaying}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
                borderRadius: 8, border: 'none', background: replaying ? '#5856D6' : '#007AFF',
                color: '#fff', fontSize: 12, fontWeight: 600, cursor: replaying ? 'default' : 'pointer',
              }}
            >
              <Play size={13} /> {replaying ? 'Replaying…' : 'Replay slow-mo'}
            </button>
          )}
          {onDownloadVideo && videoUrl && (
            <button
              type="button"
              onClick={onDownloadVideo}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
                borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent',
                color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Download size={13} /> MP4
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close phase sequence"
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
        {snapshots.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelectIndex(i)}
            style={{
              flexShrink: 0,
              width: 140,
              borderRadius: 10,
              overflow: 'hidden',
              border: i === activeIndex ? '2px solid #007AFF' : '2px solid transparent',
              background: '#000',
              cursor: 'pointer',
              padding: 0,
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ width: '100%', height: 80, background: '#1a1a22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {s.screenshot
                ? <img src={s.screenshot} alt={s.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>No capture</span>}
            </div>
            <div style={{ padding: '4px 6px', textAlign: 'left' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {i + 1}. {s.label}
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>
                {s.timeSec.toFixed(2)}s
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
