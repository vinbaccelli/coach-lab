/**
 * Trustpilot TrustBox (Review Collector) — the config and the one decision the
 * widget component makes, kept pure so tests/trustpilot.test.ts covers them.
 *
 * Values are the owner's public widget snippet (2026-10-12). The profile is the
 * ONE AngleMotion Trustpilot profile (see components/LandingPage.tsx).
 *
 * The widget is rendered by components/TrustpilotReviewCollector.tsx, which is
 * used ONLY on the public landing (components/LandingPage.tsx). The bootstrap
 * script is injected by that component, so no app route (/analysis included)
 * ever requests it on a direct load.
 */

export const TRUSTPILOT_PROFILE_URL = 'https://www.trustpilot.com/review/anglemotion.com';

/**
 * Trustpilot's standard TrustBox bootstrap (v5). Their snippet writes it
 * protocol-relative (`//widget.trustpilot.com/...`); https is pinned here.
 */
export const TRUSTBOX_BOOTSTRAP_SRC = 'https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js';

/** The data-* attributes of the owner's Review Collector snippet, verbatim. */
export const REVIEW_COLLECTOR_ATTRS = {
  'data-locale': 'en-US',
  'data-template-id': '56278e9abfbbba0bdcd568bc',
  'data-businessunit-id': '6a99ec11d6c78a72f845bbda',
  'data-style-height': '52px',
  'data-style-width': '100%',
  'data-token': 'ec082cc8-1747-47ed-bf13-28e8101cc854',
} as const;

/** Height the widget renders at; reserved up front so the layout never jumps. */
export const REVIEW_COLLECTOR_HEIGHT_PX = 52;

/** The part of `window.Trustpilot` the page uses. */
export interface TrustpilotGlobal {
  loadFromElement: (el: HTMLElement, forceReload?: boolean) => void;
}

/**
 * Render the TrustBox in `el` once the bootstrap is ready.
 *
 * On a full page load the bootstrap renders every widget itself when it runs,
 * so an element that already holds the widget's iframe is left alone (no
 * double render). After client-side navigation back to the landing the
 * bootstrap has already run and will not scan again: the fresh element still
 * holds only the fallback link, so it is rendered explicitly.
 */
export function renderTrustBox(
  el: Pick<HTMLElement, 'querySelector'> | null | undefined,
  tp: TrustpilotGlobal | null | undefined,
): 'rendered' | 'already' | 'unavailable' {
  if (!el || !tp || typeof tp.loadFromElement !== 'function') return 'unavailable';
  if (el.querySelector('iframe')) return 'already';
  tp.loadFromElement(el as HTMLElement, true);
  return 'rendered';
}

/**
 * The site sends `Cross-Origin-Embedder-Policy: credentialless` on every page
 * (next.config.js). Under it, Chrome/Edge refuse a cross-origin iframe unless
 * the framed page sends its own COEP header — measured with a stub TrustBox:
 * without that header the widget renders as an empty grey error box. An
 * iframe carrying the `credentialless` attribute is exempt (it loads without
 * cookies instead). The bootstrap creates the iframe itself, so the widget
 * component marks it and restarts its load once; this reports whether it did.
 * Browsers without the attribute (`'credentialless' in iframe` is false) are
 * left alone.
 */
export function markCredentialless(
  iframe: { credentialless?: boolean; hasAttribute: (n: string) => boolean; setAttribute: (n: string, v: string) => void; getAttribute: (n: string) => string | null },
): boolean {
  if (!('credentialless' in iframe) || iframe.hasAttribute('credentialless')) return false;
  iframe.setAttribute('credentialless', '');
  const src = iframe.getAttribute('src');
  // Re-setting src restarts the navigation, now as credentialless.
  if (src) iframe.setAttribute('src', src);
  return true;
}
