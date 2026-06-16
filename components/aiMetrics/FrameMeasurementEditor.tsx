'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AIMETRICS_MODULE_LABELS,
  clonePhaseMeasurements,
  type AIMetricsModuleId,
} from '@/lib/aiMetricsDraft';
import type { PhaseMeasurements } from '@/lib/biomechanics/types';

function formatTimeShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

function parseNum(raw: string): number | null {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

export interface FrameMeasurementEditorProps {
  frameLabel: string;
  timeSec: number;
  frameStatus: 'pending' | 'edited' | 'ready';
  measurements: PhaseMeasurements;
  enabledModules: Record<AIMetricsModuleId, boolean>;
  onMeasurementsChange: (m: PhaseMeasurements) => void;
  onReset: () => void;
  onRepropose: () => void;
  onMarkReady?: () => void;
  onClose: () => void;
  isReproposing?: boolean;
}

const inputStyle: React.CSSProperties = {
  width: 72,
  padding: '4px 6px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(0,0,0,0.35)',
  color: '#fff',
  fontSize: 11,
  fontFamily: 'ui-monospace, monospace',
};

const toolBtn: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

export default function FrameMeasurementEditor({
  frameLabel,
  timeSec,
  frameStatus,
  measurements,
  enabledModules,
  onMeasurementsChange,
  onReset,
  onRepropose,
  onMarkReady,
  onClose,
  isReproposing = false,
}: FrameMeasurementEditorProps) {
  const [local, setLocal] = useState(() => clonePhaseMeasurements(measurements));

  useEffect(() => {
    setLocal(clonePhaseMeasurements(measurements));
  }, [measurements]);

  const commit = useCallback((next: PhaseMeasurements) => {
    setLocal(next);
    onMeasurementsChange(next);
  }, [onMeasurementsChange]);

  const setJoint = (key: keyof PhaseMeasurements['jointAngles'], value: number | null) => {
    commit({
      ...local,
      jointAngles: { ...local.jointAngles, [key]: value },
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10050,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(520px, 100%)',
          maxHeight: '92vh',
          overflow: 'auto',
          background: '#1c1c1e',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.12)',
          padding: 16,
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: 15 }}>{frameLabel}</strong>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'ui-monospace, monospace' }}>
              @ {formatTimeShort(timeSec)}
              {frameStatus === 'ready' ? (
                <span style={{ marginLeft: 8, color: '#34C759', fontWeight: 700 }}>Ready</span>
              ) : null}
            </div>
          </div>
          <button type="button" onClick={onClose} style={toolBtn}>Close</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" style={toolBtn} onClick={onReset}>Reset to AI proposal</button>
          <button type="button" style={toolBtn} disabled={isReproposing} onClick={onRepropose}>
            {isReproposing ? 'Re-proposing…' : 'Re-propose measurements'}
          </button>
          {onMarkReady && frameStatus !== 'ready' ? (
            <button
              type="button"
              style={{ ...toolBtn, borderColor: '#34C759', background: 'rgba(52,199,89,0.15)' }}
              onClick={onMarkReady}
            >
              Mark Ready
            </button>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 11 }}>
          {enabledModules.jointAngles ? (
            <section>
              <div style={{ fontWeight: 700, marginBottom: 6, color: 'rgba(255,255,255,0.65)' }}>
                {AIMETRICS_MODULE_LABELS.jointAngles}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {([
                  ['L Elbow', 'leftElbowDeg'],
                  ['R Elbow', 'rightElbowDeg'],
                  ['L Knee', 'leftKneeDeg'],
                  ['R Knee', 'rightKneeDeg'],
                  ['L Shoulder', 'leftShoulderDeg'],
                  ['R Shoulder', 'rightShoulderDeg'],
                ] as const).map(([label, key]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    {label}
                    <input
                      type="number"
                      step={0.1}
                      style={inputStyle}
                      value={local.jointAngles[key] ?? ''}
                      onChange={(e) => setJoint(key, parseNum(e.target.value))}
                    />
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          {enabledModules.shoulderHipSeparation ? (
            <section>
              <div style={{ fontWeight: 700, marginBottom: 6, color: 'rgba(255,255,255,0.65)' }}>
                {AIMETRICS_MODULE_LABELS.shoulderHipSeparation}
              </div>
              <input
                type="number"
                step={0.1}
                style={inputStyle}
                value={local.shoulderHipSeparationDeg ?? ''}
                onChange={(e) => commit({ ...local, shoulderHipSeparationDeg: parseNum(e.target.value) })}
              />
            </section>
          ) : null}

          {enabledModules.racketAngle ? (
            <section>
              <div style={{ fontWeight: 700, marginBottom: 6, color: 'rgba(255,255,255,0.65)' }}>
                {AIMETRICS_MODULE_LABELS.racketAngle}
              </div>
              <input
                type="number"
                step={0.1}
                style={inputStyle}
                value={local.racketAngleDeg ?? ''}
                onChange={(e) => commit({ ...local, racketAngleDeg: parseNum(e.target.value) })}
              />
            </section>
          ) : null}

          {enabledModules.stringbedDirection ? (
            <section>
              <div style={{ fontWeight: 700, marginBottom: 6, color: 'rgba(255,255,255,0.65)' }}>
                {AIMETRICS_MODULE_LABELS.stringbedDirection}
              </div>
              <input
                type="number"
                step={0.1}
                style={inputStyle}
                value={local.stringbedDirection.degrees ?? ''}
                onChange={(e) => commit({
                  ...local,
                  stringbedDirection: {
                    ...local.stringbedDirection,
                    available: true,
                    degrees: parseNum(e.target.value),
                  },
                })}
              />
            </section>
          ) : null}

          {enabledModules.footDirection ? (
            <section>
              <div style={{ fontWeight: 700, marginBottom: 6, color: 'rgba(255,255,255,0.65)' }}>
                {AIMETRICS_MODULE_LABELS.footDirection}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  L Foot °
                  <input
                    type="number"
                    step={0.1}
                    style={inputStyle}
                    value={local.footDirection.leftFootDeg ?? ''}
                    onChange={(e) => commit({
                      ...local,
                      footDirection: { ...local.footDirection, leftFootDeg: parseNum(e.target.value) },
                    })}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  R Foot °
                  <input
                    type="number"
                    step={0.1}
                    style={inputStyle}
                    value={local.footDirection.rightFootDeg ?? ''}
                    onChange={(e) => commit({
                      ...local,
                      footDirection: { ...local.footDirection, rightFootDeg: parseNum(e.target.value) },
                    })}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {enabledModules.footSpacing && local.footSpacing ? (
            <section>
              <div style={{ fontWeight: 700, marginBottom: 6, color: 'rgba(255,255,255,0.65)' }}>
                {AIMETRICS_MODULE_LABELS.footSpacing}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.75)' }}>
                {local.footSpacing.normalizedToShoulderWidth.toFixed(2)}× shoulder width
                <span style={{ opacity: 0.55, marginLeft: 8 }}>(auto from pose)</span>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
