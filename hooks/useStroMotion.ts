'use client';

import { useCallback, useRef, useState } from 'react';
import {
  clearFrames,
  extractAllFrames,
  type StroMotionStatus,
} from '@/lib/stroMotion';

export interface StroMotionExtractParams {
  /** Sorted video timestamps in seconds */
  times: number[];
}

export interface StroMotionProgress {
  current: number;
  total: number;
}

export function useStroMotion(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [ghostFrames, setGhostFrames] = useState<ImageBitmap[]>([]);
  const [status, setStatus] = useState<StroMotionStatus>('idle');
  const [progress, setProgress] = useState<StroMotionProgress>({ current: 0, total: 0 });
  const extractGenRef = useRef(0);

  const clearGhosts = useCallback(() => {
    setGhostFrames((prev) => {
      clearFrames(prev);
      return [];
    });
    setProgress({ current: 0, total: 0 });
    setStatus('idle');
  }, []);

  const extractFrames = useCallback(
    async (params: StroMotionExtractParams): Promise<ImageBitmap[]> => {
      const video = videoRef.current;
      if (!video || params.times.length < 2) return [];

      if (video.videoWidth === 0 || video.videoHeight === 0) return [];

      const gen = ++extractGenRef.current;

      setGhostFrames((prev) => {
        clearFrames(prev);
        return [];
      });
      setStatus('extracting');
      setProgress({ current: 0, total: params.times.length });

      const isCancelled = () => extractGenRef.current !== gen;

      try {
        const bitmaps = await extractAllFrames(
          video,
          params.times,
          (current, total) => {
            if (isCancelled()) return;
            setProgress({ current, total });
          },
          isCancelled,
        );

        if (isCancelled()) {
          clearFrames(bitmaps);
          return [];
        }

        setGhostFrames(bitmaps);
        setStatus('ready');
        return bitmaps;
      } catch {
        if (!isCancelled()) {
          setGhostFrames((prev) => {
            clearFrames(prev);
            return [];
          });
          setStatus('idle');
        }
        return [];
      } finally {
        if (extractGenRef.current === gen) {
          setProgress((p) => (p.total > 0 ? p : { current: 0, total: 0 }));
        }
      }
    },
    [videoRef],
  );

  const cancelExtraction = useCallback(() => {
    extractGenRef.current += 1;
    setStatus((prev) => (prev === 'extracting' ? 'idle' : prev));
    setProgress({ current: 0, total: 0 });
  }, []);

  const setAnimating = useCallback((animating: boolean) => {
    setStatus((prev) => {
      if (animating) return 'animating';
      if (prev === 'animating') return ghostFrames.length > 0 ? 'ready' : 'idle';
      return prev;
    });
  }, [ghostFrames.length]);

  const setConfiguring = useCallback((configuring: boolean) => {
    setStatus((prev) => {
      if (configuring && prev === 'idle') return 'configuring';
      if (!configuring && prev === 'configuring') return 'idle';
      return prev;
    });
  }, []);

  return {
    ghostFrames,
    status,
    isProcessing: status === 'extracting',
    progress,
    clearGhosts,
    extractFrames,
    cancelExtraction,
    setAnimating,
    setConfiguring,
  };
}
