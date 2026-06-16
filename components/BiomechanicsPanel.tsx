'use client';

import React from 'react';
import { Check, Download, Minus, Plus, Trash2 } from 'lucide-react';
import {
  STROKE_TYPE_LABELS,
  STROKE_TYPES,
  type PhaseDefinition,
  type StrokeType,
} from '@/lib/biomechanics';
import {
  AIMETRICS_FRAME_COUNTS,
  AIMETRICS_MODULE_LABELS,
  type AIMetricsFrameCount,
  type AIMetricsFrameStatus,
  type AIMetricsModuleId,
} from '@/lib/aiMetricsDraft';
import { ChevronDown, ChevronUp, Plus as PlusIcon } from 'lucide-react';

function formatTimeShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

function statusLabel(status: AIMetricsFrameStatus): string {
  if (status === 'ready') return 'Ready';
  if (status === 'edited') return 'Edited';
  return 'Pending';
}

function statusColor(status: AIMetricsFrameStatus): string {
  if (status === 'ready') return '#34C759';
  if (status === 'edited') return '#FF9500';
  return 'rgba(255,255,255,0.55)';
}

const iconBtn: React.CSSProperties = {
  padding: 4,
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const btn: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
  width: '100%',
};

export interface BiomechFrameRow {
  index: number;
  timeSec: number;
  label: string;
  status: AIMetricsFrameStatus;
  hasMeasurements: boolean;
}

export interface BiomechFrameCard {
  id: string;
  label: string;
  timeSec: number;
  imageUrl: string;
}

function CustomStepsEditor({
  steps,
  disabled,
  onAdd,
  onRename,
  onDelete,
  onReorder,
}: {
  steps: PhaseDefinition[];
  disabled?: boolean;
  onAdd: () => void;
  onRename: (stepId: string, label: string) => void;
  onDelete: (stepId: string) => void;
  onReorder: (stepId: string, direction: 'up' | 'down') => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
        Custom frame labels — optional names for each step
      </div>
      {steps.map((step, i) => (
        <div key={step.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            value={step.label}
            disabled={disabled}
            onChange={(e) => onRename(step.id, e.target.value)}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(0,0,0,0.35)',
              color: '#fff',
              fontSize: 12,
            }}
          />
          <button type="button" style={iconBtn} disabled={disabled || i === 0} onClick={() => onReorder(step.id, 'up')}>
            <ChevronUp size={14} />
          </button>
          <button type="button" style={iconBtn} disabled={disabled || i === steps.length - 1} onClick={() => onReorder(step.id, 'down')}>
            <ChevronDown size={14} />
          </button>
          <button type="button" style={iconBtn} disabled={disabled || steps.length <= 1} onClick={() => onDelete(step.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" style={{ ...btn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} disabled={disabled} onClick={onAdd}>
        <PlusIcon size={14} /> Add label
      </button>
    </div>
  );
}

export interface BiomechanicsPanelProps {
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
  isProposingFrame: boolean;
  proposingFrameIndex: number | null;
  isGenerating: boolean;
  readyCount: number;
  isReportReady: boolean;
  enabledModules: Record<AIMetricsModuleId, boolean>;
  onToggleModule: (id: AIMetricsModuleId, enabled: boolean) => void;
  showSkeleton: boolean;
  onShowSkeletonChange: (v: boolean) => void;
  onGenerate: () => void;
  onClear: () => void;
  frameCards?: BiomechFrameCard[];
  onDownloadFrameCard?: (url: string, label: string) => void;
  onExportMeasurements?: () => void;
  isProcessing: boolean;
  progress: number;
  disabled?: boolean;
  disabledReason?: string;
}

export default function BiomechanicsPanel({
  currentTime,
  duration,
  strokeType,
  onStrokeTypeChange,
  customSteps,
  onAddCustomStep,
  onRenameCustomStep,
  onDeleteCustomStep,
  onReorderCustomStep,
  trimStartSec,
  trimEndSec,
  onSetTrimStart,
  onSetTrimEnd,
  frameCount,
  onFrameCountChange,
  sampleTimes = [],
  frames,
  activeFrameIndex,
  onSelectFrame,
  onProposeFrame,
  onEditFrame,
  onMarkReady,
  isProposingFrame,
  proposingFrameIndex,
  isGenerating,
  readyCount,
  isReportReady,
  enabledModules,
  onToggleModule,
  showSkeleton,
  onShowSkeletonChange,
  onGenerate,
  onClear,
  frameCards = [],
  onDownloadFrameCard,
  onExportMeasurements,
  isProcessing,
  progress,
  disabled,
  disabledReason,
}: BiomechanicsPanelProps) {
  const allReady = frames.length > 0 && readyCount === frames.length;
  const canGenerate = !disabled && !isProcessing && allReady;
  const frameCountIdx = AIMETRICS_FRAME_COUNTS.indexOf(frameCount);
  const canDecrement = frameCountIdx > 0;
  const canIncrement = frameCountIdx >= 0 && frameCountIdx < AIMETRICS_FRAME_COUNTS.length - 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 4px 8px' }}>
      {disabled && disabledReason ? (
        <p style={{ margin: 0, fontSize: 11, color: '#FF9500' }}>{disabledReason}</p>
      ) : null}

      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.45, color: 'rgba(255,255,255,0.65)' }}>
        Trim the stroke, place green balls, AI proposes measurements per frame — review, edit, mark Ready, then Generate Report.
      </p>

      <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
        Stroke Type
        <select
          value={strokeType}
          onChange={(e) => onStrokeTypeChange(e.target.value as StrokeType)}
          disabled={disabled || isProcessing}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 4,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(0,0,0,0.35)',
            color: '#fff',
            fontSize: 12,
          }}
        >
          {STROKE_TYPES.map((t) => (
            <option key={t} value={t}>{STROKE_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </label>

      {strokeType === 'custom' && customSteps && onAddCustomStep && onRenameCustomStep && onDeleteCustomStep && onReorderCustomStep ? (
        <CustomStepsEditor
          steps={customSteps}
          disabled={disabled || isProcessing}
          onAdd={onAddCustomStep}
          onRename={onRenameCustomStep}
          onDelete={onDeleteCustomStep}
          onReorder={onReorderCustomStep}
        />
      ) : null}

      <div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginBottom: 4 }}>Trim to One Movement</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button type="button" style={btn} disabled={disabled} onClick={onSetTrimStart}>
            Start {formatTimeShort(trimStartSec)}
          </button>
          <button type="button" style={btn} disabled={disabled} onClick={onSetTrimEnd}>
            End {formatTimeShort(trimEndSec)}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
          Playhead: {formatTimeShort(currentTime)} / {formatTimeShort(duration)}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginBottom: 4 }}>Frame Count</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <button
            type="button"
            disabled={disabled || !canDecrement || isProcessing}
            onClick={() => canDecrement && onFrameCountChange(AIMETRICS_FRAME_COUNTS[frameCountIdx - 1])}
            style={{ ...iconBtn, width: 36, height: 36 }}
          >
            <Minus size={16} />
          </button>
          <span style={{ fontWeight: 700, fontSize: 18, minWidth: 28, textAlign: 'center' }}>{frameCount}</span>
          <button
            type="button"
            disabled={disabled || !canIncrement || isProcessing}
            onClick={() => canIncrement && onFrameCountChange(AIMETRICS_FRAME_COUNTS[frameCountIdx + 1])}
            style={{ ...iconBtn, width: 36, height: 36 }}
          >
            <Plus size={16} />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {AIMETRICS_FRAME_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              disabled={disabled || isProcessing}
              onClick={() => onFrameCountChange(n)}
              style={{
                ...btn,
                padding: '6px 4px',
                background: frameCount === n ? 'rgba(52,199,89,0.35)' : 'rgba(255,255,255,0.08)',
                borderColor: frameCount === n ? 'rgba(52,199,89,0.6)' : 'rgba(255,255,255,0.15)',
                fontWeight: frameCount === n ? 700 : 400,
              }}
            >
              {n}
            </button>
          ))}
        </div>
        {sampleTimes.length > 0 ? (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
            Drag green balls on timeline
          </div>
        ) : null}
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'rgba(255,255,255,0.65)' }}>
          Measurement modules
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(Object.keys(AIMETRICS_MODULE_LABELS) as AIMetricsModuleId[]).map((id) => (
            <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enabledModules[id]}
                disabled={disabled || isProcessing}
                onChange={(e) => onToggleModule(id, e.target.checked)}
              />
              {AIMETRICS_MODULE_LABELS[id]}
            </label>
          ))}
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showSkeleton}
          disabled={disabled || isProcessing}
          onChange={(e) => onShowSkeletonChange(e.target.checked)}
        />
        Show Skeleton (read-only overlay)
      </label>

      {frames.length > 0 ? (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'rgba(255,255,255,0.65)' }}>
            Frames — {readyCount}/{frames.length} ready
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {frames.map((frame) => {
              const active = frame.index === activeFrameIndex;
              const proposing = isProposingFrame && proposingFrameIndex === frame.index;
              return (
                <div
                  key={frame.index}
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    border: active ? '1px solid #007AFF' : '1px solid rgba(255,255,255,0.15)',
                    background: active ? 'rgba(0,122,255,0.12)' : 'rgba(255,255,255,0.04)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <button
                      type="button"
                      onClick={() => onSelectFrame(frame.index)}
                      style={{ border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 11, fontWeight: 600 }}
                    >
                      {frame.label}
                    </button>
                    <span style={{ fontSize: 10, fontWeight: 700, color: statusColor(frame.status) }}>
                      {statusLabel(frame.status)}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                    {formatTimeShort(frame.timeSec)}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button type="button" style={{ ...btn, width: 'auto', padding: '4px 8px', fontSize: 10 }} disabled={disabled || isProcessing} onClick={() => onProposeFrame(frame.index)}>
                      {proposing ? 'Proposing…' : frame.hasMeasurements ? 'Re-propose' : 'Propose'}
                    </button>
                    {frame.hasMeasurements ? (
                      <>
                        <button type="button" style={{ ...btn, width: 'auto', padding: '4px 8px', fontSize: 10 }} onClick={() => onEditFrame(frame.index)}>
                          Edit
                        </button>
                        {frame.status !== 'ready' ? (
                          <button type="button" style={{ ...btn, width: 'auto', padding: '4px 8px', fontSize: 10, color: '#34C759' }} onClick={() => onMarkReady(frame.index)}>
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
      ) : trimEndSec > trimStartSec ? (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
          Set trim and drag green balls, then Propose measurements for each frame.
        </div>
      ) : null}

      {isProposingFrame ? (
        <div style={{ fontSize: 12 }}>AI proposing measurements… {progress}%</div>
      ) : isGenerating ? (
        <div style={{ fontSize: 12 }}>Generating report…</div>
      ) : isReportReady ? (
        <div style={{ fontSize: 12, fontWeight: 600, color: '#34C759' }}>Report ready</div>
      ) : allReady ? (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>All frames ready — press Generate Report.</div>
      ) : null}

      <button
        type="button"
        style={{ ...btn, background: canGenerate ? 'rgba(52,199,89,0.35)' : 'rgba(255,255,255,0.08)', borderColor: canGenerate ? 'rgba(52,199,89,0.6)' : 'rgba(255,255,255,0.15)', opacity: canGenerate ? 1 : 0.5 }}
        disabled={!canGenerate}
        onClick={onGenerate}
      >
        {isGenerating ? 'Generating…' : 'Generate Report'}
      </button>

      {isReportReady && frameCards.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>Frame cards (ready values)</div>
          {frameCards.map((card) => (
            <div key={card.id} style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
              <img src={card.imageUrl} alt={card.label} style={{ width: '100%', display: 'block' }} />
              <div style={{ padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{card.label} @ {formatTimeShort(card.timeSec)}</span>
                {onDownloadFrameCard ? (
                  <button
                    type="button"
                    style={{ ...btn, width: 'auto', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => onDownloadFrameCard(card.imageUrl, card.label)}
                  >
                    <Download size={12} /> Download
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {onExportMeasurements ? (
            <button type="button" style={btn} onClick={onExportMeasurements}>Export Measurements JSON</button>
          ) : null}
        </div>
      ) : null}

      {(frames.length > 0 || frameCards.length > 0) && !isProcessing ? (
        <button type="button" style={{ ...btn, opacity: 0.8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={onClear}>
          <Trash2 size={14} /> Clear
        </button>
      ) : null}
    </div>
  );
}
