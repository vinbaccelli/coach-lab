'use client';

/**
 * Lightweight tennis-racket localization using TensorFlow.js COCO-SSD (MobileNetV2).
 * Runs in the browser; first call downloads model weights (~20MB).
 */

export type NormRect = { x: number; y: number; w: number; h: number };

const RACKET_CLASS = 'tennis racket';

let modelPromise: Promise<import('@tensorflow-models/coco-ssd').ObjectDetection> | null = null;

export function preloadRacketDetector(): void {
  if (typeof window === 'undefined') return;
  void getRacketDetectorModel();
}

async function getRacketDetectorModel(): Promise<import('@tensorflow-models/coco-ssd').ObjectDetection> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      try {
        await tf.setBackend('webgl');
      } catch {
        await tf.setBackend('cpu');
      }
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      return cocoSsd.load({ base: 'mobilenet_v2' });
    })();
  }
  return modelPromise;
}

/**
 * Returns a bounding box in **video-normalized** 0..1 coordinates, or null if not found.
 */
export async function detectTennisRacketNorm(
  video: HTMLVideoElement,
  options?: { maxDetections?: number; minScore?: number; pad?: number },
): Promise<NormRect | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 16 || vh < 16 || video.readyState < 2) return null;

  const maxDetections = options?.maxDetections ?? 12;
  const minScore = options?.minScore ?? 0.32;
  const pad = options?.pad ?? 0.08;

  const model = await getRacketDetectorModel();
  const preds = await model.detect(video, maxDetections, minScore);
  const racket = preds.find((p) => p.class === RACKET_CLASS);
  if (!racket) return null;

  let [bx, by, bw, bh] = racket.bbox;
  bw = Math.max(4, bw);
  bh = Math.max(4, bh);
  bx -= bw * pad * 0.5;
  by -= bh * pad * 0.5;
  bw *= 1 + pad;
  bh *= 1 + pad;

  const nx = Math.max(0, Math.min(1, bx / vw));
  const ny = Math.max(0, Math.min(1, by / vh));
  const nwRaw = bw / vw;
  const nhRaw = bh / vh;
  const nw = Math.max(0.02, Math.min(1 - nx, nwRaw));
  const nh = Math.max(0.02, Math.min(1 - ny, nhRaw));

  return { x: nx, y: ny, w: nw, h: nh };
}
