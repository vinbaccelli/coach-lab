'use client';

import { useEffect, useState } from 'react';
import { isStandaloneDisplay } from '@/lib/standaloneDisplay';

/** True when the page runs as an installed app (see lib/standaloneDisplay.ts). False on the first render, so it never changes the server HTML. */
export function useStandaloneDisplay(): boolean {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    setStandalone(isStandaloneDisplay(typeof window === 'undefined' ? undefined : (window as unknown as Parameters<typeof isStandaloneDisplay>[0])));
  }, []);
  return standalone;
}
