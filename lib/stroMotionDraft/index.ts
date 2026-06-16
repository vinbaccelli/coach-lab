'use client';

export { clearStroMotionDraft } from '@/lib/stroMotionDraft/clearDraft';
export {
  renderStroMotionDraftComposite,
  stroMotionDraftToCanvas,
  stroMotionDraftToDataURL,
} from '@/lib/stroMotionDraft/compositeFromDraft';
export { allFramesReady, countExportReadyFrames, countFramesWithPreviewMask, countReadyFrames, frameHasMask, getCompositeMask, getExportMask, getPreviewMask, maskHasContent } from '@/lib/stroMotionDraft/frameMask';
export { exportStroMotionDraftPng, hydrateDraftBitmapsForExport } from '@/lib/stroMotionDraft/exportDraft';
export { ensureStroMotionDraft } from '@/lib/stroMotionDraft/initDraft';
export { applyBrushToMask, cloneAlphaMask, embedRegionMask, extractAlphaMaskFromBitmap, fillBoxMask, floodRemoveInMask, mergeMasksPreferForeground } from '@/lib/stroMotionDraft/maskUtils';
export { proposeFrameMask } from '@/lib/stroMotionDraft/proposeFrameMask';
export type {
  AlphaMask,
  BrushMode,
  StroMotionDraft,
  StroMotionFrameDraft,
  StroMotionFrameStatus,
  StroMotionObjectType,
  StroMotionFrameCount,
} from '@/lib/stroMotionDraft/types';
export {
  STRO_MOTION_DEFAULT_FRAME_COUNT,
  STRO_MOTION_FRAME_COUNTS,
} from '@/lib/stroMotionDraft/types';
