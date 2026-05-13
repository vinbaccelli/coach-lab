'use client';

import React, { useCallback, useRef, useState } from 'react';
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
  TrendingUp,
  Eraser,
  RefreshCw,
  Minus,
  Square,
  Zap,
  ZoomIn,
  Shapes,
  Layers,
  ChevronLeft,
  Palette,
  LayoutGrid,
  Video,
  Crosshair,
} from 'lucide-react';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';

export type BallTrailMode = 'comet' | 'arc' | 'strobe';
export type WebcamPipMode = 'rectangle' | 'circle' | 'hidden';

interface ToolPaletteProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
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
  /** Mobile: Coach Now–style precision draw (optional) */
  precisionDrawEnabled?: boolean;
  onPrecisionDrawToggle?: () => void;
  onShowPrecisionInstructions?: () => void;
}

const PRESET_COLORS = [
  '#1E40AF', '#DC2626', '#16A34A', '#D97706', '#7C3AED',
  '#0891B2', '#EC4899', '#111827', '#FFFFFF',
];

type NavScreen =
  | 'home'
  | 'style'
  | 'draw'
  | 'shapeOpts'
  | 'skeleton'
  | 'view'
  | 'multiplier'
  | 'more';

function haptic() {
  try {
    navigator?.vibrate?.(10);
  } catch {
    /* noop */
  }
}

function useTapScale() {
  const [id, setId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fire = useCallback((key: string, action: () => void) => {
    haptic();
    if (timer.current) clearTimeout(timer.current);
    setId(key);
    action();
    timer.current = setTimeout(() => setId(null), 150);
  }, []);
  return { pressedKey: id, fire };
}

const shell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  minHeight: 0,
  userSelect: 'none',
  background: 'rgba(255,255,255,0.98)',
  borderRadius: 12,
  overflow: 'hidden',
};

const scrollArea: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  WebkitOverflowScrolling: 'touch',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 10px 12px',
};

function rowBase(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: 44,
    padding: '10px 12px',
    borderRadius: 10,
    border: active ? '1px solid #35679A' : '1px solid #E8E6E1',
    background: active ? 'rgba(53,103,154,0.08)' : '#FAF8F5',
    color: '#1A1A1A',
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontSize: 14,
    fontWeight: 600,
    touchAction: 'manipulation',
    transition: 'transform 0.12s ease, background 0.12s ease, border-color 0.12s ease',
  };
}

export default function ToolPalette(props: ToolPaletteProps) {
  const {
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
    onResetCropZoom,
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
    precisionDrawEnabled = false,
    onPrecisionDrawToggle,
    onShowPrecisionInstructions,
  } = props;

  const [navStack, setNavStack] = useState<NavScreen[]>(['home']);
  const top = navStack[navStack.length - 1];
  const { pressedKey, fire } = useTapScale();

  const pop = useCallback(() => {
    setNavStack((s) => (s.length > 1 ? s.slice(0, -1) : ['home']));
  }, []);
  const push = useCallback((x: NavScreen) => {
    setNavStack((s) => [...s, x]);
  }, []);
  const resetNav = useCallback(() => setNavStack(['home']), []);

  const isCircle3d = activeTool === 'bodyCircle';
  const isShapeTool =
    activeTool === 'circle' ||
    activeTool === 'bodyCircle' ||
    activeTool === 'rect' ||
    activeTool === 'triangle';
  const shapeEraserEligible =
    activeTool === 'circle' ||
    activeTool === 'bodyCircle' ||
    (activeTool === 'rect' && !!rect3d) ||
    (activeTool === 'triangle' && !!triangle3d);

  const setTool = (t: ToolType) => onToolChange(t);

  const Row = ({
    k,
    active,
    icon,
    label,
    onPress,
    sub,
  }: {
    k: string;
    active?: boolean;
    icon: React.ReactNode;
    label: string;
    onPress: () => void;
    sub?: string;
  }) => {
    const pressed = pressedKey === k;
    return (
      <button
        type="button"
        style={{
          ...rowBase(!!active),
          transform: pressed ? 'scale(0.95)' : undefined,
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          fire(k, onPress);
        }}
      >
        <span style={{ display: 'flex', width: 26, justifyContent: 'center', color: '#4B5563' }}>{icon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 0 }}>
          <span style={{ lineHeight: 1.2 }}>{label}</span>
          {sub ? <span style={{ fontSize: 11, fontWeight: 500, color: '#6B7280' }}>{sub}</span> : null}
        </span>
      </button>
    );
  };

  const BackHeader = ({
    title,
    icon,
  }: {
    title: string;
    icon: React.ReactNode;
  }) => (
    <>
      <button
        type="button"
        style={{
          ...rowBase(false),
          background: '#fff',
          borderColor: '#E8E6E1',
          fontWeight: 700,
          color: '#35679A',
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          fire(`back-${title}`, pop);
        }}
      >
        <ChevronLeft size={20} />
        Back
      </button>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 4px 4px',
          color: '#111827',
          fontWeight: 800,
          fontSize: 15,
        }}
      >
        <span style={{ color: '#35679A' }}>{icon}</span>
        {title}
      </div>
    </>
  );

  const chk = (
    key: string,
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <label
      key={key}
      style={{
        ...rowBase(checked),
        cursor: 'pointer',
        transform: pressedKey === key ? 'scale(0.95)' : undefined,
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        fire(key, () => onChange(!checked));
      }}
    >
      <input type="checkbox" readOnly checked={checked} style={{ width: 18, height: 18 }} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
    </label>
  );

  /* ── Screens ───────────────────────────────────────────────────────── */

  if (top === 'style') {
    return (
      <div style={shell}>
        <div style={scrollArea}>
          <BackHeader title="Style" icon={<Palette size={18} />} />
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 4px 0' }}>
            Preset colors
          </div>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              style={{
                ...rowBase(drawingOptions.color === c),
                justifyContent: 'flex-start',
                transform: pressedKey === `c-${c}` ? 'scale(0.95)' : undefined,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                fire(`c-${c}`, () => onOptionsChange({ color: c }));
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: c,
                  border: drawingOptions.color === c ? '2px solid #35679A' : '1px solid #E5E5E5',
                }}
              />
              {c}
            </button>
          ))}
          <label style={{ ...rowBase(false), cursor: 'pointer' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Custom</span>
            <input
              type="color"
              value={drawingOptions.color}
              onChange={(e) => onOptionsChange({ color: e.target.value })}
              style={{ marginLeft: 'auto', width: 44, height: 32, border: 'none', background: 'transparent' }}
            />
          </label>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 4px 0' }}>
            Thickness ({drawingOptions.lineWidth}px)
          </div>
          <input
            type="range"
            min={1}
            max={12}
            step={1}
            value={drawingOptions.lineWidth}
            onChange={(e) => onOptionsChange({ lineWidth: Number(e.target.value) })}
            style={{ width: '100%', marginTop: 4 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              type="button"
              style={{ ...rowBase(!drawingOptions.dashed), flex: 1, justifyContent: 'center' }}
              onPointerDown={(e) => {
                e.preventDefault();
                fire('solid', () => onOptionsChange({ dashed: false }));
              }}
            >
              Solid line
            </button>
            <button
              type="button"
              style={{ ...rowBase(!!drawingOptions.dashed), flex: 1, justifyContent: 'center' }}
              onPointerDown={(e) => {
                e.preventDefault();
                fire('dash', () => onOptionsChange({ dashed: true }));
              }}
            >
              Dashed
            </button>
          </div>
          {(activeTool === 'manualSwing' || activeTool === 'swingPath') &&
            chk('arrowEnd', 'Arrow at end of swing path', !!drawingOptions.arrowAtEnd, (v) => onOptionsChange({ arrowAtEnd: v }))}
          {activeTool === 'text' && (
            <div style={{ padding: '4px 8px 0' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 4 }}>Text size</div>
              <input
                type="range"
                min={10}
                max={72}
                step={2}
                value={drawingOptions.fontSize}
                onChange={(e) => onOptionsChange({ fontSize: Number(e.target.value) })}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{drawingOptions.fontSize}px</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (top === 'draw') {
    return (
      <div style={shell}>
        <div style={scrollArea}>
          <BackHeader title="Draw & annotate" icon={<Pen size={18} />} />
          <Row k="pen" active={activeTool === 'pen'} icon={<Pen size={18} />} label="Freehand" onPress={() => { setTool('pen'); resetNav(); }} />
          <Row k="line" active={activeTool === 'line'} icon={<Minus size={18} />} label="Straight line" onPress={() => { setTool('line'); resetNav(); }} />
          <Row k="arrow" active={activeTool === 'arrow'} icon={<ArrowRight size={18} />} label="Arrow" onPress={() => { setTool('arrow'); resetNav(); }} />
          <Row k="erase" active={activeTool === 'erase'} icon={<Eraser size={18} />} label="Eraser" onPress={() => { setTool('erase'); resetNav(); }} />
          <Row
            k="circle"
            active={activeTool === 'circle' || activeTool === 'bodyCircle'}
            icon={<Circle size={18} />}
            label="Circle"
            sub={isCircle3d ? '3D body circle' : '2D circle'}
            onPress={() => {
              setTool(isCircle3d ? 'bodyCircle' : 'circle');
              push('shapeOpts');
            }}
          />
          <Row
            k="rect"
            active={activeTool === 'rect'}
            icon={<Square size={18} />}
            label="Rectangle"
            onPress={() => {
              setTool('rect');
              push('shapeOpts');
            }}
          />
          <Row
            k="tri"
            active={activeTool === 'triangle'}
            icon={<Triangle size={18} />}
            label="Triangle"
            onPress={() => {
              setTool('triangle');
              push('shapeOpts');
            }}
          />
          <Row k="text" active={activeTool === 'text'} icon={<Type size={18} />} label="Text" onPress={() => { setTool('text'); resetNav(); }} />
          <Row k="angle" active={activeTool === 'angle'} icon={<Triangle size={18} />} label="Angle measure" onPress={() => { setTool('angle'); resetNav(); }} />
          <Row k="aa" active={activeTool === 'arrowAngle'} icon={<Activity size={18} />} label="Arrow + angle" onPress={() => { setTool('arrowAngle'); resetNav(); }} />
          <Row k="sw" active={activeTool === 'manualSwing'} icon={<Zap size={18} />} label="Swing path" onPress={() => { setTool('manualSwing'); resetNav(); }} />
        </div>
      </div>
    );
  }

  if (top === 'shapeOpts') {
    const shapeLabel =
      activeTool === 'bodyCircle'
        ? '3D Circle'
        : activeTool === 'circle'
          ? 'Circle'
          : activeTool === 'rect'
            ? 'Rectangle'
            : activeTool === 'triangle'
              ? 'Triangle'
              : 'Shape';
    return (
      <div style={shell}>
        <div style={scrollArea}>
          <BackHeader title={shapeLabel} icon={<Shapes size={18} />} />
          {onCircleSpinningChange && (activeTool === 'circle' || activeTool === 'bodyCircle') &&
            chk('spin', 'Animated outline', !!circleSpinning, onCircleSpinningChange)}
          {activeTool === 'rect' && onRect3dChange &&
            chk('r3d', '3D / perspective rectangle', !!rect3d, onRect3dChange)}
          {activeTool === 'triangle' && onTriangle3dChange &&
            chk('t3d', '3D / perspective triangle', !!triangle3d, onTriangle3dChange)}
          {onOutlineEraserSizeChange && shapeEraserEligible && (
            <>
              {chk('oe', 'Outline eraser', outlineEraserSize > 0, (v) => onOutlineEraserSizeChange(v ? 15 : 0))}
              {outlineEraserSize > 0 && (
                <div style={{ padding: '0 8px' }}>
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>Eraser size ({outlineEraserSize}px)</div>
                  <input
                    type="range"
                    min={5}
                    max={50}
                    step={1}
                    value={outlineEraserSize}
                    onChange={(e) => onOutlineEraserSizeChange(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (top === 'skeleton') {
    return (
      <div style={shell}>
        <div style={scrollArea}>
          <BackHeader title="Skeleton" icon={<PersonStanding size={18} />} />
          <p style={{ margin: '0 4px 8px', fontSize: 12, lineHeight: 1.45, color: '#6B7280' }}>
            AI pose overlay follows the player. Keep the video playing for best results.
          </p>
          <button
            type="button"
            style={{ ...rowBase(false), color: '#C2410C', borderColor: '#FED7AA', background: '#FFF7ED' }}
            onPointerDown={(e) => {
              e.preventDefault();
              fire('reskel', () => onResetSkeleton());
            }}
          >
            <RefreshCw size={18} />
            Reset &amp; re-analyze
          </button>
          {onSkeletonShowAnglesChange !== undefined &&
            chk('sa', 'Show joint angles', skeletonShowAngles ?? true, onSkeletonShowAnglesChange)}
          {onSkeletonShowHeadLineChange !== undefined &&
            chk('sh', 'Show head line', skeletonShowHeadLine ?? false, onSkeletonShowHeadLineChange)}
          {onSkeletonClassicColorsChange !== undefined &&
            chk('sc', 'Neon colors', skeletonClassicColors ?? true, onSkeletonClassicColorsChange)}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', padding: '8px 4px 0' }}>Body parts</div>
          {onSkeletonShowRightArmChange !== undefined &&
            chk('ra', 'Right arm', skeletonShowRightArm ?? true, onSkeletonShowRightArmChange)}
          {onSkeletonShowLeftArmChange !== undefined &&
            chk('la', 'Left arm', skeletonShowLeftArm ?? true, onSkeletonShowLeftArmChange)}
          {onSkeletonShowRightLegChange !== undefined &&
            chk('rl', 'Right leg', skeletonShowRightLeg ?? true, onSkeletonShowRightLegChange)}
          {onSkeletonShowLeftLegChange !== undefined &&
            chk('ll', 'Left leg', skeletonShowLeftLeg ?? true, onSkeletonShowLeftLegChange)}
        </div>
      </div>
    );
  }

  if (top === 'view') {
    return (
      <div style={shell}>
        <div style={scrollArea}>
          <BackHeader title="View" icon={<ZoomIn size={18} />} />
          <Row k="zoom" active={activeTool === 'zoom'} icon={<ZoomIn size={18} />} label="Zoom & pan" onPress={() => { setTool('zoom'); resetNav(); }} />
          {onResetCropZoom ? (
            <Row k="rz" icon={<RefreshCw size={18} />} label="Reset zoom" onPress={() => { onResetCropZoom(); resetNav(); }} />
          ) : null}
        </div>
      </div>
    );
  }

  if (top === 'multiplier') {
    return (
      <div style={shell}>
        <div style={scrollArea}>
          <BackHeader title="Object multiplier" icon={<Layers size={18} />} />
          <p style={{ margin: '0 4px 8px', fontSize: 13, fontWeight: 600, color: '#7C3AED', lineHeight: 1.4 }}>
            Drag to select the object you want to multiply
          </p>
          <p style={{ margin: '0 4px 12px', fontSize: 12, color: '#6B7280', lineHeight: 1.45 }}>
            Draw a dashed rectangle on the video, then tune frames and duration and tap Capture.
          </p>
          <div style={{ padding: '4px 8px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280' }}>Frames: {objMultiplierFrameCount}</div>
            <input
              type="range"
              min={3}
              max={12}
              step={1}
              value={objMultiplierFrameCount}
              onChange={(e) => onObjMultiplierFrameCountChange?.(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ padding: '4px 8px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280' }}>Duration: {objMultiplierDuration}s</div>
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.5}
              value={objMultiplierDuration}
              onChange={(e) => onObjMultiplierDurationChange?.(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          {!objMultiplierActive ? (
            <p style={{ fontSize: 12, color: '#B45309', fontWeight: 600, margin: '4px 8px', lineHeight: 1.4 }}>
              No region yet — drag on the video to select an area first.
            </p>
          ) : null}
          {objMultiplierProgress ? (
            <p style={{ fontSize: 12, color: '#7C3AED', fontWeight: 600, margin: '4px 8px' }}>{objMultiplierProgress}</p>
          ) : null}
          <Row k="cap" icon={<Layers size={18} />} label="Capture frames" onPress={() => onObjMultiplierCapture?.()} />
          <Row k="clr" icon={<RefreshCw size={18} />} label="Clear overlay" onPress={() => onObjMultiplierClear?.()} />
        </div>
      </div>
    );
  }

  if (top === 'more') {
    return (
      <div style={shell}>
        <div style={scrollArea}>
          <BackHeader title="More tools" icon={<LayoutGrid size={18} />} />
          {onAutoSwing ? (
            <Row k="as" icon={<TrendingUp size={18} />} label="Auto swing path" onPress={() => { onAutoSwing(); resetNav(); }} />
          ) : null}
          {onRacketMultiplier ? (
            <Row k="rm" icon={<Video size={18} />} label="Racket trail" onPress={() => { onRacketMultiplier(); resetNav(); }} />
          ) : null}
          <Row k="ball" active={activeTool === 'ballShadow'} icon={<Circle size={18} />} label="Ball shadow / trail" onPress={() => { setTool('ballShadow'); resetNav(); }} />
          {activeTool === 'ballShadow' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 8 }}>
              {(['comet', 'arc', 'strobe'] as BallTrailMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  style={rowBase(ballTrailMode === m)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    fire(`bt-${m}`, () => onBallTrailModeChange(m));
                  }}
                >
                  Trail: {m}
                </button>
              ))}
              <Row k="rbt" icon={<RefreshCw size={16} />} label="Reset ball trail" onPress={() => onResetBallTrail()} />
            </div>
          )}
          {onBallSampleModeChange !== undefined &&
            chk('bsm', 'Ball sample mode', !!ballSampleMode, onBallSampleModeChange)}
        </div>
      </div>
    );
  }

  /* ── Home ─────────────────────────────────────────────────────────── */
  return (
    <div style={shell}>
      <div style={scrollArea}>
        <Row k="sel" active={activeTool === 'select'} icon={<MousePointer2 size={20} />} label="Select" onPress={() => setTool('select')} />
        {onPrecisionDrawToggle ? (
          <Row
            k="prec"
            active={precisionDrawEnabled}
            icon={<Crosshair size={20} />}
            label="Precision draw"
            sub="Crosshair + second finger to tap"
            onPress={() => onPrecisionDrawToggle()}
          />
        ) : null}
        {onShowPrecisionInstructions && precisionDrawEnabled ? (
          <button
            type="button"
            style={{ ...rowBase(false), fontSize: 12, fontWeight: 600, color: '#35679A', borderStyle: 'dashed' }}
            onPointerDown={(e) => {
              e.preventDefault();
              fire('pinst', () => onShowPrecisionInstructions());
            }}
          >
            How precision draw works
          </button>
        ) : null}
        <Row k="st" icon={<Palette size={20} />} label="Style" sub="Color, thickness, line" onPress={() => push('style')} />
        <Row k="dr" icon={<Pen size={20} />} label="Draw & annotate" onPress={() => push('draw')} />
        <Row
          k="sk"
          active={activeTool === 'skeleton'}
          icon={<PersonStanding size={20} />}
          label="Skeleton"
          onPress={() => {
            setTool('skeleton');
            push('skeleton');
          }}
        />
        <Row k="vw" icon={<ZoomIn size={20} />} label="View & zoom" onPress={() => push('view')} />
        <Row
          k="mul"
          active={activeTool === 'objectMultiplier'}
          icon={<Layers size={20} />}
          label="Object multiplier"
          onPress={() => {
            setTool('objectMultiplier');
            push('multiplier');
          }}
        />
        {isShapeTool && (
          <Row k="sho" icon={<Shapes size={20} />} label="Shape options" sub="Outline, 3D, animation" onPress={() => push('shapeOpts')} />
        )}
        <Row k="more" icon={<LayoutGrid size={20} />} label="More" sub="Swing, racket, ball" onPress={() => push('more')} />

        <div style={{ height: 1, background: '#E8E6E1', margin: '8px 0' }} />

        <Row k="u" icon={<Undo2 size={20} />} label="Undo" onPress={onUndo} />
        <Row k="r" icon={<Redo2 size={20} />} label="Redo" onPress={onRedo} />
        <Row k="cl" icon={<Trash2 size={20} />} label="Clear all" onPress={onClear} />
      </div>
    </div>
  );
}
