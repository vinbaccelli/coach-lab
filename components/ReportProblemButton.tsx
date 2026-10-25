'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/nextjs';
import { REPORT_BUTTON_FALLBACK_BOTTOM, reportButtonBottomPx } from '@/lib/reportButtonPlacement';

/**
 * Small "Report a problem" button (Sentry User Feedback, docs/SENTRY.md). It is
 * rendered only when Sentry is on (a non-empty EU DSN): the feedback
 * integration is added in instrumentation-client.ts only then, so with no DSN
 * this renders nothing. It sends the typed message only (no name, e-mail or
 * screenshot field). Unrelated to any e-mail bug link already in the app.
 *
 * Bottom-right, above the zoom stack (lib/reportButtonPlacement.ts), never over
 * the left toolbar, the zoom buttons or the timeline.
 */
export default function ReportProblemButton() {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [available, setAvailable] = useState(false);
  // Measured `bottom` (px) above the zoom stack; null = no stack on this page.
  const [bottomPx, setBottomPx] = useState<number | null>(null);

  useEffect(() => {
    setAvailable(Boolean(Sentry.getFeedback()));
  }, []);

  useEffect(() => {
    const feedback = Sentry.getFeedback();
    const el = ref.current;
    if (!available || !feedback || !el) return;
    return feedback.attachTo(el);
  }, [available]);

  useEffect(() => {
    if (!available) return;
    const measure = () => {
      const stack = document.querySelector('[data-tour-id="tour-zoom"]');
      const r = stack ? stack.getBoundingClientRect() : null;
      setBottomPx(reportButtonBottomPx(window.innerHeight, r ? { top: r.top, width: r.width, height: r.height } : null));
    };
    measure();
    // The stack appears with the video and moves with the dock / install banner / rotation.
    const timer = window.setInterval(measure, 500);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [available]);

  if (!available) return null;
  return (
    <button
      ref={ref}
      type="button"
      data-testid="report-problem"
      style={{
        position: 'fixed',
        right: 'calc(12px + env(safe-area-inset-right, 0px))',
        bottom: bottomPx != null ? `${bottomPx}px` : REPORT_BUTTON_FALLBACK_BOTTOM,
        zIndex: 60,
        padding: '5px 9px',
        borderRadius: 999,
        border: '1px solid rgba(0,0,0,0.12)',
        background: 'rgba(250,249,247,0.92)',
        color: '#1D1D1F',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.2,
        cursor: 'pointer',
        opacity: 0.8,
      }}
    >
      Report a problem
    </button>
  );
}
