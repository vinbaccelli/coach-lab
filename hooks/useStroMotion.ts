'use client';

import { useCallback, useRef, useState } from 'react';
import {
  clearStroMotionResult,
  extractStroMotionComposite,
  logStroMotionExtractDiagnostics,
  type StroMotionResult,
  type StroMotionStatus,
  type StroMotionSubjectBox,
} from '@/lib/stroMotion';

export interface StroMotionExtractParams {
  startSec: number;
  endSec: number;
  ghostCount: number;
  subjectBox: StroMotionSubjectBox;
}

export interface StroMotionProgress {
  current: number;
  total: number;
}

export function useStroMotion(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [result, setResult] = useState<StroMotionResult | null>(null);
  const [status, setStatus] = useState<StroMotionStatus>('idle');
  const [progress, setProgress] = useState<StroMotionProgress>({ current: 0, total: 0 });
  const extractGenRef = useRef(0);

  const clearGhosts = useCallback(() => {
    setResult((prev) => {
      clearStroMotionResult(prev);
      return null;
    });
    setProgress({ current: 0, total: 0 });
    setStatus('idle');
  }, []);

  const extractFrames = useCallback(
    async (params: StroMotionExtractParams): Promise<StroMotionResult | null> => {
      const video = videoRef.current;
      if (!video) return null;
      if (params.endSec <= params.startSec) return null;
      if (params.subjectBox.width <= 0 || params.subjectBox.height <= 0) return null;

      const gen = ++extractGenRef.current;

      setResult((prev) => {
        clearStroMotionResult(prev);
        return null;
      });
      setStatus('extracting');
      setProgress({ current: 0, total: params.ghostCount + 1 });

      const isCancelled = () => extractGenRef.current !== gen;

      try {
        const composite = await extractStroMotionComposite(
          video,
          params.startSec,
          params.endSec,
          params.ghostCount,
          params.subjectBox,
          (current, total) => {
            if (isCancelled()) return;
            setProgress({ current, total });
          },
          isCancelled,
        );

        if (isCancelled() || !composite) {
          if (composite) clearStroMotionResult(composite);
          return null;
        }

        await logStroMotionExtractDiagnostics(composite);

        setResult(composite);
        setStatus('ready');
        return composite;
      } catch {
        if (!isCancelled()) {
          setResult((prev) => {
            clearStroMotionResult(prev);
            return null;
          });
          setStatus('idle');
        }
        return null;
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
      if (prev === 'animating') return result ? 'ready' : 'idle';
      return prev;
    });
  }, [result]);

  const setConfiguring = useCallback((configuring: boolean) => {
    setStatus((prev) => {
      if (configuring && prev === 'idle') return 'configuring';
      if (!configuring && prev === 'configuring') return 'idle';
      return prev;
    });
  }, []);

  return {
    result,
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
