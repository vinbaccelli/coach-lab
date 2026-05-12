'use client';

import React, { useMemo, useState } from 'react';
import {
  MousePointer2,
  Pen,
  Triangle,
  ArrowRight,
  Type,
  PersonStanding,
  TrendingUp,
  ZoomIn,
  LayoutGrid,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Minus,
  Square,
  Circle,
  Activity,
  Zap,
  Crosshair,
} from 'lucide-react';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import type { BallTrailMode } from '@/components/ToolPalette';

type Panel = null | 'tools' | 'view';

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
  outlineEraserSize?: number;
  onOutlineEraserSizeChange?: (size: number) => void;
  rect3d?: boolean;
  onRect3dChange?: (v: boolean) => void;
  triangle3d?: boolean;
  onTriangle3dChange?: (v: boolean) => void;
  onResetCropZoom?: () => void;
  precisionDrawEnabled?: boolean;
  onPrecisionDrawToggle?: () => void;
  onShowPrecisionInstructions?: () => void;
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
      type="button"
      className={`tool-btn tool-btn-chrome ${active ? 'active' : ''}`}
      onClick={onClick}
      title={title}
      style={{
        width: 44,
        height: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        padding: 0,
        cursor: 'pointer',
        touchAction: 'manipulation',
      }}
    >
      {children}
    </button>
  );
}

const secLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#6e6e73',
  margin: '10px 0 6px',
};

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
    outlineEraserSize = 0,
    onOutlineEraserSizeChange,
    rect3d,
    onRect3dChange,
    triangle3d,
    onTriangle3dChange,
    onResetCropZoom,
    precisionDrawEnabled = false,
    onPrecisionDrawToggle,
    onShowPrecisionInstructions,
  } = props;

  const [panel, setPanel] = useState<Panel>(null);
  const isCircle3d = activeTool === 'bodyCircle';
  const toolsOpen = panel === 'tools';
  const viewOpen = panel === 'view';

  const shapeEraserEligible =
    activeTool === 'circle' ||
    activeTool === 'bodyCircle' ||
    (activeTool === 'rect' && !!rect3d) ||
    (activeTool === 'triangle' && !!triangle3d);

  const panelStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    left: 46,
    top: 0,
    minWidth: 220,
    maxWidth: 'min(92vw, 320px)',
    maxHeight: 'min(72vh, 520px)',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: 'rgba(250,249,247,0.97)',
    border: '1px solid #E5E5E5',
    borderRadius: 14,
    padding: 12,
    color: '#1A1A1A',
    boxShadow: '0 12px 36px rgba(0,0,0,0.08)',
  }), []);

  const showSwingArrowOpt = activeTool === 'manualSwing' || activeTool === 'swingPath';

  return (
    <div className="coachlab-mobile-toolrail" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <IconBtn active={activeTool === 'select'} title="Select" onClick={() => { setPanel(null); onToolChange('select'); }}>
          <MousePointer2 size={22} />
        </IconBtn>
        {onPrecisionDrawToggle ? (
          <IconBtn
            active={precisionDrawEnabled}
            title="Precision draw — one finger moves crosshair; second finger taps to click there."
            onClick={() => {
              setPanel(null);
              onPrecisionDrawToggle();
            }}
          >
            <Crosshair size={20} strokeWidth={precisionDrawEnabled ? 2.5 : 2} />
          </IconBtn>
        ) : null}
        <IconBtn
          active={toolsOpen || ['pen', 'line', 'arrow', 'erase', 'circle', 'bodyCircle', 'rect', 'triangle', 'angle', 'arrowAngle', 'text', 'manualSwing'].includes(activeTool)}
          title="Draw & annotate — lines, shapes, text, swing"
          onClick={() => setPanel(toolsOpen ? null : 'tools')}
        >
          <LayoutGrid size={22} />
        </IconBtn>
        <IconBtn active={activeTool === 'skeleton'} title="Skeleton" onClick={() => { setPanel(null); onToolChange('skeleton'); }}>
          <PersonStanding size={22} />
        </IconBtn>
        <IconBtn
          active={viewOpen || activeTool === 'zoom'}
          title="Zoom & pan"
          onClick={() => setPanel(viewOpen ? null : 'view')}
        >
          <ZoomIn size={22} />
        </IconBtn>
        <IconBtn title="Undo" onClick={() => { setPanel(null); onUndo(); }}>
          <Undo2 size={22} />
        </IconBtn>
        <IconBtn title="Redo" onClick={() => { setPanel(null); onRedo(); }}>
          <Redo2 size={22} />
        </IconBtn>
        <IconBtn title="Clear All" onClick={() => { setPanel(null); onClear(); }}>
          <Trash2 size={22} />
        </IconBtn>
      </div>

      {panel === 'tools' && (
        <div style={panelStyle}>
          <div style={secLabel}>Line & color</div>
          <label style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            Color
            <input type="color" value={drawingOptions.color} onChange={(e) => onOptionsChange({ color: e.target.value })} />
          </label>
          <label style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            Thickness
            <input type="range" min={1} max={12} step={1} value={drawingOptions.lineWidth} onChange={(e) => onOptionsChange({ lineWidth: Number(e.target.value) })} />
          </label>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <input type="checkbox" checked={!!drawingOptions.dashed} onChange={(e) => onOptionsChange({ dashed: e.target.checked })} />
            Dashed line
          </label>
          {showSwingArrowOpt && (
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <input type="checkbox" checked={!!drawingOptions.arrowAtEnd} onChange={(e) => onOptionsChange({ arrowAtEnd: e.target.checked })} />
              Arrow at end of path
            </label>
          )}
          {activeTool === 'text' && (
            <label style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              Font size
              <input type="range" min={10} max={72} step={2} value={drawingOptions.fontSize} onChange={(e) => onOptionsChange({ fontSize: Number(e.target.value) })} />
            </label>
          )}
          {onShowPrecisionInstructions ? (
            <button
              type="button"
              onClick={() => {
                onShowPrecisionInstructions();
              }}
              style={{
                marginBottom: 10,
                padding: '8px 0',
                border: 'none',
                background: 'none',
                color: '#35679A',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 2,
              }}
            >
              Precision draw instructions
            </button>
          ) : null}

          <div style={secLabel}>Stroke</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" onClick={() => { onToolChange('pen'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><Pen size={14} />Pen</button>
            <button type="button" onClick={() => { onToolChange('line'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><Minus size={14} />Line</button>
            <button type="button" onClick={() => { onToolChange('arrow'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><ArrowRight size={14} />Arrow</button>
            <button type="button" onClick={() => { onToolChange('erase'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><Eraser size={14} />Eraser</button>
          </div>

          <div style={secLabel}>Shapes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" onClick={() => { onToolChange(isCircle3d ? 'bodyCircle' : 'circle'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><Circle size={14} />Circle</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <input type="checkbox" checked={isCircle3d} onChange={(e) => onToolChange(e.target.checked ? 'bodyCircle' : 'circle')} />
              3D body circle
            </label>
            <button type="button" onClick={() => { onToolChange('rect'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><Square size={14} />Rectangle</button>
            {onRect3dChange && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input type="checkbox" checked={!!rect3d} onChange={(e) => onRect3dChange(e.target.checked)} />
                3D rectangle
              </label>
            )}
            <button type="button" onClick={() => { onToolChange('triangle'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><Triangle size={14} />Triangle</button>
            {onTriangle3dChange && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input type="checkbox" checked={!!triangle3d} onChange={(e) => onTriangle3dChange(e.target.checked)} />
                3D triangle
              </label>
            )}
            {onCircleSpinningChange && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input type="checkbox" checked={!!circleSpinning} onChange={(e) => onCircleSpinningChange(e.target.checked)} />
                Animated outline
              </label>
            )}
            {onOutlineEraserSizeChange && shapeEraserEligible && (
              <div className="flex flex-col gap-1 px-3 py-1">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <input type="checkbox" checked={outlineEraserSize > 0} onChange={(e) => onOutlineEraserSizeChange(e.target.checked ? 15 : 0)} />
                  Outline eraser
                </label>
                {outlineEraserSize > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#999' }}>
                      <span>Eraser size</span>
                      <span style={{ fontWeight: 600, color: '#444' }}>{outlineEraserSize}px</span>
                    </div>
                    <input type="range" min={5} max={50} step={1} value={outlineEraserSize} onChange={(e) => onOutlineEraserSizeChange(Number(e.target.value))} style={{ width: '100%' }} />
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={secLabel}>Measure</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" onClick={() => { onToolChange('angle'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><Triangle size={14} />Angle</button>
            <button type="button" onClick={() => { onToolChange('arrowAngle'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><Activity size={14} />Arrow + angle</button>
          </div>

          <div style={secLabel}>More</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" onClick={() => { onToolChange('text'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><Type size={14} />Text</button>
            <button type="button" onClick={() => { onToolChange('manualSwing'); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><Zap size={14} />Manual swing path</button>
          </div>

          {activeTool === 'ballShadow' && (
            <div style={{ marginTop: 10 }}>
              <div style={secLabel}>Ball trail</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['comet', 'arc', 'strobe'] as BallTrailMode[]).map((m) => (
                  <button key={m} type="button" onClick={() => onBallTrailModeChange(m)} className={`tool-btn flex-row gap-1 ${ballTrailMode === m ? 'active' : ''}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {panel === 'view' && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" onClick={() => { onToolChange('zoom'); setPanel(null); }} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3"><ZoomIn size={14} />Zoom & pan</button>
            {onResetCropZoom ? (
              <button type="button" onClick={() => onResetCropZoom()} className="tool-btn flex-row gap-1 min-h-11 w-full justify-start px-3">
                Reset zoom
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
