'use client';

import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BoxSelect, Check, Layers, Minus, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  STRO_MOTION_FRAME_COUNTS,
  type StroMotionFrameCount,
  type StroMotionFrameStatus,
  type StroMotionObjectType,
} from '@/lib/stroMotionDraft/types';
import type { StroMotionBackground, StroMotionVideoOrder } from '@/lib/stroMotionDraft/types';
// `import type` only — erased at compile time, so the panel gains no runtime
// dependency on the hook; the summary shape keeps a single definition.
import type { StroAutoRunSummary } from '@/hooks/useStroMotion';

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
  /** Auto-detect selection areas for all frames using skeleton keypoints */
  onAutoSelectAll?: () => void;
  /**
   * Outcome of the last Auto Detect pass, or null when none has run since the
   * draft was built/cleared. Drives the completion state in the status line.
   */
  lastAutoRun?: StroAutoRunSummary | null;
  /** When true, renders a compact icon-only vertical strip for the collapsed toolbar rail */
  compact?: boolean;
  /** Show text labels beside icons (expanded toolbar) */
  showLabels?: boolean;
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
  const panelW = Math.min(200, window.innerWidth - rect.right - 16);
  const left = rect.right + 8;
  const top = Math.min(rect.top, window.innerHeight - 220);
  const panelRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const target = 'touches' in e ? (e as globalThis.TouchEvent).touches[0]?.target : (e as MouseEvent).target;
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
        position: 'fixed', left, top, zIndex: 9999, width: Math.max(panelW, 160),
        background: 'var(--cl-bg-panel)', borderRadius: 14, border: '1px solid var(--cl-border)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cl-text-primary)' }}>Frame {frame.index + 1}</span>
        <span style={{ fontSize: 11, color: '#AEAEB2' }}>{formatTimeShort(frame.timeSec)}</span>
      </div>
      <button
        type="button"
        disabled={disabled || isGenerating || isProposingFrame}
        onClick={onSelectArea}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--cl-accent)', background: 'rgba(0,122,255,0.07)', color: 'var(--cl-accent)' }}
      >
        <BoxSelect size={14} />
        {frame.hasSelection ? 'Re-select area' : 'Select Area'}
      </button>
      {(frame.hasMask || frame.hasSelection) && (
        <button
          type="button"
          onClick={onEditFrame}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)' }}
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
          border: isOpen || isSelecting ? '1px solid var(--cl-accent)' : hasContent ? '1px solid var(--cl-success)' : '1px solid var(--cl-border)',
          background: isOpen || isSelecting ? 'var(--cl-accent)' : hasContent ? 'rgba(52,199,89,0.08)' : 'var(--cl-bg-panel)',
          color: isOpen || isSelecting ? 'var(--cl-text-on-fill)' : hasContent ? 'var(--cl-success)' : 'var(--cl-text-primary)',
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
  onAutoSelectAll,
  lastAutoRun = null,
  compact = false,
  showLabels = false,
}: StroMotionPanelProps) {
  const allReady = frames.length > 0 && readyCount === frames.length;
  const canGenerate = !disabled && !isGenerating && !isProposingFrame && allReady;
  const frameCountIdx = STRO_MOTION_FRAME_COUNTS.indexOf(frameCount);
  const canDecrement = frameCountIdx > 0;
  const canIncrement = frameCountIdx >= 0 && frameCountIdx < STRO_MOTION_FRAME_COUNTS.length - 1;

  const [openFrameIndex, setOpenFrameIndex] = useState<number | null>(null);
  const [openFrameAnchor, setOpenFrameAnchor] = useState<HTMLElement | null>(null);

  if (compact) {
    const ib = (active = false, destructive = false): React.CSSProperties => showLabels
      ? {
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', minHeight: 44, padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
          border: active ? '1px solid var(--cl-accent)' : '1px solid var(--cl-border)',
          background: active ? 'var(--cl-accent)' : 'var(--cl-bg-panel)',
          color: destructive ? 'var(--cl-destructive)' : active ? 'var(--cl-text-on-fill)' : 'var(--cl-text-primary)',
          fontSize: 13, fontWeight: 500,
        }
      : {
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
          border: active ? '1px solid var(--cl-accent)' : '1px solid var(--cl-border)',
          background: active ? 'var(--cl-accent)' : 'var(--cl-bg-panel)',
          color: destructive ? 'var(--cl-destructive)' : active ? 'var(--cl-text-on-fill)' : 'var(--cl-text-primary)',
          margin: '0 auto',
        };

    const LB = ({ icon, label }: { icon: React.ReactNode; label: string }) => showLabels
      ? <><span style={{ display: 'flex', width: 20, justifyContent: 'center', flexShrink: 0 }}>{icon}</span><span>{label}</span></>
      : <>{icon}</>;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: showLabels ? 6 : 4, alignItems: showLabels ? 'stretch' : 'center', padding: '4px 0', position: 'relative' }}>
        {disabled && (
          <div style={{ fontSize: showLabels ? 12 : 10, color: 'var(--cl-destructive)', textAlign: showLabels ? 'left' : 'center', padding: '0 4px', lineHeight: 1.3, marginBottom: 2 }}>
            {showLabels ? 'Upload a video file first.' : 'Upload\nvideo\nfirst'}
          </div>
        )}
        {/*
          SECTION CONTROLS + AUTO-DETECT RESULT — IN THE COMPACT RAIL.
          They existed only in the full body below, and the full body is never
          rendered: page.tsx mounts this panel with `compact`, and `if (compact)`
          returns above. So "Set Start", "Set End Frame", the "Use full video"
          control and the auto-detect banner were all unreachable in the shipping
          UI — which is why the section appeared stuck at ~3s with no way out,
          and why the completion message was never seen. Placing a fix in an
          unrendered branch is not a fix.
        */}
        {lastAutoRun ? (
          <div
            role="status"
            style={{
              padding: showLabels ? '8px 10px' : '6px 4px',
              borderRadius: 8,
              fontSize: showLabels ? 12 : 10,
              lineHeight: 1.35,
              textAlign: showLabels ? 'left' : 'center',
              border: `1px solid ${lastAutoRun.framesBuilt === 0
                ? 'var(--cl-destructive-text, #c00)'
                : lastAutoRun.racketPassActive && lastAutoRun.racketApplied === 0
                  ? 'var(--cl-warning, #E8A33D)'
                  : 'var(--cl-success, #2E9E5B)'}`,
              background: lastAutoRun.framesBuilt === 0
                ? 'rgba(204,0,0,0.10)'
                : lastAutoRun.racketPassActive && lastAutoRun.racketApplied === 0
                  ? 'rgba(232,163,61,0.14)'
                  : 'rgba(46,158,91,0.14)',
            }}
          >
            <div style={{ fontWeight: 800 }}>
              {lastAutoRun.framesBuilt > 0
                ? `Auto-detect done — ${lastAutoRun.framesBuilt}/${lastAutoRun.framesAttempted} in ${(lastAutoRun.elapsedMs / 1000).toFixed(1)}s`
                : 'Auto-detect built no frames'}
            </div>
            {/* WHY THE OFF STATE IS RENDERED RATHER THAN OMITTED.
                This line used to be dropped entirely when the auto-racket pass
                was inactive, so "the pass never ran" and "the pass ran and
                found nothing" produced the same chip — a banner with no racket
                row. The pass is only active for objectType 'racket'/'custom'
                (autoRacketFlags.ts), and the Object button in this very rail
                CYCLES the type on each tap, so one stray tap silently disables
                racket detection with nothing on screen to say so. Naming the
                active type makes that self-diagnosing. */}
            <div style={{ marginTop: 2 }}>
              {!lastAutoRun.racketPassActive
                ? `Racket detect off (Object: ${objectType})`
                : lastAutoRun.racketApplied > 0
                  ? `Racket on ${lastAutoRun.racketApplied}/${lastAutoRun.framesBuilt}`
                  : lastAutoRun.racketDetected > 0
                    ? `Seen on ${lastAutoRun.racketDetected}, none cut out`
                    : `No racket${lastAutoRun.unitFloorPx != null ? ` (scale ${Math.round(lastAutoRun.unitFloorPx)}px)` : ''}`}
            </div>
          </div>
        ) : null}

        {/* THE SECTION IS THE TIMELINE'S JOB NOW.
            "Use full video", "Set start" and "Set end" used to live here. All
            three existed to work around a section that defaulted to a hardcoded
            0-3s (page.tsx `useState(3)`) — "Use full video" undid that default,
            and the other two moved a boundary to the playhead. The playhead is
            itself trapped inside the zoomed trim window, which is why "Set end"
            could only creep the end out by the view's padding (3.0 -> 3.36 ->
            3.76s) and never reach the end of a 15s clip.
            The default is now the whole clip, so there is nothing to undo, and
            the timeline's trim handles — already wired straight to
            setStroStartFrame/setStroEndFrame (page.tsx, `onTrimChange`) — are
            the one way to define a section. Three buttons and a workaround out,
            no capability lost. */}

        <div style={{ height: 1, background: 'var(--cl-border)', width: showLabels ? '100%' : 32, margin: '4px auto' }} />

        {/* Frame count */}
        {showLabels ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cl-text-primary)' }}>Frames</span>
            <button type="button" disabled={disabled || !canDecrement} onClick={() => canDecrement && onFrameCountChange(STRO_MOTION_FRAME_COUNTS[frameCountIdx - 1])} style={{ ...ib(), width: 36, height: 36, padding: 0, justifyContent: 'center', gap: 0 }}><Minus size={14} /></button>
            <span style={{ fontSize: 18, fontWeight: 800, minWidth: 28, textAlign: 'center', color: 'var(--cl-text-primary)' }}>{frameCount}</span>
            <button type="button" disabled={disabled || !canIncrement} onClick={() => canIncrement && onFrameCountChange(STRO_MOTION_FRAME_COUNTS[frameCountIdx + 1])} style={{ ...ib(), width: 36, height: 36, padding: 0, justifyContent: 'center', gap: 0 }}><Plus size={14} /></button>
          </div>
        ) : (
        <>
        <button type="button" disabled={disabled || !canIncrement} onClick={() => canIncrement && onFrameCountChange(STRO_MOTION_FRAME_COUNTS[frameCountIdx + 1])} style={ib()} title="More frames">
          <Plus size={14} strokeWidth={2} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cl-text-primary)', textAlign: 'center', width: 36, display: 'block', lineHeight: 1.4 }}>{frameCount}</span>
        <button type="button" disabled={disabled || !canDecrement} onClick={() => canDecrement && onFrameCountChange(STRO_MOTION_FRAME_COUNTS[frameCountIdx - 1])} style={ib()} title="Fewer frames">
          <Minus size={14} strokeWidth={2} />
        </button>

        <div style={{ height: 1, background: 'var(--cl-border)', width: 32, margin: '4px auto' }} />

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

        {onAutoSelectAll && frames.length > 0 && (
          <button type="button" disabled={!!disabled || isGenerating || isProposingFrame} onClick={onAutoSelectAll} title="Auto-detect" style={ib()}>
            <Sparkles size={14} strokeWidth={2} />
          </button>
        )}

        <div style={{ height: 1, background: 'var(--cl-border)', width: 32, margin: '4px auto' }} />

        <button type="button" onClick={() => { const idx = OBJECT_TYPES.findIndex(o => o.id === objectType); onObjectTypeChange(OBJECT_TYPES[(idx + 1) % OBJECT_TYPES.length].id); }} title={`Object: ${objectType}`} style={ib()}>
          <BoxSelect size={14} strokeWidth={2} />
        </button>

        {onBackgroundChange ? (
          <button type="button" onClick={() => onBackgroundChange(background === 'start' ? 'end' : 'start')} title={`Clean-background frame: ${background} of section. AI samples the empty background here to erase it — switch to whichever end has no athlete in view.`} style={ib(background === 'end')}>
            <Layers size={14} strokeWidth={2} />
          </button>
        ) : null}

        <div style={{ height: 1, background: 'var(--cl-border)', width: 28, margin: '4px auto' }} />

        <button type="button" disabled={!canGenerate} onClick={onGenerate} title="Generate" style={ib()}>
          <Check size={14} strokeWidth={2} />
        </button>

        {(frames.length > 0 || isPreviewReady) ? (
          <button type="button" onClick={onClear} title="Clear" style={ib(false, true)}>
            <Trash2 size={14} strokeWidth={2} />
          </button>
        ) : null}
        </>
        )}

        {/* Labeled mode: frame buttons + actions with text */}
        {showLabels && (
          <>
          <div style={{ height: 1, background: 'var(--cl-border)', width: '100%', margin: '4px 0' }} />

          {frames.map((frame) => {
            const selecting = isSelectingArea && selectingFrameIndex === frame.index;
            const hasContent = frame.hasMask || frame.hasSelection;
            return (
              <button
                key={frame.index}
                type="button"
                disabled={!!disabled || isGenerating}
                onClick={() => { onSelectFrame(frame.index); onSelectArea(frame.index); }}
                style={{
                  ...ib(selecting),
                  border: selecting ? '1px solid var(--cl-accent)' : hasContent ? '1px solid var(--cl-success)' : '1px solid var(--cl-border)',
                  background: selecting ? 'var(--cl-accent)' : hasContent ? 'rgba(52,199,89,0.06)' : 'var(--cl-bg-panel)',
                  color: selecting ? 'var(--cl-text-on-fill)' : hasContent ? 'var(--cl-success)' : 'var(--cl-text-primary)',
                }}
              >
                <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: selecting ? 'rgba(255,255,255,0.2)' : 'var(--cl-fill-inactive)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: selecting ? 'var(--cl-text-on-fill)' : 'var(--cl-text-secondary)' }}>
                  {frame.index + 1}
                </span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{frame.label}</span>
                <span style={{ fontSize: 11, opacity: 0.6 }}>{formatTimeShort(frame.timeSec)}</span>
                {hasContent && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--cl-success)' }}>✓</span>}
              </button>
            );
          })}

          {onAutoSelectAll && frames.length > 0 && (
            <button type="button" disabled={!!disabled || isGenerating || isProposingFrame} onClick={onAutoSelectAll} style={ib()}>
              <LB icon={<Sparkles size={18} />} label="AI auto-detect" />
            </button>
          )}

          <div style={{ height: 1, background: 'var(--cl-border)', width: '100%', margin: '4px 0' }} />

          <button type="button" onClick={() => { const idx = OBJECT_TYPES.findIndex(o => o.id === objectType); onObjectTypeChange(OBJECT_TYPES[(idx + 1) % OBJECT_TYPES.length].id); }} style={ib()}>
            <LB icon={<BoxSelect size={18} />} label={`Object: ${objectType}`} />
          </button>

          {onBackgroundChange ? (
            <button type="button" onClick={() => onBackgroundChange(background === 'start' ? 'end' : 'start')} title="The frame the AI reads as the clean, athlete-free background to erase. Set it to whichever end of the section has no athlete in view." style={ib(background === 'end')}>
              <LB icon={<Layers size={18} />} label={`Clean BG: ${background}`} />
            </button>
          ) : null}

          <div style={{ height: 1, background: 'var(--cl-border)', width: '100%', margin: '4px 0' }} />

          <button type="button" disabled={!canGenerate} onClick={onGenerate} style={ib()}>
            <LB icon={<Check size={18} />} label="Generate Motion Layer" />
          </button>

          {(frames.length > 0 || isPreviewReady) ? (
            <button type="button" onClick={onClear} style={ib(false, true)}>
              <LB icon={<Trash2 size={18} />} label="Clear" />
            </button>
          ) : null}
          </>
        )}
      </div>
    );
  }

  /**
   * COMPACT IS THE ONLY MODE THIS PANEL IS EVER RENDERED IN.
   *
   * `app/analysis/page.tsx` mounts it as `<StroMotionPanel compact ... />` — a bare
   * prop, so always true — and that is the ONLY consumer in the repo. Everything
   * after the branch above was therefore unreachable, and a ~415-line second copy
   * of the panel sat here looking maintained: its own frame list, object-type
   * selector, background-plate picker, video-order control and status chain.
   *
   * It was not harmless. Two separate fixes were written INTO it — a "Use full
   * video" control and the auto-detect completion banner — shipped, and reported
   * as still broken, because neither had ever rendered. Deleting it is what stops
   * that happening a third time; `tsc` and `next build` cannot, since unreachable
   * JSX type-checks and bundles perfectly happily.
   *
   * The branch above is left in place rather than de-indented into the function
   * body: this diff is a deletion, and re-indenting 250 lines of live JSX in the
   * same change would bury it. Collapsing the conditional (and retiring the now-
   * vestigial `compact` prop) is a follow-up tidy, not part of removing dead code.
   */
  return null;
}
