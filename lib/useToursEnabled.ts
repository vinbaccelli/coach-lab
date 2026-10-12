'use client';

import { useEffect, useState } from 'react';
import { SS_TOURS_OPT_IN, TOURS_ENABLED_FOR_ALL, resolveToursEnabled } from '@/lib/toursSwitch';

/**
 * The switch as a hook. With the constant on, true from the first render (as
 * before the switch existed). Off, false until mounted, then the URL / session
 * decide — so server and first client render agree and nothing flashes.
 */
export function useToursEnabled(): boolean {
  const [enabled, setEnabled] = useState(TOURS_ENABLED_FOR_ALL);
  useEffect(() => {
    if (TOURS_ENABLED_FOR_ALL) return;
    let optedIn = false;
    try {
      optedIn = window.sessionStorage.getItem(SS_TOURS_OPT_IN) === '1';
    } catch {
      /* private mode */
    }
    const r = resolveToursEnabled(false, window.location.search, optedIn);
    try {
      if (r.store === 'set') window.sessionStorage.setItem(SS_TOURS_OPT_IN, '1');
      else if (r.store === 'clear') window.sessionStorage.removeItem(SS_TOURS_OPT_IN);
    } catch {
      /* private mode: on for this page view only */
    }
    setEnabled(r.enabled);
  }, []);
  return enabled;
}
