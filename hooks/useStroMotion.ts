'use client';

import { useEffect, useRef, useState } from 'react';
import type { StroMotionConfig } from '@/lib/stroMotion';

export type { StroMotionConfig };

/** Assumed frame rate used to convert frame numbers to seek timestamps. */
const FPS = 30;

/** Fallback timeout (ms) for when the 'seeked' event does not fire. */
const SEEK_TIMEOUT_MS = 500;

export function useStroMotion(
  videoRef: React.RefObject<HTMLVideoElement>,
  config: StroMotionConfig
) {
  const [ghostFrames, setGhostFrames] = useState<ImageBitmap[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Keep opacity in a ref so opacity-only changes do not trigger re-extraction.
  const opacityRef = useRef(config.opacity);
  useEffect(() => {
    opacityRef.current = config.opacity;
  }, [config.opacity]);

  const { enabled, startFrame, endFrame, ghostCount } = config;

  useEffect(() => {
    if (!enabled || !videoRef.current || ghostCount < 2) return;
    // Ensure a valid range before processing.
    if (startFrame >= endFrame) return;

    let cancelled = false;

    const processGhosts = async () => {
      setIsProcessing(true);
      const video = videoRef.current!;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;

      const frames: ImageBitmap[] = [];
      const step = Math.floor((endFrame - startFrame) / Math.max(1, ghostCount - 1));

      for (let i = 0; i < ghostCount; i++) {
        if (cancelled) break;

        const frame = startFrame + i * step;
        const time = frame / FPS;

        await new Promise<void>((resolve) => {
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            resolve();
          };

          const timer = setTimeout(settle, SEEK_TIMEOUT_MS);

          video.addEventListener(
            'seeked',
            () => {
              clearTimeout(timer);
              settle();
            },
            { once: true }
          );

          video.currentTime = time;
        });

        if (cancelled) break;

        ctx.drawImage(video, 0, 0);
        const bitmap = await createImageBitmap(canvas);
        frames.push(bitmap);
        setProgress(Math.floor(((i + 1) / ghostCount) * 100));
      }

      if (!cancelled) {
        // Release previous bitmaps before replacing.
        setGhostFrames((prev) => {
          prev.forEach((bm) => bm.close());
          return frames;
        });
        setIsProcessing(false);
        video.currentTime = 0;
      } else {
        // Cancelled mid-run — release any frames already collected.
        frames.forEach((bm) => bm.close());
      }
    };

    processGhosts();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, startFrame, endFrame, ghostCount, videoRef]);

  return { ghostFrames, isProcessing, progress };
}
