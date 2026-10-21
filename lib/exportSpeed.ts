/**
 * Metrics export: slow motion. The hidden video is recorded at a playbackRate,
 * so the file lasts range ÷ speed (the render still runs in real time).
 * Overlays keep using the video's media time; holds keep their own seconds.
 */

export const EXPORT_SPEEDS = [1, 0.5, 0.25, 0.1] as const;
export type ExportSpeed = (typeof EXPORT_SPEEDS)[number];

/** The export speed closest to a timeline rate (in ratio terms); anything above 1× is 1×. */
export function nearestExportSpeed(rate: number | null | undefined): ExportSpeed {
  if (!(typeof rate === 'number') || !Number.isFinite(rate) || rate >= 1) return 1;
  if (rate <= 0) return 1;
  let best: ExportSpeed = 1;
  let bestD = Infinity;
  for (const s of EXPORT_SPEEDS) {
    const d = Math.abs(Math.log(rate / s));
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

export function speedLabel(rate: number): string {
  return `${rate}×`;
}

/** Length of the file: the range at this speed, plus every hold (holds are output seconds). */
export function exportOutputSeconds(spanSec: number, rate: number, holdTotalSec: number): number {
  const r = rate > 0 ? rate : 1;
  return Math.max(0, spanSec) / r + Math.max(0, holdTotalSec);
}

/** Sound is only offered at 1×: slowed audio would be distorted. */
export function soundAvailable(rate: number): boolean {
  return rate === 1;
}

export const SOUND_SLOW_REASON = 'Sound is off in slow motion: it would be distorted.';

/** Whether the file carries sound: the switch is on AND the speed allows it. */
export function soundIncluded(wanted: boolean, rate: number): boolean {
  return wanted && soundAvailable(rate);
}

/** Rates to try, the chosen one first, then each faster export speed down to 1×. */
export function rateCandidates(rate: number): number[] {
  const out: number[] = [rate];
  for (const s of [...EXPORT_SPEEDS].sort((a, b) => a - b)) if (s > rate + 1e-9) out.push(s);
  return out;
}

/** How long the playback probe runs before recording starts. */
export const RATE_PROBE_MS = 1200;

/**
 * Did the video play at about the asked rate? `mediaDelta` seconds of media in
 * `wallSec` seconds of real time. It must move at all, and at between 0.6× and
 * 1.6× of the asked rate (a browser that clamps or ignores the rate, or that
 * stalls, fails).
 */
export function rateWorked(rate: number, mediaDelta: number, wallSec: number): boolean {
  if (!(wallSec > 0) || !(mediaDelta > 0) || !(rate > 0)) return false;
  const observed = mediaDelta / wallSec;
  return observed >= rate * 0.6 && observed <= rate * 1.6;
}

/** The sentence shown when the export had to use another speed. */
export function rateFallbackText(wanted: number, used: number): string {
  return `This device could not play at ${speedLabel(wanted)} while exporting, so the video was exported at ${speedLabel(used)}.`;
}
