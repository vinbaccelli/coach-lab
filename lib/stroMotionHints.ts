/**
 * Small pure helpers for the Motion Layer panel (kept out of the component so they can be tested).
 */

/** m:ss.cc, ROUNDED to hundredths (a frame at 3.199 s reads 0:03.20, never the 0:03.1 a cut-off gave). */
export function formatFrameTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00';
  const total = Math.round(seconds * 100); // hundredths, rounded once so .995 carries into the seconds
  const mins = Math.floor(total / 6000);
  const secs = Math.floor((total % 6000) / 100);
  const hundredths = total % 100;
  return `${mins}:${secs.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
}

/**
 * Why the Generate button is greyed out, in words a coach can act on (the button used to give
 * no reason). Empty string = it is enabled.
 */
export function generateDisabledReason(o: {
  disabled?: boolean;
  isGenerating: boolean;
  isProposingFrame: boolean;
  frameCount: number;
  readyCount: number;
}): string {
  if (o.disabled) return 'Upload a video file first.';
  if (o.isGenerating) return 'Generating the Motion Layer…';
  if (o.isProposingFrame) return 'Finding the player… wait a moment.';
  if (o.frameCount === 0) return 'Add frames first.';
  if (o.readyCount < o.frameCount) {
    const missing = o.frameCount - o.readyCount;
    return `${missing} of ${o.frameCount} frames still need the player marked. Use AI auto-detect, or open a frame and Select Area.`;
  }
  return '';
}
