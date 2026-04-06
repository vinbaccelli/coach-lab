'use client';

export interface RacketPosition {
  timeSeconds: number;
  wristX: number;
  wristY: number;
  confidence: number;
}

export interface RacketTrail {
  startTime: number;
  endTime: number;
  positions: RacketPosition[];
}

/** Minimum pose detection confidence to accept a wrist keypoint */
const MIN_WRIST_CONFIDENCE = 0.3;

/** Extract racket positions (dominant wrist) from skeleton frame history over a swing window */
export function extractRacketTrail(
  skeletonFrames: Array<{
    timeSeconds: number;
    keypoints: Array<{ x: number; y: number; score: number }>;
  }>,
  swingStartTime: number,
  swingEndTime: number,
): RacketTrail {
  const positions: RacketPosition[] = [];

  for (const frame of skeletonFrames) {
    if (frame.timeSeconds < swingStartTime || frame.timeSeconds > swingEndTime) continue;

    // Right wrist = index 10, left wrist = index 9
    const rWrist = frame.keypoints[10];
    const lWrist = frame.keypoints[9];
    const wrist =
      (rWrist?.score ?? 0) > (lWrist?.score ?? 0) ? rWrist : lWrist;

    if (wrist && wrist.score > MIN_WRIST_CONFIDENCE) {
      positions.push({
        timeSeconds: frame.timeSeconds,
        wristX: wrist.x,
        wristY: wrist.y,
        confidence: wrist.score,
      });
    }
  }

  return {
    startTime: swingStartTime,
    endTime: swingEndTime,
    positions,
  };
}
