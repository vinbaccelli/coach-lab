'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Small "Report a problem" button (Sentry User Feedback, docs/SENTRY.md). It is
 * rendered only when Sentry is on (a non-empty EU DSN): the feedback
 * integration is added in instrumentation-client.ts only then, so with no DSN
 * this renders nothing. It sends the typed message only (no name, e-mail or
 * screenshot field). Unrelated to any e-mail bug link already in the app.
 */
export default function ReportProblemButton() {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    setAvailable(Boolean(Sentry.getFeedback()));
  }, []);

  useEffect(() => {
    const feedback = Sentry.getFeedback();
    const el = ref.current;
    if (!available || !feedback || !el) return;
    return feedback.attachTo(el);
  }, [available]);

  if (!available) return null;
  return (
    <button
      ref={ref}
      type="button"
      data-testid="report-problem"
      style={{
        position: 'fixed',
        left: 'max(8px, env(safe-area-inset-left))',
        bottom: 'max(8px, env(safe-area-inset-bottom))',
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
