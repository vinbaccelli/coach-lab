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
      {
        modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING,
        // Self-hosted weights — same rationale as the worker (no CDN risk).
        modelUrl: `${window.location.origin}/models/movenet-lightning/model.json`,
      },
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

// ─────────────────────────────────────────────────────────────────────────────
// TEMP-DEBUG-DETECTORRACE — proves the exact-pose lock actually stops concurrent
// use of this singleton. MoveNet/TFJS detectors are NOT re-entrant: two
// overlapping estimatePoses calls interleave and can return each other's answer,
// which is how a Motion Layer frame ended up with the live frame's pose (wrong
// leg → wrong mask zone → over-removal). Every caller of the shared detector
// brackets its call with these, so a single warning here is a real overlap.
// Expected after the fix: silence for the whole auto pass. Remove with the tag.
// ─────────────────────────────────────────────────────────────────────────────
let detectInFlight = 0;
let detectInFlightLabel: string | null = null;

export function markDetectStart(label: string): void {
  detectInFlight++;
  if (detectInFlight > 1) {
    console.error(
      `[DETECTORRACE] CONCURRENT estimatePoses on the shared detector: "${label}" ` +
        `started while "${detectInFlightLabel}" was still in flight (${detectInFlight} in flight). ` +
        `Results from this window are unreliable.`,
    );
    console.trace('[DETECTORRACE] overlapping call site');
  }
  detectInFlightLabel = label;
}

export function markDetectEnd(): void {
  detectInFlight = Math.max(0, detectInFlight - 1);
  if (detectInFlight === 0) detectInFlightLabel = null;
}
