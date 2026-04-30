'use client';

import React, { useMemo, useState } from 'react';
import {
  MousePointer2,
  Pen,
  Triangle,
  ArrowRight,
  Type,
  PersonStanding,
  Footprints,
  TrendingUp,
  ZoomIn,
  Shapes,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Minus,
  Square,
  Circle,
  Activity,
  Zap,
} from 'lucide-react';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import type { BallTrailMode } from '@/components/ToolPalette';

type Panel = null | 'draw' | 'angle' | 'style' | 'shapes' | 'swing';

interface Props {
  activeTool: ToolType;
  onToolChange: (t: ToolType) => void;
  drawingOptions: DrawingOptions;
  onOptionsChange: (opts: Partial<DrawingOptions>) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  ballTrailMode: BallTrailMode;
  onBallTrailModeChange: (m: BallTrailMode) => void;
  circleSpinning?: boolean;
  onCircleSpinningChange?: (v: boolean) => void;
  circleGapMode?: boolean;
  onCircleGapModeChange?: (v: boolean) => void;
  rect3d?: boolean;
  onRect3dChange?: (v: boolean) => void;
  triangle3d?: boolean;
  onTriangle3dChange?: (v: boolean) => void;
  onClearCrop?: () => void;
}

function IconBtn({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 34,
        height: 34,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        border: active ? '1px solid #35679A' : '1px solid rgba(255,255,255,0.25)',
        background: active ? 'rgba(53,103,154,0.22)' : 'rgba(0,0,0,0.35)',
        color: '#fff',
        cursor: 'pointer',
        backdropFilter: 'blur(6px)',
      }}
    >
      {children}
    </button>
  );
}

export default function MobileToolStrip(props: Props) {
  const {
    activeTool,
    onToolChange,
    drawingOptions,
    onOptionsChange,
    onUndo,
    onRedo,
    onClear,
    ballTrailMode,
    onBallTrailModeChange,
    circleSpinning,
    onCircleSpinningChange,
    circleGapMode,
    onCircleGapModeChange,
    rect3d,
    onRect3dChange,
    triangle3d,
    onTriangle3dChange,
    onClearCrop,
  } = props;

  const [panel, setPanel] = useState<Panel>(null);
  const isCircle3d = activeTool === 'bodyCircle';

  const panelStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    left: 42,
    top: 0,
    minWidth: 180,
    background: 'rgba(255,255,255,0.98)',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 10,
    padding: 8,
    color: '#111',
  }), []);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <IconBtn active={activeTool === 'select'} title="Select" onClick={() => { setPanel(null); onToolChange('select'); }}>
          <MousePointer2 size={18} />
        </IconBtn>
        <IconBtn active={panel === 'draw'} title="Draw" onClick={() => setPanel(panel === 'draw' ? null : 'draw')}>
          <Pen size={18} />
        </IconBtn>
        <IconBtn active={panel === 'angle'} title="Angle" onClick={() => setPanel(panel === 'angle' ? null : 'angle')}>
          <Triangle size={18} />
        </IconBtn>
        <IconBtn active={activeTool === 'text'} title="Text" onClick={() => { setPanel(null); onToolChange('text'); }}>
          <Type size={18} />
        </IconBtn>
        <IconBtn active={activeTool === 'skeleton'} title="Skeleton" onClick={() => { setPanel(null); onToolChange('skeleton'); }}>
          <PersonStanding size={18} />
        </IconBtn>
        {/* V2 feature: Ball Trail is intentionally hidden from UI for now. */}
        {/* <IconBtn active={activeTool === 'ballShadow'} title="Ball Trail" onClick={() => { setPanel(null); onToolChange('ballShadow'); }}>
          <Footprints size={18} />
        </IconBtn> */}
        <IconBtn active={panel === 'swing'} title="Swing" onClick={() => setPanel(panel === 'swing' ? null : 'swing')}>
          <TrendingUp size={18} />
        </IconBtn>
        <IconBtn active={activeTool === 'zoom'} title="Zoom" onClick={() => { setPanel(null); onToolChange('zoom'); }}>
          <ZoomIn size={18} />
        </IconBtn>
        <IconBtn active={activeTool === 'cropSelect'} title="Crop" onClick={() => { setPanel(null); onToolChange('cropSelect'); }}>
          <Square size={18} />
        </IconBtn>
        <IconBtn active={panel === 'shapes'} title="Shapes" onClick={() => setPanel(panel === 'shapes' ? null : 'shapes')}>
          <Shapes size={18} />
        </IconBtn>
        <IconBtn active={panel === 'style'} title="Style" onClick={() => setPanel(panel === 'style' ? null : 'style')}>
          <Minus size={18} />
        </IconBtn>
        <IconBtn title="Undo" onClick={() => { setPanel(null); onUndo(); }}>
          <Undo2 size={18} />
        </IconBtn>
        <IconBtn title="Redo" onClick={() => { setPanel(null); onRedo(); }}>
          <Redo2 size={18} />
        </IconBtn>
        <IconBtn title="Clear All" onClick={() => { setPanel(null); onClear(); }}>
          <Trash2 size={18} />
        </IconBtn>
      </div>

      {panel === 'draw' && (
        <div style={panelStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button onClick={() => { onToolChange('pen'); setPanel(null); }} className="tool-btn flex-row gap-1"><Pen size={14} />Pen</button>
            <button onClick={() => { onToolChange('line'); setPanel(null); }} className="tool-btn flex-row gap-1"><Minus size={14} />Line</button>
            <button onClick={() => { onToolChange('arrow'); setPanel(null); }} className="tool-btn flex-row gap-1"><ArrowRight size={14} />Arrow</button>
            <button onClick={() => { onToolChange('erase'); setPanel(null); }} className="tool-btn flex-row gap-1"><Eraser size={14} />Eraser</button>
            <button onClick={() => { onToolChange(isCircle3d ? 'bodyCircle' : 'circle'); setPanel(null); }} className="tool-btn flex-row gap-1"><Circle size={14} />Circle</button>
            <button onClick={() => { onToolChange('rect'); setPanel(null); }} className="tool-btn flex-row gap-1"><Square size={14} />Rect</button>
            <button onClick={() => { onToolChange('triangle'); setPanel(null); }} className="tool-btn flex-row gap-1"><Triangle size={14} />Tri</button>
          </div>
        </div>
      )}

      {panel === 'angle' && (
        <div style={panelStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button onClick={() => { onToolChange('angle'); setPanel(null); }} className="tool-btn flex-row gap-1"><Triangle size={14} />Angle</button>
            <button onClick={() => { onToolChange('arrowAngle'); setPanel(null); }} className="tool-btn flex-row gap-1"><Activity size={14} />Arrow</button>
          </div>
        </div>
      )}

      {panel === 'swing' && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => { onToolChange('manualSwing'); setPanel(null); }} className="tool-btn flex-row gap-1"><Zap size={14} />Manual</button>
            <p style={{ margin: 0, fontSize: 10, color: '#6b7280' }}>Auto swing is on desktop toolbar.</p>
          </div>
        </div>
      )}

      {panel === 'shapes' && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <button onClick={() => { onToolChange(isCircle3d ? 'bodyCircle' : 'circle'); setPanel(null); }} className="tool-btn flex-row gap-1">
                <Circle size={14} />Circle
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input type="checkbox" checked={isCircle3d} onChange={(e) => onToolChange(e.target.checked ? 'bodyCircle' : 'circle')} />
                3D
              </label>
            </div>
            {(activeTool === 'circle' || activeTool === 'bodyCircle') && onCircleGapModeChange && (
              <button onClick={() => onCircleGapModeChange(!circleGapMode)} className="tool-btn flex-row gap-1">
                ✂ {circleGapMode ? 'Gap ON' : 'Gap'}
              </button>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <button onClick={() => { onToolChange('rect'); setPanel(null); }} className="tool-btn flex-row gap-1"><Square size={14} />Rect</button>
              {onRect3dChange && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <input type="checkbox" checked={!!rect3d} onChange={(e) => onRect3dChange(e.target.checked)} />
                  3D
                </label>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <button onClick={() => { onToolChange('triangle'); setPanel(null); }} className="tool-btn flex-row gap-1"><Triangle size={14} />Tri</button>
              {onTriangle3dChange && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <input type="checkbox" checked={!!triangle3d} onChange={(e) => onTriangle3dChange(e.target.checked)} />
                  3D
                </label>
              )}
            </div>
            {onCircleSpinningChange && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input type="checkbox" checked={!!circleSpinning} onChange={(e) => onCircleSpinningChange(e.target.checked)} />
                Animation
              </label>
            )}
          </div>
        </div>
      )}

      {panel === 'style' && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              Color
              <input type="color" value={drawingOptions.color} onChange={(e) => onOptionsChange({ color: e.target.value })} />
            </label>
            <label style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              Size
              <input type="range" min={1} max={12} step={1} value={drawingOptions.lineWidth} onChange={(e) => onOptionsChange({ lineWidth: Number(e.target.value) })} />
            </label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={!!drawingOptions.dashed} onChange={(e) => onOptionsChange({ dashed: e.target.checked })} />
              Dashed
            </label>
            {activeTool === 'ballShadow' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['comet', 'arc', 'strobe'] as BallTrailMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => onBallTrailModeChange(m)}
                    className={`tool-btn flex-row gap-1 ${ballTrailMode === m ? 'active' : ''}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
            {activeTool === 'cropSelect' && onClearCrop && (
              <button onClick={onClearCrop} className="tool-btn flex-row gap-1">
                Clear crop
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
