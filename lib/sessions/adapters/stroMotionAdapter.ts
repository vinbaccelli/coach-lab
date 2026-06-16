import type { StroMotionDraft } from '@/lib/stroMotionDraft/types';
import type { PendingArtifact, StroMotionSessionSlice } from '@/lib/sessions/types';

function newArtifactId(): string {
  return crypto.randomUUID();
}

export interface StroMotionAdapterInput {
  draft: StroMotionDraft;
  pngDataUrl?: string | null;
  videoBlob?: Blob | null;
  trimStartSec: number;
  trimEndSec: number;
}

export function buildStroMotionSessionSlice(input: StroMotionAdapterInput): StroMotionSessionSlice {
  const pendingArtifacts: PendingArtifact[] = [];

  if (input.pngDataUrl) {
    pendingArtifacts.push({
      id: newArtifactId(),
      kind: 'stromotion_png',
      mime: 'image/png',
      label: 'StroMotion',
      dataUrl: input.pngDataUrl,
      width: input.draft.videoWidth,
      height: input.draft.videoHeight,
    });
  }

  if (input.videoBlob) {
    pendingArtifacts.push({
      id: newArtifactId(),
      kind: 'stromotion_video',
      mime: input.videoBlob.type || 'video/webm',
      label: 'StroMotion animation',
      blob: input.videoBlob,
    });
  }

  return {
    ghostCount: input.draft.frames.length,
    sampleTimes: input.draft.sampleTimes,
    trimStartSec: input.trimStartSec,
    trimEndSec: input.trimEndSec,
    pendingArtifacts,
  };
}

export async function pngDataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
