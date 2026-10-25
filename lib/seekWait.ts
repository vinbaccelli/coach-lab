/**
 * The pass's per-frame seek wait (app/analysis/page.tsx runPrecisionPass), pulled
 * out so its timing can be tested. Set currentTime → wait for 'seeked' → wait
 * for one requestVideoFrameCallback so the seeked frame is painted.
 *
 * Fast clips behave as they always did: the wait ends at 'seeked' + the frame,
 * or, when the frame callback never comes, 300 ms after the seek started.
 * What changed (KNOWN_ISSUES 067): that 300 ms used to end the wait even when
 * 'seeked' had NOT fired, and the next seek then cancelled the pending one, so
 * a slow-seeking clip was detected on a stale picture every time. Now a seek
 * that has not completed is waited for, up to SEEK_CAP_MS, and a seek that
 * never completes is reported as stalled so the caller can stop.
 */

/** Longest a single seek may take before the pass gives up. */
export const SEEK_CAP_MS = 4000;
/** Fast path: the wait ends this long after the seek started, whatever the frame callback does. */
export const SEEK_FRAME_FALLBACK_MS = 300;

export type SeekWaitVideo = {
  currentTime: number;
  readonly seeking: boolean;
  addEventListener: (type: 'seeked', fn: () => void, opts?: { once?: boolean }) => void;
  removeEventListener: (type: 'seeked', fn: () => void) => void;
  requestVideoFrameCallback?: (cb: () => void) => number;
};

export type SeekWaitResult = {
  /** The seek never completed within the cap: do not detect, the picture is stale. */
  stalled: boolean;
  /** Milliseconds from the call to the end of the wait. */
  ms: number;
};

export function waitForSeek(vv: SeekWaitVideo, t: number, capMs: number = SEEK_CAP_MS): Promise<SeekWaitResult> {
  return new Promise<SeekWaitResult>((resolve) => {
    const t0 = Date.now();
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let done = false;
    let seeked = false;
    const fin = (stalled: boolean) => {
      if (done) return;
      done = true;
      vv.removeEventListener('seeked', onSeeked);
      vv.removeEventListener('seeked', onPendingDone);
      timers.forEach((id) => clearTimeout(id));
      resolve({ stalled, ms: Date.now() - t0 });
    };
    const rvfc = vv.requestVideoFrameCallback;
    let past300 = false;
    let issued = false;
    const onSeeked = () => {
      seeked = true;
      if (rvfc) {
        rvfc.call(vv, () => fin(false));
        // The fast path's 300 ms timer is already gone: give the frame callback the same grace after a late 'seeked'.
        if (past300) timers.push(setTimeout(() => fin(false), SEEK_FRAME_FALLBACK_MS));
      } else {
        fin(false);
      }
    };
    const issue = () => {
      if (done) return;
      issued = true;
      vv.addEventListener('seeked', onSeeked, { once: true });
      vv.currentTime = t;
      timers.push(setTimeout(() => { past300 = true; if (seeked) fin(false); }, SEEK_FRAME_FALLBACK_MS));
      timers.push(setTimeout(() => { if (!seeked) fin(true); }, capMs));
    };
    // A seek still pending (an earlier one that timed out) must finish before the next one starts.
    const onPendingDone = () => { vv.removeEventListener('seeked', onPendingDone); issue(); };

    if (Math.abs(vv.currentTime - t) < 0.0005 && !vv.seeking) { fin(false); return; }
    if (vv.seeking) {
      vv.addEventListener('seeked', onPendingDone, { once: true });
      timers.push(setTimeout(() => { if (!issued) fin(true); }, capMs));
      return;
    }
    issue();
  });
}
