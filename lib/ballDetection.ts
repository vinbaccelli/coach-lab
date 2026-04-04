/**
 * Ball Detection module for Coach Lab.
 *
 * Uses canvas-based HSV color analysis to locate a tennis ball (bright yellow)
 * in each video frame. Results are cached in memory keyed by frame index.
 *
 * No external ML models needed — fast CPU-side detection via ImageData pixel iteration.
 */

export interface BallPosition {
  frameIndex: number;
  /** Normalized x position (0–1) */
  nx: number;
  /** Normalized y position (0–1) */
  ny: number;
  /** Detected radius in pixels */
  radius: number;
  /** Detection confidence 0–1 */
  confidence: number;
}

// HSV range for a tennis ball (bright yellow-green)
const HSV_RANGE = {
  hMin: 30,   // green-yellow hue start (degrees / 2 for OpenCV 0-180 scale)
  hMax: 70,   // yellow hue end
  sMin: 80,   // high saturation
  sMax: 255,
  vMin: 100,  // bright
  vMax: 255,
};

/** Convert a single RGB triplet to approximate HSV (h: 0–360, s: 0–255, v: 0–255) */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
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

/** Returns true if the given RGB pixel is within the tennis ball HSV range */
function isBallPixel(r: number, g: number, b: number): boolean {
  const [h, s, v] = rgbToHsv(r, g, b);
  return (
    h >= HSV_RANGE.hMin &&
    h <= HSV_RANGE.hMax &&
    s >= HSV_RANGE.sMin &&
    s <= HSV_RANGE.sMax &&
    v >= HSV_RANGE.vMin &&
    v <= HSV_RANGE.vMax
  );
}

/**
 * Detect the tennis ball in a single video frame.
 *
 * @param imageData Raw RGBA pixel data at the native video resolution.
 * @param width  Width of the frame.
 * @param height Height of the frame.
 * @returns Ball position in normalized coordinates, or null if not found.
 */
export function detectBallInFrame(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
): { nx: number; ny: number; radius: number; confidence: number } | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      if (isBallPixel(r, g, b)) {
        sumX += x;
        sumY += y;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (count < 20) return null; // Too few pixels — probably noise

  const cx = sumX / count;
  const cy = sumY / count;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const radius = (bw + bh) / 4; // rough estimate

  // Confidence: higher if bounding box is roughly circular and count is significant
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

/**
 * Process an entire video to detect ball positions in every frame.
 *
 * @param video    The HTMLVideoElement (must be loaded).
 * @param onProgress Called with progress 0–1 after each frame.
 * @returns Array of BallPosition records (only frames with detections).
 */
export async function detectBallAllFrames(
  video: HTMLVideoElement,
  onProgress?: (progress: number) => void,
): Promise<BallPosition[]> {
  const fps = 30;
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) return [];

  const totalFrames = Math.floor(duration * fps);
  const results: BallPosition[] = [];

  // Use a small offscreen canvas for performance (max 480px wide)
  const scale = Math.min(1, 480 / (video.videoWidth || 480));
  const w = Math.round((video.videoWidth || 640) * scale);
  const h = Math.round((video.videoHeight || 480) * scale);

  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext('2d', { willReadFrequently: true })!;

  // Seek through the video frame by frame
  const seekTo = (t: number): Promise<void> =>
    new Promise((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = t;
    });

  // Store original time and pause
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
        nx: det.nx,
        ny: det.ny,
        radius: det.radius / scale, // scale back to original resolution
        confidence: det.confidence,
      });
    }

    if (onProgress) onProgress((f + 1) / totalFrames);

    // Yield to the browser every 10 frames to avoid blocking UI
    if (f % 10 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Restore video state
  video.currentTime = origTime;
  if (!wasPaused) video.play().catch(() => {});

  return results;
}

/**
 * Given cached ball positions, find the one closest to a given video time.
 * Returns null if no cached data or nothing within 1 frame.
 */
export function getBallAtTime(
  positions: BallPosition[],
  currentTime: number,
  fps = 30,
): BallPosition | null {
  if (positions.length === 0) return null;
  const targetFrame = Math.round(currentTime * fps);
  // Binary search for closest frame
  let lo = 0;
  let hi = positions.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid].frameIndex < targetFrame) lo = mid + 1;
    else hi = mid;
  }
  const candidate = positions[lo];
  if (Math.abs(candidate.frameIndex - targetFrame) <= 2) return candidate;
  return null;
}
