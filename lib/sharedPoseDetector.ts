/**
 * Module-level singleton for the TF.js MoveNet pose detector.
 * Both Canvas A and Canvas B share the same detector to avoid WebGL context conflicts.
 */

let detectorPromise: Promise<any> | null = null;
let detector: any = null;
let refCount = 0;

export async function acquirePoseDetector(
  onStatus?: (msg: string) => void,
): Promise<any> {
  refCount++;
  if (detector) return detector;
  if (detectorPromise) return detectorPromise;

  detectorPromise = (async () => {
    onStatus?.('Loading pose model…');
    const tf = await import('@tensorflow/tfjs-core');
    await import('@tensorflow/tfjs-backend-webgl');
    await import('@tensorflow/tfjs-converter');
    await tf.setBackend('webgl');
    await tf.ready();
    const pd = await import('@tensorflow-models/pose-detection');
    const det = await pd.createDetector(
      pd.SupportedModels.MoveNet,
      { modelType: pd.movenet.modelType.MULTIPOSE_LIGHTNING, enableTracking: true },
    );
    detector = det;
    detectorPromise = null;
    return det;
  })();

  return detectorPromise;
}

export function releasePoseDetector() {
  refCount = Math.max(0, refCount - 1);
}
