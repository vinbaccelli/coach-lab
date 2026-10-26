/**
 * The skeleton computed WHILE the Metrics export plays (KNOWN_ISSUES 068), so
 * Generate does not need an AI Track. Some iPhone clips never complete a paused
 * seek (066/067), so any pre-analysis that seeks cannot work on them; live
 * playback does.
 *
 * On a paint of the export loop (lib/cropExport.ts) the frame just drawn is
 * copied to a small scratch canvas (long side <= 512 px) and a stateless
 * MediaPipe detection (detectFullPoseOnBitmap: the model and landmark set the
 * AI Track bake uses, feet included) runs on that copy. Detection is
 * synchronous on the main thread (up to ~70 ms), so it is rate limited: at most
 * one at a time, and the next one starts no sooner than DUTY x the median
 * detection time later (about a third of the main thread). Between detections
 * the last pose is drawn, moved on by its own velocity for a few ms. A frame is
 * never held back for a detection.
 *
 * The core is pure (clock, frame copy, detector and log are injected) so it is
 * unit-tested; `createDomExportPose` adapts the browser.
 */
import { OneEuroKeypointSmoother } from '@/lib/keypointSmooth';

export type Kp = { x: number; y: number; score: number; name: string };
type Sample = { t: number; kps: Kp[] };

/** No pose in this long from the first attempt: the export stops with EXPORT_POSE_FAILED_TEXT. */
export const EXPORT_POSE_GIVE_UP_MS = 4000;
/** Long side of the scratch copy the detector sees. */
export const EXPORT_POSE_MAX_SIDE = 512;
/** The next detection starts DUTY x (median detection time) after the last one ended. */
export const EXPORT_POSE_DUTY = 3;
export const EXPORT_POSE_MIN_INTERVAL_MS = 30;
/** A pose older than this (media seconds) is not drawn any more. */
export const EXPORT_POSE_MAX_AGE_SEC = 0.6;
/** At most this far (media seconds) is a pose moved on by its own velocity. */
export const EXPORT_POSE_MAX_EXTRAP_SEC = 0.08;
const MEDIAN_WINDOW = 15;
const LOG_EVERY_MS = 2000;

export const EXPORT_POSE_FAILED_TEXT =
  'The skeleton could not be detected while exporting this video (no player found, or the detector did not start). Turn Skeleton off to export without it, or try a re-exported copy.';
export const EXPORT_POSE_MODEL_TEXT =
  'The skeleton model could not be loaded. Turn Skeleton off to export without it, or try again.';

/** Scratch size: the frame's aspect ratio, long side at most `maxSide`, never enlarged. */
export function scratchSize(vw: number, vh: number, maxSide = EXPORT_POSE_MAX_SIDE): { w: number; h: number } {
  if (!(vw > 0) || !(vh > 0)) return { w: 0, h: 0 };
  const s = Math.min(1, maxSide / Math.max(vw, vh));
  return { w: Math.max(1, Math.round(vw * s)), h: Math.max(1, Math.round(vh * s)) };
}

export function medianOf(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Wait before the next detection may start. */
export function nextDetectDelayMs(medianDetectMs: number): number {
  return Math.max(EXPORT_POSE_MIN_INTERVAL_MS, EXPORT_POSE_DUTY * medianDetectMs);
}

/** `b` moved on towards `t` by the velocity between `a` and `b` (matched by name); `b` itself when there is nothing to go on. */
export function extrapolatePose(a: Sample | null, b: Sample, t: number): Kp[] {
  const age = t - b.t;
  if (!a || !(age > 0)) return b.kps;
  const span = b.t - a.t;
  if (!(span > 0) || span > 0.5) return b.kps;
  const dt = Math.min(age, EXPORT_POSE_MAX_EXTRAP_SEC, span * 0.5);
  const prev = new Map(a.kps.map((k) => [k.name, k]));
  return b.kps.map((k) => {
    const p = prev.get(k.name);
    if (!p || k.score < 0.15 || p.score < 0.15) return k;
    return { ...k, x: k.x + ((k.x - p.x) / span) * dt, y: k.y + ((k.y - p.y) / span) * dt };
  });
}

export type ExportPoseDeps = {
  now: () => number;
  /** Copies the frame just drawn to the scratch canvas; null when there is no frame to copy. */
  grab: (frameSource: unknown) => { src: unknown; vw: number; vh: number } | null;
  detect: (src: unknown, vw: number, vh: number) => Promise<Kp[] | null>;
  log: (line: string) => void;
  /** No pose within EXPORT_POSE_GIVE_UP_MS: the caller stops the export. */
  onFail: () => void;
};

export class ExportPose {
  private samples: Sample[] = [];
  private smoother = new OneEuroKeypointSmoother();
  private durations: number[] = [];
  private inFlight = false;
  private nextAt = 0;
  private firstAt: number | null = null;
  private failed = false;
  private lastLogAt = 0;
  private frames = 0;
  private skipped = 0;
  private detections = 0;
  private withPose = 0;
  private errors = 0;

  constructor(private d: ExportPoseDeps, private rate = 1) {}

  get hasFailed(): boolean { return this.failed; }

  /** From the paint loop, once per painted frame that needs a live pose. Never throws, never waits. */
  onFrame(mediaT: number, frameSource: unknown): void {
    if (this.failed) return;
    try {
      const n = this.d.now();
      if (this.firstAt === null) this.firstAt = n;
      this.frames++;
      if (this.withPose === 0 && n - this.firstAt >= EXPORT_POSE_GIVE_UP_MS) {
        this.fail('no pose within the give-up time');
        return;
      }
      if (!this.inFlight && n >= this.nextAt) {
        const g = this.d.grab(frameSource);
        if (g) {
          this.start(mediaT, g, n);
        } else this.skipped++;
      } else this.skipped++;
      if (n - this.lastLogAt >= LOG_EVERY_MS) this.logStats(n);
    } catch {
      this.skipped++;
    }
  }

  private start(frameT: number, g: { src: unknown; vw: number; vh: number }, startedAt: number) {
    this.inFlight = true;
    this.detections++;
    this.d.detect(g.src, g.vw, g.vh).then(
      (kps) => this.done(frameT, kps, startedAt),
      () => { this.errors++; this.done(frameT, null, startedAt); },
    );
  }

  private done(frameT: number, kps: Kp[] | null, startedAt: number) {
    const n = this.d.now();
    this.inFlight = false;
    this.durations.push(Math.max(0, n - startedAt));
    if (this.durations.length > MEDIAN_WINDOW) this.durations.shift();
    this.nextAt = n + nextDetectDelayMs(medianOf(this.durations));
    if (this.failed || !kps || !kps.length) return;
    this.withPose++;
    const smoothed = this.smoother.apply(kps, frameT * 1000) as Kp[];
    this.samples.push({ t: frameT, kps: smoothed });
    if (this.samples.length > 2) this.samples.shift();
  }

  /** The pose to draw at media time `t`: the latest detection, moved on a little; null when there is none or it is too old. */
  poseAt(t: number): Kp[] | null {
    const b = this.samples[this.samples.length - 1];
    if (!b) return null;
    const age = t - b.t;
    if (age > EXPORT_POSE_MAX_AGE_SEC || age < -0.3) return null;
    return extrapolatePose(this.samples.length > 1 ? this.samples[0] : null, b, t);
  }

  private fail(reason: string) {
    if (this.failed) return;
    this.failed = true;
    this.d.log(`export pose: FAILED (${reason}) after ${this.detections} detections, ${this.withPose} with a pose`);
    this.d.onFail();
  }

  private logStats(n: number) {
    this.lastLogAt = n;
    this.d.log(this.statsText());
  }

  statsText(): string {
    const med = Math.round(medianOf(this.durations));
    return `export pose: ${this.detections} detections (${this.withPose} with a pose${this.errors ? `, ${this.errors} errors` : ''}), median ${med} ms, `
      + `${this.skipped} of ${this.frames} frames reused the last pose, speed ${this.rate}×`;
  }

  /** The final line for the vdebug box. */
  finish(): void {
    if (this.frames > 0 || this.detections > 0) this.d.log(`${this.statsText()} (final)`);
  }
}

/**
 * Browser adapter: the scratch canvas, MediaPipe (loaded on first use) and
 * the wall clock. `onFail` is called at most once.
 */
export function createDomExportPose(opts: { rate: number; log: (line: string) => void; onFail: () => void }): ExportPose {
  let canvas: HTMLCanvasElement | null = null;
  return new ExportPose({
    now: () => performance.now(),
    grab: (frameSource) => {
      const v = frameSource as HTMLVideoElement | null;
      if (!v || v.readyState < 2 || !(v.videoWidth > 0)) return null;
      const { w, h } = scratchSize(v.videoWidth, v.videoHeight);
      canvas = canvas ?? document.createElement('canvas');
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(v, 0, 0, w, h);
      return { src: canvas, vw: v.videoWidth, vh: v.videoHeight };
    },
    detect: async (src, vw, vh) => {
      const { detectFullPoseOnBitmap } = await import('@/lib/mediapipePose');
      return detectFullPoseOnBitmap(src as HTMLCanvasElement, vw, vh);
    },
    log: opts.log,
    onFail: opts.onFail,
  }, opts.rate);
}
