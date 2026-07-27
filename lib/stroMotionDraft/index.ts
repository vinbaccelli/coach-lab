'use client';

'use client';

export { clearStroMotionDraft } from '@/lib/stroMotionDraft/clearDraft';
export {
  renderStroMotionDraftComposite,
  stroMotionDraftToCanvas,
  stroMotionDraftToDataURL,
} from '@/lib/stroMotionDraft/compositeFromDraft';
export { allFramesReady, countExportReadyFrames, countFramesWithPreviewMask, countReadyFrames, frameHasMask, getCompositeMask, getExportMask, getPreviewMask, maskHasContent } from '@/lib/stroMotionDraft/frameMask';
export { exportStroMotionDraftPng, hydrateDraftBitmapsForExport } from '@/lib/stroMotionDraft/exportDraft';
// `captureFrameFromElement` is deliberately NOT re-exported: it seeks whatever
// element it is given, which is the bug Phase 2 removed. Import it from
// captureFrame directly if you genuinely mean "this exact element".
export { waitForDecodableFrame } from '@/lib/stroMotionDraft/captureFrame';
// Phase 2: `captureVideoFrameAtTime` now comes from captureSource — same name and
// signature as before, but it captures from a DEDICATED element instead of the
// element it is handed. Every existing caller (Canvas.tsx, page.tsx and the
// pipeline modules) is isolated by that swap alone, with no call-site change.
export {
  captureVideoFrameAtTime,
  createCaptureSource,
  createCaptureSourceFromBlob,
  disposeCaptureSources,
} from '@/lib/stroMotionDraft/captureSource';
export type { CaptureSource, CaptureSourceOptions } from '@/lib/stroMotionDraft/captureSource';
export { ensureStroMotionDraft } from '@/lib/stroMotionDraft/initDraft';
export { applyBrushStrokeToMask, applyBrushToMask, cloneAlphaMask, embedRegionMask, extractAlphaMaskFromBitmap, fillBoxMask, floodRemoveInMask, mergeMasksPreferForeground } from '@/lib/stroMotionDraft/maskUtils';
export { proposeFrameMask } from '@/lib/stroMotionDraft/proposeFrameMask';
export type {
  AlphaMask,
  BrushMode,
  StroMotionBackground,
  StroMotionDraft,
  StroMotionFrameDraft,
  StroMotionFrameStatus,
  StroMotionObjectType,
  StroMotionFrameCount,
  StroMotionVideoOrder,
} from '@/lib/stroMotionDraft/types';
export {
  STRO_MOTION_DEFAULT_FRAME_COUNT,
  STRO_MOTION_FRAME_COUNTS,
} from '@/lib/stroMotionDraft/types';
