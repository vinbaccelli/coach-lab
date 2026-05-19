'use client';

/**
 * GuidedTour — spotlight-style onboarding tour.
 *
 * Renders three concerns inside a single React portal mounted on document.body:
 *   1. A persistent floating "?" help button (bottom-right, above where zoom
 *      controls would live).  Pulses on first visit until the tour is opened
 *      or dismissed.
 *   2. A full-viewport dark overlay with an SVG mask cutting a spotlight hole
 *      around the current step's target element.
 *   3. A tooltip card showing the step counter, title, description, progress
 *      bar, and Back / Next / Skip controls.
 *
 * Targets are resolved at run time via `[data-tour-id="..."]` selectors so
 * tour authoring does not depend on internal component class names that may
 * change.  Steps whose target is missing degrade gracefully to a centred
 * tooltip with no spotlight cutout (used for the welcome step).
 *
 * Positioning uses ResizeObserver + window resize/scroll listeners so the
 * spotlight and tooltip stay glued to the target even when the layout
 * reflows mid-tour (e.g. orientation change).
 *
 * Public surface:
 *   <GuidedTour />            — drop into the page; reads localStorage to
 *                               auto-open on first visit after 2 s.
 *
 * localStorage:
 *   coachlab-tour-seen        — written when the tour completes, skips, or is
 *                               dismissed.  Presence ⇒ no auto-show.
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

// ── Tour content ────────────────────────────────────────────────────────────

interface TourStep {
  /** Optional `data-tour-id` to spotlight; undefined ⇒ centred welcome card. */
  target?: string;
  title: string;
  description: string;
  /** Tooltip placement preference; falls back automatically if it would clip. */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const STEPS: ReadonlyArray<TourStep> = [
  {
    title: 'Welcome to Coach Lab',
    description:
      'A two-minute tour of the studio so you can record, analyse, and share lessons in seconds.',
    placement: 'center',
  },
  {
    target: 'load-video',
    title: 'Load a video',
    description:
      'Paste a YouTube, Instagram, or TikTok URL, drop an MP4 here, or pick a file. The video appears in slot A by default.',
    placement: 'bottom',
  },
  {
    target: 'recording-hub',
    title: 'Recording Hub',
    description:
      'Open Recording Hub from the left toolbar for layout, screenshots, screen recording, webcam, mic, and loading videos via Publer or screen record.',
    placement: 'bottom',
  },
  {
    target: 'video-toolbar',
    title: 'Drawing tools',
    description:
      'Pen, lines, shapes, angles, skeleton overlay, and ball trail. The toolbar collapses into icons on phone and 9:16 layouts.',
    placement: 'right',
  },
  {
    target: 'playback-dock',
    title: 'Timeline & playback',
    description:
      'Frame-accurate scrubbing, slow-motion speeds, A/B sync when both slots are loaded, and ⌫ / → keyboard nudges.',
    placement: 'top',
  },
  {
    target: 'tour-help',
    title: 'Need help later?',
    description:
      'This button stays in the corner — tap it any time to replay the tour. You are ready to coach.',
    placement: 'left',
  },
];

// ── Layout constants ────────────────────────────────────────────────────────

/** Always-on-top stacking band reserved for the tour (above modals/toasts). */
const Z_OVERLAY  = 2_147_483_640;
const Z_TOOLTIP  = Z_OVERLAY + 1;
const Z_HELP_BTN = Z_OVERLAY - 1;

/** Padding (CSS px) around the target rectangle inside the spotlight cutout. */
const SPOTLIGHT_PADDING = 8;
/** Corner radius on the spotlight cutout. */
const SPOTLIGHT_RADIUS  = 12;
/** Gap (CSS px) between target rect and tooltip card. */
const TOOLTIP_GAP       = 14;

const LS_KEY            = 'coachlab-tour-seen';
const AUTO_SHOW_DELAY_MS = 2_000;

// ── Geometry helpers ────────────────────────────────────────────────────────

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
  const h = typeof window === 'undefined' ? 768  : window.innerHeight;
  return { w, h };
}

/**
 * Pick the actual placement for the tooltip given the target rect and the
 * tooltip's measured size.  We try the requested placement first; if it would
 * clip the viewport on the preferred side we fall back through a fixed order
 * (top → bottom → right → left → center).
 */
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

  // `preferred === 'center'` is already handled above, so `preferred` here is
  // either undefined or a side.
  type Side = 'top' | 'bottom' | 'left' | 'right';
  const order: Side[] = [];
  if (preferred) order.push(preferred);
  for (const p of ['bottom', 'top', 'right', 'left'] as const) {
    if (!order.includes(p)) order.push(p);
  }

  const fits = (p: Side) => {
    if (p === 'top')    return target.y - TOOLTIP_GAP - tipSize.h - MARGIN >= 0;
    if (p === 'bottom') return target.y + target.h + TOOLTIP_GAP + tipSize.h + MARGIN <= vp.h;
    if (p === 'left')   return target.x - TOOLTIP_GAP - tipSize.w - MARGIN >= 0;
    if (p === 'right')  return target.x + target.w + TOOLTIP_GAP + tipSize.w + MARGIN <= vp.w;
    return true;
  };

  const fittedSide = order.find(fits);
  const chosen: NonNullable<TourStep['placement']> = fittedSide ?? 'center';
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;

  let x = cx - tipSize.w / 2;
  let y = cy - tipSize.h / 2;

  if (chosen === 'top')    { y = target.y - TOOLTIP_GAP - tipSize.h; }
  if (chosen === 'bottom') { y = target.y + target.h + TOOLTIP_GAP; }
  if (chosen === 'left')   { x = target.x - TOOLTIP_GAP - tipSize.w; }
  if (chosen === 'right')  { x = target.x + target.w + TOOLTIP_GAP; }

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

// ── Target-rect hook ────────────────────────────────────────────────────────

/**
 * Tracks the live bounding rect of the element matched by `[data-tour-id=...]`.
 * Returns null until the element is found (or if `tourId` is undefined).
 */
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
        raf && cancelAnimationFrame(raf);
        raf = requestAnimationFrame(update);
      });
    }

    // Initial probe; some targets may mount slightly after the tour opens
    // (e.g. RecordingHub trigger inside a header that re-renders).  Re-probe
    // for up to ~1 s before giving up.
    let attempts = 0;
    const probe = () => {
      if (cancelled) return;
      update();
      if (!observed && attempts < 20) {
        attempts += 1;
        raf = requestAnimationFrame(() => window.setTimeout(probe, 50));
      }
    };
    probe();

    const onResize = () => {
      raf && cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      if (ro) ro.disconnect();
    };
  }, [tourId, active]);

  return rect;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function GuidedTour() {
  const [mounted, setMounted]     = useState(false);
  const [open, setOpen]           = useState(false);
  const [stepIdx, setStepIdx]     = useState(0);
  const [seenBefore, setSeenBefore] = useState(true);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tipSize, setTipSize] = useState<{ w: number; h: number }>({ w: 320, h: 200 });
  const maskId = useId().replace(/:/g, '_');

  // Mount-only guard so portal+localStorage logic runs after hydration.
  useEffect(() => {
    setMounted(true);
    try {
      const seen = window.localStorage.getItem(LS_KEY) === '1';
      setSeenBefore(seen);
      if (!seen) {
        const id = window.setTimeout(() => {
          setStepIdx(0);
          setOpen(true);
        }, AUTO_SHOW_DELAY_MS);
        return () => window.clearTimeout(id);
      }
    } catch {
      /* localStorage may throw in private mode — ignore */
    }
  }, []);

  // ── Persistent dismissal helper ───────────────────────────────────────────
  const markSeen = useCallback(() => {
    try { window.localStorage.setItem(LS_KEY, '1'); } catch { /* noop */ }
    setSeenBefore(true);
  }, []);

  const closeTour = useCallback((persist: boolean) => {
    setOpen(false);
    if (persist) markSeen();
  }, [markSeen]);

  const openTour = useCallback(() => {
    setStepIdx(0);
    setOpen(true);
  }, []);

  const next = useCallback(() => {
    setStepIdx((i) => {
      if (i + 1 >= STEPS.length) {
        // End of tour — close and persist.
        setOpen(false);
        markSeen();
        return 0;
      }
      return i + 1;
    });
  }, [markSeen]);

  const back = useCallback(() => {
    setStepIdx((i) => Math.max(0, i - 1));
  }, []);

  // ── Keyboard shortcuts during the tour ────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeTour(true); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { next(); }
      else if (e.key === 'ArrowLeft') { back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, next, back, closeTour]);

  const step = STEPS[stepIdx];
  const targetRect = useTargetRect(step?.target, open);

  // Re-measure tooltip after content swaps so positioning uses fresh size.
  useLayoutEffect(() => {
    if (!open || !tooltipRef.current) return;
    const r = tooltipRef.current.getBoundingClientRect();
    if (Math.abs(r.width - tipSize.w) > 0.5 || Math.abs(r.height - tipSize.h) > 0.5) {
      setTipSize({ w: r.width, h: r.height });
    }
  }, [open, stepIdx, targetRect, tipSize.w, tipSize.h]);

  const tipPos = useMemo(
    () => resolveTooltipPos(targetRect, tipSize, step?.placement),
    [targetRect, tipSize, step?.placement],
  );

  // ── Mask geometry (SVG mask hole) ─────────────────────────────────────────
  const spotlight = useMemo(() => {
    if (!targetRect) return null;
    const x = Math.max(0, targetRect.x - SPOTLIGHT_PADDING);
    const y = Math.max(0, targetRect.y - SPOTLIGHT_PADDING);
    const w = targetRect.w + SPOTLIGHT_PADDING * 2;
    const h = targetRect.h + SPOTLIGHT_PADDING * 2;
    return { x, y, w, h };
  }, [targetRect]);

  if (!mounted) return null;

  // ── Help button (always rendered) ─────────────────────────────────────────
  const helpBtn = (
    <button
      type="button"
      data-tour-id="tour-help"
      aria-label="Open guided tour"
      title="Guided tour"
      onClick={openTour}
      style={{
        position: 'fixed',
        right: 'calc(16px + env(safe-area-inset-right, 0px))',
        // Sit above where zoom controls would live; keep clear of the playback
        // dock by reading the same CSS custom property used by InstallPrompt.
        bottom: 'calc(var(--coachlab-banner-bottom, 100px) + 12px)',
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: '#1A1A1A',
        color: '#FFFFFF',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
        cursor: 'pointer',
        zIndex: Z_HELP_BTN,
        display: open ? 'none' : 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        fontWeight: 700,
        fontFamily: 'inherit',
        animation: !seenBefore && !open ? 'coachlab-tour-pulse 1.6s ease-in-out infinite' : 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span aria-hidden="true">?</span>
    </button>
  );

  // ── Overlay + tooltip (only while open) ───────────────────────────────────
  const overlay = open && step ? (
    <>
      {/* Dark backdrop with spotlight cutout. */}
      <svg
        aria-hidden="true"
        onClick={() => closeTour(true)}
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          zIndex: Z_OVERLAY,
          cursor: 'pointer',
          pointerEvents: 'auto',
          transition: 'opacity 300ms ease',
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
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.75)"
          mask={`url(#${maskId})`}
        />
        {/* Soft glow ring around the spotlight for affordance. */}
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

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`tour-title-${stepIdx}`}
        // Stop click-through onto the overlay so taps inside the card don't
        // close the tour.
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: tipPos.y,
          left: tipPos.x,
          width: 'min(360px, calc(100vw - 24px))',
          maxWidth: 'calc(100vw - 24px)',
          zIndex: Z_TOOLTIP,
          background: '#FFFFFF',
          borderRadius: 16,
          padding: 18,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          border: '1px solid rgba(0,0,0,0.06)',
          color: '#1A1A1A',
          transition: 'top 300ms cubic-bezier(0.4, 0, 0.2, 1), left 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          fontFamily: 'inherit',
        }}
      >
        {/* Step counter + skip */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.04em' }}>
            STEP {stepIdx + 1} OF {STEPS.length}
          </span>
          <button
            type="button"
            onClick={() => closeTour(true)}
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
            Skip ×
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

        {/* Progress bar */}
        <div
          aria-hidden="true"
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
              width: `${((stepIdx + 1) / STEPS.length) * 100}%`,
              background: '#1A1A1A',
              transition: 'width 300ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 8 }}>
          {stepIdx > 0 && (
            <button
              type="button"
              onClick={back}
              style={{
                flex: 1,
                height: 38,
                borderRadius: 10,
                background: '#FFFFFF',
                border: '1px solid #E5E5E5',
                color: '#1A1A1A',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={next}
            style={{
              flex: stepIdx > 0 ? 1 : 2,
              height: 38,
              borderRadius: 10,
              background: '#1A1A1A',
              border: '1px solid #1A1A1A',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {stepIdx === STEPS.length - 1 ? 'Finish' : 'Next →'}
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
      {helpBtn}
      {overlay}
    </>,
    document.body,
  );
}
