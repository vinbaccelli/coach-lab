/**
 * Client-side pose sampling for YouTube iframe mode.
 * Cross-origin iframe pixels are not readable; we use YouTube CDN thumbnails (CORS-friendly)
 * as a single reference frame for MoveNet. During playback, landmarks are held and temporally smoothed.
 */

const CACHE = new Map<string, Promise<HTMLImageElement | null>>();

function thumbnailUrl(videoId: string, quality: 'maxresdefault' | 'hqdefault' | 'mqdefault' = 'maxresdefault') {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${quality}.jpg`;
}

export async function loadYoutubeThumbnailImage(videoId: string): Promise<HTMLImageElement | null> {
  const cached = CACHE.get(videoId);
  if (cached) return cached;

  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      // Fallback to smaller thumb if maxres is missing
      const fb = new Image();
      fb.crossOrigin = 'anonymous';
      fb.onload = () => resolve(fb);
      fb.onerror = () => resolve(null);
      fb.src = thumbnailUrl(videoId, 'hqdefault');
    };
    img.src = thumbnailUrl(videoId, 'maxresdefault');
  });

  CACHE.set(videoId, p);
  return p;
}

export type PoseKeypoint = { x: number; y: number; score: number; name: string };

/** Exponential smoothing + hold low-confidence joints from previous frame */
export function smoothPoseKeypoints(
  prev: PoseKeypoint[] | null,
  next: PoseKeypoint[],
  opts?: { alpha?: number; minScore?: number },
): PoseKeypoint[] {
  const alpha = opts?.alpha ?? 0.35;
  const minScore = opts?.minScore ?? 0.25;

  if (!prev || prev.length !== next.length) return next;

  const out: PoseKeypoint[] = [];
  for (let i = 0; i < next.length; i++) {
    const n = next[i];
    const p = prev[i];
    if (n.score < minScore && p && p.score >= minScore * 0.5) {
      out.push({
        name: n.name,
        score: Math.max(n.score, p.score * 0.92),
        x: p.x * 0.85 + n.x * 0.15,
        y: p.y * 0.85 + n.y * 0.15,
      });
    } else if (p) {
      out.push({
        name: n.name,
        score: n.score,
        x: alpha * n.x + (1 - alpha) * p.x,
        y: alpha * n.y + (1 - alpha) * p.y,
      });
    } else {
      out.push(n);
    }
  }
  return out;
}

/** Running buffer average for extra temporal stability (tennis motion blur). */
export function bufferSmoothKeypoints(
  buffer: PoseKeypoint[][],
  next: PoseKeypoint[],
  windowSize: number,
): PoseKeypoint[] {
  buffer.push(next);
  while (buffer.length > windowSize) buffer.shift();
  if (buffer.length === 0) return next;

  const nJ = next.length;
  const sum: PoseKeypoint[] = Array.from({ length: nJ }, (_, j) => ({
    name: next[j].name,
    x: 0,
    y: 0,
    score: 0,
  }));

  for (const frame of buffer) {
    for (let j = 0; j < nJ; j++) {
      sum[j].x += frame[j]?.x ?? 0;
      sum[j].y += frame[j]?.y ?? 0;
      sum[j].score += frame[j]?.score ?? 0;
    }
  }
  const k = buffer.length;
  return sum.map((s, j) => ({
    name: s.name,
    x: s.x / k,
    y: s.y / k,
    score: s.score / k,
  }));
}
