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
  Layers,
  ChevronLeft,
  ChevronRight,
  Palette,
  LayoutGrid,
  Video,
  Crosshair,
  Sparkles,
  Home,
  GripHorizontal,
  BarChart3,
  FolderOpen,
  Ruler,
  Camera,
  ZoomIn,
  ZoomOut,
  Maximize2,
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
  /** Save analysis report to player history. */
  onSaveReport?: () => void;
  saveReportEnabled?: boolean;
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
  /** Stromotion panel content (full workflow UI). */
  stroMotionPanel?: React.ReactNode;
  /** Biomechanics analysis panel (V1 primary workflow). */
  biomechanicsPanel?: React.ReactNode;
  /** Called when the user navigates to a toolbar screen. */
  onNavigate?: (screen: 'home' | 'recording' | 'style' | 'draw' | 'drawContext' | 'angle' | 'skeleton' | 'tools' | 'stromotion' | 'aimetrics' | 'framecapture' | 'webcam') => void;
  /** @deprecated Use stroMotionPanel — legacy toggle only */
  stroMotionEnabled?: boolean;
  onStroMotionToggle?: () => void;
  /** Auth button slot (rendered at bottom of every screen's footer) */
  authContent?: React.ReactNode;
  /** Quick screenshot → docs. When provided, shows a camera button in the footer. */
  onScreenshotSave?: () => void;
  /** True while screenshot save is in progress */
  screenshotSaving?: boolean;
  /** Canvas zoom controls */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}

const PRESET_COLORS = ['#FFFFFF', '#1D1D1F', '#FF3B30', '#007AFF'] as const;

// Tools surfaced on the Draw sub-screen. Used so opening Draw highlights a tool
// (and so leaving Draw can return the canvas to a neutral select state).
const DRAW_SCREEN_TOOLS: ToolType[] = [
  'pen', 'line', 'arrow', 'angle', 'arrowAngle', 'rect', 'circle', 'manualSwing', 'jointChain', 'text', 'ruler',
];

type NavScreen =
  | 'home'
  | 'recording'
  | 'style'
  | 'draw'
  | 'drawContext'
  | 'angle'
  | 'skeleton'
  | 'tools'
  | 'stromotion'
  | 'aimetrics'
  | 'framecapture'
  | 'webcam';

const TOOLBAR_ICON_PROPS = {
  strokeWidth: 2,
  color: 'currentColor',
} as const;

function ToolbarIcon({ children, size = 18 }: { children: React.ReactElement; size?: number }) {
  return React.cloneElement(children, {
    size,
    ...TOOLBAR_ICON_PROPS,
  });
}

function ToolbarChevron({ expanded }: { expanded: boolean }) {
  const size = 18;
  return expanded ? (
    <ChevronLeft size={size} strokeWidth={2} />
  ) : (
    <ChevronRight size={size} strokeWidth={2} />
  );
}

function svgIconProps(size: number) {
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const, 'aria-hidden': true };
}

function AngleToolIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...svgIconProps(size)}>
      <path d="M4 20 A16 16 0 0 1 20 20" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M4 20 L4 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 20 L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ArrowAngleToolIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...svgIconProps(size)}>
      <path d="M4 20 A16 16 0 0 1 20 20" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M4 20 L4 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 20 L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 14 L20 14 L20 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 14 L14 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SwingPathIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...svgIconProps(size)}>
      <path d="M4 17 C7 7, 13 7, 16 13 S20 17, 20 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="4" cy="17" r="1.75" fill="currentColor" />
      <path d="M18 15 L20 17 L18 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function JointChainIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...svgIconProps(size)}>
      <circle cx="6" cy="17" r="2.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="7" r="2.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="17" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 15.5 L10.5 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M13.5 9.5 L16 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── Body-part icons ─────────────────────────────────────────────────────────

function RightArmIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...svgIconProps(size)}>
      {/* shoulder → elbow → wrist going right */}
      <circle cx="4" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="20" cy="13" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <line x1="6" y1="10" x2="10" y2="7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="7.5" x2="18" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LeftArmIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...svgIconProps(size)}>
      <circle cx="20" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="4" cy="13" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <line x1="18" y1="10" x2="14" y2="7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="10" y1="7.5" x2="6" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RightLegIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...svgIconProps(size)}>
      {/* hip → knee → ankle going right-down */}
      <circle cx="8" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="13" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="20" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <line x1="9.5" y1="5.5" x2="12" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="13.5" x2="17" y2="18.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LeftLegIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...svgIconProps(size)}>
      <circle cx="16" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="11" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6" cy="20" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <line x1="14.5" y1="5.5" x2="12" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="10" y1="13.5" x2="7" y2="18.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RecordHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...svgIconProps(size)}>
      <rect x="3" y="6" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M17 10 L21 8 V16 L17 14 Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none" />
      <circle cx="10" cy="12" r="2.75" fill="#FF3B30" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
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
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--cl-text-muted)' }}>PX</span>
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
          accentColor: 'var(--cl-accent)',
          WebkitAppearance: 'slider-vertical' as React.CSSProperties['WebkitAppearance'],
          writingMode: 'vertical-lr',
          direction: 'rtl',
        }}
      />
      <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--cl-text-muted)', lineHeight: 1 }}>{value}</span>
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
  if (io) base = { ...scrollArea, padding: '6px 4px 10px', gap: 4, alignItems: 'center' };
  if (mobileChrome) {
    base = {
      ...base,
      paddingBottom: 'calc(8px + var(--coachlab-install-banner-height, 0px))',
    };
  }
  return base;
}

function ToolbarScrollArea({
  io,
  mobileChrome,
  children,
}: {
  io: boolean;
  mobileChrome?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={io ? 'coachlab-toolbar-scroll coachlab-toolbar-scroll--icon-only' : 'coachlab-toolbar-scroll'}
      style={scrollAreaFor(io, mobileChrome)}
    >
      {children}
    </div>
  );
}

function rowBase(active: boolean, pressed: boolean, io?: boolean, dense?: boolean): React.CSSProperties {
  const compact = io || dense;
  let background = '#FFFFFF';
  let color = '#1D1D1F';
  let border = '1px solid #D1D1D6';

  if (active) {
    background = '#007AFF';
    color = '#FFFFFF';
    border = '1px solid #007AFF';
  } else if (pressed) {
    background = '#DCEBFF';
    color = '#007AFF';
    border = '1px solid #D1D1D6';
  }

  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: io ? 8 : 10,
    width: '100%',
    minHeight: 44,
    padding: compact ? (io ? '8px 10px' : '8px 12px') : '10px 12px',
    borderRadius: 10,
    border,
    background,
    color,
    cursor: 'pointer',
    textAlign: io ? 'left' : 'left',
    fontSize: 13,
    fontWeight: 500,
    touchAction: 'manipulation',
    transition: 'transform 0.12s ease, background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  };
  if (io) {
    return {
      ...base,
      boxSizing: 'border-box',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 0,
      width: 44,
      height: 44,
      minHeight: 44,
      maxHeight: 44,
      margin: '0 auto',
      gap: 0,
      overflow: 'hidden',
      whiteSpace: 'normal',
    };
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
    onSaveReport,
    saveReportEnabled = false,
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
    stroMotionPanel,
    biomechanicsPanel,
    onNavigate,
    stroMotionEnabled = false,
    onStroMotionToggle,
    authContent,
    onScreenshotSave,
    screenshotSaving = false,
    onZoomIn,
    onZoomOut,
    onZoomReset,
  } = props;

  const iconOnlyMode = compactToolbarChrome
    ? !toolbarLabelsExpanded
    : Boolean(iconOnlyLayout || mobileChrome || collapsed || phoneLayout);
  const io = iconOnlyMode;
  const useVerticalThickness = Boolean((compactToolbarChrome || phoneLayout) && !mobileChrome && !io);
  const rb = (active: boolean, pressed: boolean, iconOnly = io, dense = denseMobile || iconOnly): React.CSSProperties =>
    rowBase(active, pressed, iconOnly, dense);
  const textMuted = '#6E6E73';
  const textSubtle = '#8E8E93';
  const shellStyle: React.CSSProperties = {
    ...shell,
    ...(mobileChrome ? { flex: 1, minHeight: 0 } : null),
    background: 'transparent',
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
    onNavigate?.(x);
  }, [onNavigate]);
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

  const iconBox = denseMobile || io ? 20 : 26;

  const GlobalActionsFooter = () => (
    <div
      style={{
        flexShrink: 0,
        paddingBottom: mobileChrome
          ? 'calc(4px + env(safe-area-inset-bottom, 0px) + var(--coachlab-install-banner-height, 0px))'
          : undefined,
      }}
    >
      <div style={{ height: 1, background: '#D1D1D6', margin: '8px 0' }} />
      {onScreenshotSave ? (
        <Row
          k="screenshot"
          icon={screenshotSaving
            ? <span style={{ width: denseMobile || io ? 16 : 20, height: denseMobile || io ? 16 : 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={denseMobile || io ? 16 : 20} height={denseMobile || io ? 16 : 20} style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
                </svg>
              </span>
            : <Camera size={denseMobile || io ? 16 : 20} />
          }
          label={screenshotSaving ? 'Saving…' : 'Screenshot'}
          onPress={screenshotSaving ? () => {} : onScreenshotSave}
        />
      ) : null}
      <Row k="u" icon={<Undo2 size={denseMobile || io ? 16 : 20} />} label="Undo" onPress={onUndo} />
      <Row k="r" icon={<Redo2 size={denseMobile || io ? 16 : 20} />} label="Redo" onPress={onRedo} />
      <Row k="cl" destructive icon={<Trash2 size={denseMobile || io ? 16 : 20} />} label="Clear all" onPress={onClear} />
      {onCleanSession ? (
        <button
          type="button"
          aria-label="Clear session"
          data-destructive="true"
          style={{
            ...rb(false, pressedKey === 'clean', io, denseMobile || io),
            color: '#FF3B30',
            borderColor: '#D1D1D6',
            background: pressedKey === 'clean' ? '#FFECEC' : '#FFFFFF',
            transform: pressedKey === 'clean' ? 'scale(0.95)' : undefined,
            ...(io ? { width: 44, height: 44, minHeight: 44, maxHeight: 44, margin: '0 auto', padding: 0, justifyContent: 'center' } : null),
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            fire('clean', onCleanSession);
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
            <RefreshCw size={denseMobile || io ? 16 : 18} />
          </span>
          {io ? null : <span style={{ fontSize: 13, fontWeight: 500 }}>Clear session</span>}
        </button>
      ) : null}
      <Link
        href="/"
        aria-label="Control Panel"
        style={{
          ...rb(false, false, io, denseMobile),
          textDecoration: 'none',
          color: 'inherit',
          ...(io ? { width: 44, height: 44, minHeight: 44, maxHeight: 44, margin: '0 auto', padding: 0, justifyContent: 'center' } : null),
        }}
        onPointerDown={() => haptic()}
      >
        <span style={{ display: 'flex', width: iconBox, height: iconBox, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ToolbarIcon size={denseMobile ? 16 : 18}><Home /></ToolbarIcon>
        </span>
        {io ? null : <span style={{ fontSize: 13, fontWeight: 500 }}>Control Panel</span>}
      </Link>
      {authContent ? <div style={{ marginTop: 4 }}>{authContent}</div> : null}
    </div>
  );

  const ToolbarLead = () => (
    <>
      {/* Logo */}
      <div style={{ display: 'flex', justifyContent: io ? 'center' : 'flex-start', padding: io ? '2px 0' : '2px 4px 6px' }}>
        {io
          ? <img src="/logo-square.png" alt="CoachLab" style={{ width: 36, height: 36, borderRadius: 7 }} />
          : <img src="/logo-rect.png" alt="CoachLab.ai" style={{ height: 24, width: 'auto' }} />
        }
      </div>
      {!showCollapseControl && (compactToolbarChrome || mobileChrome || phoneLayout) && onToggleToolbarLabels ? (
        <button
          type="button"
          aria-label={toolbarLabelsExpanded ? 'Collapse toolbar labels' : 'Expand toolbar labels'}
          style={{
            ...rb(false, pressedKey === 'expand', io, denseMobile),
            justifyContent: 'center',
            transform: pressedKey === 'expand' ? 'scale(0.95)' : undefined,
            ...(io ? { width: 44, height: 44, minHeight: 44, maxHeight: 44, margin: '0 auto', padding: 0 } : null),
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            fire('expand', onToggleToolbarLabels);
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
            <ToolbarChevron expanded={toolbarLabelsExpanded} />
          </span>
        </button>
      ) : null}
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
            ...rb(false, pressedKey === 'collapse', io, denseMobile),
            boxSizing: 'border-box',
            width: io ? 44 : denseMobile ? 36 : 40,
            height: io ? 44 : undefined,
            minHeight: 44,
            maxHeight: io ? 44 : undefined,
            padding: 0,
            justifyContent: 'center',
            margin: io ? '0 auto' : undefined,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            fire('collapse', onToggleCollapsed);
          }}
        >
          <ChevronRight size={18} strokeWidth={2} style={{ display: collapsed ? 'block' : 'none' }} />
          <ChevronLeft size={18} strokeWidth={2} style={{ display: collapsed ? 'none' : 'block' }} />
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
    destructive,
  }: {
    k: string;
    active?: boolean;
    icon: React.ReactNode;
    label: string;
    onPress: () => void;
    sub?: string;
    destructive?: boolean;
  }) => {
    const pressed = pressedKey === k;
    const rowStyle = {
      ...rb(!!active, pressed, io, denseMobile),
      ...(destructive && !active
        ? {
            color: '#FF3B30',
            background: pressed ? '#FFECEC' : '#FFFFFF',
            borderColor: '#D1D1D6',
          }
        : null),
      transform: pressed ? 'scale(0.95)' : undefined,
      justifyContent: io ? ('center' as const) : ('flex-start' as const),
      ...(io ? { width: 44, height: 44, minHeight: 44, maxHeight: 44, margin: '0 auto', padding: 0 } : null),
    };
    if (io) {
      return (
        <button
          type="button"
          aria-label={sub ? `${label} — ${sub}` : label}
          data-active={active ? 'true' : undefined}
          data-destructive={destructive ? 'true' : undefined}
          style={rowStyle}
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
            {icon}
          </span>
        </button>
      );
    }
    return (
      <button
        type="button"
        data-active={active ? 'true' : undefined}
        data-destructive={destructive ? 'true' : undefined}
        style={rowStyle}
        onPointerDown={(e) => {
          e.preventDefault();
          fire(k, onPress);
        }}
      >
        <span style={{ display: 'flex', width: 26, justifyContent: 'center', flexShrink: 0 }}>
          {icon}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 0 }}>
          <span style={{ lineHeight: 1.2, fontSize: 13, fontWeight: 500 }}>{label}</span>
          {sub ? <span style={{ fontSize: 11, fontWeight: 400, color: textMuted }}>{sub}</span> : null}
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
          ...rb(false, pressedKey === `back-${title}`, io, denseMobile),
          ...(io ? { width: 44, height: 44, minHeight: 44, padding: 0, justifyContent: 'center' } : null),
          fontWeight: 600,
          fontSize: io ? undefined : 16,
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          fire(`back-${title}`, () => {
            onBack?.();
            pop();
          });
        }}
      >
        {io ? <ChevronLeft size={18} strokeWidth={2} /> : (
          <>
            <ChevronLeft size={18} strokeWidth={2} />
            Back
          </>
        )}
      </button>
      {!io ? (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 10,
          padding: '10px 4px 4px',
          color: '#1D1D1F',
          fontWeight: 600,
          fontSize: 16,
          position: 'relative',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', color: 'currentColor' }}>{icon}</span>
        {title}
      </div>
      ) : null}
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
        ...rb(checked, pressedKey === key, io),
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
            color: checked ? '#FFFFFF' : '#1D1D1F',
          }}
        >
          {icon}
        </span>
      ) : (
        <>
          {!io ? (
            <input
              type="checkbox"
              readOnly
              checked={checked}
              tabIndex={-1}
              aria-hidden
              style={{ width: 18, height: 18, accentColor: '#007AFF' }}
            />
          ) : null}
          {icon ? (
            <span
              style={{
                display: 'flex',
                width: io ? 28 : 26,
                height: io ? 28 : undefined,
                justifyContent: 'center',
                alignItems: 'center',
                color: checked ? '#FFFFFF' : '#1D1D1F',
              }}
            >
              {icon}
            </span>
          ) : null}
          {io ? null : (
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
        <ToolbarScrollArea io={io} mobileChrome={mobileChrome}>
          <ToolbarLead />
          <BackHeader title="Recording Hub" icon={<RecordHubIcon size={18} />} />
          {recordingHubContent}
        </ToolbarScrollArea>
        <GlobalActionsFooter />
      </div>
    );
  }

  if (top === 'style') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <ToolbarScrollArea io={io} mobileChrome={mobileChrome}>
          <ToolbarLead />
          <BackHeader title="Default style" icon={<Palette size={18} />} />
          {!io ? (
          <>
          <p style={{ margin: '0 4px 10px', fontSize: 11, lineHeight: 1.45, color: textMuted }}>
            Sets the look for your next mark. Tap a finished shape on the video to edit it there.
          </p>
          <div style={{ fontSize: 11, fontWeight: 700, color: textSubtle, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 4px 0' }}>
            Preset colors
          </div>
          </>
          ) : null}
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              style={{
                ...rb(drawingOptions.color === c, pressedKey === `c-${c}`, io),
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
                  border: drawingOptions.color === c ? '2px solid #007AFF' : '1px solid #D1D1D6',
                }}
              />
              {io ? null : c}
            </button>
          ))}
          <label style={{ ...rb(false, false, io), cursor: 'pointer', ...(io ? { justifyContent: 'center' } : null) }}>
            {io ? null : <span style={{ fontSize: 13, fontWeight: 600 }}>Custom</span>}
            <input
              type="color"
              value={drawingOptions.color}
              onChange={(e) => onOptionsChange({ color: e.target.value })}
              style={{ marginLeft: io ? 0 : 'auto', width: io ? 32 : 44, height: io ? 32 : 32, border: 'none', background: 'transparent' }}
            />
          </label>
          <ThicknessPxBar
            value={drawingOptions.lineWidth}
            onChange={(v) => onOptionsChange({ lineWidth: v })}
            vertical={useVerticalThickness}
          />
          <div style={{ display: 'flex', gap: io ? 4 : 8, marginTop: 6, ...(io ? { justifyContent: 'center' } : null) }}>
            <button
              type="button"
              aria-label="Solid line"
              style={{ ...rb(!drawingOptions.dashed, pressedKey === 'solid', io), flex: io ? undefined : 1, justifyContent: 'center', ...(io ? { width: 44, height: 44, minHeight: 44, padding: 0 } : null) }}
              onPointerDown={(e) => {
                e.preventDefault();
                fire('solid', () => onOptionsChange({ dashed: false }));
              }}
            >
              {io ? <Minus size={18} strokeWidth={2} /> : 'Solid line'}
            </button>
            <button
              type="button"
              aria-label="Dashed line"
              style={{ ...rb(!!drawingOptions.dashed, pressedKey === 'dash', io), flex: io ? undefined : 1, justifyContent: 'center', ...(io ? { width: 44, height: 44, minHeight: 44, padding: 0 } : null) }}
              onPointerDown={(e) => {
                e.preventDefault();
                fire('dash', () => onOptionsChange({ dashed: true }));
              }}
            >
              {io ? <GripHorizontal size={18} strokeWidth={2} /> : 'Dashed'}
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
              {outlineEraserSize > 0 && !io && (
                <div style={{ padding: '0 8px' }}>
                  <div style={{ fontSize: 12, color: textMuted, marginBottom: 4 }}>Eraser size ({outlineEraserSize}px)</div>
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
          {activeTool === 'text' && !io && (
            <div style={{ padding: '4px 8px 0' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: textSubtle, textTransform: 'uppercase', marginBottom: 4 }}>Text size</div>
              <input
                type="range"
                min={10}
                max={72}
                step={2}
                value={drawingOptions.fontSize}
                onChange={(e) => onOptionsChange({ fontSize: Number(e.target.value) })}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: 12, color: textMuted, marginTop: 4 }}>{drawingOptions.fontSize}px</div>
            </div>
          )}
        </ToolbarScrollArea>
        <GlobalActionsFooter />
      </div>
    );
  }

  if (top === 'draw') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <ToolbarScrollArea io={io} mobileChrome={mobileChrome}>
          <ToolbarLead />
          <BackHeader title="Draw" icon={<Pen size={18} />} onBack={() => { onExitDrawContext?.(); setTool('select'); }} />
          <Row k="pen" active={activeTool === 'pen'} icon={<Pen size={18} />} label="Pen" onPress={() => setTool('pen')} />
          <Row k="line" active={activeTool === 'line'} icon={<Minus size={18} />} label="Line" onPress={() => setTool('line')} />
          <Row k="arrow" active={activeTool === 'arrow'} icon={<ArrowRight size={18} />} label="Arrow" onPress={() => setTool('arrow')} />
          <div data-tour-id="tour-angle">
            <Row k="angle-d" active={activeTool === 'angle'} icon={<AngleToolIcon size={18} />} label="Angle" onPress={() => setTool('angle')} />
          </div>
          <Row k="aa-d" active={activeTool === 'arrowAngle'} icon={<ArrowAngleToolIcon size={18} />} label="Angle arrow" onPress={() => setTool('arrowAngle')} />
          <Row k="rect" active={activeTool === 'rect'} icon={<Square size={18} />} label="Rectangle" onPress={() => setTool('rect')} />
          <Row k="circle" active={activeTool === 'circle'} icon={<Circle size={18} />} label="Circle" onPress={() => setTool('circle')} />
          <Row k="sw" active={activeTool === 'manualSwing'} icon={<SwingPathIcon size={18} />} label="Swing path" onPress={() => setTool('manualSwing')} />
          <Row k="jc" active={activeTool === 'jointChain'} icon={<JointChainIcon size={18} />} label="Joint chain" onPress={() => setTool('jointChain')} />
          <Row k="text" active={activeTool === 'text'} icon={<Type size={18} />} label="Text" onPress={() => setTool('text')} />
          <Row k="ruler" active={activeTool === 'ruler'} icon={<Ruler size={18} />} label="Ruler" onPress={() => setTool('ruler')} />
          <Row
            k="st-d"
            icon={<Palette size={18} />}
            label="Style"
            onPress={() => push('style')}
          />
        </ToolbarScrollArea>
        <GlobalActionsFooter />
      </div>
    );
  }

  if (top === 'angle') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <ToolbarScrollArea io={io} mobileChrome={mobileChrome}>
          <BackHeader title="Angle" icon={<AngleToolIcon size={18} />} />
          <Row k="angle" active={activeTool === 'angle'} icon={<AngleToolIcon size={18} />} label="Angle" onPress={() => setTool('angle')} />
          <Row k="aa" active={activeTool === 'arrowAngle'} icon={<ArrowAngleToolIcon size={18} />} label="Angle arrow" onPress={() => setTool('arrowAngle')} />
        </ToolbarScrollArea>
        <GlobalActionsFooter />
      </div>
    );
  }

  if (top === 'skeleton') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <ToolbarScrollArea io={io} mobileChrome={mobileChrome}>
          <BackHeader title="Skeleton" icon={<PersonStanding size={18} />} />
          {/* On/Off toggle */}
          {onSkeletonOverlayPausedChange !== undefined && (
            <Row
              k="sov"
              active={!skeletonOverlayPaused}
              icon={<PersonStanding size={io ? 18 : 20} />}
              label="Skeleton on / off"
              onPress={() => onSkeletonOverlayPausedChange()}
            />
          )}
          {/* Refresh */}
          <Row
            k="reskel"
            icon={<RefreshCw size={io ? 16 : 18} />}
            label="Refresh pose overlay"
            onPress={() => onResetSkeleton()}
            destructive
          />
          {/* Style options */}
          {onSkeletonShowAnglesChange !== undefined &&
            chk('sa', 'Show angle labels', skeletonShowAngles ?? true, onSkeletonShowAnglesChange, <Activity size={18} strokeWidth={2} />)}
          {onSkeletonClassicColorsChange !== undefined &&
            chk(
              'sc',
              skeletonClassicColors ?? true ? 'Colourful' : 'Simple blue',
              skeletonClassicColors ?? true,
              onSkeletonClassicColorsChange,
              <Palette size={18} strokeWidth={2} />,
            )}
          {onSkeletonShowHeadLineChange !== undefined &&
            chk('sh', 'Head line', skeletonShowHeadLine ?? false, onSkeletonShowHeadLineChange, <Minus size={18} strokeWidth={2} />)}
          {/* Body parts — each on its own row */}
          {onSkeletonShowRightArmChange !== undefined &&
            chk('ra', 'Right arm', skeletonShowRightArm ?? true, onSkeletonShowRightArmChange, <RightArmIcon size={18} />)}
          {onSkeletonShowLeftArmChange !== undefined &&
            chk('la', 'Left arm', skeletonShowLeftArm ?? true, onSkeletonShowLeftArmChange, <LeftArmIcon size={18} />)}
          {onSkeletonShowRightLegChange !== undefined &&
            chk('rl', 'Right leg', skeletonShowRightLeg ?? true, onSkeletonShowRightLegChange, <RightLegIcon size={18} />)}
          {onSkeletonShowLeftLegChange !== undefined &&
            chk('ll', 'Left leg', skeletonShowLeftLeg ?? true, onSkeletonShowLeftLegChange, <LeftLegIcon size={18} />)}
          {!io ? (
            <p style={{ margin: '4px 4px 0', fontSize: 11, lineHeight: 1.45, color: textMuted }}>
              Pose follows the player live. Works best with an uploaded video file.
            </p>
          ) : null}
        </ToolbarScrollArea>
        <GlobalActionsFooter />
      </div>
    );
  }

  if (top === 'tools') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <ToolbarScrollArea io={io} mobileChrome={mobileChrome}>
          <BackHeader title="Tools" icon={<LayoutGrid size={18} />} />
          <Row k="met-t" icon={<BarChart3 size={18} />} label="Metrics" onPress={() => push('aimetrics')} />
          <Row k="sm-t" icon={<Layers size={18} />} label="Stromotion" onPress={() => { onExitDrawContext?.(); push('stromotion'); }} />
        </ToolbarScrollArea>
        <GlobalActionsFooter />
      </div>
    );
  }

  if (top === 'stromotion') {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <ToolbarScrollArea io={io} mobileChrome={mobileChrome}>
          <BackHeader title="Stromotion" icon={<Layers size={18} />} />
          {stroMotionPanel ?? (
            <>
              {onStroMotionToggle ? (
                <Row
                  k="sm-on"
                  active={stroMotionEnabled}
                  icon={<Layers size={18} />}
                  label="Stromotion"
                  onPress={() => onStroMotionToggle()}
                />
              ) : null}
              {!io ? (
                <p style={{ margin: '0 4px 8px', fontSize: 12, lineHeight: 1.45, color: textMuted }}>
                  Overlay ghost frames across a clip segment. Works with uploaded video files.
                </p>
              ) : null}
            </>
          )}
        </ToolbarScrollArea>
        <GlobalActionsFooter />
      </div>
    );
  }

  if (top === 'aimetrics') {
    const metricIcon = denseMobile || io ? 16 : 18;
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <ToolbarScrollArea io={io} mobileChrome={mobileChrome}>
          <ToolbarLead />
          <BackHeader title="Metrics" icon={<BarChart3 size={18} />} />

          {/* Skeleton sub-screen */}
          <Row
            k="sk-met"
            active={activeTool === 'skeleton'}
            icon={<PersonStanding size={metricIcon} />}
            label="Skeleton"
            onPress={() => { setTool('skeleton'); push('skeleton'); }}
          />

          {!io && (
            <div style={{ fontSize: 11, fontWeight: 700, color: textSubtle, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 4px 2px' }}>
              Auto measurements
            </div>
          )}

          <Row k="m-shoulder" icon={<AngleToolIcon size={metricIcon} />} label="Shoulder angle" onPress={() => { setTool('arrowAngle'); }} />
          <Row k="m-hip" icon={<AngleToolIcon size={metricIcon} />} label="Hip angle" onPress={() => { setTool('arrowAngle'); }} />
          <Row k="m-diff" icon={<Activity size={metricIcon} />} label="Shoulder–Hip diff" onPress={() => {}} />
          <Row k="m-foot-dir" icon={<ArrowRight size={metricIcon} />} label="Foot direction" onPress={() => { setTool('arrowAngle'); }} />
          <Row k="m-head" icon={<Minus size={metricIcon} />} label="Head direction" onPress={() => { setTool('arrowAngle'); }} />
          <Row k="m-foot-dist" icon={<Ruler size={metricIcon} />} label="Foot distance" onPress={() => { setTool('ruler'); }} />

          {!io && (
            <div style={{ fontSize: 11, fontWeight: 700, color: textSubtle, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 4px 2px' }}>
              Manual measurements
            </div>
          )}

          <Row k="m-racket" icon={<ArrowAngleToolIcon size={metricIcon} />} label="Racket angle" onPress={() => { setTool('arrowAngle'); }} />
          <Row k="m-stringbed" icon={<Crosshair size={metricIcon} />} label="Stringbed direction" onPress={() => { setTool('arrowAngle'); }} />

          {!io && (
            <div style={{ height: 1, background: '#D1D1D6', margin: '8px 0' }} />
          )}

          {/* Frame Capture toggle — shows green balls + biomech panel */}
          <Row
            k="m-capture"
            active={!!biomechanicsPanel}
            icon={<Camera size={metricIcon} />}
            label="Frame Capture"
            onPress={() => { push('framecapture'); }}
          />
        </ToolbarScrollArea>
        <GlobalActionsFooter />
      </div>
    );
  }

  if (top === ('framecapture')) {
    return (
      <div style={shellStyle}>
        <CollapseControl />
        <ToolbarScrollArea io={io} mobileChrome={mobileChrome}>
          <BackHeader title="Frame Capture" icon={<Camera size={18} />} />
          {biomechanicsPanel ?? (
            !io ? (
              <p style={{ margin: '0 4px 8px', fontSize: 12, lineHeight: 1.45, color: textMuted }}>
                Add green balls on the timeline to capture frozen frames with measurements.
              </p>
            ) : null
          )}
        </ToolbarScrollArea>
        <GlobalActionsFooter />
      </div>
    );
  }

  /* ── Home ─────────────────────────────────────────────────────────── */
  return (
    <div style={shellStyle}>
      <CollapseControl />
      <ToolbarScrollArea io={io} mobileChrome={mobileChrome}>
        <ToolbarLead />
        <Row k="sel-h" active={activeTool === 'select'} icon={<MousePointer2 size={denseMobile ? 16 : 18} />} label="Select" onPress={() => { onExitDrawContext?.(); setTool('select'); }} />
        <div data-tour-id="tour-draw-tools" style={io ? { display: 'flex', justifyContent: 'center', width: '100%' } : undefined}>
          <Row k="dr" icon={<Pen size={denseMobile ? 16 : 20} />} label="Draw" onPress={() => { if (!DRAW_SCREEN_TOOLS.includes(activeTool)) setTool('pen'); push('draw'); }} />
        </div>
        <Row
          k="met-h"
          active={activeTool === 'skeleton'}
          icon={<BarChart3 size={denseMobile ? 16 : 20} />}
          label="Metrics"
          onPress={() => { onExitDrawContext?.(); push('aimetrics'); }}
        />
        <Row
          k="sm-h"
          icon={<Layers size={denseMobile ? 16 : 20} />}
          label="Stromotion"
          onPress={() => { onExitDrawContext?.(); push('stromotion'); }}
        />
        {recordingHubContent ? (
          <div data-tour-id="recording-hub" style={phoneLayout || mobileChrome ? { display: 'flex', flexDirection: 'column', gap: 4 } : undefined}>
            <Row
              k="cp"
              icon={<RecordHubIcon size={denseMobile ? 16 : 20} />}
              label="Recording Hub"
              onPress={() => push('recording')}
            />
          </div>
        ) : null}
      </ToolbarScrollArea>
      <GlobalActionsFooter />
    </div>
  );
}
