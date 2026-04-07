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
  videoWidth: number = 640,
  videoHeight: number = 480,
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

  const avgDim = (videoWidth + videoHeight) / 2;
  const SWING_VELOCITY_THRESHOLD = (avgDim / 640) * 80;
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

/** Seek a video element to a time, resolving when the seek completes. */
function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 500);
    video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
    video.currentTime = time;
  });
}

/** Internal type used during motion analysis. */
interface MotionSample {
  time: number;
  motion: number;
  cx: number;
  cy: number;
}

/**
 * Motion-based swing detection using frame differencing (no skeleton required).
 * Seeks through the video, computes per-frame motion, and returns swing segments
 * with motion centroids stored as wristPositions in video pixel coordinates.
 */
export async function detectSwingsFromVideo(
  video: HTMLVideoElement,
  sampleCount = 60,
): Promise<SwingSegment[]> {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const DETECT_W = 160;
  const DETECT_H = 90;
  const canvas = document.createElement('canvas');
  canvas.width = DETECT_W;
  canvas.height = DETECT_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const origTime = video.currentTime;
  const step = duration / sampleCount;

  const motions: MotionSample[] = [];
  let prevData: Uint8ClampedArray | null = null;

  for (let i = 0; i <= sampleCount; i++) {
    const t = Math.min(i * step, duration - 0.001);
    await seekVideo(video, t);

    ctx.drawImage(video, 0, 0, DETECT_W, DETECT_H);
    let imgData: ImageData;
    try {
      imgData = ctx.getImageData(0, 0, DETECT_W, DETECT_H);
    } catch {
      break; // cross-origin video — stop
    }
    const data = imgData.data;

    if (prevData) {
      let motion = 0;
      let sumX = 0, sumY = 0, n = 0;
      for (let y = 0; y < DETECT_H; y++) {
        for (let x = 0; x < DETECT_W; x++) {
          const idx = (y * DETECT_W + x) * 4;
          const diff = (
            Math.abs(data[idx]     - prevData[idx])     +
            Math.abs(data[idx + 1] - prevData[idx + 1]) +
            Math.abs(data[idx + 2] - prevData[idx + 2])
          ) / 3;
          if (diff > 20) {
            motion += diff;
            sumX += x;
            sumY += y;
            n++;
          }
        }
      }
      const cx = n > 0 ? (sumX / n / DETECT_W) * (video.videoWidth  || DETECT_W) : (video.videoWidth  || DETECT_W) / 2;
      const cy = n > 0 ? (sumY / n / DETECT_H) * (video.videoHeight || DETECT_H) : (video.videoHeight || DETECT_H) / 2;
      motions.push({ time: t, motion, cx, cy });
    }

    prevData = new Uint8ClampedArray(data);
  }

  // Restore original playback position
  video.currentTime = origTime;

  if (motions.length === 0) return [];

  const maxMotion = Math.max(...motions.map(m => m.motion), 1);
  const threshold = maxMotion * 0.25;

  const segments: SwingSegment[] = [];
  let inSwing = false;
  let swingStart = 0;
  let swingPts: Array<{ time: number; x: number; y: number }> = [];

  for (const m of motions) {
    if (!inSwing && m.motion > threshold) {
      inSwing = true;
      swingStart = m.time;
      swingPts = [{ time: m.time, x: m.cx, y: m.cy }];
    } else if (inSwing) {
      if (m.motion > threshold) {
        swingPts.push({ time: m.time, x: m.cx, y: m.cy });
      } else {
        if (m.time - swingStart >= 0.1 && swingPts.length >= 2) {
          segments.push({ startTime: swingStart, endTime: m.time, wristPositions: swingPts });
        }
        inSwing = false;
        swingPts = [];
      }
    }
  }

  if (inSwing && swingPts.length >= 2) {
    segments.push({
      startTime: swingStart,
      endTime: motions[motions.length - 1].time,
      wristPositions: swingPts,
    });
  }

  return segments;
}
