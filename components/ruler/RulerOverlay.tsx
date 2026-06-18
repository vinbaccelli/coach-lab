'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Ruler,
  RefreshCw,
  Trash2,
  CheckCircle,
  X,
  MousePointer,
  Crosshair,
} from 'lucide-react';
import { RULER_PRESETS, type RulerPreset } from '@/lib/ruler/presets';
import {
  computeHomography,
  computeScale,
  measureWithHomography,
  measureWithScale,
  formatDistance,
  dist2D,
} from '@/lib/ruler/homography';
import type { Point2D, RulerCalibration, RulerMeasurement, RulerMode } from '@/lib/ruler/types';

interface Props {
  /** Displayed width/height of the video container in pixels */
  containerWidth: number;
  containerHeight: number;
  onClose: () => void;
}

type CalibStep = 'pick-preset' | 'place-points' | 'done';

let measureIdCounter = 0;

export default function RulerOverlay({ containerWidth, containerHeight, onClose }: Props) {
  const [mode, setMode] = useState<RulerMode>('calibrate');
  const [calibStep, setCalibStep] = useState<CalibStep>('pick-preset');
  const [selectedPreset, setSelectedPreset] = useState<RulerPreset | null>(null);
  const [customDistance, setCustomDistance] = useState<string>('1.07');
  const [calibPoints, setCalibPoints] = useState<Point2D[]>([]);
  const [calibration, setCalibration] = useState<RulerCalibration | null>(null);
  const [measurements, setMeasurements] = useState<RulerMeasurement[]>([]);

  // For drawing a measurement line
  const [drawStart, setDrawStart] = useState<Point2D | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<Point2D | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const getSvgPoint = useCallback((e: React.PointerEvent): Point2D => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // ---- Calibration clicks ----
  const handleCalibClick = useCallback((e: React.PointerEvent) => {
    if (!selectedPreset) return;
    const pt = getSvgPoint(e);
    setCalibPoints(prev => {
      const next = [...prev, pt];
      if (next.length === selectedPreset.pointCount) {
        // Finalize calibration
        const dstPoints = selectedPreset.id === 'custom'
          ? [{ x: 0, y: 0 }, { x: parseFloat(customDistance) || 1, y: 0 }]
          : selectedPreset.dstPoints;

        let cal: RulerCalibration;
        if (selectedPreset.method === 'homography' && next.length === 4) {
          const h = computeHomography(next, dstPoints);
          cal = {
            method: 'homography',
            presetId: selectedPreset.id,
            srcPoints: next,
            dstPoints,
            homography: h ?? undefined,
          };
        } else {
          const refDist = selectedPreset.id === 'custom'
            ? (parseFloat(customDistance) || 1)
            : (selectedPreset.referenceDistance ?? 1);
          const scale = computeScale(next[0], next[1], refDist);
          cal = {
            method: 'simple',
            presetId: selectedPreset.id,
            srcPoints: next,
            dstPoints,
            scale,
          };
        }
        setCalibration(cal);
        setCalibStep('done');
      }
      return next;
    });
  }, [selectedPreset, customDistance, getSvgPoint]);

  // ---- Measure clicks ----
  const handleMeasureDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawStart(getSvgPoint(e));
    setDrawCurrent(getSvgPoint(e));
  }, [getSvgPoint]);

  const handleMeasureMove = useCallback((e: React.PointerEvent) => {
    if (!drawStart) return;
    setDrawCurrent(getSvgPoint(e));
  }, [drawStart, getSvgPoint]);

  const handleMeasureUp = useCallback((e: React.PointerEvent) => {
    if (!drawStart || !calibration) return;
    const end = getSvgPoint(e);
    if (dist2D(drawStart, end) < 5) { setDrawStart(null); setDrawCurrent(null); return; }

    let distM: number;
    if (calibration.method === 'homography' && calibration.homography) {
      distM = measureWithHomography(calibration.homography, drawStart, end);
    } else {
      distM = measureWithScale(calibration.scale ?? 1, drawStart, end);
    }

    setMeasurements(prev => [
      ...prev,
      { id: `m${++measureIdCounter}`, p1: drawStart, p2: end, distanceM: distM },
    ]);
    setDrawStart(null);
    setDrawCurrent(null);
  }, [drawStart, calibration, getSvgPoint]);

  const resetCalibration = useCallback(() => {
    setCalibration(null);
    setCalibPoints([]);
    setCalibStep('pick-preset');
    setSelectedPreset(null);
    setMeasurements([]);
    setMode('calibrate');
  }, []);

  const clearMeasurements = useCallback(() => setMeasurements([]), []);

  const isCalibrating = mode === 'calibrate' && calibStep === 'place-points';
  const isMeasuring = mode === 'measure';

  const nextPointLabel = selectedPreset && isCalibrating
    ? selectedPreset.pointLabels[calibPoints.length] ?? ''
    : '';

  // Preview line while measuring
  const previewLine = drawStart && drawCurrent
    ? { p1: drawStart, p2: drawCurrent }
    : null;

  const previewDist = previewLine && calibration
    ? (calibration.method === 'homography' && calibration.homography
        ? measureWithHomography(calibration.homography, previewLine.p1, previewLine.p2)
        : measureWithScale(calibration.scale ?? 1, previewLine.p1, previewLine.p2))
    : null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'auto',
        zIndex: 50,
        cursor: isCalibrating ? 'crosshair' : isMeasuring ? 'crosshair' : 'default',
      }}
    >
      {/* SVG canvas for drawings */}
      <svg
        ref={svgRef}
        width={containerWidth}
        height={containerHeight}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        onPointerDown={isCalibrating ? handleCalibClick : isMeasuring ? handleMeasureDown : undefined}
        onPointerMove={isMeasuring ? handleMeasureMove : undefined}
        onPointerUp={isMeasuring ? handleMeasureUp : undefined}
      >
        {/* Calibration point markers */}
        {calibPoints.map((pt, i) => (
          <g key={i}>
            <circle cx={pt.x} cy={pt.y} r={10} fill="rgba(59,130,246,0.2)" stroke="#3B82F6" strokeWidth={2} />
            <circle cx={pt.x} cy={pt.y} r={3} fill="#3B82F6" />
            <text x={pt.x + 13} y={pt.y + 4} fontSize={11} fill="#3B82F6" fontWeight="600"
              style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>
              {i + 1}
            </text>
          </g>
        ))}

        {/* Lines between calibration points */}
        {calibPoints.length >= 2 && selectedPreset && calibPoints.slice(0, -1).map((pt, i) => (
          <line key={i} x1={pt.x} y1={pt.y} x2={calibPoints[i + 1].x} y2={calibPoints[i + 1].y}
            stroke="#3B82F6" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.7} />
        ))}

        {/* Saved measurements */}
        {measurements.map(m => {
          const mx = (m.p1.x + m.p2.x) / 2;
          const my = (m.p1.y + m.p2.y) / 2;
          const label = formatDistance(m.distanceM);
          return (
            <g key={m.id}>
              <line x1={m.p1.x} y1={m.p1.y} x2={m.p2.x} y2={m.p2.y}
                stroke="#F59E0B" strokeWidth={2} />
              <circle cx={m.p1.x} cy={m.p1.y} r={4} fill="#F59E0B" />
              <circle cx={m.p2.x} cy={m.p2.y} r={4} fill="#F59E0B" />
              {/* Label background */}
              <rect x={mx - 28} y={my - 13} width={56} height={18} rx={4}
                fill="rgba(0,0,0,0.75)" />
              <text x={mx} y={my + 1} textAnchor="middle" dominantBaseline="middle"
                fontSize={11} fontWeight="600" fill="#F59E0B">
                {label}
              </text>
            </g>
          );
        })}

        {/* Preview line while drawing */}
        {previewLine && (
          <g>
            <line x1={previewLine.p1.x} y1={previewLine.p1.y}
              x2={previewLine.p2.x} y2={previewLine.p2.y}
              stroke="#F59E0B" strokeWidth={2} strokeDasharray="5,3" opacity={0.8} />
            <circle cx={previewLine.p1.x} cy={previewLine.p1.y} r={4} fill="#F59E0B" />
            <circle cx={previewLine.p2.x} cy={previewLine.p2.y} r={4} fill="#F59E0B" />
            {previewDist !== null && (
              <>
                <rect
                  x={(previewLine.p1.x + previewLine.p2.x) / 2 - 28}
                  y={(previewLine.p1.y + previewLine.p2.y) / 2 - 13}
                  width={56} height={18} rx={4} fill="rgba(0,0,0,0.75)" />
                <text
                  x={(previewLine.p1.x + previewLine.p2.x) / 2}
                  y={(previewLine.p1.y + previewLine.p2.y) / 2 + 1}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={11} fontWeight="600" fill="#F59E0B">
                  {formatDistance(previewDist)}
                </text>
              </>
            )}
          </g>
        )}
      </svg>

      {/* Control panel */}
      <div
        onPointerDown={e => e.stopPropagation()}
        onPointerUp={e => e.stopPropagation()}
        style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 280,
        background: 'rgba(15,15,20,0.92)',
        backdropFilter: 'blur(12px)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.12)',
        color: '#fff',
        fontSize: 13,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <Ruler size={15} color="#F59E0B" />
          <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>Measurement Ruler</span>
          {calibration && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setMode(mode === 'calibrate' ? 'measure' : 'calibrate')}
                style={{
                  padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11,
                  background: mode === 'measure' ? '#3B82F6' : 'rgba(255,255,255,0.12)',
                  color: '#fff', fontWeight: 600,
                }}>
                {mode === 'measure' ? <><Crosshair size={10} style={{ display: 'inline', marginRight: 3 }} />Measuring</> : 'Measure'}
              </button>
            </div>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 2 }}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '10px 14px' }}>
          {/* STEP 1: Pick preset */}
          {calibStep === 'pick-preset' && (
            <>
              <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 10, lineHeight: 1.4, fontSize: 12 }}>
                Choose a reference to calibrate the ruler:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {RULER_PRESETS.map(preset => (
                  <button key={preset.id} onClick={() => {
                    setSelectedPreset(preset);
                    setCalibStep('place-points');
                    setCalibPoints([]);
                  }} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px',
                    borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)', cursor: 'pointer', textAlign: 'left',
                    color: '#fff', transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{preset.icon}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>
                        {preset.label}
                        <span style={{
                          marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4,
                          background: preset.method === 'homography' ? 'rgba(139,92,246,0.3)' : 'rgba(34,197,94,0.2)',
                          color: preset.method === 'homography' ? '#A78BFA' : '#4ADE80',
                        }}>
                          {preset.method === 'homography' ? '4-pt perspective' : '2-pt simple'}
                        </span>
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, lineHeight: 1.3 }}>
                        {preset.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* STEP 2: Place calibration points */}
          {calibStep === 'place-points' && selectedPreset && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <button onClick={() => { setCalibStep('pick-preset'); setCalibPoints([]); setSelectedPreset(null); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 0 }}>
                  ← back
                </button>
                <span style={{ fontWeight: 700 }}>{selectedPreset.icon} {selectedPreset.label}</span>
              </div>

              {/* Custom distance input */}
              {selectedPreset.id === 'custom' && (
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 4 }}>
                    Known distance (meters):
                  </label>
                  <input
                    type="number" step="0.01" min="0.01" value={customDistance}
                    onChange={e => setCustomDistance(e.target.value)}
                    style={{
                      width: '100%', padding: '5px 8px', borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
                      color: '#fff', fontSize: 13, boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}

              {/* Progress dots */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {selectedPreset.pointLabels.map((_, i) => (
                  <div key={i} style={{
                    width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    background: i < calibPoints.length ? '#3B82F6' : 'rgba(255,255,255,0.1)',
                    color: i < calibPoints.length ? '#fff' : 'rgba(255,255,255,0.4)',
                    border: i === calibPoints.length ? '2px solid #3B82F6' : '2px solid transparent',
                  }}>{i + 1}</div>
                ))}
              </div>

              {/* Current instruction */}
              <div style={{
                padding: '8px 10px', borderRadius: 8, background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.3)', marginBottom: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <MousePointer size={12} color="#60A5FA" />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#60A5FA' }}>
                    Click point {calibPoints.length + 1} of {selectedPreset.pointCount}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 1.4 }}>
                  {nextPointLabel}
                </div>
              </div>

              {/* Placed points list */}
              {calibPoints.map((_, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0',
                  color: 'rgba(255,255,255,0.5)', fontSize: 11,
                }}>
                  <CheckCircle size={12} color="#4ADE80" />
                  <span>Point {i + 1}: {selectedPreset.pointLabels[i]}</span>
                </div>
              ))}
            </>
          )}

          {/* STEP 3: Calibrated — measuring */}
          {calibStep === 'done' && calibration && (
            <>
              {/* Calibration status badge */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                marginBottom: 10,
              }}>
                <CheckCircle size={13} color="#4ADE80" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#4ADE80' }}>Calibrated</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                    {RULER_PRESETS.find(p => p.id === calibration.presetId)?.label ?? ''}
                    {' · '}
                    {calibration.method === 'homography' ? 'Perspective corrected' : 'Simple scale'}
                  </div>
                </div>
                <button onClick={resetCalibration} style={{
                  background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 2,
                }}>
                  <RefreshCw size={12} />
                </button>
              </div>

              {mode === 'calibrate' && (
                <button onClick={() => setMode('measure')} style={{
                  width: '100%', padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: '#3B82F6', color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 8,
                }}>
                  Start Measuring →
                </button>
              )}

              {mode === 'measure' && (
                <>
                  <div style={{
                    fontSize: 11, color: 'rgba(255,255,255,0.6)', padding: '6px 8px',
                    borderRadius: 6, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
                    marginBottom: 8, lineHeight: 1.4,
                  }}>
                    <Crosshair size={11} style={{ display: 'inline', marginRight: 4, color: '#F59E0B' }} />
                    Click and drag on the video to measure distances
                  </div>

                  {measurements.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
                          Measurements ({measurements.length})
                        </span>
                        <button onClick={clearMeasurements} style={{
                          background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)',
                          padding: 2, display: 'flex', alignItems: 'center', gap: 3, fontSize: 11,
                        }}>
                          <Trash2 size={11} /> Clear all
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                        {measurements.map((m, i) => (
                          <div key={m.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '4px 8px', borderRadius: 6, background: 'rgba(245,158,11,0.1)',
                            border: '1px solid rgba(245,158,11,0.2)',
                          }}>
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>#{i + 1}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>
                              {formatDistance(m.distanceM)}
                            </span>
                            <button onClick={() => setMeasurements(prev => prev.filter(x => x.id !== m.id))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 0 }}>
                              <X size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer tip */}
        <div style={{
          padding: '6px 14px', borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: 10, color: 'rgba(255,255,255,0.3)', lineHeight: 1.4,
        }}>
          Tip: Use "Net Post" (1.07 m) for a quick calibration, or "Service Box" for perspective-corrected measurements
        </div>
      </div>
    </div>
  );
}
