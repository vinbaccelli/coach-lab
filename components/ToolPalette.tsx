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
  Crop,
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
  onCircleSpinningChange?: (spinning: boolean) => void;
  circleGapMode?: boolean;
  onCircleGapModeChange?: (mode: boolean) => void;
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
  onClearCrop?: () => void;
}

type Panel = null | 'draw' | 'angle' | 'style' | 'swing' | 'view';

const PRESET_COLORS = [
  '#1E40AF', '#DC2626', '#16A34A', '#D97706', '#7C3AED',
  '#0891B2', '#EC4899', '#111827', '#FFFFFF',
];

const pillBtn = (active: boolean): React.CSSProperties => ({
  padding: '3px 10px',
  borderRadius: '12px',
  border: `1px solid ${active ? '#35679A' : '#E8E8ED'}`,
  background: active ? '#35679A' : '#fff',
  color: active ? '#fff' : '#1D1D1F',
  cursor: 'pointer',
  fontSize: '10px',
  fontWeight: 600,
  whiteSpace: 'nowrap' as const,
});

export default function ToolPalette({
  activeTool,
  onToolChange,
  compact = false,
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
  onCircleSpinningChange,
  circleGapMode,
  onCircleGapModeChange,
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
  onClearCrop,
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
  const shapeGapEligible =
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

  return (
    <div ref={paletteRef} className="flex flex-col gap-1 h-full select-none">
      <div className={compact ? 'px-1 pt-2 pb-1' : 'px-2 pt-2 pb-1'}>
        {!compact && (
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
            Toolbar
          </p>
        )}

        <div className="flex flex-col gap-1">
          {/* Single-column desktop toolbar (matches mobile's clarity) */}
          <button
            onClick={() => { setTool('select'); setOpenPanel(null); }}
            className={`tool-btn tool-btn-chrome w-full flex-row gap-1 ${compact ? 'justify-center' : ''} ${activeTool === 'select' ? 'active' : ''}`}
            title="Select and move drawings"
          >
            <MousePointer2 size={15} />
            {!compact && <span>Select</span>}
          </button>

          <button
            onClick={() => togglePanel('style')}
            className={`tool-btn tool-btn-chrome w-full flex-row gap-1 ${compact ? 'justify-center' : ''} ${openPanel === 'style' ? 'active' : ''}`}
            title="Style"
          >
            <Shapes size={15} />
            {!compact && <span>Style</span>}
          </button>

          <button
            onClick={() => togglePanel('draw')}
            className={`tool-btn tool-btn-chrome w-full flex-row gap-1 ${compact ? 'justify-center' : ''} ${isDrawTool ? 'active' : ''}`}
            title="Draw, shapes, text, measure, swing"
          >
            <Pen size={15} />
            {!compact && <span>Draw</span>}
          </button>
          {openPanel === 'draw' && (
            <div className="px-2 py-2 rounded-xl bg-[#FAF9F7] border border-[#E5E5E5] shadow-sm max-h-[min(70vh,520px)] overflow-y-auto">
              <div className="grid grid-cols-1 gap-2">
                <button onClick={() => setTool('pen')} className={`tool-btn flex-row gap-1 ${activeTool === 'pen' ? 'active' : ''}`} title="Draw freely on the video — drag to draw">
                  <Pen size={14} /><span>Freehand</span>
                </button>
                <button onClick={() => setTool('line')} className={`tool-btn flex-row gap-1 ${activeTool === 'line' ? 'active' : ''}`} title="Draw a straight line — click start and end points">
                  <Minus size={14} /><span>Line</span>
                </button>
                <button onClick={() => setTool('arrow')} className={`tool-btn flex-row gap-1 ${activeTool === 'arrow' ? 'active' : ''}`} title="Draw an arrow — click start and end points">
                  <ArrowRight size={14} /><span>Arrow</span>
                </button>
                <button onClick={() => setTool('erase')} className={`tool-btn flex-row gap-1 ${activeTool === 'erase' ? 'active' : ''}`} title="Erase drawings — click on a shape to remove it">
                  <Eraser size={14} /><span>Eraser</span>
                </button>
                <button onClick={() => setTool(isCircle3d ? 'bodyCircle' : 'circle')} className={`tool-btn flex-row gap-1 ${(activeTool === 'circle' || activeTool === 'bodyCircle') ? 'active' : ''}`} title="Draw a circle — click center and drag to set size">
                  <Circle size={14} /><span>Circle</span>
                </button>
                <button onClick={() => setTool('rect')} className={`tool-btn flex-row gap-1 ${activeTool === 'rect' ? 'active' : ''}`} title="Draw a rectangle — click and drag corner to corner">
                  <Square size={14} /><span>Rectangle</span>
                </button>
                <button onClick={() => setTool('triangle')} className={`tool-btn flex-row gap-1 ${activeTool === 'triangle' ? 'active' : ''}`} title="Draw a triangle — click and drag to set size">
                  <Triangle size={14} /><span>Triangle</span>
                </button>
                <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mt-1 mb-0 px-0.5">Annotate</p>
                <button onClick={() => setTool('text')} className={`tool-btn flex-row gap-1 ${activeTool === 'text' ? 'active' : ''}`} title="Add text annotation — click to place text">
                  <Type size={14} /><span>Text</span>
                </button>
                <button onClick={() => setTool('angle')} className={`tool-btn flex-row gap-1 ${activeTool === 'angle' ? 'active' : ''}`} title="Measure an angle — click vertex, then two endpoints">
                  <Triangle size={14} /><span>Angle</span>
                </button>
                <button onClick={() => setTool('arrowAngle')} className={`tool-btn flex-row gap-1 ${activeTool === 'arrowAngle' ? 'active' : ''}`} title="Draw an arrow with angle measurement at the tip">
                  <Activity size={14} /><span>Arrow + angle</span>
                </button>
                <button onClick={() => setTool('manualSwing')} className={`tool-btn flex-row gap-1 ${activeTool === 'manualSwing' ? 'active' : ''}`} title="Draw a swing path — click points, double-click to finish">
                  <Zap size={14} /><span>Swing path</span>
                </button>
              </div>

              {(activeTool === 'circle' || activeTool === 'bodyCircle' || activeTool === 'rect' || activeTool === 'triangle') && (
                <div className="mt-2 border-t border-gray-200 pt-2 px-1 flex flex-col gap-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Shape Options
                  </p>

                  {(activeTool === 'circle' || activeTool === 'bodyCircle') && (
                    <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer" title="Enable 3D cut effect on the circle">
                      <input
                        type="checkbox"
                        checked={activeTool === 'bodyCircle'}
                        onChange={(e) => onToolChange(e.target.checked ? 'bodyCircle' : 'circle')}
                        className="accent-blue-500"
                      />
                      3D cut
                    </label>
                  )}
                  {activeTool === 'rect' && onRect3dChange && (
                    <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer" title="Enable 3D cut effect on the rectangle">
                      <input
                        type="checkbox"
                        checked={!!rect3d}
                        onChange={(e) => onRect3dChange(e.target.checked)}
                        className="accent-blue-500"
                      />
                      3D cut
                    </label>
                  )}
                  {activeTool === 'triangle' && onTriangle3dChange && (
                    <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer" title="Enable 3D cut effect on the triangle">
                      <input
                        type="checkbox"
                        checked={!!triangle3d}
                        onChange={(e) => onTriangle3dChange(e.target.checked)}
                        className="accent-blue-500"
                      />
                      3D cut
                    </label>
                  )}

                  {onCircleSpinningChange && (
                    <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer" title="Animate the shape outline with a travelling effect">
                      <input
                        type="checkbox"
                        checked={!!circleSpinning}
                        onChange={(e) => onCircleSpinningChange(e.target.checked)}
                        className="accent-blue-500"
                      />
                      Animation
                    </label>
                  )}

                  {onCircleGapModeChange && shapeGapEligible && (
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => onCircleGapModeChange(!circleGapMode)}
                        className={`tool-btn w-full flex-row gap-2 ${circleGapMode ? 'active text-blue-600' : 'text-gray-500'}`}
                        title="Cut a gap in the shape outline — click start then end of gap"
                      >
                        <span className="text-[13px]">✂</span>
                        <span>{circleGapMode ? 'Gap cutter ON' : 'Gap cutter'}</span>
                      </button>
                      {circleGapMode && (
                        <p className="text-[9px] text-blue-500 px-1 leading-tight font-medium">
                          Click where the gap starts, then click where it ends.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button onClick={() => { setTool('skeleton'); setOpenPanel(null); }} className={`tool-btn tool-btn-chrome w-full flex-row gap-1 ${activeTool === 'skeleton' ? 'active' : ''}`} title="AI body tracking — overlays joints and connections">
            <PersonStanding size={15} /><span>Skeleton</span>
          </button>

          <button
            onClick={() => togglePanel('view')}
            className={`tool-btn tool-btn-chrome w-full flex-row gap-1 ${openPanel === 'view' || activeTool === 'zoom' || activeTool === 'cropSelect' ? 'active' : ''}`}
            title="Zoom & crop"
          >
            <ZoomIn size={15} />
            {!compact && <span>View</span>}
          </button>
          {openPanel === 'view' && (
            <div className="px-2 py-2 rounded-xl bg-[#FAF9F7] border border-[#E5E5E5] shadow-sm flex flex-col gap-1.5">
              <button onClick={() => setTool('zoom')} className={`tool-btn w-full flex-row gap-1 ${activeTool === 'zoom' ? 'active' : ''}`} title="Zoom and pan the video — scroll to zoom, drag to pan">
                <ZoomIn size={14} /><span>Zoom & pan</span>
              </button>
              <button onClick={() => setTool('cropSelect')} className={`tool-btn w-full flex-row gap-1 ${activeTool === 'cropSelect' ? 'active' : ''}`} title="Crop and zoom into a region of the video">
                <Crop size={14} /><span>Crop</span>
              </button>
              {onResetCropZoom && (
                <button type="button" onClick={onResetCropZoom} className="tool-btn w-full flex-row gap-1 text-gray-600" title="Reset zoom to default view">
                  <RefreshCw size={14} /><span>Reset zoom</span>
                </button>
              )}
              {onClearCrop && (
                <button type="button" onClick={onClearCrop} className="tool-btn w-full flex-row gap-1 text-gray-600" title="Remove crop and show full video">
                  <RefreshCw size={14} /><span>Clear crop</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {openPanel === 'style' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-3 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Style
            </p>
            <div className="grid grid-cols-3 gap-1 mb-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onOptionsChange({ color: c })}
                  title={c}
                  className={`w-7 h-7 rounded-md border-2 transition-transform hover:scale-110 ${
                    drawingOptions.color === c ? 'border-blue-500 scale-110' : 'border-gray-200'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-2">
              <span>Custom:</span>
              <input
                type="color"
                value={drawingOptions.color}
                onChange={(e) => onOptionsChange({ color: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border border-gray-200"
              />
            </label>
            <div className="mb-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Thickness
              </p>
              <input
                type="range" min={1} max={12} step={1}
                value={drawingOptions.lineWidth}
                onChange={(e) => onOptionsChange({ lineWidth: Number(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                <span>1px</span>
                <span className="font-medium text-gray-600">{drawingOptions.lineWidth}px</span>
                <span>12px</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Line Style
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => onOptionsChange({ dashed: false })}
                  className={`tool-btn flex-1 flex-row gap-1 ${!drawingOptions.dashed ? 'active' : ''}`}
                  title="Solid line"
                >
                  <span style={{ fontSize: '14px' }}>—</span>
                  <span>Solid</span>
                </button>
                <button
                  onClick={() => onOptionsChange({ dashed: true })}
                  className={`tool-btn flex-1 flex-row gap-1 ${drawingOptions.dashed ? 'active' : ''}`}
                  title="Dashed line"
                >
                  <span style={{ fontSize: '14px' }}>╌</span>
                  <span>Dashed</span>
                </button>
              </div>
              {(activeTool === 'manualSwing' || activeTool === 'swingPath') && (
                <label className="flex items-center gap-2 text-xs text-gray-600 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!drawingOptions.arrowAtEnd}
                    onChange={(e) => onOptionsChange({ arrowAtEnd: e.target.checked })}
                    className="accent-blue-500"
                  />
                  Arrow at end of path
                </label>
              )}
            </div>
          </div>
        </>
      )}

      {/* Font size (text tool) */}
      {activeTool === 'text' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-3 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Font Size
            </p>
            <input
              type="range" min={10} max={72} step={2}
              value={drawingOptions.fontSize}
              onChange={(e) => onOptionsChange({ fontSize: Number(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
              <span>10</span>
              <span className="font-medium text-gray-600">{drawingOptions.fontSize}px</span>
              <span>72</span>
            </div>
          </div>
        </>
      )}

      {/* Skeleton tool */}
      {activeTool === 'skeleton' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-2 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Skeleton
            </p>
            <p className="text-[9px] text-cyan-600 px-1 mb-1.5 leading-tight font-medium">
              AI auto-detects pose from video.
            </p>
            <button
              onClick={onResetSkeleton}
              className="tool-btn w-full flex-row gap-1 text-orange-500 hover:bg-orange-50 hover:text-orange-600 mb-1"
            >
              <RefreshCw size={13} />
              <span>Reset &amp; Re-analyze</span>
            </button>
            {onRacketMultiplier && (
              <button
                onClick={onRacketMultiplier}
                className="tool-btn w-full flex-row gap-1 text-purple-600 hover:bg-purple-50 hover:text-purple-700 mb-1"
              >
                <Activity size={13} />
                <span>Racket Multiplier</span>
              </button>
            )}
            {onSkeletonShowAnglesChange !== undefined && (
              <label className="flex items-center gap-2 cursor-pointer px-1 mb-1">
                <input type="checkbox" checked={skeletonShowAngles ?? true}
                  onChange={e => onSkeletonShowAnglesChange(e.target.checked)} className="accent-green-500" />
                <span className="text-[9px] text-gray-600 font-medium">Show angles</span>
              </label>
            )}
            {onSkeletonShowHeadLineChange !== undefined && (
              <label className="flex items-center gap-2 cursor-pointer px-1 mb-1">
                <input type="checkbox" checked={skeletonShowHeadLine ?? false}
                  onChange={e => onSkeletonShowHeadLineChange(e.target.checked)} className="accent-green-500" />
                <span className="text-[9px] text-gray-600 font-medium">Show head line</span>
              </label>
            )}
            {onSkeletonClassicColorsChange !== undefined && (
              <label className="flex items-center gap-2 cursor-pointer px-1 mb-1">
                <input type="checkbox" checked={skeletonClassicColors ?? true}
                  onChange={e => onSkeletonClassicColorsChange(e.target.checked)} className="accent-green-500" />
                <span className="text-[9px] text-gray-600 font-medium">Neon colors (green/red/blue)</span>
              </label>
            )}
            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mt-2 mb-1 px-1">Body Parts</p>
            {onSkeletonShowRightArmChange !== undefined && (
              <label className="flex items-center gap-2 cursor-pointer px-1 mb-1">
                <input type="checkbox" checked={skeletonShowRightArm ?? true}
                  onChange={e => onSkeletonShowRightArmChange(e.target.checked)} className="accent-red-500" />
                <span className="text-[9px] text-gray-600 font-medium">Right arm</span>
              </label>
            )}
            {onSkeletonShowLeftArmChange !== undefined && (
              <label className="flex items-center gap-2 cursor-pointer px-1 mb-1">
                <input type="checkbox" checked={skeletonShowLeftArm ?? true}
                  onChange={e => onSkeletonShowLeftArmChange(e.target.checked)} className="accent-blue-500" />
                <span className="text-[9px] text-gray-600 font-medium">Left arm</span>
              </label>
            )}
            {onSkeletonShowRightLegChange !== undefined && (
              <label className="flex items-center gap-2 cursor-pointer px-1 mb-1">
                <input type="checkbox" checked={skeletonShowRightLeg ?? true}
                  onChange={e => onSkeletonShowRightLegChange(e.target.checked)} className="accent-red-500" />
                <span className="text-[9px] text-gray-600 font-medium">Right leg</span>
              </label>
            )}
            {onSkeletonShowLeftLegChange !== undefined && (
              <label className="flex items-center gap-2 cursor-pointer px-1 mb-1">
                <input type="checkbox" checked={skeletonShowLeftLeg ?? true}
                  onChange={e => onSkeletonShowLeftLegChange(e.target.checked)} className="accent-blue-500" />
                <span className="text-[9px] text-gray-600 font-medium">Left leg</span>
              </label>
            )}
          </div>
        </>
      )}

      {/* V2 feature: Ball Trail controls intentionally hidden from UI for now. */}
      {false && activeTool === 'ballShadow' && (
        <div />
      )}

      {/* Swing path tool */}
      {activeTool === 'swingPath' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-2 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Swing Path
            </p>
            <p className="text-[9px] text-purple-500 px-1 mb-0.5 leading-tight font-medium">
              Click to add points. Double-click to end.
            </p>
            {onAutoSwing && (
              <button
                onClick={onAutoSwing}
                className="tool-btn w-full flex-row gap-1 text-orange-500 hover:bg-orange-50 hover:text-orange-600"
              >
                <TrendingUp size={13} />
                <span>Auto Swing</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* Manual swing tool */}
      {activeTool === 'manualSwing' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-2 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Manual Swing
            </p>
            <p className="text-[9px] text-blue-500 px-1 mb-0.5 leading-tight font-medium">
              Click to add waypoints. Double-click or click same spot to finalize.
            </p>
          </div>
        </>
      )}

      {/* Angle tool */}
      {activeTool === 'angle' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-2 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Angle Measure
            </p>
            <p className="text-[9px] text-amber-500 px-1 leading-tight font-medium">
              Click 3 points. Drag 3rd for live angle preview.
            </p>
          </div>
        </>
      )}

      {/* Crop tool */}
      {activeTool === 'cropSelect' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-2 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Crop
            </p>
            <p className="text-[9px] text-orange-500 px-1 leading-tight font-medium mb-1">
              Drag a rectangle to zoom the view into that region.
            </p>
            {onClearCrop && (
              <button
                onClick={onClearCrop}
                className="tool-btn w-full flex-row gap-1 text-gray-500 hover:bg-gray-50"
              >
                <RefreshCw size={13} />
                <span>Reset Crop</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* Zoom tool */}
      {activeTool === 'zoom' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-2 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Zoom / Pan
            </p>
            <p className="text-[9px] text-blue-500 px-1 leading-tight font-medium mb-1">
              Wheel: zoom · Space+drag: pan · Pinch on touch
            </p>
            {onResetCropZoom && (
              <button
                onClick={onResetCropZoom}
                className="tool-btn w-full flex-row gap-1 text-gray-500 hover:bg-gray-50"
              >
                <RefreshCw size={13} />
                <span>Reset Zoom</span>
              </button>
            )}
          </div>
        </>
      )}

      <div className="border-t border-gray-100 mx-2" />

      {/* Actions */}
      <div className="px-2 pb-3 pt-2 flex flex-col gap-1">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5 px-1">
          Actions
        </p>
        <div className="flex flex-col gap-1">
          <button onClick={onUndo} className="tool-btn tool-btn-chrome w-full flex-row gap-1" title="Undo (Ctrl+Z)">
            <Undo2 size={15} />
            <span>Undo</span>
          </button>
          <button onClick={onRedo} className="tool-btn tool-btn-chrome w-full flex-row gap-1" title="Redo (Ctrl+Y)">
            <Redo2 size={15} />
            <span>Redo</span>
          </button>
        </div>
        <button
          onClick={onClear}
          className="tool-btn tool-btn-chrome w-full flex-row gap-1 !text-red-300 hover:!bg-white/10 hover:!text-red-200"
          title="Clear all drawings"
        >
          <Trash2 size={15} />
          <span>Clear All</span>
        </button>
      </div>
    </div>
  );
}
