'use client';

import React from 'react';
import { BoxSelect, Download, Search, Trash2 } from 'lucide-react';
import {
  STRO_MOTION_GHOST_COUNTS,
  type StroMotionDiagnostics,
  type StroMotionGhostCount,
  type StroMotionSubjectBox,
} from '@/lib/stroMotion';
import type { StroMotionFrameStop } from '@/lib/stroMotionObjectTrack';

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
  frameStops: StroMotionFrameStop[];
  activeFrameStopIndex: number | null;
  onSelectFrameStop: (index: number) => void;
  onReselectFrameStop: (index: number) => void;
  onConfirmFrameStop: (index: number) => void;
  onAutoDetectFrames: () => void;
  isTracking: boolean;
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
  frameStops,
  activeFrameStopIndex,
  onSelectFrameStop,
  onReselectFrameStop,
  onConfirmFrameStop,
  onAutoDetectFrames,
  isTracking,
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
  const stopsReady = frameStops.length === ghostCount && frameStops.length > 0;
  const canDetect =
    !disabled &&
    !isProcessing &&
    !isTracking &&
    !!subjectBox &&
    endFrame > startFrame;
  const canGenerate =
    !disabled &&
    !isProcessing &&
    !isTracking &&
    stopsReady &&
    endFrame > startFrame;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px 12px' }}>
      <p style={{ margin: '0 0 8px', fontSize: 12, lineHeight: 1.45, color: 'var(--cl-text-muted, #666)' }}>
        Select the object on the first frame, auto-detect its position at each frame stop, verify boxes, then generate the multiplied StroMotion.
      </p>

      {disabled && disabledReason ? (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#c0392b' }}>{disabledReason}</p>
      ) : null}

      <button
        type="button"
        onClick={onSelectObject}
        disabled={disabled || isProcessing || isTracking || isExportingVideo}
        style={{
          ...secondaryBtnStyle,
          borderColor: isSelectingObject ? 'var(--cl-accent, #007AFF)' : undefined,
          background: isSelectingObject ? 'rgba(0,122,255,0.08)' : undefined,
          opacity: disabled || isProcessing || isTracking || isExportingVideo ? 0.5 : 1,
        }}
      >
        <BoxSelect size={14} />
        {isSelectingObject ? ' Draw box on object…' : subjectBox ? ' Re-select Object (Frame 1)' : ' Select Object (Frame 1)'}
      </button>
      {subjectBox ? (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--cl-text-muted)' }}>
          Seed box ({Math.round(subjectBox.width * 100)}% × {Math.round(subjectBox.height * 100)}%) — tight around racket or object.
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--cl-text-muted)' }}>
          Step 1: draw a tight box on the racket at the start of the movement.
        </p>
      )}

      <button type="button" onClick={onSetStartFrame} disabled={disabled || isProcessing || isTracking || isExportingVideo} style={chipBtnStyle}>
        Set Start Frame @ {formatTimeShort(currentTime)}
      </button>
      <div style={{ fontSize: 11, color: 'var(--cl-text-muted)', paddingLeft: 4 }}>
        Start: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{formatTimeShort(startFrame)}</strong> (background)
      </div>

      <button type="button" onClick={onSetEndFrame} disabled={disabled || isProcessing || isTracking || isExportingVideo} style={chipBtnStyle}>
        Set End Frame @ {formatTimeShort(currentTime)}
      </button>
      <div style={{ fontSize: 11, color: 'var(--cl-text-muted)', paddingLeft: 4, marginBottom: 4 }}>
        End: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{formatTimeShort(endFrame)}</strong>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 4px' }}>Frame Stops</div>
      <p style={{ margin: '0 0 4px', fontSize: 10, color: 'var(--cl-text-muted)', lineHeight: 1.4 }}>
        Ball markers on the timeline — one object capture per stop.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {STRO_MOTION_GHOST_COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled || isProcessing || isTracking || isExportingVideo}
            onClick={() => onGhostCountChange(n)}
            style={{
              padding: '10px 0',
              borderRadius: 8,
              border: ghostCount === n ? '2px solid var(--cl-accent, #007AFF)' : '1px solid var(--cl-border, #ddd)',
              background: ghostCount === n ? 'rgba(0,122,255,0.1)' : 'var(--cl-surface, #fff)',
              fontWeight: 700,
              fontSize: 14,
              cursor: disabled || isProcessing || isTracking ? 'not-allowed' : 'pointer',
              opacity: disabled || isProcessing || isTracking ? 0.5 : 1,
            }}
          >
            {n}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onAutoDetectFrames}
        disabled={!canDetect}
        style={{
          ...secondaryBtnStyle,
          marginTop: 6,
          background: 'rgba(255,149,0,0.12)',
          borderColor: 'rgba(255,149,0,0.5)',
          opacity: canDetect ? 1 : 0.5,
          cursor: canDetect ? 'pointer' : 'not-allowed',
        }}
      >
        <Search size={14} />
        {isTracking ? `Detecting… ${progressCurrent}/${progressTotal}` : 'Auto-Detect Positions'}
      </button>

      {frameStops.length > 0 ? (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--cl-text-muted)' }}>
            Step 2: Verify each frame stop
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
            {frameStops.map((stop) => {
              const active = stop.index === activeFrameStopIndex;
              const statusLabel = stop.userConfirmed
                ? '✓ confirmed'
                : stop.autoDetected
                  ? 'auto'
                  : 'needs review';
              return (
                <div
                  key={stop.index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: active ? '1px solid var(--cl-accent, #007AFF)' : '1px solid var(--cl-border, #ddd)',
                    background: active ? 'rgba(0,122,255,0.08)' : 'var(--cl-surface, #fff)',
                    fontSize: 11,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectFrameStop(stop.index)}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 11,
                    }}
                  >
                    <strong>#{stop.index + 1}</strong> {formatTimeShort(stop.timeSec)}
                    <span style={{ marginLeft: 6, opacity: 0.65 }}>{statusLabel}</span>
                  </button>
                  <button type="button" style={miniBtn} onClick={() => onReselectFrameStop(stop.index)}>
                    Re-select
                  </button>
                  {!stop.userConfirmed ? (
                    <button type="button" style={miniBtn} onClick={() => onConfirmFrameStop(stop.index)}>
                      OK
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {isProcessing ? (
        <div style={{ fontSize: 12, marginTop: 8 }}>
          Generating… {progressCurrent} / {progressTotal}
        </div>
      ) : isReady ? (
        <div style={{ fontSize: 12, marginTop: 8, fontWeight: 600 }}>
          StroMotion ready — {ghostCount} object layers
        </div>
      ) : stopsReady ? (
        <div style={{ fontSize: 11, marginTop: 8, color: 'var(--cl-text-muted)' }}>
          Positions detected — verify boxes, then press Generate.
        </div>
      ) : null}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, fontWeight: 600, cursor: disabled || isProcessing ? 'not-allowed' : 'pointer', opacity: disabled || isProcessing ? 0.5 : 1 }}>
        <input type="checkbox" checked={showSkeleton} disabled={disabled || isProcessing || isExportingVideo} onChange={(e) => onShowSkeletonChange?.(e.target.checked)} />
        Show Skeleton
      </label>

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{ ...primaryBtnStyle, marginTop: 8, opacity: canGenerate ? 1 : 0.5, cursor: canGenerate ? 'pointer' : 'not-allowed' }}
      >
        {isProcessing ? `Generating ${progressCurrent}/${progressTotal}` : 'Generate StroMotion'}
      </button>

      <button type="button" onClick={onExportPng} disabled={!isReady || isExportingVideo} style={{ ...secondaryBtnStyle, opacity: !isReady || isExportingVideo ? 0.5 : 1, cursor: !isReady || isExportingVideo ? 'not-allowed' : 'pointer' }}>
        <Download size={14} /> Export PNG
      </button>

      <button type="button" onClick={onExportVideo} disabled={!isReady || isExportingVideo || !videoExportSupported} style={{ ...secondaryBtnStyle, opacity: !isReady || isExportingVideo || !videoExportSupported ? 0.5 : 1, cursor: !isReady || isExportingVideo || !videoExportSupported ? 'not-allowed' : 'pointer' }}>
        <Download size={14} /> {isExportingVideo ? 'Recording…' : 'Export Video'}
      </button>

      {!videoExportSupported ? (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--cl-text-muted)', lineHeight: 1.4 }}>
          Video export is not supported in Safari — use Export PNG instead.
        </p>
      ) : null}

      {(isReady || subjectBox || frameStops.length > 0) && !isProcessing && !isTracking ? (
        <button type="button" onClick={onClear} style={dangerBtnStyle}>
          <Trash2 size={14} /> Clear
        </button>
      ) : null}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 11, color: 'var(--cl-text-muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={debugMode} onChange={(e) => onDebugModeChange?.(e.target.checked)} />
        Debug diagnostics
      </label>

      {debugMode ? (
        <div style={{ marginTop: 6, padding: 8, borderRadius: 8, border: '1px dashed var(--cl-border, #ccc)', fontSize: 10, fontFamily: 'ui-monospace, monospace', lineHeight: 1.5, color: 'var(--cl-text-muted)' }}>
          <div>
            <strong>Sample times:</strong>{' '}
            {(precomputedSampleTimes ?? diagnostics?.sampleTimes ?? []).map((t) => t.toFixed(3)).join(', ') || '—'}
          </div>
          {diagnostics ? (
            <>
              <div>
                <strong>Object region:</strong>{' '}
                {`${(diagnostics.effectiveBox.x * 100).toFixed(1)}%, ${(diagnostics.effectiveBox.y * 100).toFixed(1)}% · ${(diagnostics.effectiveBox.width * 100).toFixed(1)}×${(diagnostics.effectiveBox.height * 100).toFixed(1)}%`}
              </div>
              <div><strong>Extraction time:</strong> {diagnostics.extractionTimeMs} ms</div>
            </>
          ) : (
            <div style={{ marginTop: 4 }}>Generate to populate diagnostics.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 5,
  border: '1px solid var(--cl-border, #ddd)',
  background: 'var(--cl-surface, #fff)',
  fontSize: 10,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

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
