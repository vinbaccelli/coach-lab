/**
 * Probe before an AI Track pass (KNOWN_ISSUES 066).
 *
 * On some iPhone files (the first-frame strategy S4/S5 clips) a paused seek never
 * fires 'seeked' and never presents a new frame, so every pass sample reads the
 * same picture and the track is frozen. Before a pass starts, this seeks the
 * video to the range start and a few frames later and checks that
 *   1. 'seeked' fires,
 *   2. the presented frame's time moves (requestVideoFrameCallback, when there is one),
 *   3. the pixels change.
 * If not, it primes the video once (muted play(), pause(), seek back) and probes
 * again. Still dead: the caller stops BEFORE the pass and writes no track.
 *
 * The core is pure (steps are injected) so it is unit-tested; `domProbeDeps`
 * adapts a real <video>.
 */
import { meanAbsDiff, toGrey } from '@/lib/exportOverlay';
import { SEEK_CAP_MS } from '@/lib/seekWait';

export type SeekResult = {
  /** 'seeked' fired within the wait. */
  seeked: boolean;
  /** Media time of the frame the browser presented after the seek; null when it presented none (or no rVFC). */
  presented: number | null;
  /** The browser has requestVideoFrameCallback. */
  hasRvfc: boolean;
  /** Milliseconds from the seek to 'seeked' (or to the timeout). */
  ms: number;
};

export type ProbeDeps = {
  seek: (t: number) => Promise<SeekResult>;
  /** A small greyscale thumbnail of the picture now on the element, or null when it cannot be read. */
  sample: () => ArrayLike<number> | null;
  /** muted play() → pause() → restore; resolves to a short result text. */
  prime: () => Promise<string>;
  log: (line: string) => void;
  aborted: () => boolean;
};

/**
 * `slowMs`: the slowest seek that completed (ms) when it was 300 ms or more —
 * "slow but working" — else null. `tooSlow`: a seek completed but took longer
 * than the pass will wait (SEEK_CAP_MS), so the pass would stop on it.
 */
export type ProbeOutcome = { ok: boolean; primed: boolean; aborted: boolean; slowMs: number | null; tooSlow: boolean };

/** A seek that takes this long or more is "slow" (still working). */
export const SLOW_SEEK_MS = 300;
/** Rough cost of one detection in the pass (ms), for the slow-clip estimate. */
export const DETECT_MS_GUESS = 500;

export type SeekClass = 'fast' | 'slow' | 'too slow' | 'dead';
/** fast < 300 ms ≤ slow ≤ 4000 ms < too slow (completed, but beyond what the pass waits); dead = no 'seeked'. */
export function seekClass(seeked: boolean, ms: number): SeekClass {
  if (!seeked) return 'dead';
  if (ms > SEEK_CAP_MS) return 'too slow';
  return ms >= SLOW_SEEK_MS ? 'slow' : 'fast';
}

/** Seconds the pass is expected to take at this seek latency: every frame pays one seek and one detection. */
export function slowEstimateSec(seekMs: number, spanSec: number, fps: number): number {
  const frames = Math.max(1, Math.ceil(Math.max(0, spanSec) * fps));
  return Math.round((frames * (seekMs + DETECT_MS_GUESS)) / 1000);
}

/** The one-line note for a slow-but-working clip. Ends with "…" so the status toast treats it as progress. */
export function slowNoteText(seconds: number): string {
  const x = seconds >= 120 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
  return `This video seeks slowly: analysis may take about ${x}…`;
}

/** Mean grey-level change (0..255) from which two pictures count as different. */
export const PIXEL_CHANGE_MIN = 0.05;
/** Frames this far apart (seconds) are probed: "a few frames later". */
export const PROBE_STEP_SEC = 0.25;

/** The three seek times: A near the start, B a few frames later, C about a second later (end of range at most). */
export function probeTimes(start: number, end: number): { a: number; b: number; c: number } {
  const span = Math.max(0, end - start);
  const a = start + Math.min(0.04, span * 0.2);
  const room = Math.max(0, end - a);
  const b = a + Math.min(PROBE_STEP_SEC, room * 0.6);
  const c = a + Math.min(1, room);
  return { a, b, c };
}

/** Did the frame time move about as far as the seek did? null when the browser reported none. */
export function frameTimeMoved(
  hasRvfc: boolean, from: number | null, to: number | null, seekDistance: number,
): boolean | null {
  if (!hasRvfc) return null;
  if (from === null || to === null) return false; // no frame was presented after a seek
  return Math.abs(to - from) >= Math.max(0.01, seekDistance * 0.5);
}

/** Pixels differ? null when either picture could not be read. */
export function pixelsDiffer(a: ArrayLike<number> | null, b: ArrayLike<number> | null): boolean | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  return meanAbsDiff(a, b) >= PIXEL_CHANGE_MIN;
}

/** One verdict from the three signals. Unknown (null) signals never fail the probe on their own. */
export function probeVerdict(seeked: boolean, moved: boolean | null, changed: boolean | null): boolean {
  return seeked && moved !== false && changed !== false;
}

const yn = (v: boolean | null) => (v === null ? 'n/a' : v ? 'yes' : 'NO');

type Attempt = { ok: boolean; slowMs: number | null; tooSlow: boolean };

async function attempt(deps: ProbeDeps, start: number, end: number, n: number, label: string): Promise<Attempt | 'aborted'> {
  const { a, b, c } = probeTimes(start, end);
  const sa = await deps.seek(a);
  if (deps.aborted()) return 'aborted';
  const pa = deps.sample();
  const sb = await deps.seek(b);
  if (deps.aborted()) return 'aborted';
  const pb = deps.sample();
  const fired = sa.seeked && sb.seeked;
  let worst = Math.max(sa.seeked ? sa.ms : 0, sb.seeked ? sb.ms : 0);
  const moved = frameTimeMoved(sb.hasRvfc, sa.presented, sb.presented, b - a);
  let changed = pixelsDiffer(pa, pb);
  let extra = '';
  // A still scene can repeat a picture legitimately: look again about a second later before calling it dead.
  if (changed === false && c - b > 0.05 && sb.seeked) {
    const sc = await deps.seek(c);
    if (deps.aborted()) return 'aborted';
    const pc = deps.sample();
    const later = pixelsDiffer(pa, pc);
    extra = ` | again at ${c.toFixed(2)} s: ${yn(later)}`;
    if (later !== false) changed = later;
    if (!sc.seeked) extra += ' (no seeked)'; else worst = Math.max(worst, sc.ms);
  }
  const cls = seekClass(fired, worst);
  const seeked = fired && cls !== 'too slow';
  const ok = probeVerdict(seeked, moved, changed);
  deps.log(
    `${label} attempt ${n}: seek ${a.toFixed(2)}→${b.toFixed(2)} s | seeked fired=${yn(fired)} (${sa.ms} ms, ${sb.ms} ms: ${cls})`
    + ` | frame time moved=${yn(moved)} (${sa.presented?.toFixed(3) ?? '—'}→${sb.presented?.toFixed(3) ?? '—'})`
    + ` | pixels changed=${yn(changed)}${extra} → ${ok ? 'ok' : 'DEAD'}`,
  );
  return { ok, slowMs: ok && worst >= SLOW_SEEK_MS ? worst : null, tooSlow: cls === 'too slow' };
}

/** Probes, primes once if dead, probes again. `label` (strategy, size) is on every log line. */
export async function probeFrames(deps: ProbeDeps, start: number, end: number, label: string): Promise<ProbeOutcome> {
  const first = await attempt(deps, start, end, 1, label);
  if (first === 'aborted') return { ok: false, primed: false, aborted: true, slowMs: null, tooSlow: false };
  if (first.ok) {
    deps.log(`${label} result: ok${first.slowMs !== null ? ` (slow: ${first.slowMs} ms per seek)` : ''}, primed=no`);
    return { ok: true, primed: false, aborted: false, slowMs: first.slowMs, tooSlow: false };
  }
  const primeText = await deps.prime();
  deps.log(`${label} primed once: ${primeText}`);
  if (deps.aborted()) return { ok: false, primed: true, aborted: true, slowMs: null, tooSlow: false };
  const second = await attempt(deps, start, end, 2, label);
  if (second === 'aborted') return { ok: false, primed: true, aborted: true, slowMs: null, tooSlow: false };
  deps.log(
    `${label} result: ${second.ok ? `ok after prime${second.slowMs !== null ? ` (slow: ${second.slowMs} ms per seek)` : ''}` : `DEAD after prime${second.tooSlow ? ' (seeks take longer than the pass waits)' : ''}: no pass, no track`}, primed=yes`,
  );
  return { ok: second.ok, primed: true, aborted: false, slowMs: second.slowMs, tooSlow: second.tooSlow };
}

export const PROBE_DEAD_TEXT = 'This video can’t be analyzed on this device yet; try a re-exported copy.';
/** The pass stopped because one seek never completed (a stale picture would give a frozen track). Reads as an error (closable). */
export const SEEK_STALL_TEXT = 'AI Track stopped: this video stopped answering seeks, so no skeleton was made (it would be frozen). Try a re-exported copy.';
export const PROBE_CHECKING_TEXT = 'Checking the video…';

// ── Browser adapter ─────────────────────────────────────────────────────────

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const SEEK_WAIT_MS = 5000;
const PRESENT_WAIT_MS = 400;
const THUMB = 32;

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime?: number }) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

/** Real-<video> steps for probeFrames. `swallow` mutes the media events of the prime's play/pause. */
export function domProbeDeps(
  video: HTMLVideoElement,
  log: (line: string) => void,
  aborted: () => boolean,
  swallow: (v: HTMLVideoElement) => () => void,
): ProbeDeps {
  const v = video as RvfcVideo;
  const hasRvfc = typeof v.requestVideoFrameCallback === 'function';
  let canvas: HTMLCanvasElement | null = null;
  const seekOnce = (t: number) => new Promise<SeekResult>((resolve) => {
    const t0 = performance.now();
    let presented: number | null = null;
    let handle: number | null = null;
    if (hasRvfc) handle = v.requestVideoFrameCallback!((_n, meta) => { presented = typeof meta?.mediaTime === 'number' ? meta.mediaTime : v.currentTime; });
    let done = false;
    const finish = async (seeked: boolean) => {
      if (done) return;
      done = true;
      v.removeEventListener('seeked', onSeeked);
      const ms = Math.round(performance.now() - t0);
      // After 'seeked', give the browser a moment to present the frame.
      if (hasRvfc && seeked) {
        const until = performance.now() + PRESENT_WAIT_MS;
        while (presented === null && performance.now() < until) await wait(20);
      }
      if (hasRvfc && presented === null && handle !== null) { try { v.cancelVideoFrameCallback?.(handle); } catch { /* noop */ } }
      resolve({ seeked, presented, hasRvfc, ms });
    };
    const onSeeked = () => { void finish(true); };
    v.addEventListener('seeked', onSeeked);
    window.setTimeout(() => { void finish(false); }, SEEK_WAIT_MS);
    try { v.pause(); v.currentTime = t; } catch { void finish(false); }
  });
  return {
    log,
    aborted,
    seek: async (t) => {
      // Never start a second seek while one is pending: it would cancel the first.
      if (v.seeking) {
        const until = performance.now() + SEEK_WAIT_MS;
        while (v.seeking && performance.now() < until) await wait(25);
        if (v.seeking) return { seeked: false, presented: null, hasRvfc, ms: SEEK_WAIT_MS };
      }
      return seekOnce(t);
    },
    sample: () => {
      try {
        if (v.readyState < 2 || !(v.videoWidth > 0)) return null;
        canvas = canvas ?? document.createElement('canvas');
        canvas.width = THUMB; canvas.height = THUMB;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(v, 0, 0, THUMB, THUMB);
        return toGrey(ctx.getImageData(0, 0, THUMB, THUMB).data);
      } catch {
        return null; // cross-origin / unreadable: the pixel signal is unknown, not failed
      }
    },
    prime: async () => {
      const release = swallow(v);
      const wasMuted = v.muted;
      let text = 'play() ok';
      try {
        v.muted = true;
        await Promise.race([v.play(), wait(800).then(() => { throw new Error('play() did not start in 800 ms'); })]);
      } catch (e) {
        text = `play() rejected: ${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`.slice(0, 100);
      } finally {
        try { v.pause(); } catch { /* noop */ }
        await wait(60);
        v.muted = wasMuted;
        await wait(30);
        release();
      }
      return text;
    },
  };
}
