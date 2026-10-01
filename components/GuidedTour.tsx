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
 *
 * Opened by the ? button (Canvas's zoom cluster dispatches
 * 'anglemotion-open-guided-tour'), which lists the tours, and once on a first
 * visit through the welcome card.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TOUR_SIGNAL_EVENT, type TourSignalDetail } from '@/lib/tourSignals';
import { TOURS, WELCOME_TOUR_ID, type TourDef, type TourStep } from '@/components/tours';

const Z_OVERLAY = 2_147_483_640;
const Z_TOOLTIP = Z_OVERLAY + 1;
const Z_WELCOME = Z_OVERLAY + 2;
const Z_HELP_BTN = Z_OVERLAY - 1;

const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 12;
const TOOLTIP_GAP = 14;
const MARGIN = 12;

/** How often an open step re-reads its target and its finish condition. */
const POLL_MS = 150;
/** Let a step's UI settle before deciding it is already done and skipping it. */
const SKIP_CHECK_DELAY_MS = 350;

const LS_SEEN = 'anglemotion-tour-seen';
const LS_PROGRESS = 'anglemotion-tours-v1';
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

function resolveTooltipPos(
  target: Rect | null,
  tip: { w: number; h: number },
  step: TourStep,
): { x: number; y: number } {
  const vp = viewport();
  const centred = { x: Math.max(MARGIN, (vp.w - tip.w) / 2), y: Math.max(MARGIN, (vp.h - tip.h) / 2) };
  if (!target || step.placement === 'center') return centred;

  type Side = 'top' | 'bottom' | 'left' | 'right';
  const order: Side[] = [];
  if (step.placement) order.push(step.placement as Side);
  for (const p of ['bottom', 'top', 'right', 'left'] as const) if (!order.includes(p)) order.push(p);

  const fits = (p: Side) => {
    if (p === 'top') return target.y - TOOLTIP_GAP - tip.h - MARGIN >= 0;
    if (p === 'bottom') return target.y + target.h + TOOLTIP_GAP + tip.h + MARGIN <= vp.h;
    if (p === 'left') return target.x - TOOLTIP_GAP - tip.w - MARGIN >= 0;
    return target.x + target.w + TOOLTIP_GAP + tip.w + MARGIN <= vp.w;
  };
  const side = order.find(fits);

  if (!side) {
    // Nothing fits outside. A working area keeps its middle clear — the card
    // tucks into its top-left corner; anything else gets centred.
    if (!step.area) return centred;
    return {
      x: Math.min(Math.max(MARGIN, target.x + MARGIN), vp.w - tip.w - MARGIN),
      y: Math.min(Math.max(MARGIN, target.y + MARGIN), vp.h - tip.h - MARGIN),
    };
  }

  let x = target.x + target.w / 2 - tip.w / 2;
  let y = target.y + target.h / 2 - tip.h / 2;
  if (side === 'top') y = target.y - TOOLTIP_GAP - tip.h;
  if (side === 'bottom') y = target.y + target.h + TOOLTIP_GAP;
  if (side === 'left') x = target.x - TOOLTIP_GAP - tip.w;
  if (side === 'right') x = target.x + target.w + TOOLTIP_GAP;
  if (side === 'top' || side === 'bottom') x = Math.min(Math.max(MARGIN, x), vp.w - tip.w - MARGIN);
  else y = Math.min(Math.max(MARGIN, y), vp.h - tip.h - MARGIN);
  return { x, y };
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
  /** When true, ? lives in the canvas zoom cluster (analysis page) — no fixed FAB. */
  suppressFloatingHelp?: boolean;
};

export default function GuidedTour({ suppressFloatingHelp = false }: GuidedTourProps) {
  const [mounted, setMounted] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tour, setTour] = useState<TourDef | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState<Progress>({});
  const [seenBefore, setSeenBefore] = useState(true);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tipSize, setTipSize] = useState({ w: 340, h: 200 });
  const maskId = useId().replace(/:/g, '_');

  const step: TourStep | null = tour ? tour.steps[stepIdx] ?? null : null;
  const targetRect = useStepTargetRect(step);

  useEffect(() => {
    setMounted(true);
    setProgress(readProgress());
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
      const def = TOURS.find((t) => t.id === id);
      if (!def) return;
      setWelcomeOpen(false);
      setPickerOpen(false);
      markSeen();
      setTour(def);
      setStepIdx(Math.min(Math.max(0, from), def.steps.length - 1));
    },
    [markSeen],
  );

  const exitTour = useCallback(() => {
    if (tour) saveProgress(tour.id, stepIdx, false);
    setTour(null);
    setStepIdx(0);
  }, [tour, stepIdx, saveProgress]);

  const next = useCallback(() => {
    if (!tour) return;
    if (stepIdx + 1 >= tour.steps.length) {
      saveProgress(tour.id, 0, true);
      setTour(null);
      setStepIdx(0);
      return;
    }
    saveProgress(tour.id, stepIdx + 1, false);
    setStepIdx(stepIdx + 1);
  }, [tour, stepIdx, saveProgress]);

  const back = useCallback(() => setStepIdx((i) => Math.max(0, i - 1)), []);

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
    if (!step?.skipIf) return;
    const selector = step.skipIf;
    const id = window.setTimeout(() => {
      if (findVisible(selector)) next();
    }, SKIP_CHECK_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [step, next]);

  // Finish condition: a now-visible element.
  useEffect(() => {
    if (!step || step.advance.kind !== 'visible') return;
    const selector = step.advance.selector;
    const id = window.setInterval(() => {
      if (findVisible(selector)) next();
    }, POLL_MS);
    return () => window.clearInterval(id);
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
      else if (step?.advance.kind === 'next' && (e.key === 'ArrowRight' || e.key === 'Enter')) next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour, step, next, back, exitTour]);

  useLayoutEffect(() => {
    if (!tour || !tooltipRef.current) return;
    const r = tooltipRef.current.getBoundingClientRect();
    if (Math.abs(r.width - tipSize.w) > 0.5 || Math.abs(r.height - tipSize.h) > 0.5) {
      setTipSize({ w: r.width, h: r.height });
    }
  }, [tour, stepIdx, targetRect, tipSize.w, tipSize.h]);

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

  const tipPos = useMemo(
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

  const welcomeTour = TOURS.find((t) => t.id === WELCOME_TOUR_ID);
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
            Learn it by doing it: a short guided tour of {welcomeTour.title.toLowerCase()}, on the real tools.
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
          {TOURS.map((t) => {
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

        <div
          ref={tooltipRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`tour-title-${stepIdx}`}
          data-tour-card={step.id}
          style={{
            ...cardStyle,
            position: 'fixed',
            top: tipPos.y,
            left: tipPos.x,
            width: 'min(340px, calc(100vw - 24px))',
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
            {waiting ? (
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
      }`}</style>
      {!suppressFloatingHelp ? helpBtn : null}
      {welcomeModal}
      {picker}
      {tourOverlay}
    </>,
    document.body,
  );
}
