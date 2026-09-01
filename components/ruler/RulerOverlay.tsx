'use client';

import React, { useState, useCallback, useRef } from 'react';
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
  dist2D,
} from '@/lib/ruler/homography';
import {
  parseLengthToMeters,
  formatLength,
  formatScale,
  defaultUnitFor,
  racketPrefill,
  LENGTH_UNIT_LABEL,
  MIN_CALIBRATION_PX,
  MIN_SCALE_PX_PER_M,
  MAX_SCALE_PX_PER_M,
  type LengthUnit,
  type UnitSystem,
} from '@/lib/ruler/units';
import type { Point2D, RulerCalibration, RulerMeasurement, RulerMode } from '@/lib/ruler/types';

interface Props {
  /** Displayed width/height of the video container in pixels */
  containerWidth: number;
  containerHeight: number;
  onClose: () => void;
  /** Report a completed measurement to the data column */
  onMeasurement?: (value: number, unit: string) => void;
  /**
   * Calibration is owned by the PAGE, not by this overlay.
   *
   * This component is conditionally rendered (`activeTool === 'ruler'`), so it
   * unmounts the moment the coach picks any other tool. Holding the
   * calibration in local state meant every tool switch silently threw it away
   * and forced a re-calibration — the scale survived only as long as the
   * ruler was the active tool. Lifting it to the page makes the lifetime what
   * it should be: the loaded clip.
   */
  calibration: RulerCalibration | null;
  onCalibrationChange: (cal: RulerCalibration | null) => void;
  unitSystem: UnitSystem;
  onUnitSystemChange: (system: UnitSystem) => void;
}

type CalibStep = 'pick-preset' | 'place-points' | 'done';

let measureIdCounter = 0;

export default function RulerOverlay({
  containerWidth,
  containerHeight,
  onClose,
  onMeasurement,
  calibration,
  onCalibrationChange,
  unitSystem,
  onUnitSystemChange,
}: Props) {
  const [mode, setMode] = useState<RulerMode>(calibration ? 'measure' : 'calibrate');
  const [calibStep, setCalibStep] = useState<CalibStep>(calibration ? 'done' : 'pick-preset');
  const [selectedPreset, setSelectedPreset] = useState<RulerPreset | null>(null);
  /** Free-form reference length ("68.6", "27 in", `5'11"`) + the unit for bare numbers. */
  const [customDistance, setCustomDistance] = useState<string>('');
  const [customUnit, setCustomUnit] = useState<LengthUnit>(defaultUnitFor(unitSystem));
  const [calibError, setCalibError] = useState<string | null>(null);
  const [calibPoints, setCalibPoints] = useState<Point2D[]>([]);
  const [measurements, setMeasurements] = useState<RulerMeasurement[]>([]);

  // For drawing a measurement line
  const [drawStart, setDrawStart] = useState<Point2D | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<Point2D | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const getSvgPoint = useCallback((e: React.PointerEvent): Point2D => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  /**
   * The reference length in METERS for the current preset, or null if the
   * coach's typed value is unusable. Presets carry their own known length;
   * only 'custom' reads the input.
   */
  const resolveReferenceMeters = useCallback((preset: RulerPreset): number | null => {
    if (preset.id !== 'custom') return preset.referenceDistance ?? null;
    return parseLengthToMeters(customDistance, customUnit);
  }, [customDistance, customUnit]);

  // ---- Calibration clicks ----
  // Everything is computed OUTSIDE the state updater on purpose: a setState
  // updater must be a pure function of prev state (React may invoke it more
  // than once), so firing onCalibrationChange / setCalibError from inside one
  // risks duplicate parent updates and dropped error messages.
  const handleCalibClick = useCallback((e: React.PointerEvent) => {
    if (!selectedPreset) return;
    const pt = getSvgPoint(e);
    const next = [...calibPoints, pt];

    if (next.length < selectedPreset.pointCount) {
      setCalibPoints(next);
      return;
    }

    // ---- Finalize calibration (with guards) ----
    const fail = (msg: string) => {
      setCalibError(msg);
      setCalibPoints([]);
    };

    if (selectedPreset.method === 'homography' && next.length === 4) {
      const h = computeHomography(next, selectedPreset.dstPoints);
      if (!h || h.some(v => !Number.isFinite(v))) {
        // Degenerate quad (collinear / duplicate corners) — gaussElim returns
        // null or non-finite values rather than a usable matrix.
        fail('Those 4 points don’t form a usable shape. Click the corners again.');
        return;
      }
      setCalibPoints(next);
      setCalibError(null);
      onCalibrationChange({
        method: 'homography',
        presetId: selectedPreset.id,
        srcPoints: next,
        dstPoints: selectedPreset.dstPoints,
        homography: h,
      });
      setCalibStep('done');
      setMode('measure');
      return;
    }

    const refMeters = resolveReferenceMeters(selectedPreset);
    if (refMeters === null || refMeters <= 0) {
      fail('Enter a valid length first (e.g. 68.6 cm, 27 in, 1.8 m).');
      return;
    }

    // Divide-by-zero guard: a reference line of ~0 px yields an infinite scale
    // and would make every later measurement nonsense.
    if (dist2D(next[0], next[1]) < MIN_CALIBRATION_PX) {
      fail('That reference line is too short. Draw along the full length of the object.');
      return;
    }

    const scale = computeScale(next[0], next[1], refMeters);
    if (!Number.isFinite(scale) || scale < MIN_SCALE_PX_PER_M || scale > MAX_SCALE_PX_PER_M) {
      fail('That length and line don’t look right together. Check the value and try again.');
      return;
    }

    setCalibPoints(next);
    setCalibError(null);
    onCalibrationChange({
      method: 'simple',
      presetId: selectedPreset.id,
      srcPoints: next,
      dstPoints: [{ x: 0, y: 0 }, { x: refMeters, y: 0 }],
      scale,
      referenceMeters: refMeters,
    });
    setCalibStep('done');
    setMode('measure');
  }, [selectedPreset, calibPoints, resolveReferenceMeters, getSvgPoint, onCalibrationChange]);

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

    if (!Number.isFinite(distM)) { setDrawStart(null); setDrawCurrent(null); return; }

    setMeasurements(prev => [
      ...prev,
      { id: `m${++measureIdCounter}`, p1: drawStart, p2: end, distanceM: distM },
    ]);
    // The data column stores the canonical meters value; its own display
    // formatting is unchanged. Unit switching here never rewrites what was
    // already sent, so the column stays internally consistent.
    onMeasurement?.(Math.round(distM * 100) / 100, 'm');
    setDrawStart(null);
    setDrawCurrent(null);
  }, [drawStart, calibration, getSvgPoint, onMeasurement]);

  const resetCalibration = useCallback(() => {
    onCalibrationChange(null);
    setCalibPoints([]);
    setCalibStep('pick-preset');
    setSelectedPreset(null);
    setMeasurements([]);
    setCalibError(null);
    setMode('calibrate');
  }, [onCalibrationChange]);

  const clearMeasurements = useCallback(() => setMeasurements([]), []);

  /**
   * A custom reference needs a usable length BEFORE the points mean anything.
   * Blank is "not filled in yet" (no error styling); non-blank-but-unparseable
   * is a real mistake worth flagging as the coach types.
   */
  const customLenMeters = selectedPreset?.id === 'custom'
    ? parseLengthToMeters(customDistance, customUnit)
    : null;
  const customLenInvalid = selectedPreset?.id === 'custom'
    && customDistance.trim() !== ''
    && customLenMeters === null;
  /** Gate point placement until a custom length is actually usable. */
  const awaitingCustomLength = selectedPreset?.id === 'custom' && customLenMeters === null;

  const isCalibrating = mode === 'calibrate' && calibStep === 'place-points' && !awaitingCustomLength;
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
          const label = formatLength(m.distanceM, unitSystem);
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
                  {formatLength(previewDist, unitSystem)}
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
        background: 'rgba(15,15,20,0.95)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.12)',
        color: 'var(--cl-text-on-fill)',
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
                  color: 'var(--cl-text-on-fill)', fontWeight: 600,
                }}>
                {mode === 'measure' ? <><Crosshair size={10} style={{ display: 'inline', marginRight: 3 }} />Measuring</> : 'Measure'}
              </button>
            </div>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 2 }}>
            <X size={14} />
          </button>
        </div>

        {/*
          Units toggle — a pure DISPLAY switch. Calibration is stored in meters,
          so flipping this re-renders every existing measurement instantly and
          never invalidates the scale.
        */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', flex: 1 }}>Units</span>
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
            {(['metric', 'imperial'] as const).map(sys => (
              <button
                key={sys}
                onClick={() => {
                  onUnitSystemChange(sys);
                  // Keep the typing unit sensible for the new system, but only
                  // when the coach hasn't already typed something — retyping
                  // their value out from under them would be worse.
                  if (!customDistance.trim()) setCustomUnit(defaultUnitFor(sys));
                }}
                style={{
                  padding: '3px 10px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  background: unitSystem === sys ? 'var(--cl-warning-text)' : 'transparent',
                  color: unitSystem === sys ? 'var(--cl-text-primary)' : 'rgba(255,255,255,0.6)',
                }}>
                {sys === 'metric' ? 'cm / m' : 'ft / in'}
              </button>
            ))}
          </div>
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
                    color: 'var(--cl-text-on-fill)', transition: 'background 0.15s',
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

              {/* Custom length input: value + unit, or free-form text */}
              {selectedPreset.id === 'custom' && (
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 4 }}>
                    Known length of the object you’re drawing along:
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customDistance}
                      placeholder={unitSystem === 'imperial' ? `27  or  5'11"` : '68.6  or  1.8 m'}
                      onChange={e => { setCustomDistance(e.target.value); setCalibError(null); }}
                      style={{
                        flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 6,
                        border: `1px solid ${customLenInvalid ? 'rgba(248,113,113,0.7)' : 'rgba(255,255,255,0.2)'}`,
                        background: 'rgba(255,255,255,0.08)',
                        color: 'var(--cl-text-on-fill)', fontSize: 13, boxSizing: 'border-box',
                      }}
                    />
                    <select
                      value={customUnit}
                      onChange={e => setCustomUnit(e.target.value as LengthUnit)}
                      aria-label="Unit"
                      style={{
                        padding: '5px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)',
                        background: 'rgba(30,30,36,0.95)', color: 'var(--cl-text-on-fill)', fontSize: 12, cursor: 'pointer',
                      }}>
                      {(['cm', 'm', 'in', 'ft', 'mm'] as const).map(u => (
                        <option key={u} value={u}>{LENGTH_UNIT_LABEL[u]}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 4, lineHeight: 1.4 }}>
                    You can also type the unit inline — “27 in”, “1.8 m”, “5 ft 11 in”.
                  </div>

                  {/* Racket hint + one-tap prefill */}
                  <div style={{
                    marginTop: 8, padding: '7px 9px', borderRadius: 8,
                    background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)',
                  }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 1.45 }}>
                      💡 <strong style={{ color: 'var(--cl-warning-text)' }}>Tip:</strong> a racket is an easy reference —
                      it’s always in frame. Most adult rackets are{' '}
                      <strong>{unitSystem === 'imperial' ? '27 in (68.6 cm)' : '68.6 cm (27 in)'}</strong>.
                      Draw along the racket and use that length.
                    </div>
                    <button
                      onClick={() => {
                        const pre = racketPrefill(unitSystem);
                        setCustomDistance(pre.value);
                        setCustomUnit(pre.unit);
                        setCalibError(null);
                      }}
                      style={{
                        marginTop: 6, width: '100%', padding: '5px 0', borderRadius: 6, border: 'none',
                        cursor: 'pointer', background: 'rgba(245,158,11,0.85)', color: 'var(--cl-text-primary)',
                        fontWeight: 700, fontSize: 11,
                      }}>
                      Use racket length ({unitSystem === 'imperial' ? '27 in' : '68.6 cm'})
                    </button>
                  </div>
                </div>
              )}

              {/* Non-custom presets: show the known length being assumed */}
              {selectedPreset.id !== 'custom' && selectedPreset.referenceDistance != null && (
                <div style={{
                  marginBottom: 10, fontSize: 11, color: 'rgba(255,255,255,0.6)',
                  padding: '5px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)',
                }}>
                  Assumed length:{' '}
                  <strong style={{ color: 'var(--cl-warning-text)' }}>
                    {formatLength(selectedPreset.referenceDistance, unitSystem)}
                  </strong>
                </div>
              )}

              {calibError && (
                <div style={{
                  marginBottom: 10, padding: '6px 9px', borderRadius: 6, fontSize: 11, lineHeight: 1.4,
                  background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)',
                  color: '#FCA5A5',
                }}>
                  {calibError}
                </div>
              )}

              {/* Progress dots */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {selectedPreset.pointLabels.map((_, i) => (
                  <div key={i} style={{
                    width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    background: i < calibPoints.length ? '#3B82F6' : 'rgba(255,255,255,0.1)',
                    color: i < calibPoints.length ? 'var(--cl-text-on-fill)' : 'rgba(255,255,255,0.4)',
                    border: i === calibPoints.length ? '2px solid #3B82F6' : '2px solid transparent',
                  }}>{i + 1}</div>
                ))}
              </div>

              {/* Current instruction */}
              <div style={{
                padding: '8px 10px', borderRadius: 8,
                background: awaitingCustomLength ? 'rgba(255,255,255,0.06)' : 'rgba(59,130,246,0.15)',
                border: `1px solid ${awaitingCustomLength ? 'rgba(255,255,255,0.12)' : 'rgba(59,130,246,0.3)'}`,
                marginBottom: 8,
              }}>
                {awaitingCustomLength ? (
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}>
                    Enter the known length above, then click the two ends of the object.
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <MousePointer size={12} color="#60A5FA" />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#60A5FA' }}>
                        Click point {calibPoints.length + 1} of {selectedPreset.pointCount}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 1.4 }}>
                      {nextPointLabel}
                    </div>
                  </>
                )}
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#4ADE80' }}>Calibrated</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                    {RULER_PRESETS.find(p => p.id === calibration.presetId)?.label ?? ''}
                    {calibration.referenceMeters != null
                      ? ` · ${formatLength(calibration.referenceMeters, unitSystem)} ref`
                      : ''}
                    {' · '}
                    {calibration.method === 'homography' ? 'Perspective corrected' : 'Simple scale'}
                  </div>
                  {calibration.method === 'simple' && calibration.scale != null && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
                      {formatScale(calibration.scale, unitSystem)}
                    </div>
                  )}
                </div>
                <button
                  onClick={resetCalibration}
                  title="Re-calibrate"
                  aria-label="Re-calibrate"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 2,
                  }}>
                  <RefreshCw size={12} />
                </button>
              </div>

              {mode === 'calibrate' && (
                <button onClick={() => setMode('measure')} style={{
                  width: '100%', padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: '#3B82F6', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 13, marginBottom: 8,
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
                    <Crosshair size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--cl-warning-text)' }} />
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
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cl-warning-text)' }}>
                              {formatLength(m.distanceM, unitSystem)}
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
          Tip: no court markings in frame? Use <strong style={{ color: 'rgba(255,255,255,0.5)' }}>Racket</strong> —
          it’s in almost every clip and most adult rackets are 27 in (68.6 cm). "Service Box" gives
          perspective-corrected measurements.
        </div>
      </div>
    </div>
  );
}
