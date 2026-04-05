'use client';

import { useEffect, useState } from 'react';
import { StroMotionConfig } from '@/lib/stroMotion';

export type { StroMotionConfig };

/** Fallback timeout (ms) if the 'seeked' event never fires for a frame. */
const SEEK_TIMEOUT_MS = 500;

export function useStroMotion(
  videoRef: React.RefObject<HTMLVideoElement>,
  config: StroMotionConfig
) {
  const [ghostFrames, setGhostFrames] = useState<ImageBitmap[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!config.enabled || !videoRef.current || config.ghostCount < 2) return;

    const processGhosts = async () => {
      setIsProcessing(true);
      const video = videoRef.current!;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;

      const frames: ImageBitmap[] = [];
      const step = Math.floor((config.endFrame - config.startFrame) / Math.max(1, config.ghostCount - 1));

      for (let i = 0; i < config.ghostCount; i++) {
        const frame = config.startFrame + i * step;
        const time = frame / 30;

        await new Promise<void>((resolve) => {
          video.currentTime = time;
          const handleSeeked = () => {
            video.removeEventListener('seeked', handleSeeked);
            resolve();
          };
          video.addEventListener('seeked', handleSeeked, { once: true });
          setTimeout(() => {
            video.removeEventListener('seeked', handleSeeked);
            resolve();
          }, SEEK_TIMEOUT_MS);
        });

        ctx.drawImage(video, 0, 0);
        const bitmap = await createImageBitmap(canvas);
        frames.push(bitmap);
        setProgress(Math.floor(((i + 1) / config.ghostCount) * 100));
      }

      setGhostFrames(frames);
      setIsProcessing(false);
      video.currentTime = 0;
    };

    processGhosts();
  }, [config, videoRef]);

  return { ghostFrames, isProcessing, progress };
}
