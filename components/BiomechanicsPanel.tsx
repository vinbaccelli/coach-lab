'use client';

import React from 'react';
import {
  STROKE_TYPE_LABELS,
  STROKE_TYPES,
  type BiomechanicsAnalysis,
  type PhaseDefinition,
  type PhaseMarker,
  type PhaseMeasurements,
  type StrokeType,
} from '@/lib/biomechanics';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';

function formatTimeShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

function fmt(n: number | null | undefined, suffix = '°'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n}${suffix}`;
}

function fmtNum(n: number | null | undefined, suffix = ''): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n}${suffix}`;
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
        Custom Steps — define your phase model
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
          <button
            type="button"
            style={iconBtn}
            disabled={disabled || i === 0}
            title="Move up"
            onClick={() => onReorder(step.id, 'up')}
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            style={iconBtn}
            disabled={disabled || i === steps.length - 1}
            title="Move down"
            onClick={() => onReorder(step.id, 'down')}
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            style={iconBtn}
            disabled={disabled || steps.length <= 1}
            title="Delete step"
            onClick={() => onDelete(step.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        style={{ ...btn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        disabled={disabled}
        onClick={onAdd}
      >
        <Plus size={14} /> Add Step
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
  phases: PhaseMarker[];
  selectedPhaseId: string | null;
  onSelectPhase: (id: string) => void;
  onSeekPhase: (timeSec: number) => void;
  onDetectPhases: () => void;
  onClear: () => void;
  onExportMeasurements?: () => void;
  onExportPhaseScreenshots?: () => void;
  isProcessing: boolean;
  progress: number;
  analysis: BiomechanicsAnalysis | null;
  disabled?: boolean;
  disabledReason?: string;
}

function MeasurementBlock({ m }: { m: PhaseMeasurements }) {
  return (
    <div style={{ fontSize: 11, lineHeight: 1.55, color: 'rgba(255,255,255,0.88)' }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#fff' }}>
        {m.phaseLabel} @ {formatTimeShort(m.timeSec)}
      </div>
      <div style={{ fontWeight: 600, marginTop: 8, marginBottom: 4, fontSize: 10, opacity: 0.65 }}>
        Joint Angles
      </div>
      <div>L Elbow: {fmt(m.jointAngles.leftElbowDeg)}</div>
      <div>R Elbow: {fmt(m.jointAngles.rightElbowDeg)}</div>
      <div>L Knee: {fmt(m.jointAngles.leftKneeDeg)}</div>
      <div>R Knee: {fmt(m.jointAngles.rightKneeDeg)}</div>
      <div>L Shoulder: {fmt(m.jointAngles.leftShoulderDeg)}</div>
      <div>R Shoulder: {fmt(m.jointAngles.rightShoulderDeg)}</div>
      <div style={{ fontWeight: 600, marginTop: 8, marginBottom: 4, fontSize: 10, opacity: 0.65 }}>
        Shoulder–Hip Separation
      </div>
      <div>{fmt(m.shoulderHipSeparationDeg)}</div>
      <div style={{ fontWeight: 600, marginTop: 8, marginBottom: 4, fontSize: 10, opacity: 0.65 }}>
        Foot Spacing
      </div>
      {m.footSpacing ? (
        <>
          <div>Absolute: {m.footSpacing.absolutePx} px</div>
          <div>Normalized: {m.footSpacing.normalizedToShoulderWidth}× shoulder width</div>
        </>
      ) : (
        <div>—</div>
      )}
      <div style={{ fontWeight: 600, marginTop: 8, marginBottom: 4, fontSize: 10, opacity: 0.65 }}>
        Foot Direction
      </div>
      <div>L: {fmt(m.footDirection.leftFootDeg)}</div>
      <div>R: {fmt(m.footDirection.rightFootDeg)}</div>
      <div style={{ fontWeight: 600, marginTop: 8, marginBottom: 4, fontSize: 10, opacity: 0.65 }}>
        Balance
      </div>
      <div>Lateral COM offset: {fmtNum(m.balance.lateralComOffsetNormalized, '× shoulder width')}</div>
      <div>Vertical COM offset: {fmtNum(m.balance.verticalComOffsetPx, ' px')}</div>
      <div>Foot orientation spread: {fmt(m.balance.footOrientationSpreadDeg)}</div>
      <div>Stance width: {fmtNum(m.balance.stanceWidthNormalized, '× shoulder width')}</div>
      <div style={{ fontWeight: 600, marginTop: 8, marginBottom: 4, fontSize: 10, opacity: 0.65 }}>
        Racket Angle
      </div>
      <div>{fmt(m.racketAngleDeg)}</div>
      <div style={{ fontWeight: 600, marginTop: 8, marginBottom: 4, fontSize: 10, opacity: 0.65 }}>
        Stringbed Direction
      </div>
      {m.stringbedDirection.available ? (
        <>
          <div>{fmt(m.stringbedDirection.degrees)}</div>
          <div style={{ opacity: 0.55, fontSize: 10 }}>
            confidence {(m.stringbedDirection.confidence * 100).toFixed(0)}% — {m.stringbedDirection.note}
          </div>
        </>
      ) : (
        <div style={{ opacity: 0.65 }}>{m.stringbedDirection.note ?? 'Unavailable'}</div>
      )}
    </div>
  );
}

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
  phases,
  selectedPhaseId,
  onSelectPhase,
  onSeekPhase,
  onDetectPhases,
  onClear,
  onExportMeasurements,
  onExportPhaseScreenshots,
  isProcessing,
  progress,
  analysis,
  disabled,
  disabledReason,
}: BiomechanicsPanelProps) {
  const selectedMeasurement = analysis?.measurements.find(
    (m) => m.phaseId === selectedPhaseId,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 4px 8px' }}>
      {disabled && disabledReason ? (
        <p style={{ margin: 0, fontSize: 11, color: '#FF9500' }}>{disabledReason}</p>
      ) : null}

      <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
        Analysis Type
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
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginBottom: 4 }}>
          Trim to One Movement
        </div>
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

      <button
        type="button"
        style={{ ...btn, background: 'rgba(0,122,255,0.35)', borderColor: 'rgba(0,122,255,0.6)' }}
        disabled={disabled || isProcessing || trimEndSec <= trimStartSec || (strokeType === 'custom' && (!customSteps || customSteps.length === 0))}
        onClick={onDetectPhases}
      >
        {isProcessing ? `Detecting… ${progress}%` : 'Detect Phases'}
      </button>

      {phases.length > 0 ? (
        <>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
            Phase Markers — click to seek, drag on timeline to adjust
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {phases.map((p) => {
              const active = p.id === selectedPhaseId;
              return (
                <button
                  key={p.id}
                  type="button"
                  title={`${p.label} @ ${formatTimeShort(p.timeSec)}`}
                  onClick={() => {
                    onSelectPhase(p.id);
                    onSeekPhase(p.timeSec);
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: active ? '1px solid #007AFF' : '1px solid rgba(255,255,255,0.2)',
                    background: active ? 'rgba(0,122,255,0.35)' : 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: active ? 700 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {p.short}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
            {phases.map((p) => `${p.short}=${formatTimeShort(p.timeSec)}`).join(' · ')}
          </div>
        </>
      ) : null}

      {selectedMeasurement ? (
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          <MeasurementBlock m={selectedMeasurement} />
        </div>
      ) : null}

      {analysis ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {onExportMeasurements ? (
            <button type="button" style={btn} onClick={onExportMeasurements}>
              Export Measurements JSON
            </button>
          ) : null}
          {onExportPhaseScreenshots ? (
            <button type="button" style={btn} onClick={onExportPhaseScreenshots}>
              Export Phase Screenshots
            </button>
          ) : null}
        </div>
      ) : null}

      {phases.length > 0 ? (
        <button type="button" style={{ ...btn, opacity: 0.8 }} onClick={onClear}>
          Clear Analysis
        </button>
      ) : null}
    </div>
  );
}
