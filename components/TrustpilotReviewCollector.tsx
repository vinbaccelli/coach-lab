'use client';

/**
 * Trustpilot Review Collector (TrustBox) for the public landing page.
 *
 * - The bootstrap script is loaded async, by this component only, and only once
 *   the widget is within ~600px of the viewport — so it is never requested by
 *   the app, and not at all by visitors who never scroll this far.
 * - Until the script renders the widget (or if it never loads) the plain
 *   "Trustpilot" link from the owner's snippet stays visible, inside a box that
 *   already has the widget's 52px height.
 * - After client-side navigation back to the landing, next/script's onReady
 *   fires again on mount and the widget is rendered explicitly (renderTrustBox).
 * - The widget's iframe is marked `credentialless` as soon as the bootstrap
 *   inserts it, so the site-wide COEP header does not block it
 *   (markCredentialless).
 */

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import {
  REVIEW_COLLECTOR_ATTRS, REVIEW_COLLECTOR_HEIGHT_PX, TRUSTBOX_BOOTSTRAP_SRC, TRUSTPILOT_PROFILE_URL,
  markCredentialless, renderTrustBox, type TrustpilotGlobal,
} from '@/lib/trustpilot';

/**
 * The widget element. Memoised with no props so React never re-renders it: the
 * bootstrap replaces its children (fallback link → iframe), and React must not
 * reconcile them afterwards.
 */
const TrustBoxElement = memo(
  React.forwardRef<HTMLDivElement>(function TrustBoxElement(_props, ref) {
    return (
      <div
        ref={ref}
        className="trustpilot-widget"
        {...REVIEW_COLLECTOR_ATTRS}
        style={{ minHeight: REVIEW_COLLECTOR_HEIGHT_PX }}
      >
        <a
          href={TRUSTPILOT_PROFILE_URL}
          target="_blank"
          rel="noopener"
          style={{ display: 'block', lineHeight: `${REVIEW_COLLECTOR_HEIGHT_PX}px`, textAlign: 'center' }}
        >
          Trustpilot
        </a>
      </div>
    );
  }),
);

export default function TrustpilotReviewCollector() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => { el.querySelectorAll('iframe').forEach((f) => { markCredentialless(f); }); });
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onReady = useCallback(() => {
    renderTrustBox(boxRef.current, (window as unknown as { Trustpilot?: TrustpilotGlobal }).Trustpilot);
  }, []);

  return (
    <>
      <TrustBoxElement ref={boxRef} />
      {near && (
        <Script id="trustpilot-trustbox-bootstrap" src={TRUSTBOX_BOOTSTRAP_SRC} strategy="afterInteractive" onReady={onReady} />
      )}
    </>
  );
}
