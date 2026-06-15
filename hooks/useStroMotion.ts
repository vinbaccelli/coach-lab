'use client';

import { useCallback, useRef, useState } from 'react';
import {
  clearStroMotionResult,
  computeGhostSampleTimes,
  extractStroMotionObjectComposite,
  logStroMotionExtractDiagnostics,
  stroMotionCacheKey,
  type StroMotionDiagnostics,
  type StroMotionResult,
  type StroMotionStatus,
  type StroMotionSubjectBox,
} from '@/lib/stroMotion';

export interface StroMotionExtractParams {
  startSec: number;
  endSec: number;
  ghostCount: number;
  subjectBox: StroMotionSubjectBox;
  /** Pre-computed sample times (Phase A) — skip recompute during Generate */
  sampleTimes?: number[];
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
  const cacheRef = useRef<Map<string, StroMotionResult>>(new Map());

  const evictCachedResult = useCallback((target: StroMotionResult | null) => {
    if (!target) return;
    for (const [key, cached] of cacheRef.current.entries()) {
      if (cached === target) {
        cacheRef.current.delete(key);
        break;
      }
    }
  }, []);

  const clearGhosts = useCallback(() => {
    setResult((prev) => {
      if (prev) {
        evictCachedResult(prev);
        clearStroMotionResult(prev);
      }
      return null;
    });
    for (const entry of cacheRef.current.values()) {
      clearStroMotionResult(entry);
    }
    cacheRef.current.clear();
    setProgress({ current: 0, total: 0 });
    setStatus('idle');
  }, [evictCachedResult]);

  const extractFrames = useCallback(
    async (params: StroMotionExtractParams): Promise<StroMotionResult | null> => {
      const video = videoRef.current;
      if (!video) return null;
      if (params.endSec <= params.startSec) return null;
      if (params.subjectBox.width <= 0 || params.subjectBox.height <= 0) return null;

      const cacheKey = stroMotionCacheKey({
        subjectBox: params.subjectBox,
        startSec: params.startSec,
        endSec: params.endSec,
        ghostCount: params.ghostCount,
      }) + ':object';

      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        setResult((prev) => {
          if (prev && prev !== cached) {
            evictCachedResult(prev);
            clearStroMotionResult(prev);
          }
          return cached;
        });
        setStatus('ready');
        setProgress({ current: cached.ghostLayers.length + 1, total: cached.ghostLayers.length + 1 });
        return cached;
      }

      const gen = ++extractGenRef.current;
      const sampleTimes = params.sampleTimes?.length
        ? params.sampleTimes
        : computeGhostSampleTimes(params.startSec, params.endSec, params.ghostCount);

      setResult((prev) => {
        if (prev) {
          evictCachedResult(prev);
          clearStroMotionResult(prev);
        }
        return null;
      });
      setStatus('extracting');
      setProgress({ current: 0, total: sampleTimes.length + 2 });

      const isCancelled = () => extractGenRef.current !== gen;

      try {
        const composite = await extractStroMotionObjectComposite(
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
          sampleTimes,
        );

        if (isCancelled() || !composite) {
          if (composite) clearStroMotionResult(composite);
          return null;
        }

        await logStroMotionExtractDiagnostics(composite);

        cacheRef.current.clear();
        cacheRef.current.set(cacheKey, composite);

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
    [evictCachedResult, videoRef],
  );

  const cancelExtraction = useCallback(() => {
    extractGenRef.current += 1;
    setStatus((prev) => (prev === 'extracting' ? 'idle' : prev));
    setProgress({ current: 0, total: 0 });
  }, []);

  const invalidateCache = useCallback(() => {
    for (const entry of cacheRef.current.values()) {
      clearStroMotionResult(entry);
    }
    cacheRef.current.clear();
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

  const diagnostics: StroMotionDiagnostics | null = result?.diagnostics ?? null;

  return {
    result,
    status,
    isProcessing: status === 'extracting',
    progress,
    diagnostics,
    clearGhosts,
    extractFrames,
    cancelExtraction,
    invalidateCache,
    setAnimating,
    setConfiguring,
  };
}
