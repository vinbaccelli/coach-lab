'use client';

import React from 'react';
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
} from 'lucide-react';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';

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
}

const TOOLS: { id: ToolType; icon: React.ReactNode; label: string }[] = [
  { id: 'select', icon: <MousePointer2 size={18} />, label: 'Select' },
  { id: 'pen', icon: <Pen size={18} />, label: 'Draw' },
  { id: 'angle', icon: <Triangle size={18} />, label: 'Angle' },
  { id: 'circle', icon: <Circle size={18} />, label: 'Circle' },
  { id: 'arrow', icon: <ArrowRight size={18} />, label: 'Arrow' },
  { id: 'arrowAngle', icon: <Activity size={18} />, label: 'Angle↗' },
  { id: 'bodyCircle', icon: <Circle size={18} strokeDasharray="4 2" />, label: '3D Circle' },
  { id: 'text', icon: <Type size={18} />, label: 'Text' },
  { id: 'skeleton', icon: <PersonStanding size={18} />, label: 'Skeleton' },
  { id: 'ballShadow', icon: <Footprints size={18} />, label: 'Ball Trail' },
  { id: 'swingPath', icon: <TrendingUp size={18} />, label: 'Swing Path' },
  { id: 'erase', icon: <Eraser size={18} />, label: 'Erase' },
];

const PRESET_COLORS = [
  '#1E40AF', // dark blue
  '#DC2626', // red
  '#16A34A', // green
  '#D97706', // amber
  '#7C3AED', // purple
  '#0891B2', // cyan
  '#EC4899', // pink
  '#111827', // near-black
  '#FFFFFF', // white
];

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
}: ToolPaletteProps) {
  return (
    <div className="flex flex-col gap-1 h-full select-none">
      {/* Drawing Tools */}
      <div className="px-2 pt-2 pb-1">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
          Tools
        </p>
        <div className="grid grid-cols-2 gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => onToolChange(t.id)}
              className={`tool-btn ${activeTool === t.id ? 'active' : ''}`}
              title={t.label}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-100 mx-2" />

      {/* Color picker */}
      <div className="px-3 py-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
          Color
        </p>
        <div className="grid grid-cols-3 gap-1 mb-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onOptionsChange({ color: c })}
              title={c}
              className={`w-7 h-7 rounded-md border-2 transition-transform hover:scale-110 ${
                drawingOptions.color === c
                  ? 'border-blue-500 scale-110'
                  : 'border-gray-200'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <span>Custom:</span>
          <input
            type="color"
            value={drawingOptions.color}
            onChange={(e) => onOptionsChange({ color: e.target.value })}
            className="w-8 h-8 rounded cursor-pointer border border-gray-200"
          />
        </label>
      </div>

      <div className="border-t border-gray-100 mx-2" />

      {/* Line width */}
      <div className="px-3 py-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
          Thickness
        </p>
        <input
          type="range"
          min={1}
          max={12}
          step={1}
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

      {/* Font size (text tool) */}
      {activeTool === 'text' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-3 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Font Size
            </p>
            <input
              type="range"
              min={10}
              max={72}
              step={2}
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

      {/* Tool-specific helpers */}
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
            <p className="text-[9px] text-gray-400 px-1 mb-1.5 leading-tight">
              Also click joints manually while paused to fine-tune.
            </p>
            <button
              onClick={onResetSkeleton}
              className="tool-btn w-full flex-row gap-1 text-orange-500 hover:bg-orange-50 hover:text-orange-600"
              title="Clear skeleton joints and re-process"
            >
              <RefreshCw size={13} />
              <span>Reset &amp; Re-analyze</span>
            </button>
          </div>
        </>
      )}

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
            <p className="text-[9px] text-gray-400 px-1 mb-1.5 leading-tight">
              Click the ball manually in any frame to add extra points.
            </p>
            <button
              onClick={onResetBallTrail}
              className="tool-btn w-full flex-row gap-1 text-orange-500 hover:bg-orange-50 hover:text-orange-600"
              title="Clear ball trail"
            >
              <RefreshCw size={13} />
              <span>Reset Trail</span>
            </button>
          </div>
        </>
      )}

      {activeTool === 'swingPath' && (
        <>
          <div className="border-t border-gray-100 mx-2" />
          <div className="px-2 py-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Swing Path
            </p>
            <p className="text-[9px] text-purple-500 px-1 mb-0.5 leading-tight font-medium">
              Click to add points along the path.
            </p>
            <p className="text-[9px] text-gray-400 px-1 mb-1.5 leading-tight">
              Desktop: double-click to end. Mobile: long-press (0.5s) to end.
            </p>
          </div>
        </>
      )}

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

      <div className="border-t border-gray-100 mx-2" />

      {/* Actions */}
      <div className="px-2 pb-3 pt-2 flex flex-col gap-1">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5 px-1">
          Actions
        </p>
        <div className="flex gap-1">
          <button
            onClick={onUndo}
            className="tool-btn flex-1 flex-row gap-1"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={15} />
            <span>Undo</span>
          </button>
          <button
            onClick={onRedo}
            className="tool-btn flex-1 flex-row gap-1"
            title="Redo (Ctrl+Y)"
          >
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
