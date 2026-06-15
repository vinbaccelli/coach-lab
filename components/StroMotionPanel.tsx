'use client';

import React from 'react';
import { BoxSelect, Download, Trash2 } from 'lucide-react';
import {
  STRO_MOTION_GHOST_COUNTS,
  type StroMotionDiagnostics,
  type StroMotionGhostCount,
  type StroMotionSubjectBox,
} from '@/lib/stroMotion';

function formatTimeShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

export interface StroMotionPanelProps {
  currentTime: number;
  startFrame: number;
  endFrame: number;
  onSetStartFrame: () => void;
  onSetEndFrame: () => void;
  ghostCount: StroMotionGhostCount;
  onGhostCountChange: (n: StroMotionGhostCount) => void;
  subjectBox: StroMotionSubjectBox | null;
  onSelectObject: () => void;
  isSelectingObject: boolean;
  isProcessing: boolean;
  progressCurrent: number;
  progressTotal: number;
  isReady: boolean;
  videoExportSupported: boolean;
  isExportingVideo?: boolean;
  onGenerate: () => void;
  onClear: () => void;
  onExportPng: () => void;
  onExportVideo: () => void;
  disabled?: boolean;
  disabledReason?: string;
  showSkeleton?: boolean;
  onShowSkeletonChange?: (v: boolean) => void;
  debugMode?: boolean;
  onDebugModeChange?: (v: boolean) => void;
  diagnostics?: StroMotionDiagnostics | null;
  precomputedSampleTimes?: number[];
}

export default function StroMotionPanel({
  currentTime,
  startFrame,
  endFrame,
  onSetStartFrame,
  onSetEndFrame,
  ghostCount,
  onGhostCountChange,
  subjectBox,
  onSelectObject,
  isSelectingObject,
  isProcessing,
  progressCurrent,
  progressTotal,
  isReady,
  videoExportSupported,
  isExportingVideo = false,
  onGenerate,
  onClear,
  onExportPng,
  onExportVideo,
  disabled,
  disabledReason,
  showSkeleton = false,
  onShowSkeletonChange,
  debugMode = false,
  onDebugModeChange,
  diagnostics,
  precomputedSampleTimes,
}: StroMotionPanelProps) {
  const canGenerate =
    !disabled &&
    !isProcessing &&
    !!subjectBox &&
    endFrame > startFrame;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px 12px' }}>
      <p style={{ margin: '0 0 8px', fontSize: 12, lineHeight: 1.45, color: 'var(--cl-text-muted, #666)' }}>
        Stromotion multiplier: select an object (racket, club, bat, etc.) and capture its positions across the movement.
      </p>

      {disabled && disabledReason ? (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#c0392b' }}>{disabledReason}</p>
      ) : null}

      <button
        type="button"
        onClick={onSelectObject}
        disabled={disabled || isProcessing || isExportingVideo}
        style={{
          ...secondaryBtnStyle,
          borderColor: isSelectingObject ? 'var(--cl-accent, #007AFF)' : undefined,
          background: isSelectingObject ? 'rgba(0,122,255,0.08)' : undefined,
          opacity: disabled || isProcessing || isExportingVideo ? 0.5 : 1,
        }}
      >
        <BoxSelect size={14} />
        {isSelectingObject ? ' Draw box on object…' : subjectBox ? ' Re-select Object' : ' Select Object'}
      </button>
      {subjectBox ? (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--cl-text-muted)' }}>
          Object box ({Math.round(subjectBox.width * 100)}% × {Math.round(subjectBox.height * 100)}%) — tight around the object only.
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--cl-text-muted)' }}>
          Draw a tight box around the object to multiply — e.g. tennis racket, golf club, or baseball bat. Not the full athlete.
        </p>
      )}

      <button
        type="button"
        onClick={onSetStartFrame}
        disabled={disabled || isProcessing || isExportingVideo}
        style={chipBtnStyle}
      >
        Set Start Frame @ {formatTimeShort(currentTime)}
      </button>
      <div style={{ fontSize: 11, color: 'var(--cl-text-muted)', paddingLeft: 4 }}>
        Start: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{formatTimeShort(startFrame)}</strong>
        {' '}(background)
      </div>

      <button
        type="button"
        onClick={onSetEndFrame}
        disabled={disabled || isProcessing || isExportingVideo}
        style={chipBtnStyle}
      >
        Set End Frame @ {formatTimeShort(currentTime)}
      </button>
      <div style={{ fontSize: 11, color: 'var(--cl-text-muted)', paddingLeft: 4, marginBottom: 4 }}>
        End: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{formatTimeShort(endFrame)}</strong>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 4px' }}>Frame Stops</div>
      <p style={{ margin: '0 0 4px', fontSize: 10, color: 'var(--cl-text-muted)', lineHeight: 1.4 }}>
        Each count adds a ball marker on the timeline — one multiplied object position per stop.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {STRO_MOTION_GHOST_COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled || isProcessing || isExportingVideo}
            onClick={() => onGhostCountChange(n)}
            style={{
              padding: '10px 0',
              borderRadius: 8,
              border: ghostCount === n ? '2px solid var(--cl-accent, #007AFF)' : '1px solid var(--cl-border, #ddd)',
              background: ghostCount === n ? 'rgba(0,122,255,0.1)' : 'var(--cl-surface, #fff)',
              fontWeight: 700,
              fontSize: 14,
              cursor: disabled || isProcessing ? 'not-allowed' : 'pointer',
              opacity: disabled || isProcessing ? 0.5 : 1,
            }}
          >
            {n}
          </button>
        ))}
      </div>

      {isProcessing ? (
        <div style={{ fontSize: 12, marginTop: 8 }}>
          Extracting… {progressCurrent} / {progressTotal}
        </div>
      ) : isReady ? (
        <div style={{ fontSize: 12, marginTop: 8, fontWeight: 600 }}>
          {ghostCount} object positions ready
        </div>
      ) : null}

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 8,
          fontSize: 12,
          fontWeight: 600,
          cursor: disabled || isProcessing ? 'not-allowed' : 'pointer',
          opacity: disabled || isProcessing ? 0.5 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={showSkeleton}
          disabled={disabled || isProcessing || isExportingVideo}
          onChange={(e) => onShowSkeletonChange?.(e.target.checked)}
        />
        Show Skeleton
      </label>

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{
          ...primaryBtnStyle,
          marginTop: 8,
          opacity: canGenerate ? 1 : 0.5,
          cursor: canGenerate ? 'pointer' : 'not-allowed',
        }}
      >
        {isProcessing ? `Processing ${progressCurrent}/${progressTotal}` : 'Generate'}
      </button>

      <button
        type="button"
        onClick={onExportPng}
        disabled={!isReady || isExportingVideo}
        style={{
          ...secondaryBtnStyle,
          opacity: !isReady || isExportingVideo ? 0.5 : 1,
          cursor: !isReady || isExportingVideo ? 'not-allowed' : 'pointer',
        }}
      >
        <Download size={14} /> Export PNG
      </button>

      <button
        type="button"
        onClick={onExportVideo}
        disabled={!isReady || isExportingVideo || !videoExportSupported}
        style={{
          ...secondaryBtnStyle,
          opacity: !isReady || isExportingVideo || !videoExportSupported ? 0.5 : 1,
          cursor: !isReady || isExportingVideo || !videoExportSupported ? 'not-allowed' : 'pointer',
        }}
      >
        <Download size={14} /> {isExportingVideo ? 'Recording…' : 'Export Video'}
      </button>

      {!videoExportSupported ? (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--cl-text-muted)', lineHeight: 1.4 }}>
          Video export is not supported in Safari — use Export PNG instead.
        </p>
      ) : null}

      {(isReady || subjectBox) && !isProcessing ? (
        <button type="button" onClick={onClear} style={dangerBtnStyle}>
          <Trash2 size={14} /> Clear
        </button>
      ) : null}

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 4,
          fontSize: 11,
          color: 'var(--cl-text-muted)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={debugMode}
          onChange={(e) => onDebugModeChange?.(e.target.checked)}
        />
        Debug diagnostics
      </label>

      {debugMode ? (
        <div
          style={{
            marginTop: 6,
            padding: 8,
            borderRadius: 8,
            border: '1px dashed var(--cl-border, #ccc)',
            fontSize: 10,
            fontFamily: 'ui-monospace, monospace',
            lineHeight: 1.5,
            color: 'var(--cl-text-muted)',
          }}
        >
          <div>
            <strong>Sample times:</strong>{' '}
            {(precomputedSampleTimes ?? diagnostics?.sampleTimes ?? [])
              .map((t) => t.toFixed(3))
              .join(', ') || '—'}
          </div>
          {diagnostics ? (
            <>
              <div>
                <strong>Object region:</strong>{' '}
                {`${(diagnostics.effectiveBox.x * 100).toFixed(1)}%, ${(diagnostics.effectiveBox.y * 100).toFixed(1)}% · ${(diagnostics.effectiveBox.width * 100).toFixed(1)}×${(diagnostics.effectiveBox.height * 100).toFixed(1)}%`}
              </div>
              <div>
                <strong>Extraction time:</strong> {diagnostics.extractionTimeMs} ms
              </div>
            </>
          ) : (
            <div style={{ marginTop: 4 }}>Generate to populate diagnostics.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

const chipBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 8px',
  borderRadius: 8,
  border: '1px solid var(--cl-border, #ddd)',
  background: 'var(--cl-surface, #fff)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'left',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--cl-accent, #007AFF)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--cl-border, #ddd)',
  background: 'var(--cl-surface, #fff)',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

const dangerBtnStyle: React.CSSProperties = {
  ...secondaryBtnStyle,
  color: '#c0392b',
  borderColor: 'rgba(192,57,43,0.3)',
};
