'use client';

/**
 * GuidedTour — the interactive walkthrough engine.
 *
 * Tours live in components/tours/ as data: an ordered list of steps, each
 * pointing at a real element by its `data-tour-id`. The coach does the real
 * thing at every step — opens the panel, picks the tool, draws on the frame —
 * and the step ends when the app shows (a now-visible element) or says (a
 * signal from lib/tourSignals.ts) that it happened. Explanation-only steps end
 * on Next.
 *
 * Mechanics that keep that honest:
 *  - The highlight is a hole the coach can click and draw through. Four
 *    blockers around it swallow stray clicks so a tour step cannot be lost by
 *    wandering off; Exit always works.
 *  - A target is the first VISIBLE element with its id. Several ids exist in
 *    more than one place (desktop and phone chrome, panel A and B, a hidden
 *    duplicate) and the hidden copy must never win.
 *  - If a target is not on screen (the coach backed out of a panel), nothing is
 *    dimmed or blocked: the card says what it is waiting for and the coach can
 *    find their way back. Every waiting step can also be skipped.
 *  - Progress is saved per tour in localStorage, so a tour can be resumed.
 *  - The card never sits on the step's target: it goes beside it, and when
 *    no side has room it takes the roomier side and scrolls inside itself.
 *  - Every step that asks for a click points at the control: a pulsing ring
 *    and an arrow from the card (still under prefers-reduced-motion).
 *  - Back never re-fires a step: a step already passed does not skip or
 *    auto-advance on a condition that is already met — it shows Next instead.
 *    Nothing the coach did is undone.
 *
 * Opened by the ? button (Canvas's zoom cluster dispatches
 * 'anglemotion-open-guided-tour' on /analysis; other screens get a floating
 * ?), which lists that screen's tours, and once on a first visit to /analysis
 * through the welcome card.
 *
 * A tour can cross a navigation (the Players tour opens a profile): the open
 * tour and its step are kept in sessionStorage, and the engine on the next
 * screen picks it up if that screen offers the tour.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TOUR_SIGNAL_EVENT, type TourSignalDetail } from '@/lib/tourSignals';
import { ALL_TOURS, TOURS_BY_PAGE, WELCOME_TOUR_ID, type TourDef, type TourPageId, type TourStep } from '@/components/tours';
import { tourAccess } from '@/lib/tourAccess';

const Z_OVERLAY = 2_147_483_640;
const Z_TOOLTIP = Z_OVERLAY + 1;
const Z_WELCOME = Z_OVERLAY + 2;
const Z_HELP_BTN = Z_OVERLAY - 1;

const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 12;
const TOOLTIP_GAP = 14;
/** Wider gap on steps that point at a control, so the pointer arrow has room. */
const POINTER_GAP = 40;
const MARGIN = 12;

/** Smallest card height worth showing when no side has room for the whole card. */
const MIN_CARD_H = 150;
/** Below this width the step picture starts folded away (phones). */
const COMPACT_W = 640;

/** How often an open step re-reads its target and its finish condition. */
const POLL_MS = 150;
/** Let a step's UI settle before deciding it is already done and skipping it. */
const SKIP_CHECK_DELAY_MS = 350;

const LS_SEEN = 'anglemotion-tour-seen';
const LS_PROGRESS = 'anglemotion-tours-v1';
/** The tour open right now and its step, so it survives a page navigation. */
const SS_ACTIVE = 'anglemotion-tour-active';
const AUTO_SHOW_DELAY_MS = 2_000;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Progress = Record<string, { step: number; done: boolean }>;

function readProgress(): Progress {
  try {
    const raw = window.localStorage.getItem(LS_PROGRESS);
    return raw ? (JSON.parse(raw) as Progress) : {};
  } catch {
    return {};
  }
}

function writeActive(active: { id: string; step: number } | null) {
  try {
    if (active) window.sessionStorage.setItem(SS_ACTIVE, JSON.stringify(active));
    else window.sessionStorage.removeItem(SS_ACTIVE);
  } catch {
    /* private mode */
  }
}

function readActive(): { id: string; step: number } | null {
  try {
    const raw = window.sessionStorage.getItem(SS_ACTIVE);
    return raw ? (JSON.parse(raw) as { id: string; step: number }) : null;
  } catch {
    return null;
  }
}

function writeProgress(p: Progress) {
  try {
    window.localStorage.setItem(LS_PROGRESS, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

/** First element matching `selector` that is actually rendered on screen. */
function findVisible(selector: string): HTMLElement | null {
  let els: NodeListOf<HTMLElement>;
  try {
    els = document.querySelectorAll<HTMLElement>(selector);
  } catch {
    return null;
  }
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    return el;
  }
  return null;
}

const byTourId = (id: string) => `[data-tour-id="${id}"]`;

function viewport() {
  return { w: window.innerWidth, h: window.innerHeight };
}

type Side = 'top' | 'bottom' | 'left' | 'right';

interface TipPlacement {
  x: number;
  y: number;
  /** Set when the card had to be shortened to stay off the target (it scrolls). */
  maxH?: number;
}

/**
 * Where the card goes. Rule one: never on the target. Beside it on the
 * preferred side, else any side with room; when none has room for the whole
 * card, the roomier of above/below with the card shortened to fit (it
 * scrolls). Working areas that fill the screen are the one exception — the
 * card tucks into a corner of the area, away from what the step is about.
 */
function resolveTooltipPos(
  target: Rect | null,
  tip: { w: number; h: number },
  step: TourStep,
): TipPlacement {
  const vp = viewport();
  const centred = { x: Math.max(MARGIN, (vp.w - tip.w) / 2), y: Math.max(MARGIN, (vp.h - tip.h) / 2) };
  if (!target || step.placement === 'center') return centred;

  const pad = step.area ? 0 : SPOTLIGHT_PADDING;
  const t = { x: target.x - pad, y: target.y - pad, w: target.w + pad * 2, h: target.h + pad * 2 };
  const gap = !step.area && step.advance.kind !== 'next' ? POINTER_GAP : TOOLTIP_GAP;
  const space: Record<Side, number> = {
    top: t.y - gap - MARGIN,
    bottom: vp.h - (t.y + t.h) - gap - MARGIN,
    left: t.x - gap - MARGIN,
    right: vp.w - (t.x + t.w) - gap - MARGIN,
  };

  const order: Side[] = [];
  if (step.placement) order.push(step.placement as Side);
  for (const p of ['bottom', 'top', 'right', 'left'] as const) if (!order.includes(p)) order.push(p);
  const fits = (p: Side) => (p === 'top' || p === 'bottom' ? space[p] >= tip.h : space[p] >= tip.w);
  const side = order.find(fits);

  const along = (p: Side, h: number): TipPlacement => {
    let x = t.x + t.w / 2 - tip.w / 2;
    let y = t.y + t.h / 2 - h / 2;
    if (p === 'top') y = t.y - gap - h;
    if (p === 'bottom') y = t.y + t.h + gap;
    if (p === 'left') x = t.x - gap - tip.w;
    if (p === 'right') x = t.x + t.w + gap;
    if (p === 'top' || p === 'bottom') x = Math.min(Math.max(MARGIN, x), vp.w - tip.w - MARGIN);
    else y = Math.min(Math.max(MARGIN, y), vp.h - h - MARGIN);
    return { x, y };
  };

  if (side) return along(side, tip.h);

  if (step.area) {
    const corner = step.corner ?? 'top-left';
    const right = corner.endsWith('right');
    const bottom = corner.startsWith('bottom');
    const vis = { x0: Math.max(0, target.x), y0: Math.max(0, target.y), x1: Math.min(vp.w, target.x + target.w), y1: Math.min(vp.h, target.y + target.h) };
    return {
      x: Math.min(Math.max(MARGIN, right ? vis.x1 - tip.w - MARGIN : vis.x0 + MARGIN), vp.w - tip.w - MARGIN),
      y: Math.min(Math.max(MARGIN, bottom ? vis.y1 - tip.h - MARGIN : vis.y0 + MARGIN), vp.h - tip.h - MARGIN),
    };
  }

  // No side holds the whole card: shorten it on the roomier of above/below.
  const vert: Side = space.top > space.bottom ? 'top' : 'bottom';
  if (space[vert] >= MIN_CARD_H) return { ...along(vert, space[vert]), maxH: space[vert] };
  return centred;
}

/**
 * The pointer arrow: the straight line between the card's centre and the
 * target's centre, trimmed to the gap between the two boxes. Null when they
 * (nearly) touch.
 */
function pointerSegment(card: Rect, target: Rect): { x1: number; y1: number; x2: number; y2: number } | null {
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;
  const gx = target.x + target.w / 2;
  const gy = target.y + target.h / 2;
  const dx = gx - cx;
  const dy = gy - cy;
  // Fraction of the centre-to-centre line at which it leaves the card / enters the target.
  const exit = (r: Rect, fromCard: boolean) => {
    const hx = r.w / 2;
    const hy = r.h / 2;
    const tx = dx === 0 ? Infinity : hx / Math.abs(dx);
    const ty = dy === 0 ? Infinity : hy / Math.abs(dy);
    const k = Math.min(tx, ty);
    return fromCard ? k : 1 - k;
  };
  const a = exit(card, true);
  const b = exit(target, false);
  if (!(b - a > 0)) return null;
  const x1 = cx + dx * a;
  const y1 = cy + dy * a;
  const x2 = cx + dx * b;
  const y2 = cy + dy * b;
  if (Math.hypot(x2 - x1, y2 - y1) < 16) return null;
  return { x1, y1, x2, y2 };
}

/** Live rect of a step's target, re-read every POLL_MS while the step is open. */
function useStepTargetRect(step: TourStep | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    if (!step?.target) {
      setRect(null);
      return;
    }
    const selector = byTourId(step.target);
    let scrolledInto: HTMLElement | null = null;
    const read = () => {
      const el = findVisible(selector);
      if (!el) {
        setRect((prev) => (prev === null ? prev : null));
        return;
      }
      // A control can be rendered yet clipped inside a scrolling panel (the
      // Draw list runs past the toolbar's fold), where the highlight would
      // frame it but a click would land on whatever covers it. Bring it into
      // view once per element; working areas are never scrolled.
      if (el !== scrolledInto && !step.area) {
        scrolledInto = el;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.x === r.left && prev.y === r.top && prev.w === r.width && prev.h === r.height
          ? prev
          : { x: r.left, y: r.top, w: r.width, h: r.height },
      );
    };
    read();
    const id = window.setInterval(read, POLL_MS);
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', read);
      window.removeEventListener('scroll', read, true);
    };
  }, [step]);
  return rect;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--cl-bg-panel)',
  borderRadius: 16,
  padding: 18,
  boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
  border: '1px solid rgba(0,0,0,0.06)',
  color: 'var(--cl-text-primary)',
  fontFamily: 'inherit',
};

const primaryBtn: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: '1px solid var(--cl-action-primary)',
  background: 'var(--cl-action-primary)',
  color: 'var(--cl-text-on-fill)',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: 'inherit',
  padding: '0 14px',
};

const secondaryBtn: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: '1px solid var(--cl-border)',
  background: 'var(--cl-bg-panel)',
  color: 'var(--cl-text-primary)',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: 'inherit',
  padding: '0 14px',
};

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--cl-text-secondary)',
  cursor: 'pointer',
  padding: '4px 6px',
  fontFamily: 'inherit',
};

type GuidedTourProps = {
  /** Which screen this is: decides the ? list (components/tours/index.ts). */
  page?: TourPageId;
  /** When true, ? lives in the canvas zoom cluster (analysis page) — no fixed FAB. */
  suppressFloatingHelp?: boolean;
};

export default function GuidedTour({ page = 'analysis', suppressFloatingHelp = false }: GuidedTourProps) {
  const tours = useMemo(() => TOURS_BY_PAGE[page].filter((t) => tourAccess(t.feature)), [page]);
  const [mounted, setMounted] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tour, setTour] = useState<TourDef | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  /** Furthest step reached in this run. Steps before it are being reviewed (Back). */
  const [maxReached, setMaxReached] = useState(0);
  /** Phones: the step picture starts folded; the coach can open it. */
  const [imageOpen, setImageOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [progress, setProgress] = useState<Progress>({});
  const [seenBefore, setSeenBefore] = useState(true);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tipSize, setTipSize] = useState({ w: 340, h: 200 });
  const maskId = useId().replace(/:/g, '_');

  const step: TourStep | null = tour ? tour.steps[stepIdx] ?? null : null;
  const reviewing = stepIdx < maxReached;
  const targetRect = useStepTargetRect(step);

  useEffect(() => {
    setMounted(true);
    setProgress(readProgress());
    // A tour that was open when the coach navigated here carries on, if this
    // screen offers it.
    const active = readActive();
    const carried = active ? tours.find((t) => t.id === active.id) : undefined;
    if (active && carried) {
      const at = Math.min(Math.max(0, active.step), carried.steps.length - 1);
      setTour(carried);
      setStepIdx(at);
      setMaxReached(at);
      return;
    }
    if (page !== 'analysis') return;
    try {
      const seen = window.localStorage.getItem(LS_SEEN) === '1';
      setSeenBefore(seen);
      if (!seen) {
        const id = window.setTimeout(() => setWelcomeOpen(true), AUTO_SHOW_DELAY_MS);
        return () => window.clearTimeout(id);
      }
    } catch {
      /* private mode */
    }
    // Mount-only: `tours` is fixed per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(LS_SEEN, '1');
    } catch {
      /* noop */
    }
    setSeenBefore(true);
  }, []);

  const saveProgress = useCallback((tourId: string, stepNo: number, done: boolean) => {
    setProgress((prev) => {
      const next = { ...prev, [tourId]: { step: stepNo, done } };
      writeProgress(next);
      return next;
    });
  }, []);

  const startTour = useCallback(
    (id: string, from = 0) => {
      const def = ALL_TOURS.find((t) => t.id === id);
      if (!def) return;
      setWelcomeOpen(false);
      setPickerOpen(false);
      markSeen();
      setTour(def);
      const start = Math.min(Math.max(0, from), def.steps.length - 1);
      setStepIdx(start);
      setMaxReached(start);
      writeActive({ id: def.id, step: start });
    },
    [markSeen],
  );

  const exitTour = useCallback(() => {
    if (tour) saveProgress(tour.id, stepIdx, false);
    writeActive(null);
    setTour(null);
    setStepIdx(0);
  }, [tour, stepIdx, saveProgress]);

  const next = useCallback(() => {
    if (!tour) return;
    if (stepIdx + 1 >= tour.steps.length) {
      saveProgress(tour.id, 0, true);
      writeActive(null);
      setTour(null);
      setStepIdx(0);
      return;
    }
    // Written synchronously: a step whose click navigates away must already
    // have recorded where the next screen picks up.
    writeActive({ id: tour.id, step: stepIdx + 1 });
    saveProgress(tour.id, stepIdx + 1, false);
    setStepIdx(stepIdx + 1);
    setMaxReached((m) => Math.max(m, stepIdx + 1));
  }, [tour, stepIdx, saveProgress]);

  // Back only moves the card: it undoes nothing the coach did, and the step it
  // lands on is "being reviewed" — no skip, no instant auto-advance (below).
  const back = useCallback(() => {
    setStepIdx((i) => {
      const to = Math.max(0, i - 1);
      if (tour) writeActive({ id: tour.id, step: to });
      return to;
    });
  }, [tour]);

  // A new step starts with its picture folded on phones.
  useEffect(() => {
    setImageOpen(false);
  }, [stepIdx, tour]);

  useEffect(() => {
    const read = () => setCompact(window.innerWidth < COMPACT_W);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  // ? button / external open → the tour list.
  useEffect(() => {
    const open = () => {
      setWelcomeOpen(false);
      setPickerOpen(true);
    };
    window.addEventListener('anglemotion-open-guided-tour', open);
    return () => window.removeEventListener('anglemotion-open-guided-tour', open);
  }, []);

  // Skip a step that is already done when it opens (the coach is already on the
  // Draw screen, already has the tool…).
  useEffect(() => {
    if (!step?.skipIf || reviewing) return;
    const selector = step.skipIf;
    const id = window.setTimeout(() => {
      if (findVisible(selector)) next();
    }, SKIP_CHECK_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [step, next, reviewing]);

  // Finish condition: a now-visible element. On a step being reviewed, a
  // condition that is ALREADY met does not count — only a fresh one does
  // (it has to go away and come back), so Back never bounces forward.
  useEffect(() => {
    if (!step || step.advance.kind !== 'visible') return;
    const selector = step.advance.selector;
    let armed = !reviewing || !findVisible(selector);
    const id = window.setInterval(() => {
      const met = !!findVisible(selector);
      if (!armed) {
        if (!met) armed = true;
        return;
      }
      if (met) next();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [step, next, reviewing]);

  // Finish condition: a click on the target itself. Capture phase, so the step
  // sees the click even when the control stops propagation; the control's own
  // handler still runs — nothing is prevented.
  useEffect(() => {
    if (!step?.target || step.advance.kind !== 'click') return;
    const selector = step.advance.selector ?? byTourId(step.target);
    // Any element with the target id counts (a grid of player cards shares
    // one id), not only the first visible one that is highlighted.
    const onClick = (e: MouseEvent) => {
      const hit = e.target instanceof Element ? e.target.closest(selector) : null;
      if (hit) next();
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [step, next]);

  // Finish condition: an app signal.
  useEffect(() => {
    if (!step || step.advance.kind !== 'signal') return;
    const want = step.advance;
    const onSignal = (e: Event) => {
      const d = (e as CustomEvent<TourSignalDetail>).detail;
      if (!d || d.name !== want.name) return;
      if (want.tool && d.tool !== want.tool) return;
      next();
    };
    window.addEventListener(TOUR_SIGNAL_EVENT, onSignal);
    return () => window.removeEventListener(TOUR_SIGNAL_EVENT, onSignal);
  }, [step, next]);

  // Keyboard: Escape exits; arrows/Enter only page through Next-only steps, so a
  // key press can never claim the coach did something they did not.
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitTour();
      else if ((step?.advance.kind === 'next' || reviewing) && (e.key === 'ArrowRight' || e.key === 'Enter')) next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour, step, next, back, exitTour, reviewing]);

  useLayoutEffect(() => {
    if (!tour || !tooltipRef.current) return;
    // The card's NATURAL height (scrollHeight), not its possibly shortened box:
    // placement decides whether to shorten it, so it must see the full size.
    const el = tooltipRef.current;
    const w = el.getBoundingClientRect().width;
    const h = el.scrollHeight;
    if (Math.abs(w - tipSize.w) > 0.5 || Math.abs(h - tipSize.h) > 0.5) {
      setTipSize({ w, h });
    }
  });

  const spotlight = useMemo(() => {
    if (!targetRect || !step) return null;
    const pad = step.area ? 0 : SPOTLIGHT_PADDING;
    const vp = viewport();
    const x = Math.max(0, targetRect.x - pad);
    const y = Math.max(0, targetRect.y - pad);
    return {
      x,
      y,
      w: Math.min(vp.w, targetRect.x + targetRect.w + pad) - x,
      h: Math.min(vp.h, targetRect.y + targetRect.h + pad) - y,
    };
  }, [targetRect, step]);

  const tipPos: TipPlacement = useMemo(
    () => (step ? resolveTooltipPos(targetRect, tipSize, step) : { x: 0, y: 0 }),
    [targetRect, tipSize, step],
  );

  if (!mounted) return null;

  const helpBottom =
    'calc(var(--anglemotion-banner-bottom, 100px) + var(--anglemotion-install-banner-height, 0px) + 12px + env(safe-area-inset-bottom, 0px))';

  const helpBtn = (
    <button
      type="button"
      data-tour-id="tour-help"
      aria-label="Open guided tours"
      title="Guided tours"
      onPointerDown={(e) => {
        e.preventDefault();
        setPickerOpen(true);
      }}
      style={{
        position: 'fixed',
        right: 'calc(16px + env(safe-area-inset-right, 0px))',
        bottom: helpBottom,
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: 'var(--cl-action-primary)',
        color: 'var(--cl-text-on-fill)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
        cursor: 'pointer',
        zIndex: Z_HELP_BTN,
        display: welcomeOpen || pickerOpen || tour ? 'none' : 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        fontWeight: 700,
        fontFamily: 'inherit',
        animation: !seenBefore && !welcomeOpen && !tour ? 'anglemotion-tour-pulse 1.6s ease-in-out infinite' : 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span aria-hidden="true">?</span>
    </button>
  );

  const backdrop = (onClick: () => void) => (
    <div
      role="presentation"
      aria-hidden
      onClick={onClick}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: Z_WELCOME - 1 }}
    />
  );

  const modalBox: React.CSSProperties = {
    ...cardStyle,
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: Z_WELCOME,
    width: 'min(420px, calc(100vw - 32px))',
    maxHeight: 'calc(100dvh - 32px)',
    overflowY: 'auto',
    borderRadius: 20,
    padding: 24,
  };

  const welcomeTour = page === 'analysis' ? tours.find((t) => t.id === WELCOME_TOUR_ID) : undefined;
  const welcomeModal =
    welcomeOpen && welcomeTour ? (
      <>
        {backdrop(() => {
          setWelcomeOpen(false);
          markSeen();
        })}
        <div role="dialog" aria-modal="true" aria-labelledby="anglemotion-welcome-title" style={modalBox}>
          <h2 id="anglemotion-welcome-title" style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 800, lineHeight: 1.25 }}>
            Welcome to AngleMotion
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: 15, lineHeight: 1.5, color: 'var(--cl-text-secondary)' }}>
            Learn it by doing it, on the real tools. {welcomeTour.summary}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button type="button" onClick={() => startTour(welcomeTour.id)} style={{ ...primaryBtn, height: 44 }}>
              Start the tour
            </button>
            <button
              type="button"
              onClick={() => {
                setWelcomeOpen(false);
                markSeen();
              }}
              style={{ ...secondaryBtn, height: 44 }}
            >
              Skip for now
            </button>
          </div>
        </div>
      </>
    ) : null;

  const picker = pickerOpen ? (
    <>
      {backdrop(() => setPickerOpen(false))}
      <div role="dialog" aria-modal="true" aria-labelledby="anglemotion-tours-title" style={modalBox}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 id="anglemotion-tours-title" style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
            Guided tours
          </h2>
          <button type="button" onClick={() => setPickerOpen(false)} style={linkBtn}>
            Close
          </button>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {tours.map((t) => {
            const p = progress[t.id];
            const inProgress = p && !p.done && p.step > 0;
            return (
              <li
                key={t.id}
                data-tour-id={`tour-card-${t.id}`}
                style={{ border: '1px solid var(--cl-border)', borderRadius: 14, padding: 14 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 16 }}>{t.title}</strong>
                  <span style={{ fontSize: 12, color: 'var(--cl-text-secondary)', whiteSpace: 'nowrap' }}>
                    {p?.done ? 'Completed' : inProgress ? `Step ${p.step + 1} of ${t.steps.length}` : `${t.steps.length} steps`}
                  </span>
                </div>
                <p style={{ margin: '6px 0 12px', fontSize: 14, lineHeight: 1.45, color: 'var(--cl-text-secondary)' }}>
                  {t.summary}
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  {inProgress ? (
                    <>
                      <button type="button" onClick={() => startTour(t.id, p.step)} style={{ ...primaryBtn, flex: 1 }}>
                        Resume
                      </button>
                      <button type="button" onClick={() => startTour(t.id)} style={secondaryBtn}>
                        Start over
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => startTour(t.id)} style={{ ...primaryBtn, flex: 1 }}>
                      {p?.done ? 'Take it again' : 'Start'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  ) : null;

  let tourOverlay: React.ReactNode = null;
  if (tour && step) {
    const vp = viewport();
    const waiting = step.advance.kind !== 'next';
    const missing = !!step.target && !targetRect;
    const last = stepIdx === tour.steps.length - 1;
    // Untargeted cards (intro/outro) dim the whole page; a missing target dims
    // nothing, so the coach can get back to where the step happens.
    const dimAll = !step.target;
    // Steps that ask for a click get the pointer: a ring on the control and an
    // arrow from the card. Working areas (drawing on the frame) are outlined
    // instead — the whole area is the target there.
    const pointing = !!spotlight && !missing && !step.area && step.advance.kind !== 'next';
    const cardBox: Rect = {
      x: tipPos.x,
      y: tipPos.y,
      w: tipSize.w,
      h: tipPos.maxH !== undefined ? Math.min(tipSize.h, tipPos.maxH) : tipSize.h,
    };
    const seg = pointing && spotlight ? pointerSegment(cardBox, spotlight) : null;
    const segLen = seg ? Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) : 0;
    const showImage = !!step.image && (!compact || imageOpen);
    const blockers =
      spotlight && !missing
        ? [
            { left: 0, top: 0, width: vp.w, height: spotlight.y },
            { left: 0, top: spotlight.y + spotlight.h, width: vp.w, height: Math.max(0, vp.h - spotlight.y - spotlight.h) },
            { left: 0, top: spotlight.y, width: spotlight.x, height: spotlight.h },
            { left: spotlight.x + spotlight.w, top: spotlight.y, width: Math.max(0, vp.w - spotlight.x - spotlight.w), height: spotlight.h },
          ]
        : dimAll
          ? [{ left: 0, top: 0, width: vp.w, height: vp.h }]
          : [];

    tourOverlay = (
      <>
        {(spotlight || dimAll) && !missing ? (
          <svg
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: Z_OVERLAY, pointerEvents: 'none' }}
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
                    rx={step.area ? 4 : SPOTLIGHT_RADIUS}
                    fill="black"
                  />
                )}
              </mask>
            </defs>
            <rect x="0" y="0" width="100%" height="100%" fill={step.area ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.7)'} mask={`url(#${maskId})`} />
            {spotlight && (
              <rect
                x={spotlight.x - 1.5}
                y={spotlight.y - 1.5}
                width={spotlight.w + 3}
                height={spotlight.h + 3}
                rx={(step.area ? 4 : SPOTLIGHT_RADIUS) + 1.5}
                fill="none"
                stroke={step.area ? 'var(--cl-action-primary)' : 'rgba(255,255,255,0.7)'}
                strokeWidth={2}
              />
            )}
          </svg>
        ) : null}

        {blockers.map((b, i) => (
          <div
            key={i}
            aria-hidden
            data-tour-blocker=""
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', ...b, zIndex: Z_OVERLAY, background: 'transparent' }}
          />
        ))}

        {pointing && spotlight ? (
          <div
            aria-hidden
            data-tour-pointer-ring=""
            className="anglemotion-tour-anim"
            style={{
              position: 'fixed',
              left: spotlight.x - 3,
              top: spotlight.y - 3,
              width: spotlight.w + 6,
              height: spotlight.h + 6,
              borderRadius: SPOTLIGHT_RADIUS + 3,
              // Accent blue with a white halo: readable on the black canvas and
              // on the light panels alike.
              border: '2px solid var(--cl-accent)',
              outline: '2px solid rgba(255,255,255,0.85)',
              zIndex: Z_OVERLAY,
              pointerEvents: 'none',
              animation: 'anglemotion-tour-ring 1.4s ease-out infinite',
            }}
          />
        ) : null}
        {seg ? (
          <svg
            aria-hidden="true"
            data-tour-pointer-arrow=""
            style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: Z_OVERLAY, pointerEvents: 'none', overflow: 'visible' }}
          >
            <defs>
              <marker id={`${maskId}-head`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--cl-accent)" stroke="#fff" strokeWidth={1.2} />
              </marker>
            </defs>
            <g
              className="anglemotion-tour-anim"
              style={{
                ['--am-nx' as string]: String((seg.x2 - seg.x1) / segLen),
                ['--am-ny' as string]: String((seg.y2 - seg.y1) / segLen),
                animation: 'anglemotion-tour-nudge 1.1s ease-in-out infinite',
              } as React.CSSProperties}
            >
              <line
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2 - ((seg.x2 - seg.x1) / segLen) * 6}
                y2={seg.y2 - ((seg.y2 - seg.y1) / segLen) * 6}
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={6}
                strokeLinecap="round"
              />
              <line
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2 - ((seg.x2 - seg.x1) / segLen) * 6}
                y2={seg.y2 - ((seg.y2 - seg.y1) / segLen) * 6}
                stroke="var(--cl-accent)"
                strokeWidth={3}
                strokeLinecap="round"
                markerEnd={`url(#${maskId}-head)`}
              />
            </g>
          </svg>
        ) : null}

        <div
          ref={tooltipRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`tour-title-${stepIdx}`}
          data-tour-card={step.id}
          data-tour-target={step.target}
          data-tour-advance={step.advance.kind}
          data-tour-area={step.area ? '' : undefined}
          data-tour-reviewing={reviewing ? '' : undefined}
          style={{
            ...cardStyle,
            position: 'fixed',
            top: tipPos.y,
            left: tipPos.x,
            width: 'min(340px, calc(100vw - 24px))',
            maxHeight: tipPos.maxH,
            overflowY: tipPos.maxH !== undefined ? 'auto' : undefined,
            zIndex: Z_TOOLTIP,
            transition: 'top 250ms cubic-bezier(0.4, 0, 0.2, 1), left 250ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cl-text-secondary)', letterSpacing: '0.04em' }}>
              {tour.title} · {stepIdx + 1} of {tour.steps.length}
            </span>
            <button type="button" onClick={exitTour} style={linkBtn}>
              Exit
            </button>
          </div>
          <h3 id={`tour-title-${stepIdx}`} style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>
            {step.title}
          </h3>
          {step.image && compact ? (
            <button
              type="button"
              onClick={() => setImageOpen((o) => !o)}
              aria-expanded={imageOpen}
              style={{ ...linkBtn, padding: '0 0 6px', color: 'var(--cl-action-primary)' }}
            >
              {imageOpen ? 'Hide picture' : 'Show picture'}
            </button>
          ) : null}
          {showImage && step.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- small static WebP, sized by its attributes
            <img
              key={step.image.src}
              src={step.image.src}
              width={step.image.width}
              height={step.image.height}
              alt={step.image.alt}
              data-tour-image=""
              decoding="async"
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                maxHeight: compact ? 160 : 200,
                objectFit: 'contain',
                background: 'var(--cl-border)',
                borderRadius: 10,
                margin: '0 0 10px',
              }}
            />
          ) : null}
          <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.5, color: 'var(--cl-text-secondary)' }}>{step.body}</p>
          {missing ? (
            <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.45, color: 'var(--cl-text-primary)' }}>
              Not on screen right now — go back to the panel this step is about, and the tour picks up from there.
            </p>
          ) : null}
          <div aria-hidden style={{ height: 4, background: 'var(--cl-border)', borderRadius: 999, overflow: 'hidden', marginBottom: 12 }}>
            <div
              style={{
                height: '100%',
                width: `${((stepIdx + 1) / tour.steps.length) * 100}%`,
                background: 'var(--cl-action-primary)',
                transition: 'width 250ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              aria-label="Previous step"
              disabled={stepIdx === 0}
              onClick={back}
              style={{ ...secondaryBtn, width: 40, padding: 0, color: stepIdx === 0 ? 'var(--cl-border)' : 'var(--cl-text-primary)', cursor: stepIdx === 0 ? 'default' : 'pointer' }}
            >
              ←
            </button>
            {waiting && !reviewing ? (
              <>
                <span
                  role="status"
                  style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--cl-action-primary)' }}
                >
                  Your turn…
                </span>
                <button type="button" onClick={next} style={linkBtn} aria-label="Skip this step">
                  Skip step
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label={last ? 'Finish tour' : 'Next step'}
                onClick={next}
                style={{ ...primaryBtn, flex: 1 }}
              >
                {last ? 'Finish' : 'Next →'}
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  return createPortal(
    <>
      <style>{`@keyframes anglemotion-tour-pulse {
        0%, 100% { box-shadow: 0 6px 24px rgba(0,0,0,0.28), 0 0 0 0 rgba(53,103,154,0.55); }
        50%      { box-shadow: 0 6px 24px rgba(0,0,0,0.28), 0 0 0 14px rgba(53,103,154,0); }
      }
      @keyframes anglemotion-tour-ring {
        0%   { box-shadow: 0 0 0 0 rgba(0,122,255,0.65); }
        100% { box-shadow: 0 0 0 14px rgba(0,122,255,0); }
      }
      @keyframes anglemotion-tour-nudge {
        0%, 100% { transform: translate(0, 0); }
        50%      { transform: translate(calc(var(--am-nx) * -7px), calc(var(--am-ny) * -7px)); }
      }
      @media (prefers-reduced-motion: reduce) {
        .anglemotion-tour-anim { animation: none !important; }
      }`}</style>
      {!suppressFloatingHelp && tours.length > 0 ? helpBtn : null}
      {welcomeModal}
      {picker}
      {tourOverlay}
    </>,
    document.body,
  );
}
