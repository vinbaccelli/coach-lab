'use client';

import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BoxSelect, Check, Download, Layers, Minus, Plus, Trash2 } from 'lucide-react';
import {
  STRO_MOTION_FRAME_COUNTS,
  type StroMotionFrameCount,
  type StroMotionFrameStatus,
  type StroMotionObjectType,
} from '@/lib/stroMotionDraft/types';
import type { StroMotionBackground, StroMotionVideoOrder } from '@/lib/stroMotionDraft/types';
import type { StroMotionSubjectBox } from '@/lib/stroMotion';

function formatTimeShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

const OBJECT_TYPES: { id: StroMotionObjectType; label: string }[] = [
  { id: 'player', label: 'Player' },
  { id: 'racket', label: 'Racket' },
  { id: 'ball', label: 'Ball' },
  { id: 'custom', label: 'Custom' },
];

function statusLabel(status: StroMotionFrameStatus): string {
  if (status === 'ready') return 'Ready';
  if (status === 'edited') return 'Edited';
  return 'Pending';
}

function statusColor(status: StroMotionFrameStatus): string {
  if (status === 'ready') return '#34C759';
  if (status === 'edited') return '#FF9500';
  return 'var(--cl-text-muted, #888)';
}

export interface StroMotionFrameRow {
  index: number;
  timeSec: number;
  label: string;
  status: StroMotionFrameStatus;
  hasMask: boolean;
  hasSelection?: boolean;
}

export interface StroMotionPanelProps {
  objectType: StroMotionObjectType;
  onObjectTypeChange: (type: StroMotionObjectType) => void;
  currentTime: number;
  startFrame: number;
  endFrame: number;
  onSetStartFrame: () => void;
  onSetEndFrame: () => void;
  frameCount: StroMotionFrameCount;
  onFrameCountChange: (n: StroMotionFrameCount) => void;
  frames: StroMotionFrameRow[];
  activeFrameIndex: number | null;
  onSelectFrame: (index: number) => void;
  onSelectArea: (index: number) => void;
  onEditFrame: (index: number) => void;
  onMarkReady: (index: number) => void;
  isSelectingArea: boolean;
  selectingFrameIndex: number | null;
  isProposingFrame: boolean;
  proposingFrameIndex: number | null;
  isGenerating: boolean;
  progressCurrent: number;
  progressTotal: number;
  readyCount: number;
  isPreviewReady: boolean;
  videoExportSupported: boolean;
  isExportingVideo?: boolean;
  isBuildingVideoPreview?: boolean;
  onGenerate: () => void;
  onClear: () => void;
  previewPngUrl?: string | null;
  previewVideoUrl?: string | null;
  onDownloadPng?: () => void;
  onDownloadVideo?: () => void;
  onBuildVideoPreview?: () => void;
  onOpenPreview?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  showSkeleton?: boolean;
  onShowSkeletonChange?: (v: boolean) => void;
  precomputedSampleTimes?: number[];
  background?: StroMotionBackground;
  onBackgroundChange?: (bg: StroMotionBackground) => void;
  videoOrder?: StroMotionVideoOrder;
  onVideoOrderChange?: (order: StroMotionVideoOrder) => void;
  /** When true, renders a compact icon-only vertical strip for the collapsed toolbar rail */
  compact?: boolean;
}

function StroFrameSubPanel({
  frame, anchorEl, disabled, isGenerating, isProposingFrame, onSelectArea, onEditFrame, onClose,
}: {
  frame: StroMotionFrameRow;
  anchorEl: HTMLElement;
  disabled: boolean;
  isGenerating: boolean;
  isProposingFrame: boolean;
  onSelectArea: () => void;
  onEditFrame: () => void;
  onClose: () => void;
}) {
  const rect = anchorEl.getBoundingClientRect();
  const left = rect.right + 8;
  const top = Math.min(rect.top, window.innerHeight - 220);

  const panel = (
    <div
      style={{
        position: 'fixed', left, top, zIndex: 9999, width: 190,
        background: '#FFF', borderRadius: 14, border: '1px solid #E5E5EA',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#1D1D1F' }}>Frame {frame.index + 1}</span>
        <span style={{ fontSize: 11, color: '#AEAEB2' }}>{formatTimeShort(frame.timeSec)}</span>
      </div>
      <button
        type="button"
        disabled={disabled || isGenerating || isProposingFrame}
        onClick={onSelectArea}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid #007AFF', background: 'rgba(0,122,255,0.07)', color: '#007AFF' }}
      >
        <BoxSelect size={14} />
        {frame.hasSelection ? 'Re-select area' : 'Select Area'}
      </button>
      {(frame.hasMask || frame.hasSelection) && (
        <button
          type="button"
          onClick={onEditFrame}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid #D1D1D6', background: '#FFF', color: '#1D1D1F' }}
        >
          Edit mask
        </button>
      )}
      <button type="button" onClick={onClose} style={{ fontSize: 11, color: '#AEAEB2', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'center', padding: 4 }}>
        Close
      </button>
    </div>
  );
  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}

function StroFrameCompactIcon({
  frame, isOpen, isSelecting, disabled, isGenerating, isProposingFrame,
  onToggle, onSelectArea, onEditFrame, onClose, anchorEl,
}: {
  frame: StroMotionFrameRow;
  isOpen: boolean;
  isSelecting: boolean;
  disabled: boolean;
  isGenerating: boolean;
  isProposingFrame: boolean;
  onToggle: (el: HTMLElement) => void;
  onSelectArea: () => void;
  onEditFrame: () => void;
  onClose: () => void;
  anchorEl: HTMLElement | null;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const hasContent = frame.hasMask || frame.hasSelection;
  return (
    <div style={{ width: 44, display: 'flex', justifyContent: 'center' }}>
      <button
        ref={btnRef}
        type="button"
        title={`Frame ${frame.index + 1} — ${formatTimeShort(frame.timeSec)}`}
        onClick={() => btnRef.current && onToggle(btnRef.current)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 1,
          width: 44, height: 44, borderRadius: 10, cursor: 'pointer',
          border: isOpen || isSelecting ? '1px solid #007AFF' : hasContent ? '1px solid #34C759' : '1px solid #D1D1D6',
          background: isOpen || isSelecting ? '#007AFF' : hasContent ? 'rgba(52,199,89,0.08)' : '#FFF',
          color: isOpen || isSelecting ? '#FFF' : hasContent ? '#34C759' : '#1D1D1F',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 800, lineHeight: 1 }}>{frame.index + 1}</span>
        {hasContent && <span style={{ fontSize: 8, fontWeight: 700, lineHeight: 1 }}>✓</span>}
      </button>
      {isOpen && anchorEl && (
        <StroFrameSubPanel
          frame={frame}
          anchorEl={anchorEl}
          disabled={disabled}
          isGenerating={isGenerating}
          isProposingFrame={isProposingFrame}
          onSelectArea={onSelectArea}
          onEditFrame={onEditFrame}
          onClose={onClose}
        />
      )}
    </div>
  );
}

export default function StroMotionPanel({
  objectType,
  onObjectTypeChange,
  currentTime,
  startFrame,
  endFrame,
  onSetStartFrame,
  onSetEndFrame,
  frameCount,
  onFrameCountChange,
  frames,
  activeFrameIndex,
  onSelectFrame,
  onSelectArea,
  onEditFrame,
  onMarkReady,
  isSelectingArea,
  selectingFrameIndex,
  isProposingFrame,
  proposingFrameIndex,
  isGenerating,
  progressCurrent,
  progressTotal,
  readyCount,
  isPreviewReady,
  videoExportSupported,
  isExportingVideo = false,
  isBuildingVideoPreview = false,
  onGenerate,
  onClear,
  previewPngUrl,
  previewVideoUrl,
  onDownloadPng,
  onDownloadVideo,
  onBuildVideoPreview,
  onOpenPreview,
  disabled,
  disabledReason,
  showSkeleton = false,
  onShowSkeletonChange,
  precomputedSampleTimes,
  background = 'start',
  onBackgroundChange,
  videoOrder = 'forward',
  onVideoOrderChange,
  compact = false,
}: StroMotionPanelProps) {
  const allReady = frames.length > 0 && readyCount === frames.length;
  const canGenerate = !disabled && !isGenerating && !isProposingFrame && allReady;
  const frameCountIdx = STRO_MOTION_FRAME_COUNTS.indexOf(frameCount);
  const canDecrement = frameCountIdx > 0;
  const canIncrement = frameCountIdx >= 0 && frameCountIdx < STRO_MOTION_FRAME_COUNTS.length - 1;

  // ── Compact icon-only strip ──────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [openFrameIndex, setOpenFrameIndex] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [openFrameAnchor, setOpenFrameAnchor] = useState<HTMLElement | null>(null);

  if (compact) {
    const ib = (active = false, destructive = false): React.CSSProperties => ({
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 44, height: 44, borderRadius: 10, cursor: 'pointer',
      border: active ? '1px solid #007AFF' : '1px solid #D1D1D6',
      background: active ? '#007AFF' : '#FFFFFF',
      color: destructive ? '#FF3B30' : active ? '#FFFFFF' : '#1D1D1F',
      margin: '0 auto',
    });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', padding: '4px 0', position: 'relative' }}>
        {disabled && (
          <div style={{ fontSize: 10, color: '#FF3B30', textAlign: 'center', padding: '0 4px', lineHeight: 1.3, marginBottom: 2 }}>
            Upload video first
          </div>
        )}
        {/* Frame count: + / number / - vertical */}
        <button type="button" disabled={disabled || !canIncrement} onClick={() => canIncrement && onFrameCountChange(STRO_MOTION_FRAME_COUNTS[frameCountIdx + 1])} style={ib()} title="More frames">
          <Plus size={18} strokeWidth={2} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#1D1D1F', textAlign: 'center', width: 44, display: 'block', lineHeight: 1.4 }}>{frameCount}</span>
        <button type="button" disabled={disabled || !canDecrement} onClick={() => canDecrement && onFrameCountChange(STRO_MOTION_FRAME_COUNTS[frameCountIdx - 1])} style={ib()} title="Fewer frames">
          <Minus size={18} strokeWidth={2} />
        </button>

        <div style={{ height: 1, background: '#D1D1D6', width: 32, margin: '4px auto' }} />

        {/* Per-frame buttons — each opens a mini sub-panel with Select Area */}
        {frames.map((frame) => (
          <StroFrameCompactIcon
            key={frame.index}
            frame={frame}
            isOpen={openFrameIndex === frame.index}
            isSelecting={isSelectingArea && selectingFrameIndex === frame.index}
            disabled={!!disabled}
            isGenerating={isGenerating}
            isProposingFrame={isProposingFrame}
            onToggle={(el) => {
              const isAlreadyOpen = openFrameIndex === frame.index;
              setOpenFrameIndex(isAlreadyOpen ? null : frame.index);
              setOpenFrameAnchor(isAlreadyOpen ? null : el);
            }}
            onSelectArea={() => { onSelectArea(frame.index); setOpenFrameIndex(null); setOpenFrameAnchor(null); }}
            onEditFrame={() => { onEditFrame(frame.index); setOpenFrameIndex(null); setOpenFrameAnchor(null); }}
            onClose={() => { setOpenFrameIndex(null); setOpenFrameAnchor(null); }}
            anchorEl={openFrameIndex === frame.index ? openFrameAnchor : null}
          />
        ))}

        <div style={{ height: 1, background: '#D1D1D6', width: 32, margin: '4px auto' }} />

        {/* Object type cycle */}
        <button type="button" onClick={() => { const idx = OBJECT_TYPES.findIndex(o => o.id === objectType); onObjectTypeChange(OBJECT_TYPES[(idx + 1) % OBJECT_TYPES.length].id); }} title={`Object: ${objectType}`} style={ib()}>
          <BoxSelect size={18} strokeWidth={2} />
        </button>

        {/* Background toggle */}
        {onBackgroundChange ? (
          <button type="button" onClick={() => onBackgroundChange(background === 'start' ? 'end' : 'start')} title={`Background: ${background}`} style={ib(background === 'end')}>
            <Layers size={18} strokeWidth={2} />
          </button>
        ) : null}

        <div style={{ height: 1, background: '#D1D1D6', width: 32, margin: '4px auto' }} />

        {/* Generate */}
        <button type="button" disabled={!canGenerate} onClick={onGenerate} title="Generate StroMotion" style={ib()}>
          <Check size={18} strokeWidth={2} />
        </button>

        {/* Clear */}
        {(frames.length > 0 || isPreviewReady) ? (
          <button type="button" onClick={onClear} title="Clear" style={ib(false, true)}>
            <Trash2 size={18} strokeWidth={2} />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px 12px' }}>
      <ol style={{ margin: '0 0 10px', padding: '0 0 0 16px', fontSize: 11, lineHeight: 1.6, color: 'var(--cl-text-muted, #666)' }}>
        <li>Pick <strong>Object Type</strong> and set <strong>Start / End Frame</strong> around the stroke.</li>
        <li>Drag the <strong>green balls</strong> on the timeline to each key moment.</li>
        <li>Click <strong>Select Area</strong> on each frame, then draw a box on the video.</li>
        <li>Refine the cyan mask in the editor, then <strong>Mark Ready</strong>.</li>
        <li>Press <strong>Generate</strong> to composite all frames.</li>
      </ol>

      {disabled && disabledReason ? (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#c0392b' }}>{disabledReason}</p>
      ) : null}

      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Object Type</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 8 }}>
        {OBJECT_TYPES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            disabled={disabled || isGenerating || isProposingFrame || isExportingVideo}
            onClick={() => onObjectTypeChange(id)}
            style={{
              padding: '8px 6px',
              borderRadius: 8,
              border: objectType === id ? '2px solid var(--cl-accent, #007AFF)' : '1px solid var(--cl-border, #ddd)',
              background: objectType === id ? 'rgba(0,122,255,0.1)' : 'var(--cl-surface, #fff)',
              fontWeight: 700,
              fontSize: 12,
              cursor: disabled || isGenerating ? 'not-allowed' : 'pointer',
              opacity: disabled || isGenerating ? 0.5 : 1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <button type="button" onClick={onSetStartFrame} disabled={disabled || isGenerating || isProposingFrame || isExportingVideo} style={chipBtnStyle}>
        Set Start (background plate) @ {formatTimeShort(currentTime)}
      </button>
      <div style={{ fontSize: 11, color: 'var(--cl-text-muted)', paddingLeft: 4 }}>
        Background: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{formatTimeShort(startFrame)}</strong>
        <span style={{ marginLeft: 4, opacity: 0.7 }}>— clean frame before stroke begins</span>
      </div>

      <button type="button" onClick={onSetEndFrame} disabled={disabled || isGenerating || isProposingFrame || isExportingVideo} style={chipBtnStyle}>
        Set End Frame @ {formatTimeShort(currentTime)}
      </button>
      <div style={{ fontSize: 11, color: 'var(--cl-text-muted)', paddingLeft: 4, marginBottom: 4 }}>
        End: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{formatTimeShort(endFrame)}</strong>
        <span style={{ marginLeft: 4, opacity: 0.7 }}>— stroke complete</span>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 4px' }}>Frame Count</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          disabled={disabled || !canDecrement || isGenerating || isProposingFrame}
          onClick={() => canDecrement && onFrameCountChange(STRO_MOTION_FRAME_COUNTS[frameCountIdx - 1])}
          style={countStepBtn}
          aria-label="Decrease frame count"
        >
          <Minus size={16} />
        </button>
        <span style={{ fontWeight: 700, fontSize: 22, minWidth: 32, textAlign: 'center' }}>{frameCount}</span>
        <button
          type="button"
          disabled={disabled || !canIncrement || isGenerating || isProposingFrame}
          onClick={() => canIncrement && onFrameCountChange(STRO_MOTION_FRAME_COUNTS[frameCountIdx + 1])}
          style={countStepBtn}
          aria-label="Increase frame count"
        >
          <Plus size={16} />
        </button>
        <span style={{ fontSize: 11, color: 'var(--cl-text-muted)', marginLeft: 4 }}>ghost frames (1–15)</span>
      </div>

      {frames.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--cl-text-muted)' }}>
            Frames — {readyCount}/{frames.length} ready
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {frames.map((frame) => {
              const active = frame.index === activeFrameIndex;
              const selecting = isSelectingArea && selectingFrameIndex === frame.index;
              const proposing = isProposingFrame && proposingFrameIndex === frame.index;
              return (
                <div
                  key={frame.index}
                  style={{
                    padding: '8px',
                    borderRadius: 8,
                    border: active ? '1px solid var(--cl-accent, #007AFF)' : '1px solid var(--cl-border, #ddd)',
                    background: active ? 'rgba(0,122,255,0.08)' : 'var(--cl-surface, #fff)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <button
                      type="button"
                      onClick={() => onSelectFrame(frame.index)}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, textAlign: 'left', fontSize: 11 }}
                    >
                      <strong>{frame.label}</strong>
                    </button>
                    <span style={{ fontSize: 10, fontWeight: 700, color: statusColor(frame.status) }}>
                      {statusLabel(frame.status)}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--cl-text-muted)', fontFamily: 'ui-monospace, monospace', marginBottom: 6 }}>
                    {formatTimeShort(frame.timeSec)}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      style={{
                        ...miniBtn,
                        ...(selecting ? activeMini : {}),
                        ...(!frame.hasSelection && !selecting && !proposing
                          ? { border: '1px solid var(--cl-accent, #007AFF)', color: 'var(--cl-accent, #007AFF)' }
                          : {}),
                      }}
                      disabled={disabled || isGenerating || isProposingFrame}
                      onClick={() => onSelectArea(frame.index)}
                    >
                      <BoxSelect size={10} style={{ marginRight: 4, verticalAlign: -1 }} />
                      {selecting
                        ? 'Draw area…'
                        : proposing
                          ? 'Proposing…'
                          : frame.hasSelection
                            ? 'Re-select area'
                            : 'Select Area'}
                    </button>
                    {frame.hasMask || frame.hasSelection ? (
                      <>
                        <button type="button" style={miniBtn} onClick={() => onEditFrame(frame.index)}>
                          Edit mask
                        </button>
                        {frame.status !== 'ready' ? (
                          <button type="button" style={{ ...miniBtn, color: '#34C759' }} onClick={() => onMarkReady(frame.index)}>
                            <Check size={10} style={{ marginRight: 2, verticalAlign: -1 }} />
                            Ready
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : endFrame > startFrame ? (
        <div style={{ fontSize: 11, marginTop: 8, color: 'var(--cl-text-muted)' }}>
          Drag green balls on the timeline to set each frame time, then Select Area on each frame.
        </div>
      ) : null}

      {isProposingFrame ? (
        <div style={{ fontSize: 12, marginTop: 8 }}>
          AI proposing mask… {progressCurrent}/{progressTotal}
        </div>
      ) : isGenerating ? (
        <div style={{ fontSize: 12, marginTop: 8 }}>
          Generating composite… {progressCurrent}/{progressTotal}
        </div>
      ) : isPreviewReady ? (
        <div style={{ fontSize: 12, marginTop: 8, fontWeight: 600, color: '#34C759' }}>
          StroMotion ready — {frameCount} layers
        </div>
      ) : allReady ? (
        <div style={{ fontSize: 11, marginTop: 8, color: 'var(--cl-text-muted)' }}>
          All frames ready — press Generate StroMotion.
        </div>
      ) : frames.length > 0 ? (
        <div style={{ fontSize: 11, marginTop: 8, color: 'var(--cl-text-muted)' }}>
          Mark each frame Ready after the mask covers the object (cyan overlay).
        </div>
      ) : null}

      {/* Background plate selector */}
      <div style={{ fontSize: 12, fontWeight: 600, margin: '10px 0 4px' }}>Background plate</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        {(['start', 'end'] as const).map((bg) => (
          <button
            key={bg}
            type="button"
            disabled={disabled || isGenerating || isExportingVideo}
            onClick={() => onBackgroundChange?.(bg)}
            style={{
              padding: '8px 6px', borderRadius: 8,
              border: background === bg ? '2px solid var(--cl-accent, #007AFF)' : '1px solid var(--cl-border, #ddd)',
              background: background === bg ? 'rgba(0,122,255,0.1)' : 'var(--cl-surface, #fff)',
              fontWeight: 700, fontSize: 12, cursor: 'pointer',
            }}
          >
            {bg === 'start' ? '← Start frame' : 'End frame →'}
          </button>
        ))}
      </div>

      {/* Video animation order */}
      <div style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 4px' }}>Video animation</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        {([['forward', 'Forward →'], ['reverse', '← Reverse']] as const).map(([ord, label]) => (
          <button
            key={ord}
            type="button"
            disabled={disabled || isGenerating || isExportingVideo}
            onClick={() => onVideoOrderChange?.(ord)}
            style={{
              padding: '8px 6px', borderRadius: 8,
              border: videoOrder === ord ? '2px solid var(--cl-accent, #007AFF)' : '1px solid var(--cl-border, #ddd)',
              background: videoOrder === ord ? 'rgba(0,122,255,0.1)' : 'var(--cl-surface, #fff)',
              fontWeight: 700, fontSize: 11, cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--cl-text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
        {videoOrder === 'forward'
          ? 'Masks accumulate as athlete moves through time →'
          : '← Masks wait ahead, disappear as athlete passes'}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, fontWeight: 600, cursor: disabled || isGenerating ? 'not-allowed' : 'pointer', opacity: disabled || isGenerating ? 0.5 : 1 }}>
        <input type="checkbox" checked={showSkeleton} disabled={disabled || isGenerating || isExportingVideo} onChange={(e) => onShowSkeletonChange?.(e.target.checked)} />
        Show Skeleton
      </label>

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{ ...primaryBtnStyle, marginTop: 8, opacity: canGenerate ? 1 : 0.5, cursor: canGenerate ? 'pointer' : 'not-allowed' }}
      >
        {isGenerating ? `Generating ${progressCurrent}/${progressTotal}` : 'Generate StroMotion'}
      </button>

      {previewPngUrl ? (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--cl-text-muted)' }}>Output ready</div>
          <button type="button" onClick={onOpenPreview} style={primaryBtnStyle}>
            Review image &amp; video
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <img
              src={previewPngUrl}
              alt="StroMotion preview"
              style={{ width: '100%', borderRadius: 8, border: '1px solid var(--cl-border, #ddd)', cursor: onOpenPreview ? 'pointer' : 'default' }}
              onClick={onOpenPreview}
            />
            {previewVideoUrl ? (
              <video
                src={previewVideoUrl}
                muted
                playsInline
                loop
                style={{ width: '100%', borderRadius: 8, border: '1px solid var(--cl-border, #ddd)', background: '#000', cursor: onOpenPreview ? 'pointer' : 'default' }}
                onClick={onOpenPreview}
              />
            ) : (
              <div style={{ fontSize: 11, color: 'var(--cl-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, border: '1px dashed var(--cl-border, #ddd)', borderRadius: 8 }}>
                {isBuildingVideoPreview ? 'Building video…' : 'Video builds after Generate'}
              </div>
            )}
          </div>
          {onDownloadPng ? (
            <button type="button" onClick={onDownloadPng} style={secondaryBtnStyle}>
              <Download size={14} /> Download PNG
            </button>
          ) : null}
          {videoExportSupported && previewVideoUrl && onDownloadVideo ? (
            <button type="button" onClick={onDownloadVideo} disabled={isBuildingVideoPreview} style={secondaryBtnStyle}>
              <Download size={14} /> Download Video
            </button>
          ) : null}
          {videoExportSupported && !previewVideoUrl && onBuildVideoPreview ? (
            <button
              type="button"
              onClick={onBuildVideoPreview}
              disabled={isBuildingVideoPreview || isExportingVideo}
              style={{ ...secondaryBtnStyle, opacity: isBuildingVideoPreview ? 0.6 : 1 }}
            >
              <Download size={14} /> {isBuildingVideoPreview ? 'Building video preview…' : 'Build Video Preview'}
            </button>
          ) : null}
          {!videoExportSupported ? (
            <p style={{ margin: 0, fontSize: 11, color: 'var(--cl-text-muted)' }}>
              Video preview is not supported in Safari — download PNG instead.
            </p>
          ) : null}
        </div>
      ) : null}

      {(isPreviewReady || frames.length > 0) && !isGenerating && !isProposingFrame ? (
        <button type="button" onClick={onClear} style={dangerBtnStyle}>
          <Trash2 size={14} /> Clear
        </button>
      ) : null}

      {precomputedSampleTimes && precomputedSampleTimes.length > 0 ? (
        <div style={{ marginTop: 6, fontSize: 10, fontFamily: 'ui-monospace, monospace', color: 'var(--cl-text-muted)' }}>
          Times: {precomputedSampleTimes.map((t) => t.toFixed(2)).join(', ')}
        </div>
      ) : null}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 5,
  border: '1px solid var(--cl-border, #ddd)',
  background: 'var(--cl-surface, #fff)',
  fontSize: 10,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
};

const activeMini: React.CSSProperties = {
  border: '1px solid var(--cl-accent, #007AFF)',
  background: 'rgba(0,122,255,0.1)',
};

const countStepBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--cl-border, #ddd)',
  background: 'var(--cl-surface, #fff)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
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
