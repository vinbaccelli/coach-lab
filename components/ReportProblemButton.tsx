'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/nextjs';
import { MessageCircle } from 'lucide-react';
import { REPORT_BUTTON_SIZE_PX, reportButtonPosition } from '@/lib/reportButtonPlacement';

/**
 * Small "Report a problem" button (Sentry User Feedback, docs/SENTRY.md). It is
 * rendered only when Sentry is on (a non-empty EU DSN): the feedback
 * integration is added in instrumentation-client.ts only then, so with no DSN
 * this renders nothing. It sends the typed message only (no name, e-mail or
 * screenshot field). Unrelated to any e-mail bug link already in the app.
 *
 * A small round icon-only button on the right edge, below the +B/trash row and
 * above the zoom stack (lib/reportButtonPlacement.ts), kept inside the visual
 * viewport and the safe-area insets in portrait and landscape.
 */
export default function ReportProblemButton() {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [available, setAvailable] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 8, left: 8 });

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
    const box = (sel: string) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
    };
    // Safe-area insets in px: read from a probe, since env() is CSS only.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;'
      + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
    const measure = () => {
      const v = window.visualViewport;
      const vp = v
        ? { offsetTop: v.offsetTop, offsetLeft: v.offsetLeft, width: v.width, height: v.height }
        : { offsetTop: 0, offsetLeft: 0, width: window.innerWidth, height: window.innerHeight };
      const cs = getComputedStyle(probe);
      const insets = {
        top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
        bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0,
      };
      const next = reportButtonPosition(vp, insets, box('[data-tour-id="tour-video-ab"]'), box('[data-tour-id="tour-zoom"]'));
      setPos((p) => (p.top === next.top && p.left === next.left ? p : next));
    };
    measure();
    // The stack appears with the video and moves with the dock / install banner / rotation.
    const timer = window.setInterval(measure, 500);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      probe.remove();
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
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
      aria-label="Report a problem"
      title="Report a problem"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 60,
        width: REPORT_BUTTON_SIZE_PX,
        height: REPORT_BUTTON_SIZE_PX,
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        border: '1px solid rgba(0,0,0,0.12)',
        background: 'rgba(250,249,247,0.7)',
        color: '#1D1D1F',
        cursor: 'pointer',
        opacity: 0.8,
      }}
    >
      <MessageCircle size={18} strokeWidth={2} aria-hidden />
    </button>
  );
}
