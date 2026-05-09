import type { MutableRefObject, RefObject } from 'react';

export type PlaybackBackendKind = 'html5' | 'youtube';

/** Supported YouTube iframe API playback rates (subset used by the player). */
export const YOUTUBE_PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function nearestYoutubePlaybackRate(desired: number): number {
  let best: number = YOUTUBE_PLAYBACK_RATES[0];
  let bestD = Math.abs(desired - best);
  for (const r of YOUTUBE_PLAYBACK_RATES) {
    const d = Math.abs(desired - r);
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

export interface VideoController {
  readonly kind: PlaybackBackendKind;
  play(): Promise<void> | void;
  pause(): void;
  /** Seek to absolute time in seconds */
  seek(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  isPlaying(): boolean;
  stepForward(frameSeconds: number): void;
  stepBackward(frameSeconds: number): void;
}

export function createHtml5VideoController(
  videoRef: RefObject<HTMLVideoElement | null>,
): VideoController {
  return {
    kind: 'html5',
    play() {
      const v = videoRef.current;
      if (!v) return Promise.resolve();
      return v.play();
    },
    pause() {
      videoRef.current?.pause();
    },
    seek(seconds: number) {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(v.duration || seconds, seconds));
    },
    getCurrentTime() {
      return videoRef.current?.currentTime ?? 0;
    },
    getDuration() {
      const d = videoRef.current?.duration;
      return Number.isFinite(d) ? d! : 0;
    },
    setPlaybackRate(rate: number) {
      const v = videoRef.current;
      if (v) v.playbackRate = rate;
    },
    getPlaybackRate() {
      return videoRef.current?.playbackRate ?? 1;
    },
    isPlaying() {
      const v = videoRef.current;
      return v ? !v.paused : false;
    },
    stepForward(frameSeconds: number) {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      v.currentTime = Math.min(v.duration || Infinity, v.currentTime + frameSeconds);
    },
    stepBackward(frameSeconds: number) {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      v.currentTime = Math.max(0, v.currentTime - frameSeconds);
    },
  };
}

export function createYoutubeIframeController(
  playerRef: MutableRefObject<any | null>,
): VideoController {
  return {
    kind: 'youtube',
    play() {
      try {
        playerRef.current?.playVideo?.();
      } catch {
        /* noop */
      }
      return Promise.resolve();
    },
    pause() {
      try {
        playerRef.current?.pauseVideo?.();
      } catch {
        /* noop */
      }
    },
    seek(seconds: number, allowSeekAhead = true) {
      try {
        playerRef.current?.seekTo?.(seconds, allowSeekAhead);
      } catch {
        /* noop */
      }
    },
    getCurrentTime() {
      try {
        const t = Number(playerRef.current?.getCurrentTime?.());
        return Number.isFinite(t) ? t : 0;
      } catch {
        return 0;
      }
    },
    getDuration() {
      try {
        const t = Number(playerRef.current?.getDuration?.());
        return Number.isFinite(t) ? t : 0;
      } catch {
        return 0;
      }
    },
    setPlaybackRate(rate: number) {
      const r = nearestYoutubePlaybackRate(rate);
      try {
        playerRef.current?.setPlaybackRate?.(r);
      } catch {
        /* noop */
      }
    },
    getPlaybackRate() {
      try {
        const r = Number(playerRef.current?.getPlaybackRate?.());
        return Number.isFinite(r) ? r : 1;
      } catch {
        return 1;
      }
    },
    isPlaying() {
      try {
        return playerRef.current?.getPlayerState?.() === 1;
      } catch {
        return false;
      }
    },
    stepForward(frameSeconds: number) {
      try {
        playerRef.current?.pauseVideo?.();
      } catch {
        /* noop */
      }
      let cur = 0;
      try {
        cur = Number(playerRef.current?.getCurrentTime?.()) || 0;
      } catch {
        cur = 0;
      }
      let dur = 0;
      try {
        dur = Number(playerRef.current?.getDuration?.()) || 0;
      } catch {
        dur = 0;
      }
      try {
        playerRef.current?.seekTo?.(Math.min(dur || Infinity, cur + frameSeconds), true);
      } catch {
        /* noop */
      }
    },
    stepBackward(frameSeconds: number) {
      try {
        playerRef.current?.pauseVideo?.();
      } catch {
        /* noop */
      }
      let cur = 0;
      try {
        cur = Number(playerRef.current?.getCurrentTime?.()) || 0;
      } catch {
        cur = 0;
      }
      try {
        playerRef.current?.seekTo?.(Math.max(0, cur - frameSeconds), true);
      } catch {
        /* noop */
      }
    },
  };
}
