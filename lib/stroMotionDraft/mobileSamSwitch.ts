/**
 * MobileSAM (the light Object-select model) is the DEFAULT for the racket worker, which is what phones use. SAM-2 stays as the fallback:
 * the worker tries MobileSAM first and switches to SAM-2 for the rest of the session if MobileSAM cannot load or run.
 *
 * Kill switch: localStorage 'anglemotion:mobileSam' = '0' (or window.__mobileSam = false) forces SAM-2 only; '1' forces MobileSAM on.
 */
export const MOBILE_SAM_KEY = 'anglemotion:mobileSam';

export function mobileSamEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.__mobileSam === 'boolean') return w.__mobileSam;
  try {
    const v = window.localStorage.getItem(MOBILE_SAM_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch { /* storage blocked: use the default */ }
  return true;
}

export type SamBackend = 'mobile' | 'sam2';
let lastBackend: SamBackend | null = null;
/** The worker reports which model actually encoded the last frame (MobileSAM, or SAM-2 after a fallback). */
export function noteSamBackend(b: SamBackend | undefined): void { if (b === 'mobile' || b === 'sam2') lastBackend = b; }
/** True when the Object tool is (or is about to be) running the light model. */
export function samBackendIsMobile(): boolean { return lastBackend ? lastBackend === 'mobile' : mobileSamEnabled(); }
/** Which model last encoded a frame, or null before any Object select ran. Read by the test-build label. */
export function lastSamBackend(): SamBackend | null { return lastBackend; }
/** The label is for test builds only: Vercel previews and local dev, never production (anglemotion.com). */
export function showSamBackendLabel(): boolean { return process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT !== 'production'; }
