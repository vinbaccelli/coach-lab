/**
 * What the mask editor says when Object select (SAM-2) cannot load. The model needs about 850 MB of working
 * memory whatever the video's size is (its input is a fixed 1024 px square), so on a phone the usual cause is
 * "not enough free memory right now", and the useful advice is different from a missing-file error.
 */
export function objectSelectUnavailableNote(reason: string): string {
  const r = reason.trim().slice(0, 160);
  if (/memory/i.test(r)) {
    return 'Object select needs more memory than this phone has free right now (it does not depend on the video size). '
      + 'Close other apps and browser tabs, then tap the video to try again. Add, Remove and Flood work without it.';
  }
  return 'Object select unavailable — the segmenter could not load on this machine.' + (r ? ` Reason: ${r}` : '');
}
