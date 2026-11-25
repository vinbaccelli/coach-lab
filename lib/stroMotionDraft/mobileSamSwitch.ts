/**
 * The MobileSAM switch. DEFAULT OFF (the model files are not shipped until counsel clears them; docs/MOBILESAM_PROVENANCE.md).
 * On: localStorage 'anglemotion:mobileSam' = '1', or window.__mobileSam = true. Read by the page; the worker is told at init.
 */
export const MOBILE_SAM_KEY = 'anglemotion:mobileSam';

export function mobileSamEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.__mobileSam === 'boolean') return w.__mobileSam;
  try { return window.localStorage.getItem(MOBILE_SAM_KEY) === '1'; } catch { return false; }
}
