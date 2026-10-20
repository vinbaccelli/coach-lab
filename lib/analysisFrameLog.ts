/**
 * On-device diagnostics for the Metrics export's skeleton analysis (?vdebug=1
 * log, KNOWN_ISSUES 061). Watches the analysis video from OUTSIDE the AI Track
 * pass: every `every`-th seek it logs the video's currentTime, the mediaTime of
 * the next frame the browser presents (requestVideoFrameCallback, when the
 * browser has it) and the wall time. A frozen track shows here as a presented
 * mediaTime that stops following currentTime, or seeks faster than frames.
 */

type FrameMeta = { mediaTime?: number };
export type WatchedVideo = Pick<HTMLVideoElement, 'currentTime' | 'addEventListener' | 'removeEventListener'> & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
};

/** Starts the log; returns stop(). `now` is injectable for tests. */
export function watchPassFrames(
  video: WatchedVideo,
  log: (line: string) => void,
  every = 10,
  now: () => number = () => performance.now(),
): () => void {
  const t0 = now();
  let seeks = 0;
  let lastWall = t0;
  let stopped = false;
  const onSeeked = () => {
    seeks++;
    if (seeks % every !== 0) return;
    const n = seeks;
    const t = video.currentTime;
    const wall = now();
    const step = wall - lastWall;
    lastWall = wall;
    const line = (presented: string) =>
      `seek #${n} t=${t.toFixed(3)} ${presented} wall=${Math.round(wall - t0)} ms (+${Math.round(step)})`;
    const rvfc = video.requestVideoFrameCallback;
    if (typeof rvfc !== 'function') { log(line('rvfc=n/a')); return; }
    rvfc.call(video, (_now, meta) => {
      if (stopped) return;
      const mt = meta?.mediaTime;
      log(line(typeof mt === 'number' ? `rvfc mediaTime=${mt.toFixed(3)}` : 'rvfc mediaTime=n/a'));
    });
  };
  video.addEventListener('seeked', onSeeked);
  return () => {
    if (stopped) return;
    stopped = true;
    video.removeEventListener('seeked', onSeeked);
    log(`analysis end: ${seeks} seeks in ${Math.round(now() - t0)} ms`);
  };
}
