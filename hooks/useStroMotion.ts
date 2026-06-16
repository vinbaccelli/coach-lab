'use client';

import { renderStroMotionDraftComposite } from '@/lib/stroMotionDraft/compositeFromDraft';
import { exportStroMotionDraftPng } from '@/lib/stroMotionDraft/exportDraft';
import { clearStroMotionDraft } from '@/lib/stroMotionDraft/clearDraft';
import { cloneAlphaMask } from '@/lib/stroMotionDraft/maskUtils';
import { countExportReadyFrames, maskHasContent, statusAfterMaskEdit } from '@/lib/stroMotionDraft/frameMask';
import { hydrateDraftBitmapsForExport } from '@/lib/stroMotionDraft/exportDraft';
import { ensureStroMotionDraft } from '@/lib/stroMotionDraft/initDraft';
import { proposeFrameMask } from '@/lib/stroMotionDraft/proposeFrameMask';
import type {
  AlphaMask,
  StroMotionDraft,
  StroMotionFrameStatus,
  StroMotionObjectType,
} from '@/lib/stroMotionDraft/types';
import type { StroMotionSubjectBox } from '@/lib/stroMotion';
import { useCallback, useRef, useState } from 'react';

export type StroMotionHookStatus = 'idle' | 'configuring' | 'proposing' | 'generating' | 'ready';

export interface StroMotionProgress {
  current: number;
  total: number;
}

export interface SyncDraftParams {
  objectType: StroMotionObjectType;
  backgroundTimeSec: number;
  sampleTimes: number[];
}

export function useStroMotion(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [draft, setDraft] = useState<StroMotionDraft | null>(null);
  const [status, setStatus] = useState<StroMotionHookStatus>('idle');
  const [objectType, setObjectType] = useState<StroMotionObjectType>('racket');
  const [activeFrameIndex, setActiveFrameIndex] = useState<number | null>(null);
  const [proposingFrameIndex, setProposingFrameIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<StroMotionProgress>({ current: 0, total: 0 });
  const draftRef = useRef<StroMotionDraft | null>(null);
  draftRef.current = draft;

  const clearDraftState = useCallback(() => {
    setDraft((prev) => {
      if (prev) clearStroMotionDraft(prev);
      return null;
    });
    setActiveFrameIndex(null);
    setProposingFrameIndex(null);
    setProgress({ current: 0, total: 0 });
  }, []);

  const clearAll = useCallback(() => {
    clearDraftState();
    setStatus('idle');
    setObjectType('racket');
  }, [clearDraftState]);

  const invalidatePreview = useCallback(() => {
    setStatus((prev) => (prev === 'ready' ? 'configuring' : prev));
  }, []);

  const syncDraft = useCallback(async (params: SyncDraftParams): Promise<StroMotionDraft | null> => {
    const video = videoRef.current;
    if (!video) return null;

    const next = await ensureStroMotionDraft(video, {
      objectType: params.objectType,
      backgroundTimeSec: params.backgroundTimeSec,
      sampleTimes: params.sampleTimes,
      previous: draftRef.current,
    });

    if (!next) return null;

    setDraft((current) => {
      if (!current) return next;
      if (Math.abs(current.backgroundTimeSec - next.backgroundTimeSec) > 0.001) return next;
      if (current.objectType !== next.objectType) return next;

      const mergedFrames = next.frames.map((f, i) => {
        const cur = current.frames[i];
        if (
          cur &&
          cur.sourceFrame &&
          (maskHasContent(cur.working) || maskHasContent(cur.readyMask) || maskHasContent(cur.aiSnapshot)) &&
          Math.abs(cur.timeSec - f.timeSec) < 0.05 &&
          cur.selectionBox
        ) {
          return {
            ...f,
            selectionBox: cur.selectionBox,
            sourceFrame: cur.sourceFrame,
            aiSnapshot: cur.aiSnapshot,
            working: cur.working,
            readyMask: cur.readyMask,
            status: cur.status,
            label: cur.label || f.label,
          };
        }
        return f;
      });
      return { ...next, frames: mergedFrames };
    });
    setStatus('configuring');
    return next;
  }, [videoRef]);

  const invalidateFrameAt = useCallback((frameIndex: number, timeSec?: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) => {
        if (f.index !== frameIndex) return f;
        if (f.sourceFrame) {
          try { f.sourceFrame.close(); } catch { /* closed */ }
        }
        return {
          ...f,
          timeSec: timeSec ?? f.timeSec,
          status: 'pending' as StroMotionFrameStatus,
          selectionBox: null,
          sourceFrame: null,
          aiSnapshot: null,
          working: null,
          readyMask: null,
        };
      });
      const sampleTimes = [...prev.sampleTimes];
      if (timeSec !== undefined && frameIndex >= 0 && frameIndex < sampleTimes.length) {
        sampleTimes[frameIndex] = timeSec;
      }
      return { ...prev, frames, sampleTimes };
    });
    invalidatePreview();
  }, [invalidatePreview]);

  const updateFrameTime = useCallback((frameIndex: number, timeSec: number) => {
    invalidateFrameAt(frameIndex, timeSec);
  }, [invalidateFrameAt]);

  const updateFrameLabel = useCallback((frameIndex: number, label: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex ? { ...f, label } : f,
      );
      return { ...prev, frames };
    });
  }, []);

  const selectAreaForFrame = useCallback(async (
    frameIndex: number,
    selectionBox: StroMotionSubjectBox,
  ): Promise<boolean> => {
    const video = videoRef.current;
    const current = draftRef.current;
    if (!video || !current) return false;

    const frame = current.frames[frameIndex];
    if (!frame) return false;

    setProposingFrameIndex(frameIndex);
    setProgress({ current: 0, total: 1 });
    setStatus('proposing');

    try {
      const proposal = await proposeFrameMask(
        video,
        frame.timeSec,
        selectionBox,
        current.backgroundTimeSec,
        current.objectType,
      );

      if (!proposal) return false;

      const hasProposal = maskHasContent(proposal.aiSnapshot);

      setDraft((prev) => {
        if (!prev) {
          proposal.sourceFrame.close();
          return prev;
        }
        const frames = prev.frames.map((f) => {
          if (f.index !== frameIndex) return f;
          if (f.sourceFrame) {
            try { f.sourceFrame.close(); } catch { /* closed */ }
          }
          return {
            ...f,
            selectionBox,
            sourceFrame: proposal.sourceFrame,
            aiSnapshot: proposal.aiSnapshot,
            working: proposal.working,
            readyMask: null,
            status: 'edited' as StroMotionFrameStatus,
          };
        });
        return { ...prev, frames };
      });
      invalidatePreview();
      return true;
    } catch (err) {
      console.error('[StroMotion] Mask proposal failed:', err);
      return false;
    } finally {
      setProposingFrameIndex(null);
      setProgress({ current: 0, total: 0 });
      setStatus('configuring');
    }
  }, [invalidatePreview, videoRef]);

  const updateFrameMask = useCallback((frameIndex: number, mask: AlphaMask) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex
          ? { ...f, working: mask, readyMask: null, status: statusAfterMaskEdit(f.status) }
          : f,
      );
      return { ...prev, frames };
    });
    invalidatePreview();
  }, [invalidatePreview]);

  const resetFrameMask = useCallback((frameIndex: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex && f.aiSnapshot
          ? {
              ...f,
              working: cloneAlphaMask(f.aiSnapshot),
              readyMask: null,
              status: 'edited' as StroMotionFrameStatus,
            }
          : f,
      );
      return { ...prev, frames };
    });
    invalidatePreview();
  }, [invalidatePreview]);

  const reproposeFrameMask = useCallback(async (frameIndex: number): Promise<boolean> => {
    const current = draftRef.current;
    const frame = current?.frames[frameIndex];
    if (!frame?.selectionBox) return false;
    return selectAreaForFrame(frameIndex, frame.selectionBox);
  }, [selectAreaForFrame]);

  const markFrameReady = useCallback((frameIndex: number): boolean => {
    const current = draftRef.current;
    const frame = current?.frames[frameIndex];
    const mask = frame?.working ?? frame?.readyMask ?? frame?.aiSnapshot;
    if (!mask || !maskHasContent(mask)) return false;

    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) => {
        if (f.index !== frameIndex) return f;
        return {
          ...f,
          readyMask: cloneAlphaMask(mask),
          status: 'ready' as StroMotionFrameStatus,
        };
      });
      return { ...prev, frames };
    });
    invalidatePreview();
    return true;
  }, [invalidatePreview]);

  const generatePreview = useCallback(async (draftOverride?: StroMotionDraft): Promise<string | null> => {
    const video = videoRef.current;
    const current = draftOverride ?? draftRef.current;
    if (!video || !current || current.frames.length === 0) return null;
    if (countExportReadyFrames(current.frames) !== current.frames.length) return null;

    setStatus('generating');
    setProgress({ current: 0, total: 1 });
    try {
      const pngUrl = await exportStroMotionDraftPng(video, current);
      setStatus('ready');
      return pngUrl;
    } catch (err) {
      console.error('[StroMotion] Generate PNG failed:', err);
      setStatus('configuring');
      return null;
    } finally {
      setProgress({ current: 0, total: 0 });
    }
  }, [videoRef]);

  const hydrateDraftForExport = useCallback(async (): Promise<StroMotionDraft | null> => {
    const video = videoRef.current;
    const current = draftRef.current;
    if (!video || !current) return null;
    const hydrated = await hydrateDraftBitmapsForExport(video, current);
    setDraft(hydrated);
    return hydrated;
  }, [videoRef]);

  const setConfiguring = useCallback((configuring: boolean) => {
    setStatus((prev) => {
      if (configuring && (prev === 'idle' || prev === 'configuring')) return 'configuring';
      if (!configuring && prev === 'configuring') return draftRef.current ? 'configuring' : 'idle';
      return prev;
    });
  }, []);

  return {
    draft,
    status,
    objectType,
    setObjectType,
    activeFrameIndex,
    setActiveFrameIndex,
    proposingFrameIndex,
    isProposingFrame: proposingFrameIndex !== null,
    isGenerating: status === 'generating',
    isProcessing: status === 'proposing' || status === 'generating',
    progress,
    syncDraft,
    updateFrameTime,
    updateFrameLabel,
    selectAreaForFrame,
    updateFrameMask,
    resetFrameMask,
    reproposeFrameMask,
    markFrameReady,
    generatePreview,
    hydrateDraftForExport,
    invalidatePreview,
    clearAll,
    setConfiguring,
    renderStroMotionDraftComposite,
  };
}
