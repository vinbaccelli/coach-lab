/**
 * Stuck main video: detection, trace and quiet recovery (KNOWN_ISSUES 074).
 *
 * Symptom (iPhone, Chrome on iOS 18.5, local file, ~1 load in 10): the element says it
 * is playing (`paused` false, readyState 4) while `currentTime` stays at 0.000, and every
 * seek fires 'seeked' at 0.000 without the picture moving. Only a page refresh + upload
 * cleared it. The element itself is wedged (not the app's playing flag: ?vdebug=1 reads
 * `video.paused` directly), so the cure is the same as the refresh: load the same blob
 * again.
 *
 * Two signals, both decided by the pure functions below (tests/seekWait.test.ts):
 *   - playing but the time does not advance for STUCK_MS while nothing explains it
 *     (not seeking, data available, rate > 0, page visible);
 *   - a coach's seek (timeline step / scrub / tap) that ends where it started although
 *     another time was asked, or far from the asked time, and is still wrong a moment later.
 * A healthy video never meets either, so nothing here changes how it behaves.
 *
 * Recovery: pause, `load()` the same src (the blob URL is still valid), restore the time
 * the coach asked for and the playback rate. Never during recording or analysis (the page
 * decides, `canRecover`). At most MAX_RECOVERIES per RECOVERY_WINDOW_MS; after that the
 * coach gets a clear message instead of a reload loop.
 */

export const STUCK_MS = 1000;
/** A seek farther than this from the asked time landed in the wrong place. */
export const SEEK_TOLERANCE_S = 0.25;
/** The asked time differs from the start of the seek by more than this… */
export const SEEK_MIN_MOVE_S = 0.01;
/** …and the seek ended within this of where it started: it did not move at all. */
export const SEEK_NO_MOVE_S = 0.001;
/** A wrong seek is confirmed only if it is still wrong after this long. */
export const SEEK_CONFIRM_MS = 300;
export const MAX_RECOVERIES = 2;
export const RECOVERY_WINDOW_MS = 60_000;
/** Within this of the end, Play starts from the start. */
export const END_EPSILON_S = 0.05;

// ── pure decisions ───────────────────────────────────────────────────────────

export type PlaybackSample = {
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  readyState: number;
  playbackRate: number;
  currentTime: number;
  visible: boolean;
};

/** Could the time be expected to advance right now? */
export function shouldAdvance(s: PlaybackSample): boolean {
  return !s.paused && !s.ended && !s.seeking && s.readyState >= 3 && s.playbackRate > 0 && s.visible;
}

export type AdvanceMark = { time: number; at: number };

/** Track the last moment the time moved (or advancing stopped being expected). */
export function nextAdvanceMark(prev: AdvanceMark | null, s: PlaybackSample, now: number): AdvanceMark {
  if (!prev || !shouldAdvance(s) || s.currentTime !== prev.time) return { time: s.currentTime, at: now };
  return prev;
}

/** Playing, expected to advance, and the time has not moved for STUCK_MS. */
export function isPlayingStuck(mark: AdvanceMark | null, s: PlaybackSample, now: number): boolean {
  return !!mark && shouldAdvance(s) && s.currentTime === mark.time && now - mark.at >= STUCK_MS;
}

/**
 * Did a seek end in the wrong place? `before` is the time when the seek was issued,
 * `requested` the asked time, `actual` the time once it ended.
 */
export function seekLandedWrong(o: { before: number; requested: number; actual: number; duration: number }): boolean {
  const { before, requested, actual, duration } = o;
  if (![before, requested, actual].every(Number.isFinite)) return false;
  const target = Number.isFinite(duration) && duration > 0 ? Math.min(Math.max(requested, 0), duration) : Math.max(requested, 0);
  if (Math.abs(target - before) > SEEK_MIN_MOVE_S && Math.abs(actual - before) <= SEEK_NO_MOVE_S) return true;
  return Math.abs(actual - target) > SEEK_TOLERANCE_S;
}

export type RecoveryPlan = 'reload' | 'message' | 'none';

/** Reload, or (too many reloads lately) tell the coach, or nothing (not allowed now). */
export function recoveryPlan(o: { allowed: boolean; recentRecoveries: readonly number[]; now: number }): RecoveryPlan {
  if (!o.allowed) return 'none';
  const recent = o.recentRecoveries.filter((t) => o.now - t < RECOVERY_WINDOW_MS).length;
  return recent >= MAX_RECOVERIES ? 'message' : 'reload';
}

/** Play on an ended video (or one parked at its very end) starts from the start. */
export function shouldRestartFromStart(o: { ended: boolean; currentTime: number; duration: number }): boolean {
  if (o.ended) return true;
  return Number.isFinite(o.duration) && o.duration > 0 && o.currentTime >= o.duration - END_EPSILON_S;
}

/** Where to put the playhead after a reload: the asked time, kept inside the clip. */
export function resumeTime(asked: number, duration: number): number {
  const t = Number.isFinite(asked) ? Math.max(asked, 0) : 0;
  if (!Number.isFinite(duration) || duration <= 0) return t;
  return Math.min(t, Math.max(0, duration - END_EPSILON_S));
}

// ── browser side ─────────────────────────────────────────────────────────────

export type StuckReason = 'playing but t not advancing' | 'seek ended at the wrong time';

type Watcher = {
  onSeekResult: (before: number, requested: number, actual: number) => void;
};
const watchers = new WeakMap<HTMLMediaElement, Watcher>();

/**
 * The timeline reports each coach seek here once it has ended. No-op unless the page
 * watches this element.
 */
export function reportSeekResult(v: HTMLMediaElement, before: number, requested: number, actual: number): void {
  watchers.get(v)?.onSeekResult(before, requested, actual);
}

export function sampleOf(v: HTMLMediaElement): PlaybackSample {
  return {
    paused: v.paused,
    ended: v.ended,
    seeking: v.seeking,
    readyState: v.readyState,
    playbackRate: v.playbackRate,
    currentTime: v.currentTime,
    visible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
  };
}

/**
 * Watch one element. `onStuck` gets the reason and the time to restore. Poll only while
 * the element plays (started by 'playing', which the first-frame prime swallows, so its
 * own short muted play is never watched).
 */
export function watchStuckPlayback(
  v: HTMLMediaElement,
  { onStuck }: { onStuck: (reason: StuckReason, resumeAt: number, detail: string) => void },
): () => void {
  let mark: AdvanceMark | null = null;
  let poll = 0;
  let confirm = 0;
  // The last time the video was known to be where the coach put it.
  let lastGood = v.currentTime || 0;
  let fired = false;

  const fire = (reason: StuckReason, resumeAt: number, detail: string) => {
    if (fired) return;
    fired = true;
    stopPoll();
    onStuck(reason, resumeAt, detail);
    // Re-arm after the page has acted (a reload resets the element).
    window.setTimeout(() => { fired = false; mark = null; }, STUCK_MS);
  };

  const tick = () => {
    const s = sampleOf(v);
    const now = performance.now();
    if (isPlayingStuck(mark, s, now)) {
      fire('playing but t not advancing', lastGood, `no time change for ${Math.round(now - (mark?.at ?? now))} ms`);
      return;
    }
    const prev = mark;
    mark = nextAdvanceMark(mark, s, now);
    if (prev && shouldAdvance(s) && s.currentTime !== prev.time) lastGood = s.currentTime;
    if (s.paused || s.ended) stopPoll();
  };
  const stopPoll = () => { if (poll) { window.clearInterval(poll); poll = 0; } };
  const onPlaying = () => {
    if (poll) return;
    mark = null;
    tick();
    poll = window.setInterval(tick, 250);
  };

  const watcher: Watcher = {
    onSeekResult: (before, requested, actual) => {
      const duration = v.duration;
      if (!seekLandedWrong({ before, requested, actual, duration })) { lastGood = actual; return; }
      // Confirm: a seek still settling, or overtaken by the coach's next one, is not stuck.
      window.clearTimeout(confirm);
      confirm = window.setTimeout(() => {
        if (v.seeking) return;
        if (!seekLandedWrong({ before, requested, actual: v.currentTime, duration: v.duration })) { lastGood = v.currentTime; return; }
        fire('seek ended at the wrong time', resumeTime(requested, v.duration), `asked ${requested.toFixed(3)} from ${before.toFixed(3)}, ended ${v.currentTime.toFixed(3)}`);
      }, SEEK_CONFIRM_MS);
    },
  };
  // Any newer seek supersedes the one being confirmed.
  const onSeeking = () => window.clearTimeout(confirm);
  watchers.set(v, watcher);
  v.addEventListener('playing', onPlaying);
  v.addEventListener('seeking', onSeeking);
  if (!v.paused) onPlaying();
  return () => {
    stopPoll();
    window.clearTimeout(confirm);
    v.removeEventListener('playing', onPlaying);
    v.removeEventListener('seeking', onSeeking);
    if (watchers.get(v) === watcher) watchers.delete(v);
  };
}

/**
 * The refresh, without the refresh: pause, load the same src again, put the playhead back
 * at `resumeAt` and restore the playback rate. Resolves true once metadata is back and
 * the seek has ended (or timed out); false if the reload failed.
 */
export async function reloadSameSource(v: HTMLMediaElement, resumeAt: number, timeoutMs = 5000): Promise<boolean> {
  const src = v.getAttribute('src');
  if (!src) return false;
  const rate = v.playbackRate;
  try { v.pause(); } catch { /* noop */ }
  const loaded = await new Promise<boolean>((resolve) => {
    let done = false;
    const fin = (ok: boolean) => {
      if (done) return;
      done = true;
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('error', onErr);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const onMeta = () => fin(true);
    const onErr = () => fin(false);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('error', onErr);
    const timer = window.setTimeout(() => fin(v.readyState >= 1), timeoutMs);
    try { v.load(); } catch { fin(false); }
  });
  if (!loaded) return false;
  try { v.playbackRate = rate; } catch { /* noop */ }
  await new Promise<void>((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; v.removeEventListener('seeked', fin); window.clearTimeout(timer); resolve(); } };
    v.addEventListener('seeked', fin);
    const timer = window.setTimeout(fin, 1500);
    // 0.001 rather than 0: the tiny seek also asks iOS for a first frame (lib/firstFrame.ts S1).
    try { v.currentTime = resumeTime(resumeAt, v.duration) || 0.001; } catch { fin(); }
  });
  return true;
}
