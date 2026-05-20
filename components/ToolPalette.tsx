'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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
  Layers,
  ChevronLeft,
  ChevronRight,
  Palette,
  LayoutGrid,
  Video,
  Crosshair,
  Camera,
  Sparkles,
  Link2,
  Home,
  PanelLeftOpen,
  PanelLeftClose,
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
  onObjMultiplierCapture?: () => void;
  onObjMultiplierClear?: () => void;
  objMultiplierActive?: boolean;
  objMultiplierProgress?: string | null;
  onCircleSpinningChange?: (spinning: boolean) => void;
  outlineEraserSize?: number;
  onOutlineEraserSizeChange?: (size: number) => void;
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
  /** When true, skeleton pose still runs but overlay is hidden */
  skeletonOverlayPaused?: boolean;
  onSkeletonOverlayPausedChange?: () => void;
  ballSampleMode?: boolean;
  onBallSampleModeChange?: (v: boolean) => void;
  onResetCropZoom?: () => void;
  /** Webcam PiP: turn camera on/off (must be synchronous-friendly for Safari). */
  onToggleWebcam?: () => void;
  /** Mobile: Coach Now–style precision draw (optional) */
  precisionDrawEnabled?: boolean;
  onPrecisionDrawToggle?: () => void;
  onShowPrecisionInstructions?: () => void;
  /** Below 768px: icon-only rail (narrow); desktop keeps labels */
  iconOnlyLayout?: boolean;
  /** Mobile floating toolbar: transparent shell over video */
  mobileChrome?: boolean;
  /** Recording Hub body (embedded in toolbar navigation). */
  recordingHubContent?: React.ReactNode;
  /** Desktop: toolbar rail is icon-only when collapsed. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  showCollapseControl?: boolean;
  /** Full workspace reset (videos + drawings). */
  onCleanSession?: () => void;
  /** Mobile: denser icon targets to maximize canvas. */
  denseMobile?: boolean;
  /** Compare mode: which video panel receives markup / undo / clear. */
  markupTarget?: 'A' | 'B' | 'both';
  onMarkupTargetChange?: (t: 'A' | 'B' | 'both') => void;
  hasCompareVideo?: boolean;
  /** After a shape is committed, toolbar shows contextual style controls (no popup). */
  drawContextActive?: boolean;
  onExitDrawContext?: () => void;
  onOpenDrawContext?: () => void;
  /** Desktop 9:16 — same compact icon-only rail as phone. */
  phoneLayout?: boolean;
  /** Mobile + desktop 9:16 compact toolbar with expand/collapse labels. */
  compactToolbarChrome?: boolean;
  toolbarLabelsExpanded?: boolean;
  onToggleToolbarLabels?: () => void;
}

const PRESET_COLORS = ['#FFFFFF', '#111827', '#DC2626', '#2563EB'] as const;

type NavScreen =
  | 'home'
  | 'recording'
  | 'style'
  | 'draw'
  | 'drawContext'
  | 'angle'
  | 'skeleton'
  | 'webcam'
  | 'multiplier'
  | 'more';

const TOOLBAR_ICON_PROPS = {
  color: '#FFFFFF',
  strokeWidth: 2.25,
  style: { filter: 'drop-shadow(0 0 1px #000) drop-shadow(0 1px 0 #000)' },
} as const;

function ToolbarIcon({ children, size = 18 }: { children: React.ReactElement; size?: number }) {
  return React.cloneElement(children, {
    size,
    ...TOOLBAR_ICON_PROPS,
  });
}

function ThicknessPxBar({
  value,
  onChange,
  vertical,
}: {
  value: number;
  onChange: (v: number) => void;
  vertical?: boolean;
}) {
  if (!vertical) {
    return (
      <input
        type="range"
        min={1}
        max={12}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', marginTop: 4 }}
      />
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        padding: '4px 0 8px',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: '#6B7280' }}>PX</span>
      <input
        type="range"
        min={1}
        max={12}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Line thickness"
        style={{
          width: 28,
          height: 96,
          margin: 0,
          accentColor: '#35679A',
          WebkitAppearance: 'slider-vertical' as React.CSSProperties['WebkitAppearance'],
          writingMode: 'vertical-lr',
          direction: 'rtl',
        }}
      />
      <span style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', lineHeight: 1 }}>{value}</span>
    </div>
  );
}

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
  background: 'transparent',
  borderRadius: 12,
  overflow: 'hidden',
  animation: 'coachlabToolbarScreenIn 200ms ease-out',
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

function scrollAreaFor(io: boolean, mobileChrome?: boolean): React.CSSProperties {
  let base = scrollArea;
  if (io) base = { ...scrollArea, padding: '6px 4px 10px', gap: 4 };
  if (mobileChrome) {
    return {
      ...base,
      paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 0px))',
    };
  }
  return base;
}

function rowBase(active: boolean, io?: boolean, dense?: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: io ? 0 : 10,
    width: '100%',
    minHeight: dense ? 34 : io ? 40 : 44,
    padding: dense ? '4px 2px' : io ? '6px 4px' : '10px 12px',
    borderRadius: 10,
    border: active ? '1px solid #35679A' : '1px solid rgba(255,255,255,0.25)',
    background: active ? 'rgba(53,103,154,0.2)' : 'rgba(255,255,255,0.12)',
    color: '#1A1A1A',
    cursor: 'pointer',
    textAlign: io ? 'center' : 'left',
    fontSize: 14,
    fontWeight: 600,
    touchAction: 'manipulation',
    transition: 'transform 0.12s ease, background 0.12s ease, border-color 0.12s ease',
  };
  if (io) {
    return { ...base, justifyContent: 'center' };
  }
  return base;
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
    onObjMultiplierCapture,
    onObjMultiplierClear,
    objMultiplierActive = false,
    objMultiplierProgress,
    onCircleSpinningChange,
    outlineEraserSize = 0,
    onOutlineEraserSizeChange,
    webcamPipMode,
    onWebcamPipModeChange,
    webcamOpacity,
    onWebcamOpacityChange,
    webcamActive,
    webcamCutout,
    onWebcamCutoutChange,
    onToggleWebcam,
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
    skeletonOverlayPaused = false,
    onSkeletonOverlayPausedChange,
    ballSampleMode,
    onBallSampleModeChange,
    precisionDrawEnabled = false,
    onPrecisionDrawToggle,
    onShowPrecisionInstructions,
    iconOnlyLayout = false,
    mobileChrome = false,
    recordingHubContent,
    collapsed = false,
    onToggleCollapsed,
    showCollapseControl = false,
    onCleanSession,
    denseMobile = false,
    markupTarget = 'A',
    onMarkupTargetChange,
    hasCompareVideo = false,
    drawContextActive = false,
    onExitDrawContext,
    onOpenDrawContext,
    phoneLayout = false,
    compactToolbarChrome = false,
    toolbarLabelsExpanded = false,
    onToggleToolbarLabels,
  } = props;

  const useVerticalThickness = Boolean(compactToolbarChrome || mobileChrome || phoneLayout);
  const iconOnlyMode = compactToolbarChrome
    ? !toolbarLabelsExpanded
    : Boolean(iconOnlyLayout || mobileChrome || collapsed || phoneLayout);
  const io = iconOnlyMode;
  const shellStyle: React.CSSProperties = {
    ...shell,
    background: mobileChrome ? 'rgba(255,255,255,0.15)' : 'transparent',
    backdropFilter: mobileChrome ? 'blur(10px)' : undefined,
    WebkitBackdropFilter: mobileChrome ? 'blur(10px)' : undefined,
    boxShadow: 'none',
    border: 'none',
  };

  const [navStack, setNavStack] = useState<NavScreen[]>(['home']);
  const top = navStack[navStack.length - 1];
  const { pressedKey, fire } = useTapScale();

  const pop = useCallback(() => {
    setNavStack((s) => (s.length > 1 ? s.slice(0, -1) : ['home']));
  }, []);
  const push = useCallback((x: NavScreen) => {
    setNavStack((s) => [...s, x]);
  }, []);
  useEffect(() => {
    const id = 'coachlab-toolbar-keyframes';
    if (typeof document === 'undefined' || document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent =
      '@keyframes coachlabToolbarScreenIn{from{opacity:.92;transform:translateX(8px)}to{opacity:1;transform:none}}';
    document.head.appendChild(el);
  }, []);
  const resetNav = useCallback(() => setNavStack(['home']), []);

  useEffect(() => {
    if (!drawContextActive) {
      setNavStack((s) => (s.includes('drawContext') ? s.filter((x) => x !== 'drawContext') : s));
    }
  }, [drawContextActive]);

  const outlineEraserEligible =
    activeTool !== 'select' &&
    activeTool !== 'zoom' &&
    activeTool !== 'skeleton' &&
    activeTool !== 'ballShadow' &&
    activeTool !== 'objectMultiplier';
  const animatedOutlineEligible = outlineEraserEligible;

  const setTool = (t: ToolType) => onToolChange(t);

  const iconBox = denseMobile ? 20 : io ? 24 : 26;

  const ToolbarLead = () => (
    <>
      {compactToolbarChrome && onToggleToolbarLabels ? (
        <button
          type="button"
          aria-label={toolbarLabelsExpanded ? 'Collapse toolbar labels' : 'Expand toolbar labels'}
          style={{
            ...rowBase(false, true, denseMobile),
            transform: pressedKey === 'expand' ? 'scale(0.95)' : undefined,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            fire('expand', onToggleToolbarLabels);
          }}
        >
          <ToolbarIcon size={denseMobile ? 18 : 20}>
            {toolbarLabelsExpanded ? <PanelLeftClose /> : <PanelLeftOpen />}
          </ToolbarIcon>
        </button>
      ) : null}
      <Link
        href="/"
        aria-label="Back to Control Panel"
        style={{
          ...rowBase(false, io, denseMobile),
          textDecoration: 'none',
          color: 'inherit',
        }}
        onPointerDown={() => haptic()}
      >
        <span
          style={{
            display: 'flex',
            width: iconBox,
            height: iconBox,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ToolbarIcon size={denseMobile ? 16 : 18}>
            <Home />
          </ToolbarIcon>
        </span>
        {io ? null : <span style={{ fontSize: 14, fontWeight: 700, color: '#35679A' }}>Control Panel</span>}
      </Link>
    </>
  );

  const CollapseControl = () =>
    showCollapseControl && onToggleCollapsed ? (
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: denseMobile ? '2px 2px 4px' : '4px 4px 6px',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          aria-label={collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
          style={{
            ...rowBase(false, true, denseMobile),
            width: denseMobile ? 32 : 36,
            minHeight: denseMobile ? 28 : 32,
            padding: 0,
            justifyContent: 'center',
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            fire('collapse', onToggleCollapsed);
          }}
        >
          {collapsed ? <ChevronRight size={denseMobile ? 16 : 18} /> : <ChevronLeft size={denseMobile ? 16 : 18} />}
        </button>
      </div>
    ) : null;

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
    if (io) {
      return (
        <button
          type="button"
          aria-label={sub ? `${label} — ${sub}` : label}
          style={{
            ...rowBase(!!active, true, denseMobile),
            transform: pressed ? 'scale(0.95)' : undefined,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            fire(k, onPress);
          }}
        >
          <span
            style={{
              display: 'flex',
              width: iconBox,
              height: iconBox,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ToolbarIcon size={denseMobile ? 16 : io ? 20 : 18}>{icon as React.ReactElement}</ToolbarIcon>
          </span>
        </button>
      );
    }
    return (
      <button
        type="button"
        style={{
          ...rowBase(!!active, false, denseMobile),
          transform: pressed ? 'scale(0.95)' : undefined,
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          fire(k, onPress);
        }}
      >
        <span style={{ display: 'flex', width: 26, justifyContent: 'center' }}>
          <ToolbarIcon size={18}>{icon as React.ReactElement}</ToolbarIcon>
        </span>
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
    onBack,
  }: {
    title: string;
    icon: React.ReactNode;
    onBack?: () => void;
  }) => (
    <>
      <button
        type="button"
        aria-label="Back"
        style={{
          ...rowBase(false, io),
          background: '#fff',
          borderColor: '#E8E6E1',
          fontWeight: 700,
          color: '#35679A',
          ...(io ? { minHeight: 40, padding: '6px 4px' } : {}),
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          fire(`back-${title}`, () => {
            onBack?.();
            pop();
          });
        }}
      >
        {io ? <ChevronLeft size={22} strokeWidth={2.25} /> : (
          <>
            <ChevronLeft size={20} />
            Back
          </>
        )}
      </button>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: io ? 'center' : 'flex-start',
          gap: io ? 6 : 10,
          padding: io ? '6px 2px 4px' : '10px 4px 4px',
          color: '#111827',
          fontWeight: 800,
          fontSize: io ? 0 : 15,
          position: 'relative',
        }}
      >
        <span style={{ color: '#35679A', display: 'flex', alignItems: 'center' }}>{icon}</span>
        {io ? (
          <span
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: 'hidden',
              clip: 'rect(0,0,0,0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          >
            {title}
          </span>
        ) : (
          title
        )}
      </div>
    </>
  );

  const chk = (
    key: string,
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    icon?: React.ReactNode,
  ) => (
    <label
      key={key}
      aria-label={label}
      aria-checked={checked}
      role="checkbox"
      style={{
        ...rowBase(checked, io),
        cursor: 'pointer',
        transform: pressedKey === key ? 'scale(0.95)' : undefined,
        position: 'relative',
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        fire(key, () => onChange(!checked));
      }}
    >
      {io && icon ? (
        <span
          style={{
            display: 'flex',
            width: 28,
            height: 28,
            alignItems: 'center',
            justifyContent: 'center',
            color: checked ? '#35679A' : '#4B5563',
          }}
        >
          {icon}
        </span>
      ) : (
        <>
          <input
            type="checkbox"
            readOnly
            checked={checked}
            tabIndex={-1}
            aria-hidden
            style={{ width: 18, height: 18, accentColor: '#35679A' }}
          />
          {icon ? (
            <span
              style={{
                display: 'flex',
                width: 26,
                justifyContent: 'center',
                color: checked ? '#35679A' : '#4B5563',
              }}
            >
              {icon}
            </span>
          ) : null}
          {io ? (
            <span
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: 'hidden',
                clip: 'rect(0,0,0,0)',
                whiteSpace: 'nowrap',
                border: 0,
              }}
            >
              {label}
            </span>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
          )}
        </>
      )}
    </label>
  );

  /* ── Screens ───────────────────────────────────────────────────────── */

  if (top === 'recording' && recordingHubContent) {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <div style={scrollAreaFor(io, mobileChrome)}>
          <ToolbarLead />
          <BackHeader title="Session & record" icon={<LayoutGrid size={18} />} />
          {recordingHubContent}
        </div>
      </div>
    );
  }

  if (top === 'style') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <div style={scrollAreaFor(io, mobileChrome)}>
          <ToolbarLead />
          <BackHeader title="Default style" icon={<Palette size={18} />} />
          <p style={{ margin: '0 4px 10px', fontSize: 11, lineHeight: 1.45, color: '#6B7280' }}>
            Sets the look for your next mark. Tap a finished shape on the video to edit it there.
          </p>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 4px 0' }}>
            Preset colors
          </div>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              style={{
                ...rowBase(drawingOptions.color === c, io),
                justifyContent: io ? 'center' : 'flex-start',
                transform: pressedKey === `c-${c}` ? 'scale(0.95)' : undefined,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                fire(`c-${c}`, () => onOptionsChange({ color: c }));
              }}
            >
              <span
                style={{
                  width: io ? 26 : 22,
                  height: io ? 26 : 22,
                  borderRadius: 6,
                  background: c,
                  border: drawingOptions.color === c ? '2px solid #35679A' : '1px solid #E5E5E5',
                }}
              />
              {io ? null : c}
            </button>
          ))}
          <label style={{ ...rowBase(false, io), cursor: 'pointer' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Custom</span>
            <input
              type="color"
              value={drawingOptions.color}
              onChange={(e) => onOptionsChange({ color: e.target.value })}
              style={{ marginLeft: 'auto', width: 44, height: 32, border: 'none', background: 'transparent' }}
            />
          </label>
          <ThicknessPxBar
            value={drawingOptions.lineWidth}
            onChange={(v) => onOptionsChange({ lineWidth: v })}
            vertical={useVerticalThickness}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              type="button"
              aria-label="Solid line"
              style={{ ...rowBase(!drawingOptions.dashed, io), flex: 1, justifyContent: 'center' }}
              onPointerDown={(e) => {
                e.preventDefault();
                fire('solid', () => onOptionsChange({ dashed: false }));
              }}
            >
              {io ? '━' : 'Solid line'}
            </button>
            <button
              type="button"
              aria-label="Dashed line"
              style={{ ...rowBase(!!drawingOptions.dashed, io), flex: 1, justifyContent: 'center' }}
              onPointerDown={(e) => {
                e.preventDefault();
                fire('dash', () => onOptionsChange({ dashed: true }));
              }}
            >
              {io ? '┅' : 'Dashed'}
            </button>
          </div>
          {onCircleSpinningChange && animatedOutlineEligible &&
            chk(
              'spin',
              'Highlight pulse',
              !!circleSpinning,
              onCircleSpinningChange,
              <Sparkles size={18} strokeWidth={2} />,
            )}
          {onOutlineEraserSizeChange && outlineEraserEligible && (
            <>
              {chk(
                'oe',
                'Erase part of line',
                outlineEraserSize > 0,
                (v) => onOutlineEraserSizeChange(v ? 15 : 0),
                <Eraser size={18} strokeWidth={2} />,
              )}
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

  const MarkStyleControls = (
    <>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#9CA3AF',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          padding: '10px 4px 6px',
          borderTop: '1px solid #F0EDE8',
          marginTop: 6,
        }}
      >
        Mark style
      </div>
      {PRESET_COLORS.map((c) => (
        <button
          key={`dc-${c}`}
          type="button"
          aria-label={`Color ${c}`}
          style={{
            ...rowBase(drawingOptions.color === c, io),
            justifyContent: io ? 'center' : 'flex-start',
            transform: pressedKey === `dc-${c}` ? 'scale(0.95)' : undefined,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            fire(`dc-${c}`, () => onOptionsChange({ color: c }));
          }}
        >
          <span
            style={{
              width: io ? 26 : 22,
              height: io ? 26 : 22,
              borderRadius: 6,
              background: c,
              border: drawingOptions.color === c ? '2px solid #35679A' : '1px solid #E5E5E5',
            }}
          />
          {io ? null : c}
        </button>
      ))}
      <ThicknessPxBar
        value={drawingOptions.lineWidth}
        onChange={(v) => onOptionsChange({ lineWidth: v })}
        vertical={useVerticalThickness}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          type="button"
          aria-label="Solid line"
          style={{ ...rowBase(!drawingOptions.dashed, io), flex: 1, justifyContent: 'center' }}
          onPointerDown={(e) => {
            e.preventDefault();
            fire('dc-solid', () => onOptionsChange({ dashed: false }));
          }}
        >
          {io ? '━' : 'Solid'}
        </button>
        <button
          type="button"
          aria-label="Dashed line"
          style={{ ...rowBase(!!drawingOptions.dashed, io), flex: 1, justifyContent: 'center' }}
          onPointerDown={(e) => {
            e.preventDefault();
            fire('dc-dash', () => onOptionsChange({ dashed: true }));
          }}
        >
          {io ? '┅' : 'Dashed'}
        </button>
      </div>
      {onCircleSpinningChange &&
        chk(
          'dc-spin',
          'Highlight pulse',
          !!circleSpinning,
          onCircleSpinningChange,
          <Sparkles size={18} strokeWidth={2} />,
        )}
      {onOutlineEraserSizeChange && (
        <>
          {chk(
            'dc-oe',
            'Erase part of line',
            outlineEraserSize > 0,
            (v) => onOutlineEraserSizeChange(v ? 15 : 0),
            <Eraser size={18} strokeWidth={2} />,
          )}
          {outlineEraserSize > 0 && (
            <div style={{ padding: '0 8px' }}>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>Eraser ({outlineEraserSize}px)</div>
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
    </>
  );

  if (top === 'draw') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <div style={scrollAreaFor(io, mobileChrome)}>
          <ToolbarLead />
          <BackHeader title="Draw" icon={<Pen size={18} />} />
          <Row k="pen" active={activeTool === 'pen'} icon={<Pen size={18} />} label="Pen" onPress={() => setTool('pen')} />
          <Row k="arrow" active={activeTool === 'arrow'} icon={<ArrowRight size={18} />} label="Arrow" onPress={() => setTool('arrow')} />
          <Row k="line" active={activeTool === 'line'} icon={<Minus size={18} />} label="Line" onPress={() => setTool('line')} />
          <Row k="rect" active={activeTool === 'rect'} icon={<Square size={18} />} label="Rectangle" onPress={() => setTool('rect')} />
          <Row k="circle" active={activeTool === 'circle'} icon={<Circle size={18} />} label="Circle" onPress={() => setTool('circle')} />
          <div data-tour-id="tour-angle">
            <Row k="angle-d" active={activeTool === 'angle'} icon={<Activity size={18} />} label="Angle" onPress={() => setTool('angle')} />
          </div>
          <Row k="sw" active={activeTool === 'manualSwing'} icon={<Zap size={18} />} label="Swing path" onPress={() => setTool('manualSwing')} />
          <Row k="jc" active={activeTool === 'jointChain'} icon={<Link2 size={18} />} label="Joint chain" onPress={() => setTool('jointChain')} />
          <Row k="text" active={activeTool === 'text'} icon={<Type size={18} />} label="Text" onPress={() => setTool('text')} />
          <Row
            k="st-d"
            active={drawContextActive}
            icon={<Palette size={18} />}
            label="Style"
            onPress={() => onOpenDrawContext?.()}
          />
          {drawContextActive ? MarkStyleControls : null}
        </div>
      </div>
    );
  }

  if (top === 'angle') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <div style={scrollAreaFor(io, mobileChrome)}>
          <BackHeader title="Angle" icon={<Activity size={18} />} />
          <Row k="angle" active={activeTool === 'angle'} icon={<Triangle size={18} />} label="Angle" onPress={() => setTool('angle')} />
          <Row k="aa" active={activeTool === 'arrowAngle'} icon={<Activity size={18} />} label="Arrow Angle" onPress={() => setTool('arrowAngle')} />
        </div>
      </div>
    );
  }

  if (top === 'skeleton') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <div style={scrollAreaFor(io, mobileChrome)}>
          <BackHeader title="Skeleton" icon={<PersonStanding size={18} />} />
          {onSkeletonOverlayPausedChange !== undefined && (
            <label
              key="sov"
              aria-label="Skeleton on/off"
              style={{
                ...rowBase(!skeletonOverlayPaused, io),
                cursor: 'pointer',
                transform: pressedKey === 'sov' ? 'scale(0.95)' : undefined,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                fire('sov', () => onSkeletonOverlayPausedChange());
              }}
            >
              <input type="checkbox" readOnly checked={!skeletonOverlayPaused} style={{ width: 18, height: 18 }} />
              {io ? (
                <span
                  style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: 'hidden',
                    clip: 'rect(0,0,0,0)',
                    whiteSpace: 'nowrap',
                    border: 0,
                  }}
                >
                  Skeleton on
                </span>
              ) : (
                <span style={{ fontSize: 13, fontWeight: 600 }}>Skeleton on/off</span>
              )}
            </label>
          )}
          <p style={{ margin: '0 4px 8px', fontSize: 12, lineHeight: 1.45, color: '#6B7280' }}>
            AI pose overlay follows the player. Keep the video playing for best results.
          </p>
          <button
            type="button"
            style={{ ...rowBase(false, io), color: '#C2410C', borderColor: '#FED7AA', background: '#FFF7ED' }}
            onPointerDown={(e) => {
              e.preventDefault();
              fire('reskel', () => onResetSkeleton());
            }}
          >
            <RefreshCw size={18} />
            Refresh pose overlay
          </button>
          {onSkeletonShowAnglesChange !== undefined &&
            chk('sa', 'Show angle labels', skeletonShowAngles ?? true, onSkeletonShowAnglesChange)}
          {onSkeletonShowHeadLineChange !== undefined &&
            chk('sh', 'Show head line', skeletonShowHeadLine ?? false, onSkeletonShowHeadLineChange)}
          {onSkeletonClassicColorsChange !== undefined &&
            chk(
              'sc',
              skeletonClassicColors ?? true ? 'Colourful skeleton' : 'Simple blue skeleton',
              skeletonClassicColors ?? true,
              onSkeletonClassicColorsChange,
            )}
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

  if (top === 'webcam') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <div style={scrollAreaFor(io, mobileChrome)}>
          <BackHeader title="Webcam" icon={<Camera size={18} />} />
          {onToggleWebcam ? (
            <Row
              k="wct"
              icon={<Camera size={18} />}
              label={webcamActive ? 'Turn camera off' : 'Turn camera on'}
              onPress={() => {
                fire('wct', () => onToggleWebcam());
              }}
            />
          ) : null}
          {onWebcamCutoutChange !== undefined &&
            chk('wcbg', 'Background removal', !!webcamCutout, (v) => onWebcamCutoutChange(v))}
          {onWebcamOpacityChange !== undefined && (
            <div style={{ padding: '4px 8px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280' }}>
                Opacity ({Math.round((webcamOpacity ?? 1) * 100)}%)
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round((webcamOpacity ?? 1) * 100)}
                onChange={(e) => onWebcamOpacityChange(Number(e.target.value) / 100)}
                style={{ width: '100%', accentColor: '#35679A' }}
              />
            </div>
          )}
          {onWebcamPipModeChange !== undefined && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', padding: '6px 4px 0' }}>
                PiP shape
              </div>
              {(['rectangle', 'circle'] as WebcamPipMode[]).map((m) => (
                <Row
                  key={m}
                  k={`wcp-${m}`}
                  active={webcamPipMode === m}
                  icon={<Camera size={16} />}
                  label={m.charAt(0).toUpperCase() + m.slice(1)}
                  onPress={() => {
                    fire(`wcp-${m}`, () => onWebcamPipModeChange(m));
                  }}
                />
              ))}
            </>
          )}
          <p style={{ margin: '4px 4px 0', fontSize: 12, lineHeight: 1.45, color: '#6B7280' }}>
            Drag the PiP on the canvas to move it. Safari: choose Window or Screen and pick this browser window when sharing for capture.
          </p>
        </div>
      </div>
    );
  }

  if (top === 'more') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <div style={scrollAreaFor(io, mobileChrome)}>
          <BackHeader title="More tools" icon={<LayoutGrid size={18} />} />
          <p style={{ margin: '0 4px 8px', fontSize: 12, color: '#6B7280' }}>More tools will return in a future update.</p>
        </div>
      </div>
    );
  }

  // V2 — Racket Multiplier
  // if (top === 'multiplier') {
  //   const frameChoices = [3, 5, 8, 10] as const;
  //   return (
  //     <div style={shellStyle}>
  //       <div style={scrollAreaFor(io, mobileChrome)}>
  //         <BackHeader title="Racket multiplier" icon={<Layers size={18} />} />
  //         <p style={{ margin: '0 4px 8px', fontSize: 13, fontWeight: 600, color: '#7C3AED', lineHeight: 1.4 }}>
  //           Highlight the racket region across frames
  //         </p>
  //         <p style={{ margin: '0 4px 12px', fontSize: 12, color: '#6B7280', lineHeight: 1.45 }}>
  //           Drag a rectangle on the video to select the racket area. Frames are captured at 10 fps from the current time, with background softened on each frame.
  //         </p>
  //         <div style={{ padding: '4px 8px' }}>
  //           <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>Frames to overlay</div>
  //           <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
  //             {frameChoices.map((n) => (
  //               <button
  //                 key={n}
  //                 type="button"
  //                 style={{
  //                   ...rowBase(objMultiplierFrameCount === n, io),
  //                   flex: '1 1 40%',
  //                   justifyContent: 'center',
  //                   minHeight: 40,
  //                 }}
  //                 onPointerDown={(e) => {
  //                   e.preventDefault();
  //                   fire(`frm-${n}`, () => onObjMultiplierFrameCountChange?.(n));
  //                 }}
  //               >
  //                 {n}
  //               </button>
  //             ))}
  //           </div>
  //         </div>
  //         {!objMultiplierActive ? (
  //           <p style={{ fontSize: 12, color: '#B45309', fontWeight: 600, margin: '4px 8px', lineHeight: 1.4 }}>
  //             No region yet — drag on the video to select the racket area first.
  //           </p>
  //         ) : null}
  //         {objMultiplierProgress ? (
  //           <p style={{ fontSize: 12, color: '#7C3AED', fontWeight: 600, margin: '4px 8px' }}>{objMultiplierProgress}</p>
  //         ) : null}
  //         <Row k="cap" icon={<Layers size={18} />} label="Capture frames" onPress={() => onObjMultiplierCapture?.()} />
  //         <Row k="clr" icon={<RefreshCw size={18} />} label="Clear overlay" onPress={() => onObjMultiplierClear?.()} />
  //       </div>
  //     </div>
  //   );
  // }

  /* ── Home ─────────────────────────────────────────────────────────── */
  return (
    <div style={shellStyle}>
      <CollapseControl />
      <div style={scrollAreaFor(io, mobileChrome)}>
        <ToolbarLead />
        {recordingHubContent ? (
          <div data-tour-id="recording-hub" style={phoneLayout || mobileChrome ? { display: 'flex', flexDirection: 'column', gap: 4 } : undefined}>
            <Row
              k="cp"
              icon={<LayoutGrid size={denseMobile ? 16 : 20} />}
              label="Session & record"
              onPress={() => push('recording')}
            />
          </div>
        ) : null}
        <Row k="sel-h" active={activeTool === 'select'} icon={<MousePointer2 size={denseMobile ? 16 : 18} />} label="Select" onPress={() => { onExitDrawContext?.(); setTool('select'); }} />
        <div data-tour-id="tour-draw-tools">
          <Row k="dr" icon={<Pen size={denseMobile ? 16 : 20} />} label="Draw" onPress={() => push('draw')} />
        </div>
        <div data-tour-id="tour-skeleton">
          <Row
            k="sk"
            icon={<PersonStanding size={denseMobile ? 16 : 20} />}
            label="Skeleton"
            onPress={() => { onExitDrawContext?.(); setTool('skeleton'); push('skeleton'); }}
          />
        </div>
        {onPrecisionDrawToggle ? (
          <div data-tour-id="tour-precision">
            <Row
              k="prec"
              active={precisionDrawEnabled}
              icon={<Crosshair size={denseMobile ? 16 : 20} />}
              label="Precision"
              onPress={() => onPrecisionDrawToggle()}
            />
          </div>
        ) : null}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.2)', margin: '8px 0' }} />
        <Row k="u" icon={<Undo2 size={denseMobile ? 16 : 20} />} label="Undo" onPress={onUndo} />
        <Row k="r" icon={<Redo2 size={denseMobile ? 16 : 20} />} label="Redo" onPress={onRedo} />
        <Row k="cl" icon={<Trash2 size={denseMobile ? 16 : 20} />} label="Clear all" onPress={onClear} />
        {onCleanSession ? (
          <button
            type="button"
            aria-label="Clean session"
            style={{
              ...rowBase(false, io, denseMobile),
              color: '#9a3412',
              borderColor: '#fca5a5',
              background: io ? 'rgba(254,226,226,0.35)' : '#FFF7ED',
              transform: pressedKey === 'clean' ? 'scale(0.95)' : undefined,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              fire('clean', onCleanSession);
            }}
          >
            {io ? (
              <span
                style={{
                  display: 'flex',
                  width: iconBox,
                  height: iconBox,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RefreshCw size={denseMobile ? 16 : 18} />
              </span>
            ) : (
              <>
                <span style={{ display: 'flex', width: 26, justifyContent: 'center', color: '#9a3412' }}>
                  <RefreshCw size={18} />
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>New session</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}
