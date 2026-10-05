'use client';

import { useEffect, useMemo, useState } from 'react';
import { canUse, NO_ENTITLEMENT, type Entitlement, type Feature } from '@/lib/entitlements';
import { isValidPlanId } from '@/lib/plans';

/**
 * The signed-in coach's entitlement on the client, for LOCKED-STATE UI only.
 * The server is the authority (API guards, middleware); this hook decides what
 * to show. While the entitlement is unknown — loading, signed out, or a read
 * error — nothing is shown as locked (fail open): a wrong lock would block a
 * paying coach, a missed lock is caught by the server.
 */
export function useEntitlement(): { ent: Entitlement | null; can: (f: Feature) => boolean } {
  const [ent, setEnt] = useState<Entitlement | null>(null);

  useEffect(() => {
    // Read after mount (never during render) so server and client render alike.
    const override = devPlanOverride();
    if (override) { setEnt(override); return; }
    let cancelled = false;
    fetch('/api/entitlement', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((e: (Entitlement & { degraded?: boolean }) | null) => {
        if (!cancelled && e && !e.degraded) setEnt(e);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const can = useMemo(() => (f: Feature) => (ent ? canUse(f, ent) : true), [ent]);
  return { ent, can };
}

/**
 * DEV-ONLY plan override for testing locked UI: `?devPlan=light|pro|academy|
 * none|trial|admin` (remembered in sessionStorage for the tab).
 *
 * Impossible in a production build: Next inlines `process.env.NODE_ENV` at
 * build time, so in production this function is `return null` and the
 * override code — including the 'devPlan' key — is removed from the bundle
 * (verified by grepping the production build output; see PR #65). It only
 * ever changes what the UI shows; the server never sees it.
 */
function devPlanOverride(): Entitlement | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (typeof window === 'undefined') return null;
  let v: string | null = null;
  try {
    v = new URLSearchParams(window.location.search).get('devPlan');
    if (v) window.sessionStorage.setItem('am-devPlan', v);
    else v = window.sessionStorage.getItem('am-devPlan');
  } catch { /* storage blocked */ }
  if (!v) return null;
  if (v === 'none') return { ...NO_ENTITLEMENT };
  if (v === 'trial') return { ...NO_ENTITLEMENT, trial: true };
  if (v === 'admin') return { ...NO_ENTITLEMENT, admin: true };
  if (isValidPlanId(v)) return { ...NO_ENTITLEMENT, plan: v, interval: 'year' };
  return null;
}
