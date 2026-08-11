'use client';

/**
 * FLAGS for SKELETON-GUIDED AUTO-CORRECTION of the mask.
 *
 * One flag PER FIX, all DEFAULT OFF, so each can be A/B'd on real footage
 * independently and the ones that misfire can be switched off without losing the
 * ones that work. That separation is the point — a single "auto-fix" switch would
 * force the reliable fix and the unreliable one to live or die together.
 *
 * No imports, no state, no side effects, so proposeFrameMask can consult these
 * without pulling any of the correction code into its bundle.
 */

function readFlag(key: string, windowKey: string): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (w[windowKey] === true) return true;
  if (w[windowKey] === false) return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * INTERIOR HOLE FILL — the "space between the legs / arms" fix.
 *
 * OFF by default. Both key spellings work, because both have been written down:
 *   localStorage.setItem('autoHoleFill', '1')   // or 'autoFixHoles'
 *   window.__autoHoleFill = true                // or window.__autoFixHoles
 *
 * See maskAutoFix.ts for what it will and will not touch.
 */
export function autoFixHolesEnabled(): boolean {
  return readFlag('autoHoleFill', '__autoHoleFill') || readFlag('autoFixHoles', '__autoFixHoles');
}

/**
 * BONE-CORE ARM RESCUE — loosens the core's confidence gate for ARMS only.
 *
 * OFF by default:
 *   localStorage.setItem('autoArmRescue', '1')  // or window.__autoArmRescue = true
 *
 * The gate change and its guards are documented on `BoneCoreArmRescue` in
 * skeletonMaskFilter.ts. With this off, the bone core is byte-for-byte unchanged.
 */
export function autoArmRescueEnabled(): boolean {
  return readFlag('autoArmRescue', '__autoArmRescue');
}

/**
 * HAT ALLOWANCE — lets the head zone (and the segmenter crop) reach a little
 * higher, so a cap the model DOES see is no longer clipped off.
 *
 * OFF by default:
 *   localStorage.setItem('autoHatAllowance', '1')  // or window.__autoHatAllowance = true
 *
 * ALLOW-only: it widens what may survive, never what is painted. See
 * `headTopExtraUnits`.
 */
export function autoHatAllowanceEnabled(): boolean {
  return readFlag('autoHatAllowance', '__autoHatAllowance');
}

/**
 * Tuning for the two zone/core opt-ins, in one place so the values the A/B is
 * run with are visible rather than scattered through call sites.
 *
 * ARM: the elbow/wrist floor drops 0.35 → 0.22 while the SHOULDER stays at 0.35,
 * and the bone length must fall in 0.55–1.9 × unit. That band is deliberately
 * wide — it is there to reject the geometrically absurd (a "forearm" a third of a
 * shoulder width long, or twice a whole arm), not to second-guess real anatomy.
 *
 * HAT: 0.12 × headUnit of extra semi-major ⇒ ~0.24 × headUnit of extra height,
 * about 11px on a 46px unit. A cap's brim, not a hairstyle.
 */
export const ARM_RESCUE_TUNING = {
  minScore: 0.22,
  anchorMinScore: 0.35,
  minLenUnits: 0.55,
  maxLenUnits: 1.9,
} as const;

export const HAT_EXTRA_HEAD_UNITS = 0.12;
