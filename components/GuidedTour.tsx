'use client';

/**
 * GuidedTour — 14-step spotlight onboarding with welcome screen on first visit.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

interface TourStep {
  target: string;
  title: string;
  description: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** Omit on desktop (e.g. precision mode). */
  mobileOnly?: boolean;
}

const ALL_STEPS: ReadonlyArray<TourStep> = [
  {
    target: 'tour-upload',
    title: 'Upload Video',
    description: 'Load any video from your device for analysis.',
    placement: 'bottom',
  },
  {
    target: 'tour-publer',
    title: 'Load from Publer',
    description:
      'Use Publer to load videos from YouTube, Instagram, or TikTok without downloading manually.',
    placement: 'bottom',
  },
  {
    target: 'tour-video-ab',
    title: 'Video A and B',
    description:
      'Load two videos side by side to compare technique between sessions or players.',
    placement: 'top',
  },
  {
    target: 'playback-dock',
    title: 'Playback controls',
    description: 'Play, pause, and control your video with precision.',
    placement: 'top',
  },
  {
    target: 'tour-timeline',
    title: 'Timeline and scrubber',
    description: 'Drag the scrubber to navigate to any moment in the video instantly.',
    placement: 'top',
  },
  {
    target: 'tour-frame-controls',
    title: 'Frame by frame',
    description:
      'Step through the video one frame at a time for detailed technical analysis.',
    placement: 'top',
  },
  {
    target: 'tour-draw-tools',
    title: 'Draw tools',
    description:
      'Pen, arrows, body chains, and shapes — use Quick markup on the toolbar home for one-tap access.',
    placement: 'right',
  },
  {
    target: 'tour-joint-chain',
    title: 'Body chain',
    description:
      'Build a manual joint chain for biomechanics: tap each joint, then double-tap to finish. Drag joints later with Select.',
    placement: 'right',
  },
  {
    target: 'tour-angle',
    title: 'Angle tool',
    description: 'Tap three points (corner, side, side) to measure an angle on the athlete.',
    placement: 'right',
  },
  {
    target: 'tour-style',
    title: 'Default style',
    description:
      'Set colour and thickness for your next mark. After drawing, use the floating card on the video to tweak that shape.',
    placement: 'right',
  },
  {
    target: 'tour-skeleton',
    title: 'Skeleton overlay',
    description: 'Overlay a pose skeleton on the athlete to analyse body position and movement.',
    placement: 'right',
  },
  {
    target: 'tour-zoom',
    title: 'Zoom and pan',
    description: 'Zoom into any part of the video and drag to explore the detail.',
    placement: 'left',
  },
  {
    target: 'tour-webcam',
    title: 'Webcam overlay',
    description:
      'Add your webcam for coach commentary with optional background removal.',
    placement: 'left',
  },
  {
    target: 'tour-record-screen',
    title: 'Record Screen',
    description: 'Record your full analysis session as a video to share with your athlete.',
    placement: 'left',
  },
  {
    target: 'tour-precision',
    title: 'Precision mode',
    description:
      'Hold one finger to position the cursor, then tap with a second finger to draw with pixel precision.',
    placement: 'right',
    mobileOnly: true,
  },
];

const Z_OVERLAY = 2_147_483_640;
const Z_TOOLTIP = Z_OVERLAY + 1;
const Z_WELCOME = Z_OVERLAY + 2;
const Z_HELP_BTN = Z_OVERLAY - 1;

const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 12;
const TOOLTIP_GAP = 14;

const LS_KEY = 'coachlab-tour-seen';
const AUTO_SHOW_DELAY_MS = 2_000;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectFromEl(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function viewport() {
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const h = typeof window === 'undefined' ? 768 : window.innerHeight;
  return { w, h };
}

function resolveTooltipPos(
  target: Rect | null,
  tipSize: { w: number; h: number },
  preferred: TourStep['placement'],
): { x: number; y: number; placement: NonNullable<TourStep['placement']> } {
  const vp = viewport();
  const MARGIN = 12;

  if (!target || preferred === 'center') {
    return {
      x: Math.max(MARGIN, (vp.w - tipSize.w) / 2),
      y: Math.max(MARGIN, (vp.h - tipSize.h) / 2),
      placement: 'center',
    };
  }

  type Side = 'top' | 'bottom' | 'left' | 'right';
  const order: Side[] = [];
  if (preferred) order.push(preferred);
  for (const p of ['bottom', 'top', 'right', 'left'] as const) {
    if (!order.includes(p)) order.push(p);
  }

  const fits = (p: Side) => {
    if (p === 'top') return target.y - TOOLTIP_GAP - tipSize.h - MARGIN >= 0;
    if (p === 'bottom') return target.y + target.h + TOOLTIP_GAP + tipSize.h + MARGIN <= vp.h;
    if (p === 'left') return target.x - TOOLTIP_GAP - tipSize.w - MARGIN >= 0;
    if (p === 'right') return target.x + target.w + TOOLTIP_GAP + tipSize.w + MARGIN <= vp.w;
    return true;
  };

  const chosen: NonNullable<TourStep['placement']> = order.find(fits) ?? 'center';
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;

  let x = cx - tipSize.w / 2;
  let y = cy - tipSize.h / 2;

  if (chosen === 'top') y = target.y - TOOLTIP_GAP - tipSize.h;
  if (chosen === 'bottom') y = target.y + target.h + TOOLTIP_GAP;
  if (chosen === 'left') x = target.x - TOOLTIP_GAP - tipSize.w;
  if (chosen === 'right') x = target.x + target.w + TOOLTIP_GAP;

  if (chosen === 'top' || chosen === 'bottom') {
    x = Math.min(Math.max(MARGIN, x), vp.w - tipSize.w - MARGIN);
  } else if (chosen === 'left' || chosen === 'right') {
    y = Math.min(Math.max(MARGIN, y), vp.h - tipSize.h - MARGIN);
  } else {
    x = Math.max(MARGIN, (vp.w - tipSize.w) / 2);
    y = Math.max(MARGIN, (vp.h - tipSize.h) / 2);
  }

  return { x, y, placement: chosen };
}

function useTargetRect(tourId: string | undefined, active: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!active || !tourId || typeof document === 'undefined') {
      setRect(null);
      return;
    }

    let raf = 0;
    let cancelled = false;
    let observed: Element | null = null;
    let ro: ResizeObserver | null = null;

    const update = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour-id="${tourId}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      if (el !== observed) {
        if (ro && observed) ro.unobserve(observed);
        observed = el;
        ro?.observe(el);
      }
      setRect(rectFromEl(el));
    };

    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(update);
      });
    }

    let attempts = 0;
    const probe = () => {
      if (cancelled) return;
      update();
      if (!observed && attempts < 24) {
        attempts += 1;
        raf = requestAnimationFrame(() => window.setTimeout(probe, 50));
      }
    };
    probe();

    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      ro?.disconnect();
    };
  }, [tourId, active]);

  return rect;
}

function useIsMobileTour() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const fn = () => setMobile(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return mobile;
}

type GuidedTourProps = {
  /** When true, ? lives in the canvas zoom cluster (analysis page) — no fixed FAB. */
  suppressFloatingHelp?: boolean;
};

export default function GuidedTour({ suppressFloatingHelp = false }: GuidedTourProps) {
  const [mounted, setMounted] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [seenBefore, setSeenBefore] = useState(true);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tipSize, setTipSize] = useState({ w: 320, h: 200 });
  const maskId = useId().replace(/:/g, '_');
  const isMobile = useIsMobileTour();

  const steps = useMemo(
    () => ALL_STEPS.filter((s) => !s.mobileOnly || isMobile),
    [isMobile],
  );

  useEffect(() => {
    setMounted(true);
    try {
      const seen = window.localStorage.getItem(LS_KEY) === '1';
      setSeenBefore(seen);
      if (!seen) {
        const id = window.setTimeout(() => setWelcomeOpen(true), AUTO_SHOW_DELAY_MS);
        return () => window.clearTimeout(id);
      }
    } catch {
      /* private mode */
    }
  }, []);

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(LS_KEY, '1');
    } catch {
      /* noop */
    }
    setSeenBefore(true);
  }, []);

  const endAll = useCallback(
    (persist: boolean) => {
      setWelcomeOpen(false);
      setTourOpen(false);
      setStepIdx(0);
      if (persist) markSeen();
    },
    [markSeen],
  );

  const startTour = useCallback(() => {
    setWelcomeOpen(false);
    setStepIdx(0);
    setTourOpen(true);
  }, []);

  const openTourFromHelp = useCallback(() => {
    setWelcomeOpen(false);
    setStepIdx(0);
    setTourOpen(true);
  }, []);

  useEffect(() => {
    const onExternalOpen = () => openTourFromHelp();
    window.addEventListener('coachlab-open-guided-tour', onExternalOpen);
    return () => window.removeEventListener('coachlab-open-guided-tour', onExternalOpen);
  }, [openTourFromHelp]);

  const next = useCallback(() => {
    setStepIdx((i) => {
      if (i + 1 >= steps.length) {
        setTourOpen(false);
        markSeen();
        return 0;
      }
      return i + 1;
    });
  }, [markSeen, steps.length]);

  const back = useCallback(() => {
    setStepIdx((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    if (!tourOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endAll(true);
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tourOpen, next, back, endAll]);

  const step = tourOpen ? steps[stepIdx] : null;
  const targetRect = useTargetRect(step?.target, tourOpen);

  useLayoutEffect(() => {
    if (!tourOpen || !tooltipRef.current) return;
    const r = tooltipRef.current.getBoundingClientRect();
    if (Math.abs(r.width - tipSize.w) > 0.5 || Math.abs(r.height - tipSize.h) > 0.5) {
      setTipSize({ w: r.width, h: r.height });
    }
  }, [tourOpen, stepIdx, targetRect, tipSize.w, tipSize.h]);

  const tipPos = useMemo(
    () => resolveTooltipPos(targetRect, tipSize, step?.placement),
    [targetRect, tipSize, step?.placement],
  );

  const spotlight = useMemo(() => {
    if (!targetRect) return null;
    return {
      x: Math.max(0, targetRect.x - SPOTLIGHT_PADDING),
      y: Math.max(0, targetRect.y - SPOTLIGHT_PADDING),
      w: targetRect.w + SPOTLIGHT_PADDING * 2,
      h: targetRect.h + SPOTLIGHT_PADDING * 2,
    };
  }, [targetRect]);

  const helpBottom =
    'calc(var(--coachlab-banner-bottom, 100px) + var(--coachlab-install-banner-height, 0px) + 12px + env(safe-area-inset-bottom, 0px))';

  if (!mounted) return null;

  const helpBtn = (
    <button
      type="button"
      data-tour-id="tour-help"
      aria-label="Open guided tour"
      title="Guided tour"
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          navigator?.vibrate?.(10);
        } catch {
          /* noop */
        }
        openTourFromHelp();
      }}
      style={{
        position: 'fixed',
        right: 'calc(16px + env(safe-area-inset-right, 0px))',
        bottom: helpBottom,
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: '#1A1A1A',
        color: '#FFFFFF',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
        cursor: 'pointer',
        zIndex: Z_HELP_BTN,
        display: welcomeOpen || tourOpen ? 'none' : 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        fontWeight: 700,
        fontFamily: 'inherit',
        animation: !seenBefore && !welcomeOpen && !tourOpen
          ? 'coachlab-tour-pulse 1.6s ease-in-out infinite'
          : 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span aria-hidden="true">?</span>
    </button>
  );

  const welcomeModal = welcomeOpen ? (
    <>
      <div
        role="presentation"
        aria-hidden
        onClick={() => endAll(true)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          zIndex: Z_WELCOME - 1,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coachlab-welcome-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: Z_WELCOME,
          width: 'min(400px, calc(100vw - 32px))',
          background: '#FFFFFF',
          borderRadius: 20,
          padding: 24,
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          color: '#1A1A1A',
          fontFamily: 'inherit',
        }}
      >
        <h2 id="coachlab-welcome-title" style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 800, lineHeight: 1.25 }}>
          Welcome to CoachLab
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: 15, lineHeight: 1.5, color: '#4B5563' }}>
          Let us show you around.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            onClick={startTour}
            style={{
              height: 44,
              borderRadius: 12,
              border: 'none',
              background: '#1A1A1A',
              color: '#fff',
              fontWeight: 700,
              fontSize: 15,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Start Tour
          </button>
          <button
            type="button"
            onClick={() => endAll(true)}
            style={{
              height: 44,
              borderRadius: 12,
              border: '1px solid #E5E5E5',
              background: '#fff',
              color: '#374151',
              fontWeight: 600,
              fontSize: 15,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Skip for now
          </button>
        </div>
      </div>
    </>
  ) : null;

  const tourOverlay =
    tourOpen && step ? (
      <>
        <svg
          aria-hidden="true"
          onClick={() => endAll(true)}
          style={{
            position: 'fixed',
            inset: 0,
            width: '100vw',
            height: '100vh',
            zIndex: Z_OVERLAY,
            cursor: 'pointer',
          }}
        >
          <defs>
            <mask id={maskId}>
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {spotlight && (
                <rect
                  x={spotlight.x}
                  y={spotlight.y}
                  width={spotlight.w}
                  height={spotlight.h}
                  rx={SPOTLIGHT_RADIUS}
                  ry={SPOTLIGHT_RADIUS}
                  fill="black"
                  style={{ transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
                />
              )}
            </mask>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.75)" mask={`url(#${maskId})`} />
          {spotlight && (
            <rect
              x={spotlight.x - 1.5}
              y={spotlight.y - 1.5}
              width={spotlight.w + 3}
              height={spotlight.h + 3}
              rx={SPOTLIGHT_RADIUS + 1.5}
              ry={SPOTLIGHT_RADIUS + 1.5}
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth={1.5}
              style={{
                pointerEvents: 'none',
                transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          )}
        </svg>

        <div
          ref={tooltipRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`tour-title-${stepIdx}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: tipPos.y,
            left: tipPos.x,
            width: 'min(360px, calc(100vw - 24px))',
            zIndex: Z_TOOLTIP,
            background: '#FFFFFF',
            borderRadius: 16,
            padding: 18,
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            border: '1px solid rgba(0,0,0,0.06)',
            color: '#1A1A1A',
            transition:
              'top 300ms cubic-bezier(0.4, 0, 0.2, 1), left 300ms cubic-bezier(0.4, 0, 0.2, 1)',
            fontFamily: 'inherit',
          }}
        >
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.04em' }}>
              Step {stepIdx + 1} of {steps.length}
            </span>
            <button
              type="button"
              onClick={() => endAll(true)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                color: '#6B7280',
                cursor: 'pointer',
                padding: '4px 6px',
                fontFamily: 'inherit',
              }}
            >
              Skip Tour
            </button>
          </div>

          <h3
            id={`tour-title-${stepIdx}`}
            style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, lineHeight: 1.25 }}
          >
            {step.title}
          </h3>
          <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.5, color: '#374151' }}>
            {step.description}
          </p>

          <div
            aria-hidden
            style={{
              height: 4,
              background: '#F3F4F6',
              borderRadius: 999,
              overflow: 'hidden',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${((stepIdx + 1) / steps.length) * 100}%`,
                background: '#1A1A1A',
                transition: 'width 300ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              aria-label="Previous step"
              disabled={stepIdx === 0}
              onClick={back}
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                border: '1px solid #E5E5E5',
                background: '#fff',
                color: stepIdx === 0 ? '#D1D5DB' : '#1A1A1A',
                fontSize: 18,
                cursor: stepIdx === 0 ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ←
            </button>
            <button
              type="button"
              aria-label={stepIdx === steps.length - 1 ? 'Finish tour' : 'Next step'}
              onClick={next}
              style={{
                flex: 1,
                height: 38,
                borderRadius: 10,
                border: '1px solid #1A1A1A',
                background: '#1A1A1A',
                color: '#fff',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {stepIdx === steps.length - 1 ? 'Finish' : 'Next →'}
            </button>
          </div>
        </div>
      </>
    ) : null;

  return createPortal(
    <>
      <style>{`@keyframes coachlab-tour-pulse {
        0%, 100% { box-shadow: 0 6px 24px rgba(0,0,0,0.28), 0 0 0 0 rgba(53,103,154,0.55); }
        50%      { box-shadow: 0 6px 24px rgba(0,0,0,0.28), 0 0 0 14px rgba(53,103,154,0); }
      }`}</style>
      {!suppressFloatingHelp ? helpBtn : null}
      {welcomeModal}
      {tourOverlay}
    </>,
    document.body,
  );
}
