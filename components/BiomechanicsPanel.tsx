'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  FileText,
  Loader2,
  Minus,
  Pen,
  Plus,
  PlusCircle,
  Ruler,
  Trash2,
  PersonStanding,
} from 'lucide-react';
import {
  AIMETRICS_FRAME_COUNTS,
  type AIMetricsFrameCount,
  type AIMetricsFrameStatus,
  type AIMetricsModuleId,
} from '@/lib/aiMetricsDraft';
import {
  type PhaseDefinition,
  type StrokeType,
} from '@/lib/biomechanics';
import type { ToolType } from '@/lib/drawingTools';

function formatTimeShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

// ── Shared button styles ───────────────────────────────────────────────────

const rowBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '9px 12px', borderRadius: 10,
  border: '1px solid #D1D1D6', background: '#FFFFFF',
  color: '#1D1D1F', fontSize: 13, fontWeight: 500,
  cursor: 'pointer', textAlign: 'left',
};

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 34, height: 34, borderRadius: 8,
  border: '1px solid #D1D1D6', background: '#FFFFFF',
  color: '#1D1D1F', cursor: 'pointer', flexShrink: 0, padding: 0,
};

// Inline SVG angle-arrow icon matching the drawing tool
function AngleArrowIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="2" y1="16" x2="9" y2="4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="9" y1="4" x2="16" y2="14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <polyline points="13,14 16,14 16,11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// ── Compact frame sub-panel — fixed portal, appears to the right of toolbar ─

interface CompactFrameSubPanelProps {
  frame: BiomechFrameRow;
  anchorEl: HTMLElement;
  showSkeleton: boolean;
  onJumpAndDraw: () => void;
  onStampSkeleton: () => void;
  onActivateTool?: (tool: ToolType) => void;
  onToggleMeasurement?: (key: 'footDirection' | 'racketDirection' | 'footDistance', done: boolean) => void;
  onClose: () => void;
}

function CompactFrameSubPanel({
  frame, anchorEl, onJumpAndDraw, onStampSkeleton, onActivateTool, onToggleMeasurement, onClose,
}: CompactFrameSubPanelProps) {
  const measurementRows: { key: 'footDirection' | 'racketDirection' | 'footDistance'; label: string; tool: ToolType; icon: React.ReactNode }[] = [
    { key: 'footDirection', label: 'Foot direction', tool: 'arrowAngle', icon: <AngleArrowIcon size={13} /> },
    { key: 'racketDirection', label: 'Racket direction', tool: 'arrowAngle', icon: <AngleArrowIcon size={13} /> },
    { key: 'footDistance', label: 'Foot distance', tool: 'ruler', icon: <Ruler size={13} /> },
  ];
  const doneMap: Record<string, boolean | undefined> = {
    footDirection: frame.footDirectionDone,
    racketDirection: frame.racketDirectionDone,
    footDistance: frame.footDistanceDone,
  };

  const rect = anchorEl.getBoundingClientRect();
  const panelW = Math.min(220, window.innerWidth - rect.right - 16);
  const left = rect.right + 8;
  const top = Math.min(rect.top, window.innerHeight - 340);

  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e instanceof TouchEvent ? e.touches[0]?.target : e.target;
      if (panelRef.current && !panelRef.current.contains(target as Node) && !anchorEl.contains(target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [onClose, anchorEl]);

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: 'fixed', left, top, zIndex: 9999, width: Math.max(panelW, 180),
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
        onClick={onJumpAndDraw}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid #007AFF', background: 'rgba(0,122,255,0.07)', color: '#007AFF' }}
      >
        <Pen size={14} /> Jump to frame
      </button>

      <button
        type="button"
        onClick={onStampSkeleton}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: frame.hasSkeletonStamp ? '1px solid #5856D6' : '1px solid #D1D1D6', background: frame.hasSkeletonStamp ? 'rgba(88,86,214,0.1)' : '#fff', color: frame.hasSkeletonStamp ? '#5856D6' : '#6E6E73' }}
      >
        <PersonStanding size={14} /> {frame.hasSkeletonStamp ? 'Stamped ✓' : 'Stamp skeleton'}
      </button>

      <div style={{ borderTop: '1px solid #F2F2F7', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#AEAEB2', textTransform: 'uppercase', letterSpacing: 0.5 }}>Measurements</div>
        {measurementRows.map(({ key, label, tool, icon }) => {
          const done = !!doneMap[key];
          return (
            <label
              key={key}
              style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', padding: '2px 0' }}
              onClick={(e) => {
                e.preventDefault();
                if (!done) { onJumpAndDraw(); onActivateTool?.(tool); }
                onToggleMeasurement?.(key, !done);
              }}
            >
              <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: done ? '1.5px solid #007AFF' : '1.5px solid #D1D1D6', background: done ? '#007AFF' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {done && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <span style={{ fontSize: 12, color: done ? '#007AFF' : '#6E6E73', fontWeight: done ? 600 : 400, display: 'flex', alignItems: 'center', gap: 5 }}>
                {icon} {label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}

// ── Compact strip ──────────────────────────────────────────────────────────

interface CompactStripProps {
  frames: BiomechFrameRow[];
  frameCount: AIMetricsFrameCount;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement: boolean;
  canIncrement: boolean;
  onAddFrame: () => void;
  onGenerate: () => void;
  canGenerate: boolean;
  isReportReady: boolean;
  onSaveReport?: () => void;
  onClear: () => void;
  hasClearable: boolean;
  showSkeleton: boolean;
  onSelectFrame: (index: number) => void;
  onStampSkeleton: (index: number) => void;
  onActivateTool?: (tool: ToolType) => void;
  onToggleMeasurement?: (frameIndex: number, key: 'footDirection' | 'racketDirection' | 'footDistance', done: boolean) => void;
}

function FrameCompactIcon({
  frame, isOpen, hasDone, onToggle, onSelectFrame, onStampSkeleton,
  onActivateTool, onToggleMeasurement, onClose, anchorEl,
}: {
  frame: BiomechFrameRow;
  isOpen: boolean;
  hasDone: boolean;
  showSkeleton: boolean;
  onToggle: (el: HTMLElement) => void;
  onSelectFrame: (i: number) => void;
  onStampSkeleton: (i: number) => void;
  onActivateTool?: (t: ToolType) => void;
  onToggleMeasurement?: (fi: number, key: 'footDirection' | 'racketDirection' | 'footDistance', done: boolean) => void;
  onClose: () => void;
  anchorEl: HTMLElement | null;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
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
          border: isOpen ? '1px solid #007AFF' : frame.hasSkeletonStamp || hasDone ? '1px solid #5856D6' : '1px solid #D1D1D6',
          background: isOpen ? '#007AFF' : frame.hasSkeletonStamp || hasDone ? 'rgba(88,86,214,0.08)' : '#FFF',
          color: isOpen ? '#FFF' : frame.hasSkeletonStamp || hasDone ? '#5856D6' : '#1D1D1F',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 800, lineHeight: 1 }}>{frame.index + 1}</span>
        {(frame.hasSkeletonStamp || hasDone) && (
          <span style={{ fontSize: 8, fontWeight: 700, lineHeight: 1 }}>✓</span>
        )}
      </button>
      {isOpen && anchorEl && (
        <CompactFrameSubPanel
          frame={frame}
          anchorEl={anchorEl}
          showSkeleton={false}
          onJumpAndDraw={() => onSelectFrame(frame.index)}
          onStampSkeleton={() => onStampSkeleton(frame.index)}
          onActivateTool={onActivateTool}
          onToggleMeasurement={(key, done) => onToggleMeasurement?.(frame.index, key, done)}
          onClose={onClose}
        />
      )}
    </div>
  );
}

function CompactStrip({
  frames, frameCount, onDecrement, onIncrement, canDecrement, canIncrement,
  onAddFrame, onGenerate, canGenerate, isReportReady, onSaveReport, onClear, hasClearable,
  showSkeleton, onSelectFrame, onStampSkeleton, onActivateTool, onToggleMeasurement,
}: CompactStripProps) {
  const [openFrameIndex, setOpenFrameIndex] = useState<number | null>(null);
  const [openFrameAnchor, setOpenFrameAnchor] = useState<HTMLElement | null>(null);

  const ib = (active = false, destructive = false): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 44, height: 44, borderRadius: 10, cursor: 'pointer',
    border: active ? '1px solid #007AFF' : '1px solid #D1D1D6',
    background: active ? '#007AFF' : '#FFFFFF',
    color: destructive ? '#FF3B30' : active ? '#FFFFFF' : '#1D1D1F',
    margin: '0 auto',
    position: 'relative' as const,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', padding: '4px 0', position: 'relative' }}>
      {/* Frame count stepper */}
      <button type="button" disabled={!canIncrement} onClick={onIncrement} style={ib()} title="More frames"><Plus size={18} /></button>
      <span style={{ fontSize: 16, fontWeight: 700, textAlign: 'center', color: '#1D1D1F', lineHeight: 1.4, width: 44, display: 'block' }}>{frameCount}</span>
      <button type="button" disabled={!canDecrement} onClick={onDecrement} style={ib()} title="Fewer frames"><Minus size={18} /></button>

      <div style={{ height: 1, background: '#D1D1D6', width: 32, margin: '4px auto' }} />

      {/* Per-frame icon buttons */}
      {frames.map((frame) => {
        const isOpen = openFrameIndex === frame.index;
        const hasDone = frame.footDirectionDone || frame.racketDirectionDone || frame.footDistanceDone;
        return (
          <FrameCompactIcon
            key={frame.index}
            frame={frame}
            isOpen={isOpen}
            hasDone={!!hasDone}
            showSkeleton={showSkeleton}
            onToggle={(el) => {
              setOpenFrameAnchor(isOpen ? null : el);
              setOpenFrameIndex(isOpen ? null : frame.index);
            }}
            onSelectFrame={onSelectFrame}
            onStampSkeleton={onStampSkeleton}
            onActivateTool={onActivateTool}
            onToggleMeasurement={onToggleMeasurement}
            onClose={() => { setOpenFrameIndex(null); setOpenFrameAnchor(null); }}
            anchorEl={isOpen ? openFrameAnchor : null}
          />
        );
      })}

      {/* Add frame */}
      <button type="button" onClick={onAddFrame} title="Add frame at playhead" style={ib()}><PlusCircle size={18} /></button>

      <div style={{ height: 1, background: '#D1D1D6', width: 32, margin: '4px auto' }} />

      {/* Generate report */}
      <button type="button" disabled={!canGenerate} onClick={onGenerate} title="Generate report" style={ib()}>
        <FileText size={18} />
      </button>
      {isReportReady && onSaveReport ? (
        <button type="button" onClick={onSaveReport} title="Save to Player Docs" style={ib()}>
          <FileText size={18} />
        </button>
      ) : null}
      {hasClearable ? (
        <button type="button" onClick={onClear} title="Clear all frames" style={ib(false, true)}><Trash2 size={18} /></button>
      ) : null}
    </div>
  );
}

// ── Public types ───────────────────────────────────────────────────────────

export interface BiomechFrameRow {
  index: number;
  timeSec: number;
  label: string;
  status: AIMetricsFrameStatus;
  hasMeasurements: boolean;
  hasSkeletonStamp: boolean;
  enabledModules: Record<AIMetricsModuleId, boolean>;
  /** Screenshot data URL set after user captures this frame */
  capturedImageUrl?: string;
  /** Measurement checkboxes state */
  footDirectionDone?: boolean;
  racketDirectionDone?: boolean;
  footDistanceDone?: boolean;
  /** User-typed measurement notes for the report */
  notes?: string;
}

export interface BiomechFrameCard {
  id: string;
  label: string;
  timeSec: number;
  imageUrl: string;
}

export interface BiomechanicsPanelProps {
  compact?: boolean;
  currentTime: number;
  duration: number;
  strokeType: StrokeType;
  onStrokeTypeChange: (t: StrokeType) => void;
  customSteps?: PhaseDefinition[];
  onAddCustomStep?: () => void;
  onRenameCustomStep?: (stepId: string, label: string) => void;
  onDeleteCustomStep?: (stepId: string) => void;
  onReorderCustomStep?: (stepId: string, direction: 'up' | 'down') => void;
  trimStartSec: number;
  trimEndSec: number;
  onSetTrimStart: () => void;
  onSetTrimEnd: () => void;
  frameCount: AIMetricsFrameCount;
  onFrameCountChange: (n: AIMetricsFrameCount) => void;
  sampleTimes?: number[];
  frames: BiomechFrameRow[];
  activeFrameIndex: number | null;
  onSelectFrame: (index: number) => void;
  onProposeFrame: (index: number) => void;
  onEditFrame: (index: number) => void;
  onMarkReady: (index: number) => void;
  onRemoveFrame: (index: number) => void;
  onAddFrameAtCurrentTime: () => void;
  onToggleFrameModule: (frameIndex: number, moduleId: AIMetricsModuleId, enabled: boolean) => void;
  onStampSkeleton: (frameIndex: number) => void;
  /** Activate a drawing tool (e.g. 'arrowAngle', 'ruler') */
  onActivateTool?: (tool: ToolType) => void;
  /** Capture a screenshot of the current video + canvas for this frame */
  onCaptureFrame?: (frameIndex: number) => void;
  /** Update the measurement notes for a frame */
  onUpdateFrameNotes?: (frameIndex: number, notes: string) => void;
  /** Toggle measurement checkbox for a frame */
  onToggleMeasurement?: (frameIndex: number, key: 'footDirection' | 'racketDirection' | 'footDistance', done: boolean) => void;
  isProposingFrame: boolean;
  proposingFrameIndex: number | null;
  isGenerating: boolean;
  readyCount: number;
  isReportReady: boolean;
  showSkeleton: boolean;
  onShowSkeletonChange: (v: boolean) => void;
  onGenerate: () => void;
  onClear: () => void;
  onSaveReport?: () => void;
  isSavingReport?: boolean;
  frameCards?: BiomechFrameCard[];
  onDownloadFrameCard?: (url: string, label: string) => void;
  onExportMeasurements?: () => void;
  isProcessing: boolean;
  progress: number;
  disabled?: boolean;
  disabledReason?: string;
}

// ── Frame card ─────────────────────────────────────────────────────────────

function FrameCard({
  frame,
  isActive,
  isCapturing,
  showSkeleton,
  onJumpAndDraw,
  onCapture,
  onRemove,
  onStampSkeleton,
  onActivateTool,
  onToggleMeasurement,
}: {
  frame: BiomechFrameRow;
  isActive: boolean;
  isCapturing: boolean;
  showSkeleton: boolean;
  onJumpAndDraw: () => void;
  onCapture: () => void;
  onRemove: () => void;
  onStampSkeleton: () => void;
  onActivateTool?: (tool: ToolType) => void;
  onToggleMeasurement?: (key: 'footDirection' | 'racketDirection' | 'footDistance', done: boolean) => void;
}) {
  const hasCaptured = !!frame.capturedImageUrl;

  const measurementRows: { key: 'footDirection' | 'racketDirection' | 'footDistance'; label: string; tool: ToolType; icon: React.ReactNode }[] = [
    { key: 'footDirection', label: 'Foot direction', tool: 'arrowAngle', icon: <AngleArrowIcon size={14} /> },
    { key: 'racketDirection', label: 'Racket direction', tool: 'arrowAngle', icon: <AngleArrowIcon size={14} /> },
    { key: 'footDistance', label: 'Foot distance', tool: 'ruler', icon: <Ruler size={14} /> },
  ];

  const doneMap: Record<string, boolean | undefined> = {
    footDirection: frame.footDirectionDone,
    racketDirection: frame.racketDirectionDone,
    footDistance: frame.footDistanceDone,
  };

  return (
    <div style={{
      borderRadius: 12,
      border: isActive ? '1.5px solid #007AFF' : '1px solid #E5E5EA',
      background: isActive ? 'rgba(0,122,255,0.04)' : '#FAFAFA',
      overflow: 'hidden',
      transition: 'border-color 0.15s',
    }}>
      {/* Thumbnail strip */}
      {hasCaptured && (
        <div style={{ position: 'relative', background: '#000' }}>
          <img
            src={frame.capturedImageUrl}
            alt={frame.label}
            style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }}
          />
          <div style={{
            position: 'absolute', bottom: 4, right: 6,
            background: 'rgba(0,0,0,0.65)', borderRadius: 4,
            padding: '2px 6px', fontSize: 10, color: '#fff',
          }}>
            Captured
          </div>
        </div>
      )}

      {/* Frame header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        {/* Index bubble */}
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: isActive ? '#007AFF' : '#E5E5EA',
          color: isActive ? '#fff' : '#6E6E73',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700,
        }}>
          {frame.index + 1}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1D1D1F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {frame.label}
          </div>
          <div style={{ fontSize: 12, color: '#6E6E73' }}>{formatTimeShort(frame.timeSec)}</div>
        </div>

        {/* Remove */}
        <button
          type="button"
          title="Remove frame"
          onClick={onRemove}
          style={{ ...iconBtn, width: 34, height: 34, color: '#FF3B30', border: '1px solid rgba(255,59,48,0.3)' }}
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 14px 10px' }}>
        {/* Jump & Draw */}
        <button
          type="button"
          title="Jump to this frame"
          onClick={onJumpAndDraw}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: '1px solid #007AFF',
            background: isActive ? '#007AFF' : 'rgba(0,122,255,0.06)',
            color: isActive ? '#fff' : '#007AFF',
          }}
        >
          <Pen size={14} /> Jump to frame
        </button>

        {/* Skeleton stamp */}
        <button
          type="button"
          title={showSkeleton ? 'Stamp selected joints with angles' : 'Stamp all joints with angles'}
          onClick={onStampSkeleton}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: frame.hasSkeletonStamp ? '1px solid #5856D6' : '1px solid #D1D1D6',
            background: frame.hasSkeletonStamp ? 'rgba(88,86,214,0.1)' : '#fff',
            color: frame.hasSkeletonStamp ? '#5856D6' : '#6E6E73',
          }}
        >
          <PersonStanding size={14} />
          {frame.hasSkeletonStamp ? 'Stamped ✓' : 'Stamp skeleton'}
        </button>

        {/* Capture */}
        <button
          type="button"
          title="Capture this frame"
          onClick={onCapture}
          disabled={isCapturing}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: hasCaptured ? '1px solid rgba(22,163,74,0.5)' : '1px solid #D1D1D6',
            background: hasCaptured ? 'rgba(22,163,74,0.08)' : '#fff',
            color: hasCaptured ? '#16a34a' : '#6E6E73',
          }}
        >
          {isCapturing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Camera size={14} />}
          {hasCaptured ? 'Re-capture' : 'Capture frame'}
        </button>
      </div>

      {/* Measurement checkboxes */}
      <div style={{ borderTop: '1px solid #F2F2F7', padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#AEAEB2', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
          Measurements
        </div>
        {measurementRows.map(({ key, label, tool, icon }) => {
          const done = !!doneMap[key];
          return (
            <label
              key={key}
              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0' }}
              onClick={(e) => {
                e.preventDefault();
                if (!done) {
                  onJumpAndDraw();
                  onActivateTool?.(tool);
                }
                onToggleMeasurement?.(key, !done);
              }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                border: done ? '2px solid #007AFF' : '2px solid #D1D1D6',
                background: done ? '#007AFF' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {done && <svg width="12" height="10" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <span style={{ fontSize: 13, color: done ? '#007AFF' : '#6E6E73', fontWeight: done ? 600 : 400, display: 'flex', alignItems: 'center', gap: 6 }}>
                {icon} {label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function BiomechanicsPanel({
  compact = false,
  currentTime: _currentTime,
  frameCount,
  onFrameCountChange,
  frames,
  activeFrameIndex,
  onSelectFrame,
  onRemoveFrame,
  onAddFrameAtCurrentTime,
  onStampSkeleton,
  onActivateTool,
  onCaptureFrame,
  onUpdateFrameNotes: _onUpdateFrameNotes,
  onToggleMeasurement,
  isGenerating,
  isReportReady,
  showSkeleton,
  onShowSkeletonChange: _onShowSkeletonChange,
  onGenerate,
  onClear,
  onSaveReport,
  isSavingReport = false,
  isProcessing,
  progress,
  disabled = false,
  disabledReason,
  // API compat — not prominently shown
  onProposeFrame: _onProposeFrame,
  onEditFrame: _onEditFrame,
  onMarkReady: _onMarkReady,
  onToggleFrameModule: _onToggleFrameModule,
  isProposingFrame: _isProposingFrame,
  proposingFrameIndex: _proposingFrameIndex,
  readyCount: _readyCount,
  frameCards,
  onDownloadFrameCard,
  onExportMeasurements: _onExportMeasurements,
  strokeType: _strokeType,
  onStrokeTypeChange: _onStrokeTypeChange,
  customSteps: _customSteps,
  onAddCustomStep: _onAddCustomStep,
  onRenameCustomStep: _onRenameCustomStep,
  onDeleteCustomStep: _onDeleteCustomStep,
  onReorderCustomStep: _onReorderCustomStep,
  trimStartSec: _trimStartSec,
  trimEndSec: _trimEndSec,
  onSetTrimStart: _onSetTrimStart,
  onSetTrimEnd: _onSetTrimEnd,
  sampleTimes: _sampleTimes,
}: BiomechanicsPanelProps) {
  const [capturingIndex, setCapturingIndex] = useState<number | null>(null);

  const frameCountIdx = AIMETRICS_FRAME_COUNTS.indexOf(frameCount);
  const canDecrement = frameCountIdx > 0;
  const canIncrement = frameCountIdx < AIMETRICS_FRAME_COUNTS.length - 1;

  const capturedCount = frames.filter(f => !!f.capturedImageUrl).length;
  const canGenerate = capturedCount > 0 && !isGenerating;
  const hasClearable = frames.length > 0;

  const handleCapture = async (frameIndex: number) => {
    setCapturingIndex(frameIndex);
    onCaptureFrame?.(frameIndex);
    await new Promise(r => setTimeout(r, 600));
    setCapturingIndex(null);
  };

  // ── Compact strip ──
  if (compact) {
    if (disabled) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 4px' }}>
          <div style={{ fontSize: 10, color: '#FF3B30', textAlign: 'center', lineHeight: 1.3 }}>Upload<br/>video first</div>
        </div>
      );
    }
    return (
      <CompactStrip
        frames={frames}
        frameCount={frameCount}
        onDecrement={() => { const i = frameCountIdx; if (i > 0) onFrameCountChange(AIMETRICS_FRAME_COUNTS[i - 1]); }}
        onIncrement={() => { const i = frameCountIdx; if (i < AIMETRICS_FRAME_COUNTS.length - 1) onFrameCountChange(AIMETRICS_FRAME_COUNTS[i + 1]); }}
        canDecrement={canDecrement}
        canIncrement={canIncrement}
        onAddFrame={onAddFrameAtCurrentTime}
        onGenerate={onGenerate}
        canGenerate={canGenerate}
        isReportReady={isReportReady}
        onSaveReport={onSaveReport}
        onClear={onClear}
        hasClearable={hasClearable}
        showSkeleton={showSkeleton}
        onSelectFrame={onSelectFrame}
        onStampSkeleton={onStampSkeleton}
        onActivateTool={onActivateTool}
        onToggleMeasurement={onToggleMeasurement}
      />
    );
  }

  // ── Full panel ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: '#FFFFFF', height: '100%', color: '#1D1D1F' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #F2F2F7' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1D1D1F' }}>Frame Metrics</span>
          {frames.length > 0 && (
            <button type="button" onClick={onClear} style={{ ...iconBtn, color: '#FF3B30', border: '1px solid rgba(255,59,48,0.25)', width: 30, height: 30 }}>
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {/* Frame count stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: '#1D1D1F', fontWeight: 600 }}>Frames</span>
          <button
            type="button"
            disabled={!canDecrement || disabled}
            onClick={() => onFrameCountChange(AIMETRICS_FRAME_COUNTS[frameCountIdx - 1])}
            style={{ ...iconBtn, width: 32, height: 32, opacity: canDecrement ? 1 : 0.35 }}
          >
            <Minus size={14} />
          </button>
          <span style={{ fontSize: 18, fontWeight: 800, minWidth: 28, textAlign: 'center', color: '#1D1D1F' }}>{frameCount}</span>
          <button
            type="button"
            disabled={!canIncrement || disabled}
            onClick={() => onFrameCountChange(AIMETRICS_FRAME_COUNTS[frameCountIdx + 1])}
            style={{ ...iconBtn, width: 32, height: 32, opacity: canIncrement ? 1 : 0.35 }}
          >
            <Plus size={14} />
          </button>

          <div style={{ flex: 1 }} />

          {/* Add frame at playhead */}
          <button
            type="button"
            onClick={onAddFrameAtCurrentTime}
            disabled={disabled}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '6px 12px', borderRadius: 8,
              border: `1px solid ${disabled ? '#D1D1D6' : '#007AFF'}`,
              background: disabled ? '#F2F2F7' : 'rgba(0,122,255,0.08)',
              color: disabled ? '#AEAEB2' : '#007AFF',
              fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <PlusCircle size={14} /> Add frame
          </button>
        </div>
      </div>

      {/* Empty state */}
      {frames.length === 0 && (
        <div style={{ padding: '20px 16px', textAlign: 'center', color: '#6E6E73' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🎾</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#1D1D1F' }}>No frames yet</div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            Press <strong>"Add frame"</strong> at each key moment, or drag the green markers on the timeline.
          </div>
        </div>
      )}

      {/* Frame list */}
      {frames.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {frames.map(frame => (
            <FrameCard
              key={frame.index}
              frame={frame}
              isActive={activeFrameIndex === frame.index}
              isCapturing={capturingIndex === frame.index}
              showSkeleton={showSkeleton}
              onJumpAndDraw={() => onSelectFrame(frame.index)}
              onCapture={() => { void handleCapture(frame.index); }}
              onRemove={() => onRemoveFrame(frame.index)}
              onStampSkeleton={() => onStampSkeleton(frame.index)}
              onActivateTool={onActivateTool}
              onToggleMeasurement={(key, done) => onToggleMeasurement?.(frame.index, key, done)}
            />
          ))}
        </div>
      )}

      {/* Processing bar */}
      {isProcessing && (
        <div style={{ padding: '0 16px 8px' }}>
          <div style={{ height: 4, borderRadius: 2, background: '#F2F2F7', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress * 100}%`, background: '#007AFF', transition: 'width 0.2s' }} />
          </div>
          <div style={{ fontSize: 11, color: '#6E6E73', marginTop: 4 }}>Processing… {Math.round(progress * 100)}%</div>
        </div>
      )}

      {/* Footer actions */}
      {frames.length > 0 && (
        <div style={{ padding: '10px 12px', borderTop: '1px solid #F2F2F7', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {capturedCount > 0 && (
            <div style={{ fontSize: 12, color: '#6E6E73', textAlign: 'center' }}>
              {capturedCount} of {frames.length} frames captured
            </div>
          )}

          <button
            type="button"
            disabled={!canGenerate}
            onClick={onGenerate}
            style={{
              ...rowBtn, justifyContent: 'center', gap: 8,
              background: canGenerate ? 'rgba(0,122,255,0.08)' : '#F2F2F7',
              border: `1px solid ${canGenerate ? 'rgba(0,122,255,0.3)' : '#D1D1D6'}`,
              color: canGenerate ? '#007AFF' : '#AEAEB2',
              fontWeight: 700, fontSize: 14,
              opacity: canGenerate ? 1 : 0.7,
            }}
          >
            {isGenerating ? (
              <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
            ) : (
              <><FileText size={16} /> Generate Report</>
            )}
          </button>

          {isReportReady && onSaveReport && (
            <button type="button" disabled={isSavingReport} onClick={onSaveReport} style={{
              ...rowBtn, justifyContent: 'center', gap: 8,
              background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.3)',
              color: '#16a34a', fontWeight: 700,
            }}>
              {isSavingReport ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={16} />}
              {isSavingReport ? 'Saving…' : 'Save to Player Docs'}
            </button>
          )}

          {/* Legacy frame cards */}
          {frameCards && frameCards.length > 0 && onDownloadFrameCard && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {frameCards.map(card => (
                <div key={card.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <img src={card.imageUrl} alt={card.label} style={{ width: 48, height: 32, objectFit: 'cover', borderRadius: 4 }} />
                  <span style={{ flex: 1, fontSize: 12, color: '#1D1D1F' }}>{card.label}</span>
                  <button type="button" style={{ ...iconBtn, width: 28, height: 28 }} onClick={() => onDownloadFrameCard(card.imageUrl, card.label)}>
                    <FileText size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {disabled && disabledReason && (
        <div style={{ padding: '8px 16px 12px', fontSize: 11, color: '#AEAEB2', textAlign: 'center' }}>
          {disabledReason}
        </div>
      )}
    </div>
  );
}
