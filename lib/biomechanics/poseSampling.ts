import { acquirePoseDetector } from '@/lib/sharedPoseDetector';
import type { PoseKeypoint, PoseSample } from '@/lib/biomechanics/types';

function pickLargestPose(poses: Array<{ keypoints: Array<{ x: number; y: number; score?: number }> }>): typeof poses[0] | null {
  if (!poses?.length) return null;
  if (poses.length === 1) return poses[0];
  let best = poses[0];
  let bestArea = 0;
  for (const pose of poses) {
    const kps = pose.keypoints?.filter(k => (k.score ?? 0) >= 0.2) ?? [];
    if (kps.length < 4) continue;
    const xs = kps.map(k => k.x);
    const ys = kps.map(k => k.y);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) { bestArea = area; best = pose; }
  }
  return best;
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const t = Math.max(0, Math.min(time, Math.max(0, video.duration - 1e-6)));
  if (Math.abs(video.currentTime - t) < 0.001) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    }, 3000);
    const onSeeked = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = t;
  });
}

export async function samplePosesInTrimRange(
  video: HTMLVideoElement,
  trimStartSec: number,
  trimEndSec: number,
  fps = 15,
  onProgress?: (p: number) => void,
): Promise<PoseSample[]> {
  if (trimEndSec <= trimStartSec || video.videoWidth === 0) return [];

  const detector = await acquirePoseDetector();
  if (!detector) return [];

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const dt = 1 / fps;
  const times: number[] = [];
  for (let t = trimStartSec; t <= trimEndSec + 1e-6; t += dt) {
    times.push(Math.min(t, trimEndSec));
  }

  const origTime = video.currentTime;
  const wasPaused = video.paused;
  video.pause();

  const samples: PoseSample[] = [];

  for (let i = 0; i < times.length; i++) {
    await seekVideo(video, times[i]);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const poses = await detector.estimatePoses(canvas, { flipHorizontal: false });
      const raw = pickLargestPose(poses)?.keypoints;
      const keypoints: PoseKeypoint[] | null = raw?.length
        ? raw.map((kp: { x: number; y: number; score?: number; name?: string }) => ({
            x: kp.x,
            y: kp.y,
            score: kp.score ?? 0,
            name: kp.name ?? '',
          }))
        : null;
      samples.push({ timeSec: times[i], keypoints });
    } catch {
      samples.push({ timeSec: times[i], keypoints: null });
    }
    onProgress?.((i + 1) / times.length);
    if (i % 3 === 0) await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  }

  video.currentTime = origTime;
  if (!wasPaused) void video.play();

  return samples;
}

export async function samplePosesAtTimes(
  video: HTMLVideoElement,
  timesSec: number[],
  onProgress?: (p: number) => void,
): Promise<PoseSample[]> {
  if (timesSec.length === 0 || video.videoWidth === 0) return [];

  const detector = await acquirePoseDetector();
  if (!detector) return [];

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const origTime = video.currentTime;
  const wasPaused = video.paused;
  video.pause();

  const samples: PoseSample[] = [];

  for (let i = 0; i < timesSec.length; i++) {
    await seekVideo(video, timesSec[i]);
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch {
      samples.push({ timeSec: timesSec[i], keypoints: null });
      onProgress?.((i + 1) / timesSec.length);
      continue;
    }
    try {
      const poses = await detector.estimatePoses(canvas, { flipHorizontal: false });
      const raw = pickLargestPose(poses)?.keypoints;
      const keypoints: PoseKeypoint[] | null = raw?.length
        ? raw.map((kp: { x: number; y: number; score?: number; name?: string }) => ({
            x: kp.x,
            y: kp.y,
            score: kp.score ?? 0,
            name: kp.name ?? '',
          }))
        : null;
      samples.push({ timeSec: timesSec[i], keypoints });
    } catch {
      samples.push({ timeSec: timesSec[i], keypoints: null });
    }
    onProgress?.((i + 1) / timesSec.length);
    if (i % 2 === 0) await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  }

  try {
    await seekVideo(video, origTime);
  } catch {
    video.currentTime = origTime;
  }
  if (!wasPaused) void video.play();

  return samples;
}

export function nearestPoseSample(
  samples: PoseSample[],
  timeSec: number,
): PoseKeypoint[] | null {
  if (samples.length === 0) return null;
  let best = samples[0];
  let bestD = Math.abs(samples[0].timeSec - timeSec);
  for (const s of samples) {
    const d = Math.abs(s.timeSec - timeSec);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best.keypoints;
}

export function skeletonFramesToSamples(
  frames: Array<{ timeSeconds: number; keypoints: PoseKeypoint[] }>,
): PoseSample[] {
  return frames.map((f) => ({ timeSec: f.timeSeconds, keypoints: f.keypoints }));
}
