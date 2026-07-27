'use client';

// TEMP-DEBUG-VIDEOEL — temporary instrumentation to settle WHICH <video> element
// the StroMotion / Motion Layer capture path actually receives at runtime.
// Delete this file and its call sites (grep TEMP-DEBUG-VIDEOEL) once answered.

/**
 * Log the identity of `video` relative to every <video> in the document:
 * its index in document order, readyState, whether it has a real source, and
 * its dimensions — alongside the same summary for every other video element.
 */
export function probeVideoEl(tag: string, video: HTMLVideoElement | null): void {
  if (typeof document === 'undefined') return;
  const all = Array.from(document.querySelectorAll('video'));
  const describe = (v: HTMLVideoElement) =>
    `rs=${v.readyState} src=${v.currentSrc ? 'YES' : 'no'} ${v.videoWidth}x${v.videoHeight} ` +
    `offsetParent=${v.offsetParent ? 'set' : 'null'}`;
  const idx = video ? all.indexOf(video) : -2;
  console.log(
    `[TEMP-DEBUG-VIDEOEL] ${tag} — target index=${idx} of ${all.length} ` +
      `(${video ? describe(video) : 'TARGET IS NULL'})`,
  );
  all.forEach((v, i) => {
    console.log(`[TEMP-DEBUG-VIDEOEL]    [${i}]${v === video ? ' <== TARGET' : ''} ${describe(v)}`);
  });
}
