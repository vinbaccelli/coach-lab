'use client';

/**
 * Ball Detection module for Coach Lab.
 *
 * Real-time approach: detect ball on live video frames during playback.
 * Uses HSL color analysis to locate a tennis ball (bright yellow-green).
 */

export interface BallPosition {
  frameIndex: number;
  timeSeconds: number;
  /** Normalized x position (0–1) */
  nx: number;
  /** Normalized y position (0–1) */
  ny: number;
  /** Detected radius in pixels */
  radius: number;
  /** Detection confidence 0–1 */
  confidence: number;
}

/** Convert RGB to HSL (h: 0–360, s: 0–100, l: 0–100) */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
    case gn: h = ((bn - rn) / d + 2) / 6; break;
    default: h = ((rn - gn) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

/**
 * Detect tennis ball in an ImageData using HSL color analysis + blob detection.
 */
export function detectBallInImageData(
  imageData: ImageData,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const data = imageData.data;
  const mask = new Uint8Array(width * height);
  let matchCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const [h, s, lv] = rgbToHsl(r, g, b);
    if (h >= 45 && h <= 82 && s >= 40 && lv >= 35 && lv <= 78) {
      mask[i >> 2] = 1;
      matchCount++;
    }
  }

  if (matchCount < 12) return null;

  const visited = new Uint8Array(width * height);
  let bestCx = 0, bestCy = 0, bestSize = 0;

  for (let startIdx = 0; startIdx < width * height; startIdx++) {
    if (!mask[startIdx] || visited[startIdx]) continue;

    const queue = [startIdx];
    visited[startIdx] = 1;
    let sumX = 0, sumY = 0, size = 0;
    let head = 0;

    while (head < queue.length) {
      const idx = queue[head++];
      const px = idx % width;
      const py = Math.floor(idx / width);
      sumX += px; sumY += py; size++;

      const neighbors: [number, number][] = [[0,1],[0,-1],[1,0],[-1,0]];
      for (const [dx, dy] of neighbors) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (mask[nIdx] && !visited[nIdx]) {
          visited[nIdx] = 1;
          queue.push(nIdx);
        }
      }
    }

    if (size >= 10 && size <= 1500 && size > bestSize) {
      bestSize = size;
      bestCx = Math.round(sumX / size);
      bestCy = Math.round(sumY / size);
    }
  }

  if (bestSize < 10) return null;
  return { x: bestCx, y: bestCy };
}

// ── Legacy HSV-based detection (kept for backward compat) ─────────────────

const HSV_RANGE = {
  hMin: 50, hMax: 80, sMin: 80, sMax: 255, vMin: 100, vMax: 255,
};

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : (delta / max) * 255;
  const v = max * 255;
  return [h, s, v];
}

function isBallPixel(r: number, g: number, b: number): boolean {
  const [h, s, v] = rgbToHsv(r, g, b);
  return (
    h >= HSV_RANGE.hMin && h <= HSV_RANGE.hMax &&
    s >= HSV_RANGE.sMin && s <= HSV_RANGE.sMax &&
    v >= HSV_RANGE.vMin && v <= HSV_RANGE.vMax
  );
}

export function detectBallInFrame(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
): { nx: number; ny: number; radius: number; confidence: number } | null {
  let sumX = 0, sumY = 0, count = 0;
  let minX = width, maxX = 0, minY = height, maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = imageData[i], g = imageData[i + 1], b = imageData[i + 2];
      if (isBallPixel(r, g, b)) {
        sumX += x; sumY += y; count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }

  if (count < 50) return null;

  const cx = sumX / count;
  const cy = sumY / count;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const radius = (bw + bh) / 4;
  const aspect = bw > 0 && bh > 0 ? Math.min(bw, bh) / Math.max(bw, bh) : 0;
  const sizeScore = Math.min(1, count / (Math.PI * radius * radius + 1));
  const confidence = aspect * sizeScore;

  if (confidence < 0.1) return null;

  return {
    nx: cx / width,
    ny: cy / height,
    radius,
    confidence: Math.min(1, confidence),
  };
}

export async function detectBallAllFrames(
  video: HTMLVideoElement,
  onProgress?: (progress: number) => void,
): Promise<BallPosition[]> {
  const fps = 30;
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) return [];

  const totalFrames = Math.floor(duration * fps);
  const results: BallPosition[] = [];

  const scale = Math.min(1, 480 / (video.videoWidth || 480));
  const w = Math.round((video.videoWidth || 640) * scale);
  const h = Math.round((video.videoHeight || 480) * scale);

  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext('2d', { willReadFrequently: true })!;

  const seekTo = (t: number): Promise<void> =>
    new Promise((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }, 1000);
      video.addEventListener('seeked', onSeeked);
      video.currentTime = t;
    });

  const origTime = video.currentTime;
  const wasPaused = video.paused;
  if (!wasPaused) video.pause();

  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps;
    if (t >= duration) break;
    await seekTo(t);

    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const det = detectBallInFrame(imageData.data, w, h);

    if (det) {
      results.push({
        frameIndex: f,
        timeSeconds: t,
        nx: det.nx,
        ny: det.ny,
        radius: det.radius / scale,
        confidence: det.confidence,
      });
    }

    if (onProgress) onProgress((f + 1) / totalFrames);
    if (f % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  video.currentTime = origTime;
  if (!wasPaused) video.play().catch((err) => console.warn('[ballDetection] Could not resume video playback:', err));

  return results;
}

export function getBallAtTime(
  positions: BallPosition[],
  currentTime: number,
  fps = 30,
): BallPosition | null {
  if (positions.length === 0) return null;
  const targetFrame = Math.round(currentTime * fps);
  let lo = 0, hi = positions.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid].frameIndex < targetFrame) lo = mid + 1;
    else hi = mid;
  }
  const candidate = positions[lo];
  if (Math.abs(candidate.frameIndex - targetFrame) <= 2) return candidate;
  return null;
}
