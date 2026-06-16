'use client';

export async function captureVideoFrameAtTime(
  video: HTMLVideoElement,
  timeSec: number,
): Promise<ImageBitmap> {
  const wasPlaying = !video.paused;
  video.pause();

  const target = Math.max(
    0,
    Math.min(timeSec, Number.isFinite(video.duration) ? Math.max(0, video.duration - 1e-6) : timeSec),
  );

  await new Promise<void>((resolve) => {
    if (Math.abs(video.currentTime - target) < 0.001) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = target;
    window.setTimeout(resolve, 2500);
  });

  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  const bitmap = await createImageBitmap(video);
  if (wasPlaying) void video.play().catch(() => {});
  return bitmap;
}
