/**
 * PHONE VIDEO SHRINK — which size a phone should work at. Pure logic, no side effects.
 *
 * A phone cannot say how much memory it has (iOS hides `deviceMemory`), and two phones with the
 * same RAM behave differently. So: a phone starts at 1080p, and every time the phone's memory
 * kills the page during Auto-detect (phoneBudget.ts already records that) the stored tier drops one
 * step. A coach can force a tier with `?shrink=720` (remembered). Off a phone nothing is shrunk,
 * unless `?shrink=` forces it (used to test on a desktop).
 */

/** Tier = the long edge, in px, of the shrunk video (720p = 1280, 1080p = 1920, 540p = 960). */
export const SHRINK_TIERS = [1920, 1280, 960] as const;
export type ShrinkTier = (typeof SHRINK_TIERS)[number];
export const DEFAULT_PHONE_TIER: ShrinkTier = 1920;
export const SHRINK_TIER_KEY = 'anglemotion:shrinkTier';
/** Clips longer than this are not shrunk (the result is kept in memory); they open as they are. */
export const SHRINK_MAX_SECONDS = 5 * 60;

const LABEL_TO_TIER: Record<string, ShrinkTier> = { '1080': 1920, '720': 1280, '540': 960 };
export const tierLabel = (t: ShrinkTier): string => (t === 1920 ? '1080p' : t === 1280 ? '720p' : '540p');

/** Parse a stored / URL value ("1080", "720", "540", or the long edge itself). Anything else: null. */
export function parseTier(v: string | null | undefined): ShrinkTier | null {
  if (!v) return null;
  const k = v.trim().replace(/p$/i, '');
  if (k in LABEL_TO_TIER) return LABEL_TO_TIER[k];
  const n = Number(k);
  return (SHRINK_TIERS as readonly number[]).includes(n) ? (n as ShrinkTier) : null;
}

/** One step down (the floor stays at the lowest tier). */
export function lowerTier(t: ShrinkTier): ShrinkTier {
  const i = SHRINK_TIERS.indexOf(t);
  return SHRINK_TIERS[Math.min(SHRINK_TIERS.length - 1, i + 1)];
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export interface ShrinkInput {
  isPhone: boolean;
  /** Stored tier (localStorage) or null. */
  stored: ShrinkTier | null;
  /** `?shrink=` from the URL or null. Forces shrinking even off a phone. */
  forced: ShrinkTier | null;
  nativeW: number;
  nativeH: number;
  durationSec: number;
}

/**
 * The size to shrink to, or null when the clip should open as it is
 * (not a phone, already small enough, unknown size, or too long).
 */
export function shrinkTarget(i: ShrinkInput): { w: number; h: number; tier: ShrinkTier } | null {
  const tier = i.forced ?? (i.isPhone ? i.stored ?? DEFAULT_PHONE_TIER : null);
  if (!tier) return null;
  if (!(i.nativeW > 0) || !(i.nativeH > 0)) return null;
  if (i.durationSec > SHRINK_MAX_SECONDS) return null;
  const long = Math.max(i.nativeW, i.nativeH);
  if (long <= tier) return null;
  const s = tier / long;
  return { w: even(i.nativeW * s), h: even(i.nativeH * s), tier };
}

/** Bitrate for the shrunk copy: enough for sharp motion, small enough to keep the clip light. */
export function shrinkBitrate(tier: ShrinkTier): number {
  return tier >= 1920 ? 6_000_000 : tier >= 1280 ? 3_500_000 : 2_000_000;
}
