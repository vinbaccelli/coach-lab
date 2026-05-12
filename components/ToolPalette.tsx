'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  MousePointer2,
  Pen,
  Triangle,
  Circle,
  ArrowRight,
  Activity,
  Type,
  Undo2,
  Redo2,
  Trash2,
  PersonStanding,
  Footprints,
  TrendingUp,
  Eraser,
  RefreshCw,
  Minus,
  Square,
  Zap,
  ZoomIn,
  Shapes,
  Layers,
} from 'lucide-react';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';

export type BallTrailMode = 'comet' | 'arc' | 'strobe';
export type WebcamPipMode = 'rectangle' | 'circle' | 'hidden';

interface ToolPaletteProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  /** If true, renders a slim icon-first toolbar for narrow sidebars. */
  compact?: boolean;
  drawingOptions: DrawingOptions;
  onOptionsChange: (opts: Partial<DrawingOptions>) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onResetSkeleton: () => void;
  onResetBallTrail: () => void;
  ballTrailMode: BallTrailMode;
  onBallTrailModeChange: (mode: BallTrailMode) => void;
  onAutoSwing?: () => void;
  onRacketMultiplier?: () => void;
  circleSpinning?: boolean;
  objMultiplierFrameCount?: number;
  onObjMultiplierFrameCountChange?: (v: number) => void;
  objMultiplierDuration?: number;
  onObjMultiplierDurationChange?: (v: number) => void;
  onObjMultiplierCapture?: () => void;
  onObjMultiplierClear?: () => void;
  objMultiplierActive?: boolean;
  objMultiplierProgress?: string | null;
  onCircleSpinningChange?: (spinning: boolean) => void;
  outlineEraserSize?: number;
  onOutlineEraserSizeChange?: (size: number) => void;
  rect3d?: boolean;
  onRect3dChange?: (v: boolean) => void;
  triangle3d?: boolean;
  onTriangle3dChange?: (v: boolean) => void;
  webcamPipMode?: WebcamPipMode;
  onWebcamPipModeChange?: (mode: WebcamPipMode) => void;
  webcamOpacity?: number;
  onWebcamOpacityChange?: (v: number) => void;
  webcamActive?: boolean;
  /** Selfie cutout (transparent background) for PiP */
  webcamCutout?: boolean;
  onWebcamCutoutChange?: (v: boolean) => void;
  skeletonShowAngles?: boolean;
  onSkeletonShowAnglesChange?: (v: boolean) => void;
  skeletonShowHeadLine?: boolean;
  onSkeletonShowHeadLineChange?: (v: boolean) => void;
  skeletonClassicColors?: boolean;
  onSkeletonClassicColorsChange?: (v: boolean) => void;
  skeletonShowRightArm?: boolean;
  onSkeletonShowRightArmChange?: (v: boolean) => void;
  skeletonShowLeftArm?: boolean;
  onSkeletonShowLeftArmChange?: (v: boolean) => void;
  skeletonShowRightLeg?: boolean;
  onSkeletonShowRightLegChange?: (v: boolean) => void;
  skeletonShowLeftLeg?: boolean;
  onSkeletonShowLeftLegChange?: (v: boolean) => void;
  ballSampleMode?: boolean;
  onBallSampleModeChange?: (v: boolean) => void;
  onResetCropZoom?: () => void;
}

type Panel = null | 'draw' | 'angle' | 'style' | 'swing' | 'view' | 'skeleton-opts' | 'multiplier-opts';

const PRESET_COLORS = [
  '#1E40AF', '#DC2626', '#16A34A', '#D97706', '#7C3AED',
  '#0891B2', '#EC4899', '#111827', '#FFFFFF',
];

/* ---------- Coach Now compact style system (4-point grid) ---------- */

const SS = {
  toolBtn: (active: boolean): React.CSSProperties => ({
    width: 32,
    height: 32,
    borderRadius: 8,
    border: active ? 'none' : '1px solid #E5E5E5',
    background: active ? '#1A1A1A' : '#fff',
    color: active ? '#fff' : '#6e6e73',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flexShrink: 0,
    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
  }),
  actionBtn: (destructive = false): React.CSSProperties => ({
    width: 28,
    height: 28,
    borderRadius: 6,
    border: '1px solid #E5E5E5',
    background: '#FAFAFA',
    color: destructive ? '#DC2626' : '#6e6e73',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flexShrink: 0,
    transition: 'background 0.12s, color 0.12s',
  }),
  dropdown: {
    position: 'absolute' as const,
    left: 'calc(100% + 8px)',
    top: 0,
    background: '#fff',
    border: '1px solid #E5E5E5',
    borderRadius: 10,
    boxShadow: '0 4px 16px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
    padding: 8,
    maxWidth: 200,
    minWidth: 160,
    zIndex: 50,
  } as React.CSSProperties,
  dropdownItem: (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 8px',
    borderRadius: 6,
    border: 'none',
    background: active ? '#F0F0F0' : 'transparent',
    color: active ? '#1A1A1A' : '#3a3a3a',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: active ? 600 : 500,
    transition: 'background 0.1s',
  }),
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: '#999',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    padding: '4px 8px 2px',
  } as React.CSSProperties,
  hint: {
    fontSize: 9,
    color: '#888',
    padding: '2px 8px 4px',
    lineHeight: 1.3,
  } as React.CSSProperties,
  divider: {
    height: 1,
    background: '#E5E5E5',
    margin: '4px 0',
  } as React.CSSProperties,
};

export default function ToolPalette({
  activeTool,
  onToolChange,
  compact: _compact = false,
  drawingOptions,
  onOptionsChange,
  onUndo,
  onRedo,
  onClear,
  onResetSkeleton,
  onResetBallTrail,
  ballTrailMode,
  onBallTrailModeChange,
  onAutoSwing,
  onRacketMultiplier,
  circleSpinning,
  objMultiplierFrameCount = 6,
  onObjMultiplierFrameCountChange,
  objMultiplierDuration = 2,
  onObjMultiplierDurationChange,
  onObjMultiplierCapture,
  onObjMultiplierClear,
  objMultiplierActive = false,
  objMultiplierProgress,
  onCircleSpinningChange,
  outlineEraserSize = 0,
  onOutlineEraserSizeChange,
  rect3d,
  onRect3dChange,
  triangle3d,
  onTriangle3dChange,
  webcamPipMode,
  onWebcamPipModeChange,
  webcamOpacity = 1,
  onWebcamOpacityChange,
  webcamActive,
  webcamCutout = false,
  onWebcamCutoutChange,
  skeletonShowAngles,
  onSkeletonShowAnglesChange,
  skeletonShowHeadLine,
  onSkeletonShowHeadLineChange,
  skeletonClassicColors,
  onSkeletonClassicColorsChange,
  skeletonShowRightArm,
  onSkeletonShowRightArmChange,
  skeletonShowLeftArm,
  onSkeletonShowLeftArmChange,
  skeletonShowRightLeg,
  onSkeletonShowRightLegChange,
  skeletonShowLeftLeg,
  onSkeletonShowLeftLegChange,
  ballSampleMode,
  onBallSampleModeChange,
  onResetCropZoom,
}: ToolPaletteProps) {
  const [openPanel, setOpenPanel] = useState<Panel>(null);
  const togglePanel = (p: Exclude<Panel, null>) => setOpenPanel((cur) => (cur === p ? null : p));

  const isCircle3d = activeTool === 'bodyCircle';
  const isShapeTool = activeTool === 'circle' || activeTool === 'bodyCircle' || activeTool === 'rect' || activeTool === 'triangle';
  const isDrawTool =
    activeTool === 'pen' ||
    activeTool === 'line' ||
    activeTool === 'arrow' ||
    activeTool === 'erase' ||
    isShapeTool ||
    activeTool === 'text' ||
    activeTool === 'angle' ||
    activeTool === 'arrowAngle' ||
    activeTool === 'manualSwing';
  const shapeEraserEligible =
    activeTool === 'circle' ||
    activeTool === 'bodyCircle' ||
    (activeTool === 'rect' && !!rect3d) ||
    (activeTool === 'triangle' && !!triangle3d);

  const setTool = (t: ToolType) => {
    onToolChange(t);
  };

  const paletteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPanel) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        setOpenPanel(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openPanel]);

  const chk = (label: string, checked: boolean, onChange: (v: boolean) => void): React.ReactNode => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#555', padding: '3px 8px', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /> {label}
    </label>
  );

  return (
    <div
      ref={paletteRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '8px 4px',
        userSelect: 'none',
        height: '100%',
      }}
    >
      {/* ── Main tool buttons ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        {/* Select */}
        <button
          onClick={() => { setTool('select'); setOpenPanel(null); }}
          style={SS.toolBtn(activeTool === 'select')}
          title="Select"
        >
          <MousePointer2 size={16} />
        </button>

        {/* Style */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => togglePanel('style')}
            style={SS.toolBtn(openPanel === 'style')}
            title="Style"
          >
            <Shapes size={16} />
          </button>
          {openPanel === 'style' && (
            <div style={SS.dropdown}>
              <div style={SS.sectionLabel}>Color</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, padding: '4px 8px' }}>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => onOptionsChange({ color: c })}
                    title={c}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      border: drawingOptions.color === c ? '2px solid #35679A' : '1px solid #E5E5E5',
                      background: c,
                      cursor: 'pointer',
                      padding: 0,
                      transform: drawingOptions.color === c ? 'scale(1.1)' : 'none',
                      transition: 'transform 0.1s',
                    }}
                  />
                ))}
                <label style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid #E5E5E5', overflow: 'hidden', cursor: 'pointer', position: 'relative' }} title="Custom color">
                  <input
                    type="color"
                    value={drawingOptions.color}
                    onChange={(e) => onOptionsChange({ color: e.target.value })}
                    style={{ position: 'absolute', inset: -4, width: 30, height: 30, cursor: 'pointer', opacity: 0 }}
                  />
                  <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: drawingOptions.color, color: '#fff', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>+</span>
                </label>
              </div>
              <div style={SS.sectionLabel}>Thickness</div>
              <div style={{ padding: '2px 8px 4px' }}>
                <input
                  type="range" min={1} max={12} step={1}
                  value={drawingOptions.lineWidth}
                  onChange={(e) => onOptionsChange({ lineWidth: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#999' }}>
                  <span>1</span>
                  <span style={{ fontWeight: 600, color: '#555' }}>{drawingOptions.lineWidth}px</span>
                  <span>12</span>
                </div>
              </div>
              <div style={SS.sectionLabel}>Line Style</div>
              <div style={{ display: 'flex', gap: 4, padding: '2px 8px 4px' }}>
                <button
                  onClick={() => onOptionsChange({ dashed: false })}
                  style={{ ...SS.dropdownItem(!drawingOptions.dashed), flex: 1, justifyContent: 'center' }}
                  title="Solid"
                >
                  —
                </button>
                <button
                  onClick={() => onOptionsChange({ dashed: true })}
                  style={{ ...SS.dropdownItem(!!drawingOptions.dashed), flex: 1, justifyContent: 'center' }}
                  title="Dashed"
                >
                  ╌
                </button>
              </div>
              {(activeTool === 'manualSwing' || activeTool === 'swingPath') && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#555', padding: '4px 8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!drawingOptions.arrowAtEnd}
                    onChange={(e) => onOptionsChange({ arrowAtEnd: e.target.checked })}
                  />
                  Arrow at end
                </label>
              )}
            </div>
          )}
        </div>

        {/* Draw */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => togglePanel('draw')}
            style={SS.toolBtn(isDrawTool || openPanel === 'draw')}
            title="Draw"
          >
            <Pen size={16} />
          </button>
          {openPanel === 'draw' && (
            <div style={{ ...SS.dropdown, maxHeight: 'min(70vh, 480px)', overflowY: 'auto' }}>
              <div style={SS.sectionLabel}>Shapes & Lines</div>
              <button onClick={() => setTool('pen')} style={SS.dropdownItem(activeTool === 'pen')} title="Freehand draw">
                <Pen size={14} /> Freehand
              </button>
              <button onClick={() => setTool('line')} style={SS.dropdownItem(activeTool === 'line')} title="Straight line">
                <Minus size={14} /> Line
              </button>
              <button onClick={() => setTool('arrow')} style={SS.dropdownItem(activeTool === 'arrow')} title="Arrow">
                <ArrowRight size={14} /> Arrow
              </button>
              <button onClick={() => setTool('erase')} style={SS.dropdownItem(activeTool === 'erase')} title="Eraser">
                <Eraser size={14} /> Eraser
              </button>
              <button onClick={() => setTool(isCircle3d ? 'bodyCircle' : 'circle')} style={SS.dropdownItem(activeTool === 'circle' || activeTool === 'bodyCircle')} title="Circle">
                <Circle size={14} /> Circle
              </button>
              <button onClick={() => setTool('rect')} style={SS.dropdownItem(activeTool === 'rect')} title="Rectangle">
                <Square size={14} /> Rectangle
              </button>
              <button onClick={() => setTool('triangle')} style={SS.dropdownItem(activeTool === 'triangle')} title="Triangle">
                <Triangle size={14} /> Triangle
              </button>

              <div style={SS.divider} />
              <div style={SS.sectionLabel}>Annotate</div>
              <button onClick={() => setTool('text')} style={SS.dropdownItem(activeTool === 'text')} title="Text">
                <Type size={14} /> Text
              </button>
              <button onClick={() => setTool('angle')} style={SS.dropdownItem(activeTool === 'angle')} title="Angle measure">
                <Triangle size={14} /> Angle
              </button>
              <button onClick={() => setTool('arrowAngle')} style={SS.dropdownItem(activeTool === 'arrowAngle')} title="Arrow + angle">
                <Activity size={14} /> Arrow + angle
              </button>
              <button onClick={() => setTool('manualSwing')} style={SS.dropdownItem(activeTool === 'manualSwing')} title="Swing path">
                <Zap size={14} /> Swing path
              </button>

              {/* Shape options */}
              {(activeTool === 'circle' || activeTool === 'bodyCircle' || activeTool === 'rect' || activeTool === 'triangle') && (
                <>
                  <div style={SS.divider} />
                  <div style={SS.sectionLabel}>Shape Options</div>
                  {(activeTool === 'circle' || activeTool === 'bodyCircle') &&
                    chk('3D cut', activeTool === 'bodyCircle', (v) => onToolChange(v ? 'bodyCircle' : 'circle'))}
                  {activeTool === 'rect' && onRect3dChange &&
                    chk('3D cut', !!rect3d, onRect3dChange)}
                  {activeTool === 'triangle' && onTriangle3dChange &&
                    chk('3D cut', !!triangle3d, onTriangle3dChange)}
                  {onCircleSpinningChange &&
                    chk('Animation', !!circleSpinning, onCircleSpinningChange)}
                  {onOutlineEraserSizeChange && shapeEraserEligible && (
                    <div>
                      {chk('Outline eraser', outlineEraserSize > 0, (v) => onOutlineEraserSizeChange(v ? 15 : 0))}
                      {outlineEraserSize > 0 && (
                        <div style={{ padding: '2px 8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#999', marginBottom: 2 }}>
                            <span>Size</span>
                            <span style={{ fontWeight: 600, color: '#555' }}>{outlineEraserSize}px</span>
                          </div>
                          <input
                            type="range" min={5} max={50} step={1}
                            value={outlineEraserSize}
                            onChange={(e) => onOutlineEraserSizeChange(Number(e.target.value))}
                            style={{ width: '100%' }}
                          />
                          <p style={{ ...SS.hint, color: '#DC2626', padding: '2px 0' }}>Drag over outline to erase.</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Font size inline when text tool */}
              {activeTool === 'text' && (
                <>
                  <div style={SS.divider} />
                  <div style={SS.sectionLabel}>Font Size</div>
                  <div style={{ padding: '2px 8px 4px' }}>
                    <input
                      type="range" min={10} max={72} step={2}
                      value={drawingOptions.fontSize}
                      onChange={(e) => onOptionsChange({ fontSize: Number(e.target.value) })}
                      style={{ width: '100%' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#999' }}>
                      <span>10</span>
                      <span style={{ fontWeight: 600, color: '#555' }}>{drawingOptions.fontSize}px</span>
                      <span>72</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Skeleton */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setTool('skeleton'); togglePanel('skeleton-opts'); }}
            style={SS.toolBtn(activeTool === 'skeleton')}
            title="Skeleton"
          >
            <PersonStanding size={16} />
          </button>
          {openPanel === 'skeleton-opts' && activeTool === 'skeleton' && (
            <div style={SS.dropdown}>
              <div style={SS.sectionLabel}>Skeleton</div>
              <p style={{ ...SS.hint, color: '#0891B2' }}>AI auto-detects pose from video.</p>
              <button onClick={onResetSkeleton} style={{ ...SS.dropdownItem(false), color: '#EA580C' }} title="Reset skeleton">
                <RefreshCw size={13} /> Reset & Re-analyze
              </button>
              {onSkeletonShowAnglesChange !== undefined && chk('Show angles', skeletonShowAngles ?? true, onSkeletonShowAnglesChange)}
              {onSkeletonShowHeadLineChange !== undefined && chk('Show head line', skeletonShowHeadLine ?? false, onSkeletonShowHeadLineChange)}
              {onSkeletonClassicColorsChange !== undefined && chk('Neon colors', skeletonClassicColors ?? true, onSkeletonClassicColorsChange)}
              <div style={SS.sectionLabel}>Body Parts</div>
              {onSkeletonShowRightArmChange !== undefined && chk('Right arm', skeletonShowRightArm ?? true, onSkeletonShowRightArmChange)}
              {onSkeletonShowLeftArmChange !== undefined && chk('Left arm', skeletonShowLeftArm ?? true, onSkeletonShowLeftArmChange)}
              {onSkeletonShowRightLegChange !== undefined && chk('Right leg', skeletonShowRightLeg ?? true, onSkeletonShowRightLegChange)}
              {onSkeletonShowLeftLegChange !== undefined && chk('Left leg', skeletonShowLeftLeg ?? true, onSkeletonShowLeftLegChange)}
            </div>
          )}
        </div>

        {/* View (Zoom) */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => togglePanel('view')}
            style={SS.toolBtn(openPanel === 'view' || activeTool === 'zoom')}
            title="View"
          >
            <ZoomIn size={16} />
          </button>
          {openPanel === 'view' && (
            <div style={SS.dropdown}>
              <button onClick={() => setTool('zoom')} style={SS.dropdownItem(activeTool === 'zoom')} title="Zoom & pan">
                <ZoomIn size={14} /> Zoom & pan
              </button>
              {onResetCropZoom && (
                <button onClick={onResetCropZoom} style={SS.dropdownItem(false)} title="Reset zoom">
                  <RefreshCw size={14} /> Reset zoom
                </button>
              )}
            </div>
          )}
        </div>

        {/* Object Multiplier */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setTool('objectMultiplier'); togglePanel('multiplier-opts'); }}
            style={SS.toolBtn(activeTool === 'objectMultiplier')}
            title="Multiplier"
          >
            <Layers size={16} />
          </button>
          {openPanel === 'multiplier-opts' && activeTool === 'objectMultiplier' && (
            <div style={SS.dropdown}>
              <div style={SS.sectionLabel}>Object Multiplier</div>
              {!objMultiplierActive ? (
                <p style={{ ...SS.hint, color: '#7C3AED' }}>
                  Draw a rectangle around the object, then choose frames.
                </p>
              ) : (
                <>
                  <div style={{ padding: '4px 8px' }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#777', textTransform: 'uppercase' }}>
                      Frames: {objMultiplierFrameCount}
                    </div>
                    <input
                      type="range" min={3} max={12} step={1}
                      value={objMultiplierFrameCount}
                      onChange={(e) => onObjMultiplierFrameCountChange?.(Number(e.target.value))}
                      style={{ width: '100%', marginTop: 2 }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#999' }}>
                      <span>3</span><span>12</span>
                    </div>
                  </div>
                  <div style={{ padding: '4px 8px' }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#777', textTransform: 'uppercase' }}>
                      Duration: {objMultiplierDuration}s
                    </div>
                    <input
                      type="range" min={0.5} max={10} step={0.5}
                      value={objMultiplierDuration}
                      onChange={(e) => onObjMultiplierDurationChange?.(Number(e.target.value))}
                      style={{ width: '100%', marginTop: 2 }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#999' }}>
                      <span>0.5s</span><span>10s</span>
                    </div>
                  </div>
                  {objMultiplierProgress && (
                    <p style={{ ...SS.hint, color: '#7C3AED', fontWeight: 600 }}>{objMultiplierProgress}</p>
                  )}
                  <button onClick={onObjMultiplierCapture} style={{ ...SS.dropdownItem(false), color: '#7C3AED' }} title="Capture">
                    <Layers size={13} /> Capture
                  </button>
                  <button onClick={onObjMultiplierClear} style={SS.dropdownItem(false)} title="Clear overlay">
                    <RefreshCw size={13} /> Clear overlay
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Context hints for active tools */}
      {activeTool === 'swingPath' && openPanel !== 'draw' && (
        <div style={{ textAlign: 'center', maxWidth: 48, marginTop: 4 }}>
          <p style={{ ...SS.hint, color: '#7C3AED' }}>Click points, dbl-click to end.</p>
          {onAutoSwing && (
            <button onClick={onAutoSwing} style={SS.actionBtn()} title="Auto Swing">
              <TrendingUp size={13} />
            </button>
          )}
        </div>
      )}

      {activeTool === 'manualSwing' && openPanel !== 'draw' && (
        <div style={{ ...SS.hint, textAlign: 'center', marginTop: 4, maxWidth: 48 }}>
          <span style={{ color: '#2563EB' }}>Click to add points</span>
        </div>
      )}

      {activeTool === 'angle' && openPanel !== 'draw' && (
        <div style={{ ...SS.hint, textAlign: 'center', marginTop: 4, maxWidth: 48 }}>
          <span style={{ color: '#D97706' }}>Click 3 points</span>
        </div>
      )}

      {activeTool === 'zoom' && openPanel !== 'view' && (
        <div style={{ ...SS.hint, textAlign: 'center', marginTop: 4, maxWidth: 48 }}>
          <span style={{ color: '#2563EB' }}>Scroll to zoom</span>
        </div>
      )}

      {/* V2 feature: Ball Trail controls intentionally hidden */}
      {false && activeTool === 'ballShadow' && <div />}

      {/* ── Spacer ── */}
      <div style={{ flex: 1 }} />

      {/* ── Action buttons (bottom) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', paddingBottom: 8 }}>
        <div style={{ width: 24, height: 1, background: '#E5E5E5', borderRadius: 1, marginBottom: 4 }} />
        <button onClick={onUndo} style={SS.actionBtn()} title="Undo (Ctrl+Z)">
          <Undo2 size={14} />
        </button>
        <button onClick={onRedo} style={SS.actionBtn()} title="Redo (Ctrl+Y)">
          <Redo2 size={14} />
        </button>
        <button onClick={onClear} style={SS.actionBtn(true)} title="Clear all">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
