/**
 * First frame after a video is loaded into /analysis (KNOWN_ISSUES 055).
 *
 * iOS Safari does not decode a frame of a paused, never-played video by
 * itself: it stops at HAVE_METADATA and the picture stays black until Play.
 * Desktop browsers decode the first frame on their own. Only strategies that
 * cannot affect LOADING are used, after the element already has metadata, and
 * each stops as soon as a frame is there:
 *
 *   S1  tiny seek  currentTime = 0.001
 *   S4  prime      muted play() → pause() → seek back to 0.001, with the media
 *       events of that play/pause swallowed before any app listener sees them
 *       (no pose loop, no playing UI, no A/B sync) and the muted state restored
 *   S5  tap        the first tap on the video area retries S1 + S4 inside the
 *       user gesture
 *
 * NEVER here: changing `src` (no media fragment), `preload`, or calling
 * `load()`. The page sets the src exactly once, as on main. The PR #94 round 2
 * fragment (`blob:…#t=0.001`) made iOS refuse the file ("Could not load this
 * video file", KNOWN_ISSUES 055 round 3).
 *
 * "Decoded" means readyState ≥ HAVE_CURRENT_DATA and a drawImage of the video
 * paints something (any alpha). Nothing here changes how the video plays once
 * it has a frame.
 */

// ── Per-element state (read by the page's error handler and ?vdebug=1) ──────

export type FirstFrameState = {
  /** A strategy has touched the element (seek / play / pause). */
  touched: boolean;
  /** The element reached readyState ≥ 1 (HAVE_METADATA) at some point. */
  reachedMetadata: boolean;
  /** The last strategy step that ran, for the diagnostic. */
  last: string;
};
const states = new WeakMap<HTMLVideoElement, FirstFrameState>();
export function firstFrameState(v: HTMLVideoElement): FirstFrameState | null {
  return states.get(v) ?? null;
}

/**
 * Safety net for the page's 'error' handler: ignore an error only when one of
 * our strategies had touched the element AND it had loaded metadata before (so
 * the file itself loads; the error can only be about what we did). Anything
 * else is shown exactly as on main.
 */
export function ignoreLoadError(state: Pick<FirstFrameState, 'touched' | 'reachedMetadata'> | null): boolean {
  return Boolean(state && state.touched && state.reachedMetadata);
}

/** Is there a decoded frame to show? (readyState ≥ 2 and drawImage paints pixels.) */
export function frameDecoded(v: HTMLVideoElement): boolean {
  if (v.readyState < 2 || !(v.videoWidth > 0) || !(v.videoHeight > 0)) return false;
  try {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    ctx.drawImage(v, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  } catch {
    // A cross-origin stream cannot be read back: trust readyState.
    return true;
  }
}

// ── Diagnostic log (?vdebug=1) ───────────────────────────────────────────────

export type FirstFrameLogLine = { t: number; slot: string; text: string };
const logLines: FirstFrameLogLine[] = [];
const logListeners = new Set<() => void>();
let logT0 = 0;

export function firstFrameLog(slot: string, text: string): void {
  if (!logT0) logT0 = performance.now();
  logLines.push({ t: Math.round(performance.now() - logT0), slot, text });
  if (logLines.length > 80) logLines.splice(0, logLines.length - 80);
  logListeners.forEach((fn) => fn());
}
export function firstFrameLogLines(): readonly FirstFrameLogLine[] { return logLines; }
export function subscribeFirstFrameLog(fn: () => void): () => void {
  logListeners.add(fn);
  return () => { logListeners.delete(fn); };
}

/** blob (upload) / stream (URL) / none, plus "#frag" if the src carries a fragment. */
export function srcKind(src: string | null | undefined): string {
  const s = src || '';
  return `${s.startsWith('blob:') ? 'blob' : s ? 'stream' : 'none'}${s.includes('#') ? '#frag' : ''}`;
}

export function videoStateText(v: HTMLVideoElement): string {
  const err = v.error ? ` ERROR code=${v.error.code}${v.error.message ? ` "${v.error.message}"` : ''}` : '';
  return `rs=${v.readyState} ns=${v.networkState} ${v.videoWidth}x${v.videoHeight} t=${v.currentTime.toFixed(3)} `
    + `${v.paused ? 'paused' : 'playing'} src=${srcKind(v.getAttribute('src') || v.currentSrc)} muted=${v.muted}${err}`;
}

// ── S4: swallow the media events of the prime's own play/pause ──────────────

/** Media events a play() → pause() can fire. */
const PRIME_EVENTS = ['play', 'playing', 'pause', 'timeupdate', 'waiting', 'ratechange', 'volumechange'] as const;

/**
 * While active, stops these events for `video` in the window's capture phase,
 * i.e. before any listener on the element (the app's pose loop, playback UI,
 * A/B sync, timeline) runs. Returns the off switch.
 */
function swallowMediaEvents(video: HTMLVideoElement): () => void {
  const stop = (e: Event) => { if (e.target === video) e.stopImmediatePropagation(); };
  for (const type of PRIME_EVENTS) window.addEventListener(type, stop, true);
  return () => { for (const type of PRIME_EVENTS) window.removeEventListener(type, stop, true); };
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Seek to 0.001 and wait for 'seeked' (or `ms`). */
function nudge(v: HTMLVideoElement, ms = 700): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; v.removeEventListener('seeked', fin); resolve(); } };
    v.addEventListener('seeked', fin);
    window.setTimeout(fin, ms);
    try { v.currentTime = 0.001; } catch { fin(); }
  });
}

/**
 * S4: muted play() then pause(), events swallowed, muted restored, then the
 * normal seek back to 0.001 (its 'seeked' reaches the app as the S1 nudge's
 * does). `startPlay` lets a tap call play() synchronously inside its gesture.
 */
async function prime(
  v: HTMLVideoElement,
  log: (s: string) => void,
  startPlay?: Promise<void> | null,
  wasMuted: boolean = v.muted,
): Promise<void> {
  const release = swallowMediaEvents(v);
  let result = 'ok';
  try {
    v.muted = true;
    const p = startPlay ?? v.play();
    await Promise.race([p, wait(800).then(() => { throw new Error('play() did not start in 800 ms'); })]);
  } catch (e) {
    result = `play() rejected: ${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`.slice(0, 120);
  } finally {
    try { v.pause(); } catch { /* noop */ }
    // The pause/timeupdate events are queued tasks: keep swallowing until they are out.
    await wait(60);
    v.muted = wasMuted;
    await wait(30); // its volumechange, if muted changed
    release();
  }
  log(`S4 prime: ${result}`);
  await nudge(v);
}

/**
 * Runs the strategies for one video load. Returns a cancel function (call it
 * when the source changes or the page unmounts). `tapTarget` is the video's
 * panel, for S5.
 */
export function ensureFirstFrame(
  v: HTMLVideoElement,
  { slot, tapTarget, debug, onFrame }: { slot: string; tapTarget: () => HTMLElement | null; debug: boolean; onFrame?: () => void },
): () => void {
  let cancelled = false;
  let running = false;
  let finished = false;
  // One state per load: the page's effect calls this again for each new src.
  const state: FirstFrameState = { touched: false, reachedMetadata: v.readyState >= 1, last: 'waiting for metadata' };
  states.set(v, state);
  const log = (s: string) => {
    state.last = s;
    if (debug) firstFrameLog(slot, `${s} | ${videoStateText(v)}`);
  };
  const cleanups: Array<() => void> = [];
  const onMetaSeen = () => { state.reachedMetadata = true; };
  v.addEventListener('loadedmetadata', onMetaSeen);
  cleanups.push(() => v.removeEventListener('loadedmetadata', onMetaSeen));

  if (debug) {
    for (const type of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'error', 'abort', 'emptied', 'stalled'] as const) {
      const fn = () => firstFrameLog(slot, `event ${type} | ${videoStateText(v)}`);
      v.addEventListener(type, fn);
      cleanups.push(() => v.removeEventListener(type, fn));
    }
    firstFrameLog(slot, `new load, src=${srcKind(v.getAttribute('src'))} | ${videoStateText(v)}`);
  }

  const succeed = (by: string) => {
    if (finished) return;
    finished = true;
    log(`frame decoded (${by})`);
    onFrame?.();
  };
  // Not ours to touch once the coach plays or has moved the playhead.
  const untouched = () => v.paused && v.currentTime < 0.05;

  const run = async () => {
    if (running || finished || cancelled) return;
    running = true;
    try {
      // Only on an element that has loaded metadata: nothing here may touch a load in progress.
      if (v.readyState < 1 || v.error) return;
      state.reachedMetadata = true;
      if (frameDecoded(v)) { succeed('already'); return; }
      // S1: tiny seek.
      if (untouched()) { state.touched = true; log('S1 seek 0.001'); await nudge(v); log('S1 seek 0.001 done'); }
      if (cancelled) return;
      if (frameDecoded(v)) { succeed('S1'); return; }
      // S4: prime.
      if (untouched() && !v.error) { state.touched = true; log('S4 prime'); await prime(v, log); }
      if (cancelled) return;
      if (frameDecoded(v)) { succeed('S4'); return; }
      log('no frame yet: waiting for a tap on the video (S5)');
      armTap();
    } catch (e) {
      // Never surfaces: the video simply keeps whatever it shows.
      log(`strategy error ignored: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120));
    } finally {
      running = false;
    }
  };

  // S5: retry inside the first tap's gesture (play() must start synchronously there).
  const armTap = () => {
    const el = tapTarget();
    if (!el) { log('S5 unavailable: no video panel'); return; }
    const onTap = () => {
      el.removeEventListener('pointerdown', onTap, true);
      try {
        if (cancelled || finished || v.error || frameDecoded(v)) return;
        if (!untouched()) { log('S5 skipped: video already played or moved'); return; }
        state.touched = true;
        log('S5 tap: retry S1 + S4 in the gesture');
        const wasMuted = v.muted;
        v.muted = true; // prime() restores wasMuted
        let started: Promise<void> | null = null;
        try { started = v.play(); } catch (e) { started = Promise.reject(e); }
        void (async () => {
          try {
            await prime(v, log, started, wasMuted);
            if (!cancelled && frameDecoded(v)) succeed('S5');
            else log('S5: still no frame');
          } catch (e) { log(`S5 error ignored: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120)); }
        })();
      } catch (e) { log(`S5 error ignored: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120)); }
    };
    el.addEventListener('pointerdown', onTap, true);
    cleanups.push(() => el.removeEventListener('pointerdown', onTap, true));
  };

  const onMeta = () => { log('loadedmetadata → run strategies'); void run(); };
  if (v.readyState >= 1) void run();
  else {
    v.addEventListener('loadedmetadata', onMeta, { once: true });
    cleanups.push(() => v.removeEventListener('loadedmetadata', onMeta));
  }
  const onPlayed = () => { if (!finished && !v.paused) { finished = true; log('played by the coach: done'); } };
  v.addEventListener('playing', onPlayed);
  cleanups.push(() => v.removeEventListener('playing', onPlayed));

  return () => { cancelled = true; cleanups.forEach((fn) => fn()); };
}
