/**
 * Diagnostic for the export's analysis by playing (KNOWN_ISSUES 069): short
 * hashes of what the detector was fed and what it returned, so ONE iPhone run
 * shows whether the input never changes, the keypoints never change, or the
 * stored track / the render clock is at fault. Read-only; changes nothing.
 */
export type TraceKp = { x: number; y: number; score?: number; name?: string };

/** The six landmarks hashed per sample (a moving player changes at least one). */
export const TRACE_NAMES = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_wrist', 'right_wrist'] as const;

/** 32-bit FNV-1a over `values >> shift`, as 8 hex digits. Coarse enough to ignore ±noise, fine enough to tell frames apart. */
export function hashBytes(values: ArrayLike<number>, shift = 3): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    h ^= (values[i] as number) >> shift;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Hash of the six landmarks' rounded positions (a missing one counts as -1). */
export function hashKps(kps: ReadonlyArray<TraceKp> | null | undefined): string {
  if (!kps || !kps.length) return 'none';
  const vals: number[] = [];
  for (const name of TRACE_NAMES) {
    const k = kps.find((p) => p.name === name);
    vals.push(k ? Math.round(k.x) : -1, k ? Math.round(k.y) : -1);
  }
  return hashBytes(vals, 0);
}

/** Log a sample line for the first 5 samples and every 15th after. */
export function shouldLogSample(index: number): boolean {
  return index < 5 || index % 15 === 0;
}

export type TraceSummary = {
  samples: number;
  distinctT: number;
  distinctPix: number;
  distinctVid: number;
  distinctKp: number;
  firstT: number | null;
  lastT: number | null;
};

export class TraceStats {
  private ts = new Set<number>();
  private pix = new Set<string>();
  private vid = new Set<string>();
  private kp = new Set<string>();
  private n = 0;
  private first: number | null = null;
  private last: number | null = null;

  /** One sample that found a pose. */
  add(t: number, pixHash: string, vidHash: string, kpHash: string): void {
    this.n++;
    this.ts.add(Math.round(t * 1000));
    this.pix.add(pixHash);
    this.vid.add(vidHash);
    this.kp.add(kpHash);
    this.first = this.first === null ? t : Math.min(this.first, t);
    this.last = this.last === null ? t : Math.max(this.last, t);
  }

  summary(): TraceSummary {
    return {
      samples: this.n, distinctT: this.ts.size, distinctPix: this.pix.size, distinctVid: this.vid.size, distinctKp: this.kp.size,
      firstT: this.first, lastT: this.last,
    };
  }
}

const f3 = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : 'n/a');

export function sampleLine(o: {
  index: number; mediaT: number; currentTime: number; presented: number | null; pix: string; vid: string; kp: string; observedRate: number | null; rateSet: number;
}): string {
  return `trace #${o.index} t=${f3(o.mediaT)} video.currentTime=${f3(o.currentTime)} presentedFrames=${o.presented ?? 'n/a'} `
    + `pixels=${o.pix} video=${o.vid} keypoints=${o.kp} rate=${o.observedRate === null ? 'n/a' : o.observedRate.toFixed(2)}× (set ${o.rateSet}×)`;
}

export function summaryLine(s: TraceSummary, stored: { samples: number; start: number; end: number } | null, observedRate: number | null): string {
  return `trace summary: ${s.samples} samples, times ${f3(s.firstT)}–${f3(s.lastT)} (${s.distinctT} distinct), `
    + `pixel hashes ${s.distinctPix} (video ${s.distinctVid}), keypoint hashes ${s.distinctKp}, observed rate ${observedRate === null ? 'n/a' : observedRate.toFixed(2)}×, `
    + `stored ${stored ? `${stored.samples} samples ${f3(stored.start)}–${f3(stored.end)}` : 'none'}`;
}

/** Did the render's media clock move? It must cover at least half of the exported range (or 0.5 s). */
export function clockMoved(minT: number, maxT: number, spanSec: number): boolean {
  if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return false;
  return maxT - minT >= Math.max(0.5, spanSec * 0.5);
}

/** The one line shown in the panel after the export. */
export function verdictText(o: { pix: number | null; kp: number | null; stored: number | null; clockMoved: boolean | null }): string {
  const analysis = o.pix === null ? '' : `pixel hashes ${o.pix}, keypoint hashes ${o.kp ?? 'n/a'}, stored samples ${o.stored ?? 'n/a'}, `;
  return `trace: ${analysis}render clock moved ${o.clockMoved === null ? 'n/a' : o.clockMoved ? 'yes' : 'no'}`;
}
