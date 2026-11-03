'use client';

/**
 * PHONE MEMORY BUDGET for Auto-detect.
 *
 * On an iPhone the tab is killed ("Can't open this page") while Auto-detect runs,
 * with the racket pass on or off (docs/AUTODETECT_END_RELOAD.md). Everything in
 * this file is gated by `isPhoneBudgetActive()`: when it is false, no caller
 * takes a different path, so the desktop behaviour is unchanged.
 *
 * No state, no side effects at import time.
 */

/** Longest edge, in px, of the frames and masks the pass works on, on a phone. */
export const PHONE_MAX_EDGE = 1280;

/**
 * ONNX Runtime session options for the racket models on a phone: do not keep the CPU
 * memory arena or the memory-pattern planner, which retain freed blocks for reuse.
 * Slower only by allocation cost; the arena is what holds the wasm heap high.
 */
export const PHONE_ORT_SESSION_OPTIONS = { enableCpuMemArena: false, enableMemPattern: false } as const;

export interface PhoneEnv {
  /** `window.__stroPhoneBudget`: true forces on, false forces off. */
  override?: boolean | null;
  /** `localStorage 'stroPhoneBudget'`: '1' on, '0' off. */
  stored?: string | null;
  userAgent?: string;
  maxTouchPoints?: number;
  /** `matchMedia('(pointer: coarse)')`. */
  coarsePointer?: boolean;
  /** `Math.min(screen.width, screen.height)` in CSS px. */
  shortSide?: number;
}

/**
 * Is this a phone? Overrides first (so tests and the desktop measurement can force
 * either way), then iPhone/iPod, then Android phones, then "touch-only and small".
 * An iPad is not a phone here (its tab limit is higher), and neither is a desktop.
 */
export function isPhoneEnv(env: PhoneEnv): boolean {
  if (env.override === true) return true;
  if (env.override === false) return false;
  if (env.stored === '1') return true;
  if (env.stored === '0') return false;
  const ua = env.userAgent ?? '';
  if (/iPhone|iPod/i.test(ua)) return true;
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
  // Chrome on iPhone can present a desktop UA in some modes: a coarse pointer on a
  // small screen with touch is a phone, a desktop or an iPad is not.
  if (env.coarsePointer && (env.maxTouchPoints ?? 0) > 0 && (env.shortSide ?? 9999) <= 500) return true;
  return false;
}

export function isPhoneBudgetActive(): boolean {
  if (typeof window === 'undefined') return false;
  let stored: string | null = null;
  try { stored = window.localStorage.getItem('stroPhoneBudget'); } catch { /* storage blocked */ }
  const w = window as unknown as Record<string, unknown>;
  let coarse = false;
  try { coarse = window.matchMedia?.('(pointer: coarse)').matches === true; } catch { /* no matchMedia */ }
  return isPhoneEnv({
    override: typeof w.__stroPhoneBudget === 'boolean' ? (w.__stroPhoneBudget as boolean) : null,
    stored,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    maxTouchPoints: typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0,
    coarsePointer: coarse,
    shortSide: typeof screen !== 'undefined' ? Math.min(screen.width, screen.height) : 9999,
  });
}

export interface ProcessSize {
  w: number;
  h: number;
  /** processing size / native size; 1 means "no cap, take the existing path". */
  scale: number;
}

/** The size the pass works at: native when already within `maxEdge` or when the budget is off. */
export function processingSize(nativeW: number, nativeH: number, enabled: boolean, maxEdge = PHONE_MAX_EDGE): ProcessSize {
  const long = Math.max(nativeW, nativeH);
  if (!enabled || !(long > maxEdge) || !(nativeW > 0) || !(nativeH > 0)) return { w: nativeW, h: nativeH, scale: 1 };
  const scale = maxEdge / long;
  return { w: Math.max(1, Math.round(nativeW * scale)), h: Math.max(1, Math.round(nativeH * scale)), scale };
}

/** Bilinear upscale of a one-byte alpha mask, so soft edges stay soft. */
export function upscaleAlphaMask(
  mask: { width: number; height: number; data: Uint8ClampedArray },
  dw: number,
  dh: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  if (mask.width === dw && mask.height === dh) return mask;
  const { width: sw, height: sh, data: src } = mask;
  const out = new Uint8ClampedArray(dw * dh);
  const xr = sw / dw;
  const yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.max(0, (y + 0.5) * yr - 0.5);
    const y0 = Math.min(sh - 1, Math.floor(fy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.max(0, (x + 0.5) * xr - 0.5);
      const x0 = Math.min(sw - 1, Math.floor(fx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const top = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
      const bot = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
      out[y * dw + x] = Math.round(top * (1 - wy) + bot * wy);
    }
  }
  return { width: dw, height: dh, data: out };
}

// ── crash marker ────────────────────────────────────────────────────────────

export const AUTODETECT_MARKER_KEY = 'anglemotion:autodetect-in-progress';
/** A marker older than this is not a kill from the last run (the coach may have closed the tab). */
export const AUTODETECT_MARKER_MAX_AGE_MS = 30 * 60 * 1000;
export const AUTODETECT_KILLED_NOTICE =
  'Auto-detect was stopped by your phone’s memory. Try a shorter clip.';

interface MarkerStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function realStorage(): MarkerStorage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

/** Set before the heavy phase. Never throws. */
export function markAutoDetectStarted(storage: MarkerStorage | null = realStorage(), now = Date.now()): void {
  try { storage?.setItem(AUTODETECT_MARKER_KEY, String(now)); } catch { /* private mode */ }
}

/** Cleared after the commit (and on every error exit). Never throws. */
export function markAutoDetectFinished(storage: MarkerStorage | null = realStorage()): void {
  try { storage?.removeItem(AUTODETECT_MARKER_KEY); } catch { /* private mode */ }
}

/**
 * On page load: was the last Auto-detect cut short? Clears the marker either way, so
 * the notice shows once. A stale marker (older than the age limit) is ignored.
 */
export function consumeAutoDetectKilled(storage: MarkerStorage | null = realStorage(), now = Date.now()): boolean {
  if (!storage) return false;
  let raw: string | null = null;
  try { raw = storage.getItem(AUTODETECT_MARKER_KEY); } catch { return false; }
  if (raw === null) return false;
  try { storage.removeItem(AUTODETECT_MARKER_KEY); } catch { /* private mode */ }
  const at = Number(raw);
  return Number.isFinite(at) && now - at >= 0 && now - at <= AUTODETECT_MARKER_MAX_AGE_MS;
}
