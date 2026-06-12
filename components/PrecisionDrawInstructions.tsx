'use client';

import React from 'react';

const STORAGE_KEY = 'coachlab.precisionDraw.instructionsSeen';

export function hasSeenPrecisionInstructions(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markPrecisionInstructionsSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* noop */
  }
}

export default function PrecisionDrawInstructions({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: () => void;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="precision-draw-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onDismiss();
      }}
    >
      <div
        style={{
          maxWidth: 380,
          width: '100%',
          borderRadius: 16,
          padding: '22px 20px',
          background: 'rgba(250,248,245,0.98)',
          border: '1px solid rgba(0,0,0,0.08)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
          color: '#1d1d1f',
        }}
      >
        <h2 id="precision-draw-title" style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700 }}>
          Precision drawing
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 14, opacity: 0.82, lineHeight: 1.45 }}>
          Place points accurately without your finger covering the spot.
        </p>
        <ol style={{ margin: '0 0 18px', paddingLeft: 20, fontSize: 14, lineHeight: 1.55, gap: 12, display: 'flex', flexDirection: 'column' }}>
          <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span
              style={{
                flexShrink: 0,
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: '#007AFF',
                color: '#fff',
                fontSize: 13,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              1
            </span>
            <span>Touch the screen with one finger to move the cursor.</span>
          </li>
          <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span
              style={{
                flexShrink: 0,
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: '#007AFF',
                color: '#fff',
                fontSize: 13,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              2
            </span>
            <span>Tap with a second finger anywhere to click and place a point.</span>
          </li>
          <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span
              style={{
                flexShrink: 0,
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: '#007AFF',
                color: '#fff',
                fontSize: 13,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              3
            </span>
            <span>Two finger tap again to finish your drawing.</span>
          </li>
        </ol>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 12,
            border: 'none',
            background: '#007AFF',
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            cursor: 'pointer',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
