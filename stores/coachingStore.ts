'use client';

import { useRecording } from '@/contexts/RecordingContext';

interface CoachingState {
  isRecording: boolean;
}

/**
 * Selector-based hook that reads from RecordingContext.
 * Usage: const isRecording = useCoachingStore(s => s.isRecording);
 */
export function useCoachingStore<T>(selector: (state: CoachingState) => T): T {
  const { recState } = useRecording();
  return selector({ isRecording: recState === 'recording' });
}
