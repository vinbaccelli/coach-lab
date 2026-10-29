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
 * Whether the source clip has an audio track, from what the browser can tell us.
 * `audioTracks` (Safari), `mozHasAudio` (Firefox) and the number of audio tracks a
 * captureStream() of the element carries (Chrome) are each only trusted when the browser
 * has that feature; nothing available means 'unknown' (the switch is then shown as usual).
 */
export function sourceAudioFromProbe(p: { audioTracks?: number | null; mozHasAudio?: boolean | null; captureStreamAudio?: number | null }): SourceAudio {
  if (typeof p.audioTracks === 'number') return p.audioTracks > 0 ? 'yes' : 'no';
  if (typeof p.mozHasAudio === 'boolean') return p.mozHasAudio ? 'yes' : 'no';
  if (typeof p.captureStreamAudio === 'number') return p.captureStreamAudio > 0 ? 'yes' : 'no';
  return 'unknown';
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
