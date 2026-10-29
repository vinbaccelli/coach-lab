/**
 * Sound for the main analysis video: unmuted on the coach's play tap, a mute button and a
 * volume slider.
 *
 * WHY THE VIDEO WAS SILENT. The main <video> carries the `muted` attribute (app/analysis/
 * page.tsx) so it may load and seek freely, and the timeline's play button only called
 * play() — nothing ever unmuted it. Now the play TAP unmutes it (iOS allows sound for a play()
 * inside a tap); no play is added that starts without a tap.
 *
 * VOLUME ON iPHONE. `video.volume` is read-only there (always 1). The slider then drives a
 * Web Audio gain node the element is routed through. That route is only built when the coach
 * actually moves the slider below full volume (inside that gesture), so the default path is
 * the plain element, untouched; and only for same-origin media (a cross-origin element without
 * CORS would be silenced by Web Audio).
 *
 * RECORDING. While the coach records (webcam / microphone) the video stays muted, as it always
 * was, so the speaker cannot leak into the microphone.
 */

export interface SoundState {
  /** The coach's mute button. */
  muted: boolean;
  /** 0..1, the slider. */
  volume: number;
}

export const DEFAULT_SOUND: SoundState = { muted: false, volume: 1 };

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/** The element's `muted`: recording forces it; otherwise the button (or a slider at 0) decides. */
export function elementMuted(s: SoundState, forceMute: boolean): boolean {
  return forceMute || s.muted || clampVolume(s.volume) === 0;
}

/** The gain the Web Audio route applies (iPhone): 0 when muted. */
export function gainValue(s: SoundState, forceMute: boolean): number {
  return elementMuted(s, forceMute) ? 0 : clampVolume(s.volume);
}

export type VolumeRoute = 'element' | 'webaudio' | 'none';

/**
 * How the slider changes loudness: the element's own volume when it is writable (desktop,
 * Android); a Web Audio gain when it is not (iPhone) and the media is same-origin; otherwise
 * no slider (the mute button still works).
 */
export function volumeRoute(o: { volumeWritable: boolean; webAudio: boolean; sameOrigin: boolean }): VolumeRoute {
  if (o.volumeWritable) return 'element';
  if (o.webAudio && o.sameOrigin) return 'webaudio';
  return 'none';
}

/** Blob, data and same-origin URLs can go through Web Audio without being silenced. */
export function isSameOriginMedia(src: string | null | undefined, origin: string): boolean {
  if (!src) return false;
  if (src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('/')) return true;
  try {
    return new URL(src).origin === origin;
  } catch {
    return false;
  }
}

/** iPhone: setting `volume` is ignored. Probe by writing and reading back, then restore. */
export function volumeIsWritable(v: { volume: number }): boolean {
  const before = v.volume;
  try {
    const probe = before === 0.5 ? 0.25 : 0.5;
    v.volume = probe;
    const ok = Math.abs(v.volume - probe) < 1e-3;
    v.volume = before;
    return ok;
  } catch {
    return false;
  }
}

// ── browser side ─────────────────────────────────────────────────────────────

type Graph = { ctx: AudioContext; gain: GainNode };
const graphs = new WeakMap<HTMLMediaElement, Graph>();
let sessionSet = false;

/** The Web Audio route for this element, if it has been built. */
export function existingGain(video: HTMLMediaElement): Graph | null {
  return graphs.get(video) ?? null;
}

/**
 * Build (once per element) element → gain → speakers. Call it from inside the coach's gesture
 * (slider input) so the context may start. Returns null when Web Audio is missing.
 */
export function ensureGain(video: HTMLMediaElement): Graph | null {
  const have = graphs.get(video);
  if (have) {
    void have.ctx.resume?.().catch(() => {});
    return have;
  }
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const AC = w.AudioContext ?? w.webkitAudioContext;
  if (!AC) return null;
  try {
    // Web Audio obeys the iPhone's silent switch; plain media playback does not. Ask for the
    // media-playback session so the slider route sounds like the plain element does.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession && nav.audioSession.type === 'auto') {
      nav.audioSession.type = 'playback';
      sessionSet = true;
    }
    const ctx = new AC();
    const gain = ctx.createGain();
    ctx.createMediaElementSource(video).connect(gain);
    gain.connect(ctx.destination);
    void ctx.resume?.().catch(() => {});
    const g = { ctx, gain };
    graphs.set(video, g);
    return g;
  } catch {
    return null;
  }
}

/** Apply the state to the element (and its gain, when the Web Audio route exists). */
export function applySound(video: HTMLMediaElement, s: SoundState, forceMute: boolean, route: VolumeRoute): void {
  video.muted = elementMuted(s, forceMute);
  if (route === 'element') {
    try { video.volume = clampVolume(s.volume); } catch { /* noop */ }
  }
  const g = graphs.get(video);
  if (g) {
    try { g.gain.gain.value = gainValue(s, forceMute); } catch { /* noop */ }
    if (!forceMute) void g.ctx.resume?.().catch(() => {});
  }
  // Recording: hand the audio session back to the system (the microphone needs it).
  if (forceMute && sessionSet) {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try { if (nav.audioSession) nav.audioSession.type = 'auto'; } catch { /* noop */ }
    sessionSet = false;
  }
}
