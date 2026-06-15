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
import {
  trackObjectFrameStops,
  type StroMotionFrameStop,
} from '@/lib/stroMotionObjectTrack';

export type { StroMotionFrameStop };

export interface StroMotionExtractParams {
  startSec: number;
  endSec: number;
  ghostCount: number;
  subjectBox: StroMotionSubjectBox;
  sampleTimes?: number[];
  frameStops?: StroMotionFrameStop[];
}

export interface StroMotionProgress {
  current: number;
  total: number;
}

export function useStroMotion(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [result, setResult] = useState<StroMotionResult | null>(null);
  const [status, setStatus] = useState<StroMotionStatus>('idle');
  const [progress, setProgress] = useState<StroMotionProgress>({ current: 0, total: 0 });
  const [frameStops, setFrameStops] = useState<StroMotionFrameStop[]>([]);
  const [isTracking, setIsTracking] = useState(false);
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
    setFrameStops([]);
    setProgress({ current: 0, total: 0 });
    setStatus('idle');
  }, [evictCachedResult]);

  const invalidateCache = useCallback(() => {
    for (const entry of cacheRef.current.values()) {
      clearStroMotionResult(entry);
    }
    cacheRef.current.clear();
  }, []);

  const clearFrameStops = useCallback(() => {
    setFrameStops([]);
    invalidateCache();
  }, [invalidateCache]);

  const detectFrameStops = useCallback(async (params: {
    startSec: number;
    endSec: number;
    ghostCount: number;
    seedBox: StroMotionSubjectBox;
    sampleTimes?: number[];
  }): Promise<StroMotionFrameStop[]> => {
    const video = videoRef.current;
    if (!video || params.endSec <= params.startSec) return [];

    const sampleTimes = params.sampleTimes?.length
      ? params.sampleTimes
      : computeGhostSampleTimes(params.startSec, params.endSec, params.ghostCount);

    setIsTracking(true);
    setProgress({ current: 0, total: sampleTimes.length });
    setStatus('configuring');

    try {
      const stops = await trackObjectFrameStops(
        video,
        sampleTimes,
        params.seedBox,
        (current, total) => setProgress({ current, total }),
      );
      setFrameStops(stops);
      invalidateCache();
      setResult((prev) => {
        if (prev) {
          evictCachedResult(prev);
          clearStroMotionResult(prev);
        }
        return null;
      });
      setStatus('configuring');
      return stops;
    } finally {
      setIsTracking(false);
    }
  }, [evictCachedResult, invalidateCache, videoRef]);

  const updateFrameStopBox = useCallback((index: number, box: StroMotionSubjectBox) => {
    setFrameStops((prev) =>
      prev.map((s) =>
        s.index === index
          ? { ...s, box, userConfirmed: true, autoDetected: false }
          : s,
      ),
    );
    invalidateCache();
    setResult((prev) => {
      if (prev) {
        evictCachedResult(prev);
        clearStroMotionResult(prev);
      }
      return null;
    });
  }, [evictCachedResult, invalidateCache]);

  const confirmFrameStop = useCallback((index: number) => {
    setFrameStops((prev) =>
      prev.map((s) => (s.index === index ? { ...s, userConfirmed: true } : s)),
    );
  }, []);

  const extractFrames = useCallback(
    async (params: StroMotionExtractParams): Promise<StroMotionResult | null> => {
      const video = videoRef.current;
      if (!video) return null;
      if (params.endSec <= params.startSec) return null;
      if (params.subjectBox.width <= 0 || params.subjectBox.height <= 0) return null;

      const sampleTimes = params.sampleTimes?.length
        ? params.sampleTimes
        : computeGhostSampleTimes(params.startSec, params.endSec, params.ghostCount);

      const perFrameBoxes = params.frameStops?.length === sampleTimes.length
        ? params.frameStops.map((s) => ({ timeSec: s.timeSec, box: s.box }))
        : undefined;

      const cacheKey = stroMotionCacheKey({
        subjectBox: params.subjectBox,
        startSec: params.startSec,
        endSec: params.endSec,
        ghostCount: params.ghostCount,
      }) + ':object:' + JSON.stringify(perFrameBoxes ?? null);

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
          perFrameBoxes,
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
          setStatus('configuring');
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
    setStatus((prev) => (prev === 'extracting' ? 'configuring' : prev));
    setProgress({ current: 0, total: 0 });
  }, []);

  const setAnimating = useCallback((animating: boolean) => {
    setStatus((prev) => {
      if (animating) return 'animating';
      if (prev === 'animating') return result ? 'ready' : 'configuring';
      return prev;
    });
  }, [result]);

  const setConfiguring = useCallback((configuring: boolean) => {
    setStatus((prev) => {
      if (configuring && (prev === 'idle' || prev === 'configuring')) return 'configuring';
      if (!configuring && prev === 'configuring') return frameStops.length ? 'configuring' : 'idle';
      return prev;
    });
  }, [frameStops.length]);

  const diagnostics: StroMotionDiagnostics | null = result?.diagnostics ?? null;

  return {
    result,
    status,
    isProcessing: status === 'extracting',
    isTracking,
    progress,
    diagnostics,
    frameStops,
    setFrameStops,
    clearFrameStops,
    detectFrameStops,
    updateFrameStopBox,
    confirmFrameStop,
    clearGhosts,
    extractFrames,
    cancelExtraction,
    invalidateCache,
    setAnimating,
    setConfiguring,
  };
}
