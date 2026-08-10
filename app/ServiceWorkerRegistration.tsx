'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // ── DEV: actively tear down any service worker on this origin ──────────
    // Registration below is production-only, but a service worker is scoped to
    // the ORIGIN, not to the build mode: one registered by any earlier
    // production run (or `npm start`) on localhost stays active and keeps
    // intercepting fetches while the dev server is running.
    //
    // That is not benign here. public/sw.js serves JS/CSS
    // stale-while-revalidate (`return cached || networkFetch`), and Next's DEV
    // chunk URLs are stable filenames — e.g.
    // _app-pages-browser_components_Canvas_tsx.js — rather than the
    // content-hashed names a production build emits. Same URL every rebuild
    // means the cached copy keeps winning, the fresh one only lands in cache
    // for NEXT time, and the page runs permanently one reload behind the
    // server. Symptom: edits verifiably present in the served chunk simply do
    // not appear in the browser, which is indistinguishable from "the feature
    // is broken" and costs a debugging cycle every single time.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      // Drop the caches it already populated, otherwise a re-registration
      // later would immediately start serving the same stale chunks again.
      if (typeof caches !== 'undefined') {
        caches.keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
      return;
    }

    const timeout = setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }, 3000);

    return () => clearTimeout(timeout);
  }, []);

  return null;
}
