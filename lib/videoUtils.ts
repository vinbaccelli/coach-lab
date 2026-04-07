/**
 * Video utilities: frame extraction, frame navigation, slow-motion helpers.
 */

/** Default assumed FPS when metadata is unavailable */
export const DEFAULT_FPS = 30;

/** Step one frame forward */
export function stepForward(video: HTMLVideoElement, fps = DEFAULT_FPS): void {
  video.pause();
  video.currentTime = Math.min(video.duration, video.currentTime + 1 / fps);
}

/** Step one frame backward */
export function stepBackward(video: HTMLVideoElement, fps = DEFAULT_FPS): void {
  video.pause();
  video.currentTime = Math.max(0, video.currentTime - 1 / fps);
}

/** Format seconds as MM:SS.ff */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

/** Extract a single video frame at the given time as an ImageBitmap */
export async function extractFrame(
  video: HTMLVideoElement,
  time: number,
): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const onSeeked = async () => {
      video.removeEventListener('seeked', onSeeked);
      try {
        const bitmap = await createImageBitmap(video);
        resolve(bitmap);
      } catch (e) {
        reject(e);
      }
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

/** Clamp a value between min and max */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Speed steps for the speed selector */
export const SPEED_OPTIONS: { label: string; value: number }[] = [
  { label: '0.25×', value: 0.25 },
  { label: '0.5×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '1.5×', value: 1.5 },
  { label: '2×', value: 2 },
];

/** Skip amount options for the skip forward/back buttons.
 *  Values are in seconds, based on a 60 FPS reference (1 frame = 1/60s).
 *  Actual frame boundaries depend on the video's encoded frame rate.
 */
export const SKIP_OPTIONS: { label: string; value: number }[] = [
  { label: '1f', value: 1 / 60 },
  { label: '10f', value: 10 / 60 },
  { label: '20f', value: 20 / 60 },
];
