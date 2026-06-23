'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      process.env.NODE_ENV !== 'production'
    ) return;

    const timeout = setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }, 3000);

    return () => clearTimeout(timeout);
  }, []);

  return null;
}
