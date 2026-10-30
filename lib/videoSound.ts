/**
 * Sound for the main analysis video: one shared state (mute + volume) for the whole session,
 * a mute button and a volume slider that are ALWAYS available (viewing, recording, after
 * recording, with the Generate panel open), and playback that starts with sound on the
 * coach's tap.
 *
 * NOTHING FORCES THE VIDEO MUTED. The only mute is the coach's own (button, or slider at 0).
 * The one exception is the browser refusing sound for a play(): the video then plays muted and
 * the state says so (so the button tells the truth) until the coach taps unmute.
 *
 * WHY THE VIDEO WAS SILENT. The main <video> carries the `muted` attribute so it may load and
 * seek freely, and the timeline's play button only called play(): nothing ever unmuted it.
 * Now the play TAP applies the state first (iOS allows sound for a play() inside a tap).
 *
 * VOLUME ON iPHONE. `video.volume` is read-only there (always 1). The slider then drives a Web
 * Audio gain node the element is routed through, built only when the slider first goes below
 * full volume (inside that gesture), and only for same-origin media.
 *
 * RECORDING. Recording captures the microphone (or the webcam's audio), never the clip's own
 * sound (components/ScreenRecorder.tsx adds only mic/webcam audio tracks), so the clip is
 * heard in the recording only through the speaker reaching the microphone. That is the
 * coach's choice now: mute, lower the volume, or use headphones.
 */

export interface SoundState {
  /** The coach's mute button. */
  muted: boolean;
  /** 0..1, the slider. */
  volume: number;
}

export const DEFAULT_SOUND: SoundState = { muted: false, volume: 1 };

// ── the shared state: one for the whole session, kept across tools, clips and recordings ──
const STORAGE_KEY = 'anglemotion.sound.v1';
let current: SoundState = DEFAULT_SOUND;
let loaded = false;
const listeners = new Set<() => void>();

export function parseSound(raw: string | null): SoundState {
  try {
    const o = raw ? (JSON.parse(raw) as Partial<SoundState>) : null;
    if (!o) return DEFAULT_SOUND;
    return { muted: o.muted === true, volume: clampVolume(typeof o.volume === 'number' ? o.volume : 1) };
  } catch {
    return DEFAULT_SOUND;
  }
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    current = parseSound(typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null);
  } catch { /* storage blocked: the in-memory state still works */ }
}

export const soundStore = {
  get(): SoundState {
    ensureLoaded();
    return current;
  },
  set(patch: Partial<SoundState>): SoundState {
    ensureLoaded();
    const next: SoundState = { muted: patch.muted ?? current.muted, volume: clampVolume(patch.volume ?? current.volume) };
    if (next.muted === current.muted && next.volume === current.volume) return current;
    current = next;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* noop */ }
    listeners.forEach((l) => l());
    return next;
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  /** For tests. */
  reset(): void {
    current = DEFAULT_SOUND;
    loaded = true;
    listeners.clear();
  },
};

/** What a mute-button tap does: unmute (a volume of 0 comes back to full), or mute. */
export function toggleMuteState(s: SoundState): SoundState {
  return s.muted || s.volume === 0 ? { muted: false, volume: s.volume === 0 ? 1 : s.volume } : { ...s, muted: true };
}

/** What a slider move does: it always unmutes (except at 0, which is silent). */
export function volumeChangeState(volume: number): SoundState {
  return { muted: false, volume: clampVolume(volume) };
}

/** Is the shown state silent? */
export function isSilent(s: SoundState): boolean {
  return s.muted || clampVolume(s.volume) === 0;
}

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/** The element's `muted`: the coach's mute, or a slider at 0. Recording does not mute it. */
export function elementMuted(s: SoundState): boolean {
  return s.muted || clampVolume(s.volume) === 0;
}

/** The gain the Web Audio route applies (iPhone): 0 when muted. */
export function gainValue(s: SoundState): number {
  return elementMuted(s) ? 0 : clampVolume(s.volume);
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
    if (nav.audioSession && nav.audioSession.type === 'auto') nav.audioSession.type = 'playback';
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
export function applySound(video: HTMLMediaElement, s: SoundState, route: VolumeRoute): void {
  video.muted = elementMuted(s);
  if (route === 'element') {
    try { video.volume = clampVolume(s.volume); } catch { /* noop */ }
  }
  const g = graphs.get(video);
  if (g) {
    try { g.gain.gain.value = gainValue(s); } catch { /* noop */ }
    void g.ctx.resume?.().catch(() => {});
  }
}

/** How the slider can change loudness for this element right now. */
export function routeFor(video: HTMLMediaElement): VolumeRoute {
  const w = typeof window !== 'undefined' ? (window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown }) : {};
  return volumeRoute({
    volumeWritable: volumeIsWritable(video),
    webAudio: !!(w.AudioContext ?? w.webkitAudioContext),
    sameOrigin: typeof window !== 'undefined' && isSameOriginMedia(video.currentSrc || video.src, window.location.origin),
  });
}

/**
 * Play with the coach's sound state. Call it inside the tap. If the browser refuses sound the
 * video plays muted and the shared state is set to muted (the button then says so); the coach
 * unmutes with a tap. Resolves false only when even the muted play failed.
 */
export async function playWithSound(video: HTMLMediaElement, route: VolumeRoute): Promise<boolean> {
  applySound(video, soundStore.get(), route);
  try {
    await video.play();
    return true;
  } catch {
    try {
      soundStore.set({ muted: true });
      applySound(video, soundStore.get(), route);
      await video.play();
      return true;
    } catch {
      return false;
    }
  }
}
