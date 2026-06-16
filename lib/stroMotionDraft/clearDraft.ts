'use client';

import type { StroMotionDraft } from '@/lib/stroMotionDraft/types';

export function clearStroMotionDraft(draft: StroMotionDraft | null): void {
  if (!draft) return;
  try {
    draft.backgroundPlate.close();
  } catch { /* closed */ }
  for (const frame of draft.frames) {
    if (frame.sourceFrame) {
      try {
        frame.sourceFrame.close();
      } catch { /* closed */ }
    }
  }
}
