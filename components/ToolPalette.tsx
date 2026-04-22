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
} from 'lucide-react';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';

export type BallTrailMode = 'comet' | 'arc' | 'strobe';
export type WebcamPipMode = 'rectangle' | 'circle' | 'hidden';

interface ToolPaletteProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
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
  skeletonShowAngles?: boolean;
  onSkeletonShowAnglesChange?: (v: boolean) => void;
  skeletonShowHeadLine?: boolean;
  onSkeletonShowHeadLineChange?: (v: boolean) => void;
  skeletonClassicColors?: boolean;
  onSkeletonClassicColorsChange?: (v: boolean) => void;
  ballSampleMode?: boolean;
  onBallSampleModeChange?: (v: boolean) => void;
  onResetCropZoom?: () => void;
  onClearCrop?: () => void;
}

type Panel = null | 'draw' | 'angle' | 'style' | 'swing' | 'shapes';

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
  skeletonShowAngles,
  onSkeletonShowAnglesChange,
  skeletonShowHeadLine,
  onSkeletonShowHeadLineChange,
  skeletonClassicColors,
  onSkeletonClassicColorsChange,
  ballSampleMode,
  onBallSampleModeChange,
  onResetCropZoom,
  onClearCrop,
}: ToolPaletteProps) {
  const [openPanel, setOpenPanel] = useState<Panel>(null);
  const togglePanel = (p: Exclude<Panel, null>) => setOpenPanel((cur) => (cur === p ? null : p));

  const isCircle3d = activeTool === 'bodyCircle';
  const isShapeTool = activeTool === 'circle' || activeTool === 'bodyCircle' || activeTool === 'rect' || activeTool === 'triangle';
  const isDrawTool = activeTool === 'pen' || activeTool === 'line' || activeTool === 'arrow' || activeTool === 'erase' || isShapeTool;
  const isAngleTool = activeTool === 'angle' || activeTool === 'arrowAngle';

  const setTool = (t: ToolType) => {
    onToolChange(t);
    setOpenPanel(null);
  };

  return (
    <div className="flex flex-col gap-1 h-full select-none">
      <div className="px-2 pt-2 pb-1">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
          Toolbar
        </p>

        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <button
              onClick={() => setTool('select')}
              className={`tool-btn flex-1 flex-row gap-1 ${activeTool === 'select' ? 'active' : ''}`}
              title="Select"
            >
              <MousePointer2 size={15} />
              <span>Select</span>
            </button>
            <button
              onClick={() => togglePanel('style')}
              className={`tool-btn flex-1 flex-row gap-1 ${openPanel === 'style' ? 'active' : ''}`}
              title="Style"
            >
              <Shapes size={15} />
              <span>Style</span>
            </button>
          </div>

          <button
            onClick={() => togglePanel('draw')}
            className={`tool-btn w-full flex-row gap-1 ${isDrawTool ? 'active' : ''}`}
            title="Draw tools"
          >
            <Pen size={15} />
            <span>Draw</span>
          </button>
          {openPanel === 'draw' && (
            <div className="px-1 py-1 rounded-md bg-gray-50 border border-gray-200">
              <div className="grid grid-cols-2 gap-1">
                <button onClick={() => setTool('pen')} className={`tool-btn flex-row gap-1 ${activeTool === 'pen' ? 'active' : ''}`}>
                  <Pen size={14} /><span>Pen</span>
                </button>
                <button onClick={() => setTool('line')} className={`tool-btn flex-row gap-1 ${activeTool === 'line' ? 'active' : ''}`}>
                  <Minus size={14} /><span>Line</span>
                </button>
                <button onClick={() => setTool('arrow')} className={`tool-btn flex-row gap-1 ${activeTool === 'arrow' ? 'active' : ''}`}>
                  <ArrowRight size={14} /><span>Arrow</span>
                </button>
                <button onClick={() => setTool('erase')} className={`tool-btn flex-row gap-1 ${activeTool === 'erase' ? 'active' : ''}`}>
                  <Eraser size={14} /><span>Eraser</span>
                </button>
                <button onClick={() => setTool(isCircle3d ? 'bodyCircle' : 'circle')} className={`tool-btn flex-row gap-1 ${(activeTool === 'circle' || activeTool === 'bodyCircle') ? 'active' : ''}`}>
                  <Circle size={14} /><span>Circle</span>
                </button>
                <button onClick={() => setTool('rect')} className={`tool-btn flex-row gap-1 ${activeTool === 'rect' ? 'active' : ''}`}>
                  <Square size={14} /><span>Rectangle</span>
                </button>
                <button onClick={() => setTool('triangle')} className={`tool-btn flex-row gap-1 ${activeTool === 'triangle' ? 'active' : ''}`}>
                  <Triangle size={14} /><span>Triangle</span>
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => togglePanel('angle')}
            className={`tool-btn w-full flex-row gap-1 ${isAngleTool ? 'active' : ''}`}
            title="Angle tools"
          >
            <Triangle size={15} />
            <span>Angle</span>
          </button>
          {openPanel === 'angle' && (
            <div className="px-1 py-1 rounded-md bg-gray-50 border border-gray-200">
              <div className="grid grid-cols-2 gap-1">
                <button onClick={() => setTool('angle')} className={`tool-btn flex-row gap-1 ${activeTool === 'angle' ? 'active' : ''}`}>
                  <Triangle size={14} /><span>Angle</span>
                </button>
                <button onClick={() => setTool('arrowAngle')} className={`tool-btn flex-row gap-1 ${activeTool === 'arrowAngle' ? 'active' : ''}`}>
                  <Activity size={14} /><span>Arrow Angle</span>
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-1">
            <button onClick={() => setTool('text')} className={`tool-btn flex-1 flex-row gap-1 ${activeTool === 'text' ? 'active' : ''}`} title="Text">
              <Type size={15} /><span>Text</span>
            </button>
            <button onClick={() => togglePanel('shapes')} className={`tool-btn flex-1 flex-row gap-1 ${openPanel === 'shapes' ? 'active' : ''}`} title="Shapes">
              <Shapes size={15} /><span>Shapes</span>
            </button>
          </div>

          <div className="flex gap-1">
            <button onClick={() => setTool('skeleton')} className={`tool-btn flex-1 flex-row gap-1 ${activeTool === 'skeleton' ? 'active' : ''}`} title="Skeleton">
              <PersonStanding size={15} /><span>Skeleton</span>
            </button>
            <button onClick={() => setTool('ballShadow')} className={`tool-btn flex-1 flex-row gap-1 ${activeTool === 'ballShadow' ? 'active' : ''}`} title="Ball Trail">
              <Footprints size={15} /><span>Ball</span>
            </button>
          </div>

          <button onClick={() => togglePanel('swing')} className={`tool-btn w-full flex-row gap-1 ${openPanel === 'swing' ? 'active' : ''}`} title="Swing">
            <TrendingUp size={15} /><span>Swing</span>
          </button>
          {openPanel === 'swing' && (
            <div className="px-1 py-1 rounded-md bg-gray-50 border border-gray-200 flex flex-col gap-1">
              <button onClick={() => setTool('manualSwing')} className={`tool-btn w-full flex-row gap-1 ${activeTool === 'manualSwing' ? 'active' : ''}`}>
                <Zap size={14} /><span>Manual</span>
              </button>
              {onAutoSwing && (
                <button onClick={() => { setOpenPanel(null); onAutoSwing(); }} className="tool-btn w-full flex-row gap-1">
                  <TrendingUp size={14} /><span>Auto</span>
                </button>
              )}
            </div>
          )}

          <button onClick={() => setTool('zoom')} className={`tool-btn w-full flex-row gap-1 ${activeTool === 'zoom' ? 'active' : ''}`} title="Zoom / Pan">
            <ZoomIn size={15} /><span>Zoom</span>
          </button>
          <button onClick={() => setTool('cropSelect')} className={`tool-btn w-full flex-row gap-1 ${activeTool === 'cropSelect' ? 'active' : ''}`} title="Crop (affects recordings/exports)">
            <Square size={15} /><span>Crop</span>
          </button>
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
            </div>
          </div>
        </>
      )}

      {openPanel === 'shapes' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-2 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Shapes
            </p>
            <div className="flex flex-col gap-1">
              <div className="tool-btn w-full flex-row gap-2 justify-between">
                <button
                  onClick={() => setTool(isCircle3d ? 'bodyCircle' : 'circle')}
                  className={`flex items-center gap-1 ${(activeTool === 'circle' || activeTool === 'bodyCircle') ? 'text-blue-600 font-semibold' : ''}`}
                >
                  <Circle size={14} /> Circle
                </button>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isCircle3d}
                      onChange={(e) => onToolChange(e.target.checked ? 'bodyCircle' : 'circle')}
                      className="accent-blue-500"
                    />
                    3D
                  </label>
                  {onCircleSpinningChange && (
                    <label className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!circleSpinning}
                        onChange={(e) => onCircleSpinningChange(e.target.checked)}
                        className="accent-blue-500"
                      />
                      Anim
                    </label>
                  )}
                </div>
              </div>

              <div className="tool-btn w-full flex-row gap-2 justify-between">
                <button
                  onClick={() => setTool('rect')}
                  className={`flex items-center gap-1 ${activeTool === 'rect' ? 'text-blue-600 font-semibold' : ''}`}
                >
                  <Square size={14} /> Rectangle
                </button>
                <div className="flex items-center gap-2">
                  {onRect3dChange && (
                    <label className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!rect3d}
                        onChange={(e) => onRect3dChange(e.target.checked)}
                        className="accent-blue-500"
                      />
                      3D
                    </label>
                  )}
                  {onCircleSpinningChange && (
                    <label className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!circleSpinning}
                        onChange={(e) => onCircleSpinningChange(e.target.checked)}
                        className="accent-blue-500"
                      />
                      Anim
                    </label>
                  )}
                </div>
              </div>

              <div className="tool-btn w-full flex-row gap-2 justify-between">
                <button
                  onClick={() => setTool('triangle')}
                  className={`flex items-center gap-1 ${activeTool === 'triangle' ? 'text-blue-600 font-semibold' : ''}`}
                >
                  <Triangle size={14} /> Triangle
                </button>
                <div className="flex items-center gap-2">
                  {onTriangle3dChange && (
                    <label className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!triangle3d}
                        onChange={(e) => onTriangle3dChange(e.target.checked)}
                        className="accent-blue-500"
                      />
                      3D
                    </label>
                  )}
                  {onCircleSpinningChange && (
                    <label className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!circleSpinning}
                        onChange={(e) => onCircleSpinningChange(e.target.checked)}
                        className="accent-blue-500"
                      />
                      Anim
                    </label>
                  )}
                </div>
              </div>

              {onCircleGapModeChange && (activeTool === 'circle' || activeTool === 'bodyCircle') && (
                <button
                  onClick={() => onCircleGapModeChange(!circleGapMode)}
                  className={`tool-btn w-full flex-row gap-1 ${circleGapMode ? 'active text-blue-600' : 'text-gray-500'}`}
                >
                  <span className="text-[13px]">✂</span>
                  <span>{circleGapMode ? 'Gap Mode ON' : 'Add Gap'}</span>
                </button>
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
                  onChange={e => onSkeletonShowAnglesChange(e.target.checked)} className="accent-blue-500" />
                <span className="text-[9px] text-gray-600 font-medium">Show angles</span>
              </label>
            )}
            {onSkeletonShowHeadLineChange !== undefined && (
              <label className="flex items-center gap-2 cursor-pointer px-1 mb-1">
                <input type="checkbox" checked={skeletonShowHeadLine ?? true}
                  onChange={e => onSkeletonShowHeadLineChange(e.target.checked)} className="accent-blue-500" />
                <span className="text-[9px] text-gray-600 font-medium">Show headline</span>
              </label>
            )}
            {onSkeletonClassicColorsChange !== undefined && (
              <label className="flex items-center gap-2 cursor-pointer px-1 mb-1">
                <input type="checkbox" checked={skeletonClassicColors ?? false}
                  onChange={e => onSkeletonClassicColorsChange(e.target.checked)} className="accent-blue-500" />
                <span className="text-[9px] text-gray-600 font-medium">Classic neon mode</span>
              </label>
            )}
          </div>
        </>
      )}

      {/* Ball Trail tool */}
      {activeTool === 'ballShadow' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-2 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Ball Trail
            </p>
            <p className="text-[9px] text-yellow-600 px-1 mb-1.5 leading-tight font-medium">
              Auto-detects tennis ball from video.
            </p>
            <div className="flex gap-1 mb-2 flex-wrap">
              {(['comet', 'arc', 'strobe'] as BallTrailMode[]).map((m) => (
                <button
                  key={m}
                  style={pillBtn(ballTrailMode === m)}
                  onClick={() => onBallTrailModeChange(m)}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            {onBallSampleModeChange && (
              <button
                onClick={() => onBallSampleModeChange(!ballSampleMode)}
                className={`tool-btn w-full flex-row gap-1 mb-1 ${ballSampleMode ? 'active text-blue-600' : 'text-gray-500'}`}
              >
                <span className="text-[13px]">🎯</span>
                <span>{ballSampleMode ? 'Click ball to sample…' : 'Sample ball color'}</span>
              </button>
            )}
            <button
              onClick={onResetBallTrail}
              className="tool-btn w-full flex-row gap-1 text-orange-500 hover:bg-orange-50 hover:text-orange-600"
            >
              <RefreshCw size={13} />
              <span>Reset Trail</span>
            </button>
          </div>
        </>
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
              Drag a rectangle to set a crop region for recording/export.
            </p>
            {onClearCrop && (
              <button
                onClick={onClearCrop}
                className="tool-btn w-full flex-row gap-1 text-gray-500 hover:bg-gray-50"
              >
                <RefreshCw size={13} />
                <span>Clear Crop</span>
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

      {/* Webcam PiP section */}
      {webcamActive && onWebcamPipModeChange && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-2 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Webcam PiP
            </p>
            <div className="flex gap-1 mb-2 flex-wrap">
              {(['rectangle', 'circle', 'hidden'] as WebcamPipMode[]).map((m) => (
                <button
                  key={m}
                  style={pillBtn(webcamPipMode === m)}
                  onClick={() => onWebcamPipModeChange(m)}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            {onWebcamOpacityChange && (
              <div>
                <p className="text-[9px] text-gray-500 px-1 mb-1">
                  Opacity: {Math.round(webcamOpacity * 100)}%
                </p>
                <input
                  type="range" min={30} max={100} step={5}
                  value={Math.round(webcamOpacity * 100)}
                  onChange={(e) => onWebcamOpacityChange(Number(e.target.value) / 100)}
                  className="w-full"
                />
              </div>
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
        <div className="flex gap-1">
          <button onClick={onUndo} className="tool-btn flex-1 flex-row gap-1" title="Undo (Ctrl+Z)">
            <Undo2 size={15} />
            <span>Undo</span>
          </button>
          <button onClick={onRedo} className="tool-btn flex-1 flex-row gap-1" title="Redo (Ctrl+Y)">
            <Redo2 size={15} />
            <span>Redo</span>
          </button>
        </div>
        <button
          onClick={onClear}
          className="tool-btn w-full flex-row gap-1 text-red-500 hover:bg-red-50 hover:text-red-600"
          title="Clear all drawings"
        >
          <Trash2 size={15} />
          <span>Clear All</span>
        </button>
      </div>
    </div>
  );
}
