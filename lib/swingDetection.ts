'use client';

export interface SwingSegment {
  startTime: number;
  endTime: number;
  wristPositions: Array<{ time: number; x: number; y: number }>;
}

export function detectSwingSegments(
  skeletonFrames: Array<{
    timeSeconds: number;
    keypoints: Array<{ x: number; y: number; score: number; name: string }>;
  }>,
): SwingSegment[] {
  if (skeletonFrames.length < 5) return [];

  const wristPositions = skeletonFrames
    .map((f) => {
      const rw = f.keypoints.find((k) => k.name === 'right_wrist');
      const lw = f.keypoints.find((k) => k.name === 'left_wrist');
      const wrist = (rw?.score ?? 0) > (lw?.score ?? 0) ? rw : lw;
      if (!wrist || wrist.score < 0.3) return null;
      return { time: f.timeSeconds, x: wrist.x, y: wrist.y };
    })
    .filter(Boolean) as Array<{ time: number; x: number; y: number }>;

  if (wristPositions.length < 5) return [];

  const velocities = wristPositions.map((p, i) => {
    if (i === 0) return 0;
    const prev = wristPositions[i - 1];
    const dt = p.time - prev.time;
    if (dt <= 0) return 0;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    return Math.sqrt(dx * dx + dy * dy) / dt;
  });

  const smoothed = velocities.map((v, i) => {
    if (i === 0 || i === velocities.length - 1) return v;
    return (velocities[i - 1] + v + velocities[i + 1]) / 3;
  });

  const SWING_VELOCITY_THRESHOLD = 80;
  const MIN_SWING_DURATION = 0.15;

  const segments: SwingSegment[] = [];
  let inSwing = false;
  let swingStart = 0;
  let swingStartIdx = 0;

  for (let i = 0; i < smoothed.length; i++) {
    if (!inSwing && smoothed[i] > SWING_VELOCITY_THRESHOLD) {
      inSwing = true;
      swingStart = wristPositions[i].time;
      swingStartIdx = i;
    } else if (
      inSwing &&
      (smoothed[i] <= SWING_VELOCITY_THRESHOLD * 0.5 || i === smoothed.length - 1)
    ) {
      const swingEnd = wristPositions[i].time;
      const duration = swingEnd - swingStart;
      if (duration >= MIN_SWING_DURATION) {
        segments.push({
          startTime: swingStart,
          endTime: swingEnd,
          wristPositions: wristPositions.slice(swingStartIdx, i + 1),
        });
      }
      inSwing = false;
    }
  }

  return segments;
}
