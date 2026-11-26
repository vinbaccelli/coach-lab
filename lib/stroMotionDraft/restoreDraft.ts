'use client';
import { ensureStroMotionDraft } from '@/lib/stroMotionDraft/initDraft';
import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureSource';
import { unpackMask, type PersistedDraft } from '@/lib/stroMotionDraft/persist';
import type { StroMotionDraft } from '@/lib/stroMotionDraft/types';

/**
 * Rebuild a live draft from a saved record and the re-picked video: plate + frame bitmaps are re-captured from the
 * video, masks/boxes/labels/status come from the record. A mask that fails to decode (corrupt record) is dropped and its
 * frame falls back to 'pending' so the coach redoes that frame rather than the whole restore failing.
 */
export async function restoreDraftFromRecord(video: HTMLVideoElement, rec: PersistedDraft): Promise<StroMotionDraft | null> {
  const base = await ensureStroMotionDraft(video, {
    objectType: rec.settings.objectType,
    backgroundTimeSec: rec.settings.backgroundTimeSec,
    sampleTimes: rec.settings.sampleTimes,
    previous: null,
  });
  if (!base) return null;
  const frames = await Promise.all(base.frames.map(async (f) => {
    const saved = rec.frames.find((s) => s.index === f.index && Math.abs(s.timeSec - f.timeSec) < 0.001);
    if (!saved) return f;
    const aiSnapshot = saved.aiSnapshot ? unpackMask(saved.aiSnapshot) : null;
    const working = saved.working ? unpackMask(saved.working) : null;
    const readyMask = saved.readyMask ? unpackMask(saved.readyMask) : null;
    const damaged = (saved.aiSnapshot && !aiSnapshot) || (saved.working && !working) || (saved.readyMask && !readyMask);
    let sourceFrame: ImageBitmap | null = null;
    if (saved.selectionBox || aiSnapshot || working || readyMask) {
      try { sourceFrame = await captureVideoFrameAtTime(video, f.timeSec); } catch { sourceFrame = null; }
    }
    return {
      ...f, label: saved.label, selectionBox: saved.selectionBox, sourceFrame,
      aiSnapshot, working, readyMask,
      status: damaged || !sourceFrame ? ('pending' as const) : saved.status,
    };
  }));
  return { ...base, frames, batchUnitFloorNorm: rec.settings.batchUnitFloorNorm };
}
