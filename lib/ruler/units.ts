/**
 * Length parsing + display for the ruler's "Length calibration".
 *
 * CANONICAL UNIT IS METERS, everywhere, always. That was already the ruler's
 * convention before this file existed (`RulerCalibration.dstPoints` are meters,
 * `RulerMeasurement.distanceM`, `computeScale(..., realMeters)`), so calibration
 * stays a single unit-agnostic number and the metric/imperial switch is a pure
 * display concern — flipping it re-renders existing measurements and never
 * requires re-calibrating.
 */

export type UnitSystem = 'metric' | 'imperial';

/** Units a coach can type a reference length in. */
export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export const METERS_PER_UNIT: Record<LengthUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
};

export const LENGTH_UNIT_LABEL: Record<LengthUnit, string> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  in: 'in',
  ft: 'ft',
};

/**
 * Standard adult tennis racket length: 27 in = 68.58 cm exactly.
 *
 * NOTE ON THE NUMBER: 27 in is the STANDARD adult racket length (by far the
 * most common size sold), not the ITF maximum. The ITF Rules of Tennis
 * (Appendix II) cap overall frame length at 29 in / 73.66 cm. 27 in is the
 * right default here precisely because it is what almost every adult racket
 * actually measures — but the hint copy says "most adult rackets" rather than
 * quoting a regulation, so a coach with a 27.5 in frame isn't told the wrong
 * number is a rule.
 */
export const RACKET_LENGTH_M = 0.6858;

/** A reference line shorter than this is too short to calibrate from. */
export const MIN_CALIBRATION_PX = 8;

/**
 * Sanity bounds on pixels-per-meter. Outside this range the calibration is
 * almost certainly a mis-click (e.g. a 3-pixel line said to be 20 m, or a
 * full-frame line said to be 1 mm) and would make every later measurement
 * meaningless, so it is rejected rather than silently stored.
 */
export const MIN_SCALE_PX_PER_M = 0.5;
export const MAX_SCALE_PX_PER_M = 100000;

const FT_IN_PATTERNS: RegExp[] = [
  // 5'11"  /  5' 11  /  5'11
  /^(\d+(?:\.\d+)?|\.\d+)\s*'\s*(\d+(?:\.\d+)?|\.\d+)\s*"?$/,
  // 5ft11in  /  5 ft 11 in  /  5 feet 11 inches
  /^(\d+(?:\.\d+)?|\.\d+)\s*(?:ft|foot|feet)\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:in|inch|inches)?$/,
];

const VALUE_UNIT_PATTERN =
  /^(\d+(?:\.\d+)?|\.\d+)\s*(mm|millimeters?|cm|centimeters?|m|meters?|metres?|in|inch|inches|"|ft|foot|feet|')?$/;

function unitTokenToLengthUnit(token: string): LengthUnit | null {
  switch (token) {
    case 'mm': case 'millimeter': case 'millimeters': return 'mm';
    case 'cm': case 'centimeter': case 'centimeters': return 'cm';
    case 'm': case 'meter': case 'meters': case 'metre': case 'metres': return 'm';
    case 'in': case 'inch': case 'inches': case '"': return 'in';
    case 'ft': case 'foot': case 'feet': case "'": return 'ft';
    default: return null;
  }
}

/**
 * Parse a coach-typed reference length into METERS.
 *
 * Accepts a bare number (interpreted with `defaultUnit`, i.e. whatever the unit
 * dropdown is showing), a number with an inline unit ("68.6 cm", "27in",
 * "1.80 m"), or compound feet+inches ("5 ft 11 in", `5'11"`). Returns null for
 * anything unparseable, non-finite, or non-positive — callers must treat null
 * as "don't calibrate" rather than substituting a fallback, since a wrong scale
 * is worse than no scale.
 */
export function parseLengthToMeters(raw: string, defaultUnit: LengthUnit): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  for (const re of FT_IN_PATTERNS) {
    const m = s.match(re);
    if (m) {
      const feet = parseFloat(m[1]);
      const inches = parseFloat(m[2]);
      if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
      const meters = feet * METERS_PER_UNIT.ft + inches * METERS_PER_UNIT.in;
      return meters > 0 && Number.isFinite(meters) ? meters : null;
    }
  }

  const m = s.match(VALUE_UNIT_PATTERN);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = m[2] ? unitTokenToLengthUnit(m[2]) : defaultUnit;
  if (!unit) return null;

  const meters = value * METERS_PER_UNIT[unit];
  return meters > 0 && Number.isFinite(meters) ? meters : null;
}

/** Format a length in meters for display in the chosen system. */
export function formatLength(meters: number, system: UnitSystem): string {
  if (!Number.isFinite(meters)) return '—';
  if (system === 'imperial') {
    const totalInches = meters / METERS_PER_UNIT.in;
    if (totalInches < 12) return `${totalInches.toFixed(1)} in`;
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches - feet * 12;
    // Carry 11.96" up to the next foot rather than rendering 5'12".
    if (inches >= 11.95) return `${feet + 1}'0"`;
    return `${feet}'${inches.toFixed(1)}"`;
  }
  if (meters < 1) return `${(meters * 100).toFixed(1)} cm`;
  return `${meters.toFixed(2)} m`;
}

/**
 * Human-readable scale readout, e.g. "1 cm = 14.6 px" / "1 in = 37.1 px".
 *
 * Phrased per real-world unit rather than per pixel because "1 px = 0.068 cm"
 * is unreadable at typical scales.
 */
export function formatScale(pxPerMeter: number, system: UnitSystem): string {
  if (!Number.isFinite(pxPerMeter) || pxPerMeter <= 0) return '—';
  if (system === 'imperial') {
    return `1 in = ${(pxPerMeter * METERS_PER_UNIT.in).toFixed(1)} px`;
  }
  return `1 cm = ${(pxPerMeter * METERS_PER_UNIT.cm).toFixed(1)} px`;
}

/** Default typing unit for each system — what the dropdown starts on. */
export function defaultUnitFor(system: UnitSystem): LengthUnit {
  return system === 'imperial' ? 'in' : 'cm';
}

/** The racket reference length, pre-filled into the input for the chosen system. */
export function racketPrefill(system: UnitSystem): { value: string; unit: LengthUnit } {
  return system === 'imperial'
    ? { value: '27', unit: 'in' }
    : { value: '68.6', unit: 'cm' };
}
