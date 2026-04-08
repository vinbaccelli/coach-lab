'use client';

export default function ServiceWorkerRegistration() {
  // Service worker registration is disabled to prevent Safari from caching
  // stale Next.js chunks that cause hydration failures.
  return null;
}
