/**
 * The export's skeleton analysis BY PLAYING the video (KNOWN_ISSUES 069).
 *
 * Why: AI Track steps through the video with paused seeks; on some iPhone files
 * those never complete (066/067). Detecting while the export itself plays
 * (068) blocks the render on the main thread: the exported video froze and the
 * pose lagged. So this is a separate first pass: the clip plays muted in a
 * hidden element at a slow rate (0.25×, stepping down to 0.1× if detection
 * cannot keep up), every presented frame is detected (stateless MediaPipe on a
 * scratch copy, long side <= 1024 px), keyed by that frame's own media time
 * (requestVideoFrameCallback metadata). The samples go through the existing
 * bake storage (centred, zero-lag smoothing: AI Track quality), and the export
 * then renders as it always did, with no detection in the render.
 *
 * The decisions are a pure class (`PlaybackCollector`) so they are
 * unit-tested; `analyzeByPlaying` drives a real <video>.
 */
import { scratchSize, type Kp } from '@/lib/exportPose';
import { toGrey } from '@/lib/exportOverlay';
import { hashBytes, hashKps, sampleLine, shouldLogSample, summaryLine, TraceStats, type TraceSummary } from '@/lib/traceDiag';

export const ANALYSIS_START_RATE = 0.25;
export const ANALYSIS_RATES = [0.25, 0.15, 0.1] as const;
export const ANALYSIS_MAX_SIDE = 1024;
/** Frames per window in which the share of frames that found the detector busy is judged. */
export const ANALYSIS_EVAL_FRAMES = 20;
/** More than this share of skipped frames in a window → play slower. */
export const ANALYSIS_MAX_SKIP_SHARE = 0.25;
/** This many detections without a single pose: stop early (no player). */
export const ANALYSIS_EARLY_FAIL_DETECTIONS = 40;
/** No new frame for this long (tab visible): the playback stalled. */
export const ANALYSIS_STALL_MS = 6000;

export const ANALYSIS_NO_PLAYER_TEXT =
  'No player was found for the skeleton in this range. Turn Skeleton off to export without it, or choose a range where the player is in view.';
export const ANALYSIS_STALLED_TEXT =
  'The video stopped playing during the skeleton analysis. Try again, or turn Skeleton off to export without it.';

export type PlaybackSample = { t: number; kps: Kp[] };
export type FrameDecision = 'detect' | 'skip' | 'done';

/** The next slower analysis rate, or null at the slowest. */
export function nextLowerRate(rate: number): number | null {
  for (const r of ANALYSIS_RATES) if (r < rate - 1e-9) return r;
  return null;
}

/** About how long analysing `spanSec` takes at `rate` (play time plus a little start-up). */
export function analysisEstimateSec(spanSec: number, rate = ANALYSIS_START_RATE): number {
  return Math.round(Math.max(0, spanSec) / Math.max(0.05, rate) + 2);
}

export class PlaybackCollector {
  private frames = 0;
  private skipped = 0;
  private detections = 0;
  private withPose = 0;
  private winFrames = 0;
  private winSkipped = 0;
  private out: PlaybackSample[] = [];
  private lastPresented: number | null = null;
  private lastMediaT: number | null = null;
  /** The shortest gap between two callbacks seen: one video frame (used when the browser reports no frame counter). */
  private frameInterval = 1 / 30;

  constructor(private range: { start: number; end: number }) {}

  /**
   * A frame was presented at media time `mediaT`; `busy` = the previous detection is still running.
   * `presented` = the browser's presented-frame counter, when it has one. A detection blocks the page
   * for tens of ms and the frames shown meanwhile get no callback at all: they are counted from the
   * counter's jump (or, without it, from the media-time gap), so slow detection slows the playback down.
   */
  onFrame(mediaT: number, busy: boolean, presented: number | null = null): FrameDecision {
    if (mediaT >= this.range.end) return 'done';
    if (mediaT < this.range.start - 0.05) return 'skip'; // before the range (the seek did not land yet): not counted
    let missed = 0;
    if (presented !== null && this.lastPresented !== null) {
      missed = Math.max(0, presented - this.lastPresented - 1);
    } else if (this.lastMediaT !== null && mediaT > this.lastMediaT) {
      const d = mediaT - this.lastMediaT;
      this.frameInterval = Math.max(1 / 120, Math.min(this.frameInterval, d));
      missed = Math.max(0, Math.round(d / this.frameInterval) - 1);
    }
    this.lastPresented = presented;
    this.lastMediaT = mediaT;
    this.frames += 1 + missed;
    this.winFrames += 1 + missed;
    this.skipped += missed;
    this.winSkipped += missed;
    if (busy) { this.skipped++; this.winSkipped++; return 'skip'; }
    this.detections++;
    return 'detect';
  }

  record(mediaT: number, kps: Kp[] | null): void {
    if (!kps || !kps.length) return;
    this.withPose++;
    this.out.push({ t: mediaT, kps });
  }

  /** After a window of frames: the slower rate to use if too many frames found the detector busy, else null. */
  rateAdvice(current: number): number | null {
    if (this.winFrames < ANALYSIS_EVAL_FRAMES) return null;
    const share = this.winSkipped / this.winFrames;
    this.winFrames = 0;
    this.winSkipped = 0;
    return share > ANALYSIS_MAX_SKIP_SHARE ? nextLowerRate(current) : null;
  }

  /** 0..1 over the range. */
  progress(mediaT: number): number {
    const span = this.range.end - this.range.start;
    return span > 0 ? Math.max(0, Math.min(1, (mediaT - this.range.start) / span)) : 0;
  }

  get noPlayerYet(): boolean { return this.detections >= ANALYSIS_EARLY_FAIL_DETECTIONS && this.withPose === 0; }

  /** Poses inside the range (a little margin for the smoothing), in time order, one per media time. */
  samples(): PlaybackSample[] {
    const seen = new Set<number>();
    return this.out
      .filter((s) => s.t >= this.range.start - 0.1 && s.t <= this.range.end + 0.1)
      .sort((a, b) => a.t - b.t)
      .filter((s) => { const k = Math.round(s.t * 1000); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  stats() { return { frames: this.frames, skipped: this.skipped, detections: this.detections, withPose: this.withPose }; }
}

export type PlaybackAnalysisResult =
  | { ok: true; samples: PlaybackSample[]; rate: number; seconds: number; trace: TraceSummary & { observedRate: number | null } }
  | { ok: false; aborted?: boolean; error: string; /** play() was refused (iOS: not inside a tap): ask for a tap and start again. */ needsTap?: boolean };

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime?: number }) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

export type AnalysisSession = {
  video: RvfcVideo;
  /** How the play() that was started inside the tap ended. */
  playOutcome: Promise<'ok' | 'blocked' | 'error'>;
  /** Pauses and unloads the element (call once, when every range is analyzed or the run is over). */
  close: () => void;
};

/**
 * Opens the analysis player and calls play() IMMEDIATELY and synchronously, so
 * it is the first thing the tap's handler does (iOS only allows play() inside
 * the tap; anything awaited before it, such as a fetch or a model download,
 * ends that permission: KNOWN_ISSUES 069). The element loops until the
 * analysis takes over, so waiting for the model does not run it off the end,
 * and it is NOT paused between ranges (a second play() would need another tap).
 * `src` is used as it is (the page's own video URL); a non-blob URL is read
 * with CORS so the canvas copy stays readable.
 */
export function openAnalysisSession(src: string): AnalysisSession {
  const video = document.createElement('video') as RvfcVideo;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.loop = true;
  if (!src.startsWith('blob:')) video.crossOrigin = 'anonymous';
  video.src = src;
  video.playbackRate = ANALYSIS_START_RATE;
  let played: Promise<void>;
  try { played = video.play(); } catch (e) { played = Promise.reject(e); }
  const playOutcome = played.then(
    () => 'ok' as const,
    (e: unknown) => (e instanceof Error && e.name === 'NotAllowedError' ? 'blocked' as const : 'error' as const),
  );
  return {
    video,
    playOutcome,
    close: () => {
      try { video.pause(); } catch { /* noop */ }
      video.removeAttribute('src');
      try { video.load(); } catch { /* noop */ }
    },
  };
}

/**
 * Analyzes [range.start, range.end] on an open session: the player (already
 * playing, muted) is moved to the start and plays that range slowly, detecting
 * every frame it can. One seek to the start (bounded), no other seeks.
 * Cancelable with `signal`. The session is closed by the caller.
 */
export async function analyzeByPlaying(
  session: AnalysisSession,
  range: { start: number; end: number },
  o: { signal?: AbortSignal; onProgress?: (fraction: number) => void; log?: (line: string) => void; trace?: (line: string) => void },
): Promise<PlaybackAnalysisResult> {
  const log = o.log ?? (() => {});
  const trace = o.trace ?? (() => {});
  const video = session.video;
  const t0 = performance.now();
  try {
    if (video.readyState < 1) {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Could not load the video for the skeleton analysis.'));
        o.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    }
    if (o.signal?.aborted) return { ok: false, aborted: true, error: 'Cancelled.' };
    video.loop = false;

    // One seek to the start of the range, bounded: a clip that cannot seek still plays (frames before the range are ignored).
    if (range.start > 0.01) {
      await new Promise<void>((resolve) => {
        const done = () => { video.onseeked = null; resolve(); };
        video.onseeked = done;
        setTimeout(done, 4000);
        o.signal?.addEventListener('abort', done, { once: true });
        try { video.currentTime = range.start; } catch { done(); }
      });
    }
    log(`export pose: analysis start ${range.start.toFixed(2)}–${range.end.toFixed(2)} s, video at ${video.currentTime.toFixed(2)} s`);

    const col = new PlaybackCollector(range);
    const { detectPoseAttemptOnBitmap } = await import('@/lib/mediapipePose');
    let rate = ANALYSIS_START_RATE;
    video.playbackRate = rate;
    trace(`trace: playbackRate set ${rate}×, reads ${video.playbackRate}×, rVFC ${typeof video.requestVideoFrameCallback === 'function' ? 'yes' : 'NO'}, video ${video.videoWidth}x${video.videoHeight}`);
    let canvas: HTMLCanvasElement | null = null;
    // Diagnostic (KNOWN_ISSUES 069): what the detector was fed and what it returned.
    let tiny: HTMLCanvasElement | null = null;
    const stats = new TraceStats();
    const lastLines: string[] = [];
    let ordinal = 0;
    let firstWall: number | null = null;
    let firstMedia = 0;
    let observedRate: number | null = null;
    const hashOf = (source: CanvasImageSource): string => {
      try {
        tiny = tiny ?? document.createElement('canvas');
        tiny.width = 32; tiny.height = 32;
        const c = tiny.getContext('2d', { willReadFrequently: true });
        if (!c) return 'noctx';
        c.drawImage(source, 0, 0, 32, 32);
        return hashBytes(toGrey(c.getImageData(0, 0, 32, 32).data), 3);
      } catch {
        return 'unreadable';
      }
    };
    let busy = false;
    let finished = false;
    let lastFrameAt = performance.now();
    let lastT = -1;
    let lastLogAt = performance.now();
    let failure: string | null = null;
    let finishNow: () => void = () => {};

    const grab = (): { src: HTMLCanvasElement; vw: number; vh: number } | null => {
      if (video.readyState < 2 || !(video.videoWidth > 0)) return null;
      const { w, h } = scratchSize(video.videoWidth, video.videoHeight, ANALYSIS_MAX_SIDE);
      canvas = canvas ?? document.createElement('canvas');
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);
      return { src: canvas, vw: video.videoWidth, vh: video.videoHeight };
    };

    const handle = (mediaT: number, presented: number | null = null) => {
      if (finished || mediaT === lastT) return;
      lastT = mediaT;
      lastFrameAt = performance.now();
      if (firstWall === null && mediaT >= range.start - 0.05) { firstWall = performance.now(); firstMedia = mediaT; }
      else if (firstWall !== null && performance.now() - firstWall > 500) observedRate = (mediaT - firstMedia) / ((performance.now() - firstWall) / 1000);
      const decision = col.onFrame(mediaT, busy, presented);
      if (decision === 'done') { finishNow(); return; }
      if (decision === 'detect') {
        const g = grab();
        if (g) {
          busy = true;
          // What exactly the detector is fed: the scratch canvas (hashed), and the video itself for comparison.
          const pixHash = hashOf(g.src);
          const vidHash = hashOf(video);
          const currentTime = video.currentTime;
          detectPoseAttemptOnBitmap(g.src, g.vw, g.vh, { model: 'full' })
            .then((kps) => {
              col.record(mediaT, kps as Kp[] | null);
              if (kps && kps.length) {
                const kpHash = hashKps(kps);
                stats.add(mediaT, pixHash, vidHash, kpHash);
                const line = sampleLine({ index: ordinal, mediaT, currentTime, presented, pix: pixHash, vid: vidHash, kp: kpHash, observedRate, rateSet: rate });
                if (shouldLogSample(ordinal)) trace(line);
                lastLines.push(line);
                if (lastLines.length > 3) lastLines.shift();
                ordinal++;
              }
            }, () => col.record(mediaT, null))
            .finally(() => {
              busy = false;
              o.onProgress?.(col.progress(mediaT));
              if (col.noPlayerYet && !finished) { failure = ANALYSIS_NO_PLAYER_TEXT; finishNow(); return; }
              const slower = col.rateAdvice(rate);
              if (slower !== null) {
                rate = slower;
                try { video.playbackRate = rate; } catch { /* keep playing */ }
                log(`export pose: detector could not keep up, playing at ${rate}×`);
              }
            });
        }
      }
      if (performance.now() - lastLogAt > 2000) {
        lastLogAt = performance.now();
        const s = col.stats();
        log(`export pose: analysis ${s.detections} detections (${s.withPose} with a pose), ${s.skipped} of ${s.frames} frames skipped, at ${(mediaT).toFixed(2)} s, ${rate}×`);
      }
    };

    // Frame loop: every presented frame (requestVideoFrameCallback), else a poll of currentTime.
    let rvfcHandle: number | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (finished) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        rvfcHandle = video.requestVideoFrameCallback((_n, meta) => {
          arm();
          handle(typeof meta?.mediaTime === 'number' ? meta.mediaTime : video.currentTime, typeof (meta as { presentedFrames?: number })?.presentedFrames === 'number' ? (meta as { presentedFrames?: number }).presentedFrames! : null);
        });
      }
    };

    await new Promise<void>((resolve) => {
      let watchdog: ReturnType<typeof setInterval> | null = null;
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') { try { video.pause(); } catch { /* noop */ } }
        else { lastFrameAt = performance.now(); void video.play().catch(() => {}); }
      };
      finishNow = () => {
        if (finished) return;
        finished = true;
        if (watchdog) clearInterval(watchdog);
        if (pollTimer) clearInterval(pollTimer);
        if (rvfcHandle !== null) { try { video.cancelVideoFrameCallback?.(rvfcHandle); } catch { /* noop */ } }
        document.removeEventListener('visibilitychange', onVisibility);
        // Keep playing (looping): a second play() for the next range would need another tap.
        video.loop = true;
        video.onended = null;
        resolve();
      };
      o.signal?.addEventListener('abort', () => finishNow(), { once: true });
      video.onended = () => finishNow();
      document.addEventListener('visibilitychange', onVisibility);
      if (typeof video.requestVideoFrameCallback === 'function') arm();
      else pollTimer = setInterval(() => handle(video.currentTime), 16);
      watchdog = setInterval(() => {
        if (document.visibilityState === 'hidden') { lastFrameAt = performance.now(); return; }
        if (performance.now() - lastFrameAt > ANALYSIS_STALL_MS) { failure = ANALYSIS_STALLED_TEXT; finishNow(); }
      }, 1000);
      if (video.paused) {
        video.play().catch((e) => {
          failure = `The video could not be played for the skeleton analysis (${e instanceof Error ? e.name : 'error'}).`;
          finishNow();
        });
      }
    });

    if (o.signal?.aborted) return { ok: false, aborted: true, error: 'Cancelled.' };
    // Let a detection that was running finish and be recorded.
    for (let i = 0; i < 100 && busy; i++) await new Promise((r) => setTimeout(r, 20));
    const samples = col.samples();
    const s = col.stats();
    const seconds = (performance.now() - t0) / 1000;
    log(`export pose: analysis done: ${s.detections} detections (${s.withPose} with a pose) of ${s.frames} frames, ${s.skipped} skipped, `
      + `last rate ${rate}×, ${seconds.toFixed(1)} s${failure ? `, stopped: ${failure}` : ''}`);
    // The last three sample lines (they were not on the every-15th schedule), then the totals.
    for (const l of lastLines) trace(`${l} (last)`);
    const summary = stats.summary();
    trace(summaryLine(summary, null, observedRate));
    if (failure) return { ok: false, error: failure };
    if (samples.length < 2) return { ok: false, error: ANALYSIS_NO_PLAYER_TEXT };
    return { ok: true, samples, rate, seconds, trace: { ...summary, observedRate } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The skeleton analysis failed.' };
  }
}
