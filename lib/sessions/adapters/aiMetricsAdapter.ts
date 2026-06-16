import type { BiomechanicsAnalysis, StrokeType } from '@/lib/biomechanics/types';
import type { AIMetricsSessionSlice, FrameMarker, PendingArtifact } from '@/lib/sessions/types';

function newArtifactId(): string {
  return crypto.randomUUID();
}

export interface AIMetricsFrameCard {
  id: string;
  label: string;
  timeSec: number;
  imageUrl: string;
}

export interface AIMetricsAdapterInput {
  strokeType: StrokeType;
  trimStartSec: number;
  trimEndSec: number;
  frameCards: AIMetricsFrameCard[];
  sampleTimes: number[];
  measurements?: BiomechanicsAnalysis | null;
}

export function buildAIMetricsSessionSlice(input: AIMetricsAdapterInput): AIMetricsSessionSlice {
  const pendingArtifacts: PendingArtifact[] = input.frameCards.map((card) => ({
    id: newArtifactId(),
    kind: 'metrics_frame' as const,
    mime: 'image/png',
    label: card.label,
    dataUrl: card.imageUrl,
  }));

  if (input.measurements) {
    pendingArtifacts.push({
      id: newArtifactId(),
      kind: 'metrics_json',
      mime: 'application/json',
      label: 'Measurements',
      blob: new Blob([JSON.stringify(input.measurements, null, 2)], { type: 'application/json' }),
    });
  }

  const frameMarkers: FrameMarker[] = input.sampleTimes.map((timeSec, index) => {
    const card = input.frameCards.find((c) => Math.abs(c.timeSec - timeSec) < 0.001);
    return {
      index,
      label: card?.label ?? String(index + 1),
      timeSec,
    };
  });

  return {
    strokeType: input.strokeType,
    trimStartSec: input.trimStartSec,
    trimEndSec: input.trimEndSec,
    frameMarkers,
    measurements: input.measurements ?? null,
    pendingArtifacts,
  };
}
