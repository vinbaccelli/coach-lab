/**
 * Metrics export: slow motion. The hidden video is recorded at a playbackRate,
 * so the file lasts range ÷ speed (the render still runs in real time).
 * Overlays keep using the video's media time; holds keep their own seconds.
 */

export const EXPORT_SPEEDS = [1, 0.5, 0.25, 0.1] as const;
export type ExportSpeed = (typeof EXPORT_SPEEDS)[number];

/** The export speed closest to a timeline rate (in ratio terms); anything above 1× is 1×. */
export function nearestExportSpeed(rate: number | null | undefined): ExportSpeed {
  if (!(typeof rate === 'number') || !Number.isFinite(rate) || rate >= 1) return 1;
  if (rate <= 0) return 1;
  let best: ExportSpeed = 1;
  let bestD = Infinity;
  for (const s of EXPORT_SPEEDS) {
    const d = Math.abs(Math.log(rate / s));
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

export function speedLabel(rate: number): string {
  return `${rate}×`;
}

/** Length of the file: the range at this speed, plus every hold (holds are output seconds). */
export function exportOutputSeconds(spanSec: number, rate: number, holdTotalSec: number): number {
  const r = rate > 0 ? rate : 1;
  return Math.max(0, spanSec) / r + Math.max(0, holdTotalSec);
}

/**
 * SOUND. The speed never turns sound off: at 0.5×, 0.25× and 0.1× the recording's sound is
 * kept and simply plays slowed (and lower), which is what a coach reviewing a stroke expects.
 * Only two things decide it: the coach's switch, and whether the clip HAS sound.
 */
export type SourceAudio = 'yes' | 'no' | 'unknown';

export const NO_SOUND_NOTICE = 'This clip has no sound.';

/**
 * What the browser's own element APIs say about the clip's sound: `audioTracks` (Safari),
 * `mozHasAudio` (Firefox), the audio tracks of a captureStream() of the element (Chrome).
 *
 * ONLY A POSITIVE ANSWER IS TRUSTED. A zero or `false` here is NOT proof of silence: on iPhone
 * `audioTracks` exists but can be empty for a clip that has sound (a detached element that
 * has only read metadata), which is exactly how a clip with sound was labelled "This clip has
 * no sound". "No sound" is only ever concluded from the file itself (`sourceAudioVerdict`).
 */
export function sourceAudioFromProbe(p: { audioTracks?: number | null; mozHasAudio?: boolean | null; captureStreamAudio?: number | null }): SourceAudio {
  if (typeof p.audioTracks === 'number' && p.audioTracks > 0) return 'yes';
  if (p.mozHasAudio === true) return 'yes';
  if (typeof p.captureStreamAudio === 'number' && p.captureStreamAudio > 0) return 'yes';
  return 'unknown';
}

/** What the file's own container says. `certain` only when its track list was actually read. */
export interface ContainerAudio {
  kind: 'mp4' | 'webm' | 'unknown';
  audioTracks: number | null;
  certain: boolean;
  reason: string;
}

const MP4_TOP_LEVEL = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'uuid', 'meta', 'moof', 'mfra', 'sidx', 'styp', 'prft', 'emsg', 'pdin']);

const ascii4 = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

/** One MP4/MOV box header at `off`: size in bytes (0 = to end of file), type, header length. */
export function mp4BoxHeader(bytes: Uint8Array, off = 0): { size: number; type: string; header: number } | null {
  if (bytes.length < off + 8) return null;
  const size32 = ((bytes[off] << 24) >>> 0) + (bytes[off + 1] << 16) + (bytes[off + 2] << 8) + bytes[off + 3];
  const type = ascii4(bytes, off + 4);
  if (!/^[\x20-\x7e]{4}$/.test(type)) return null;
  if (size32 === 1) {
    if (bytes.length < off + 16) return null;
    let size = 0;
    for (let k = 0; k < 8; k++) size = size * 256 + bytes[off + 8 + k];
    return { size, type, header: 16 };
  }
  return { size: size32, type, header: 8 };
}

/** True when these first bytes look like an MP4 / MOV (a known top-level box first). */
export function looksLikeMp4(head: Uint8Array): boolean {
  const h = mp4BoxHeader(head, 0);
  return !!h && MP4_TOP_LEVEL.has(h.type) && (h.size === 0 || h.size >= 8);
}

/** Audio tracks in a complete `moov` box: one handler of type `soun` per audio track. */
export function audioTracksInMoov(moov: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 16 <= moov.length; i++) {
    if (moov[i] === 0x68 && ascii4(moov, i) === 'hdlr' && ascii4(moov, i + 12) === 'soun') { n++; i += 15; }
  }
  return n;
}

/**
 * A WebM's audio tracks from its first bytes: certain only when the Tracks element
 * (ID 0x1654AE6B) is in them; then each audio codec id (A_OPUS, A_VORBIS, A_AAC…) is one track.
 */
export function webmAudioFromHead(head: Uint8Array): ContainerAudio {
  let tracksAt = -1;
  for (let i = 0; i + 4 <= head.length; i++) {
    if (head[i] === 0x16 && head[i + 1] === 0x54 && head[i + 2] === 0xae && head[i + 3] === 0x6b) { tracksAt = i; break; }
  }
  if (tracksAt === -1) return { kind: 'webm', audioTracks: null, certain: false, reason: 'webm: track list not in the first bytes' };
  let n = 0;
  for (let i = tracksAt; i + 3 <= head.length; i++) {
    if (head[i] === 0x41 && head[i + 1] === 0x5f && head[i + 2] >= 0x41 && head[i + 2] <= 0x5a) {
      // "A_" + an upper-case codec name inside the track list.
      if (i >= 2 && head[i - 2] === 0x86) { n++; i += 2; }
    }
  }
  return { kind: 'webm', audioTracks: n, certain: true, reason: `webm: ${n} audio track(s) in the track list` };
}

/**
 * The final answer for the sound switch: "no sound" ONLY when the file's own track list was
 * read and has no audio. Anything uncertain shows the switch.
 */
export function sourceAudioVerdict(container: ContainerAudio | null, element: SourceAudio): { audio: SourceAudio; reason: string } {
  if (container?.certain && typeof container.audioTracks === 'number') {
    return container.audioTracks > 0
      ? { audio: 'yes', reason: container.reason }
      : { audio: 'no', reason: container.reason };
  }
  if (element === 'yes') return { audio: 'yes', reason: `${container ? `${container.reason}; ` : ''}the browser reports an audio track` };
  return { audio: 'unknown', reason: `${container ? container.reason : 'file not read'}; the browser cannot tell — the switch is shown` };
}

export interface ExportAudioPlan {
  /** The file is asked to carry the clip's sound. */
  included: boolean;
  /** Show the sound switch (false: the clip has no sound, a notice is shown instead). */
  showToggle: boolean;
  notice: string | null;
  /**
   * Browsers keep the pitch of slowed audio by default. For the export it is turned off
   * (the element's `preservesPitch = false`), so slow motion sounds slowed down.
   */
  preservesPitch: false;
}

export function exportAudioPlan(input: { wanted: boolean; source: SourceAudio; rate: number }): ExportAudioPlan {
  const has = input.source !== 'no';
  return {
    included: input.wanted && has,
    showToggle: has,
    notice: has ? null : NO_SOUND_NOTICE,
    preservesPitch: false,
  };
}

/** The shorter name the render uses: does this export carry sound? */
export function soundIncluded(wanted: boolean, source: SourceAudio, rate = 1): boolean {
  return exportAudioPlan({ wanted, source, rate }).included;
}

/**
 * Audio tracks in a recorded file, read from its container bytes (no decoding): an MP4 has one
 * `hdlr` box of type `soun` per audio track; a WebM names each audio codec (A_OPUS, A_VORBIS…).
 * `null` when the bytes are neither. Give it the start AND end of the file for big files.
 */
export function countAudioTracksInContainer(bytes: Uint8Array): number | null {
  const tag = (i: number, s: string) => {
    for (let k = 0; k < s.length; k++) if (bytes[i + k] !== s.charCodeAt(k)) return false;
    return true;
  };
  const isMp4 = bytes.length > 12 && tag(4, 'ftyp');
  const isWebm = bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (!isMp4 && !isWebm) return null;
  let n = 0;
  for (let i = 0; i < bytes.length - 16; i++) {
    if (isMp4) {
      if (bytes[i] === 0x68 && tag(i, 'hdlr') && tag(i + 12, 'soun')) { n++; i += 15; }
    } else if (bytes[i] === 0x41 && bytes[i + 1] === 0x5f) {
      if (tag(i, 'A_OPUS') || tag(i, 'A_VORBIS') || tag(i, 'A_AAC') || tag(i, 'A_MPEG')) { n++; i += 5; }
    }
  }
  return n;
}

/** Rates to try, the chosen one first, then each faster export speed down to 1×. */
export function rateCandidates(rate: number): number[] {
  const out: number[] = [rate];
  for (const s of [...EXPORT_SPEEDS].sort((a, b) => a - b)) if (s > rate + 1e-9) out.push(s);
  return out;
}

/** How long the playback probe runs before recording starts. */
export const RATE_PROBE_MS = 1200;

/**
 * Did the video play at about the asked rate? `mediaDelta` seconds of media in
 * `wallSec` seconds of real time. It must move at all, and at between 0.6× and
 * 1.6× of the asked rate (a browser that clamps or ignores the rate, or that
 * stalls, fails).
 */
export function rateWorked(rate: number, mediaDelta: number, wallSec: number): boolean {
  if (!(wallSec > 0) || !(mediaDelta > 0) || !(rate > 0)) return false;
  const observed = mediaDelta / wallSec;
  return observed >= rate * 0.6 && observed <= rate * 1.6;
}

/** The sentence shown when the export had to use another speed. */
export function rateFallbackText(wanted: number, used: number): string {
  return `This device could not play at ${speedLabel(wanted)} while exporting, so the video was exported at ${speedLabel(used)}.`;
}
