/**
 * Webcam background removal using @mediapipe/selfie_segmentation loaded from CDN.
 * Produces an output canvas where the person is fully opaque and background is transparent.
 */

const CDN_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/';

let cdnLoadPromise: Promise<void> | null = null;

function loadCdnScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = url;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(s);
  });
}

function ensureCdnLoaded(): Promise<void> {
  if (!cdnLoadPromise) {
    cdnLoadPromise = loadCdnScript(
      `${CDN_BASE}selfie_segmentation.js`,
    );
  }
  return cdnLoadPromise;
}

export class WebcamSegmenter {
  private segmentation: any = null;
  private outputCanvas: HTMLCanvasElement;
  private outputCtx: CanvasRenderingContext2D;
  private running = false;
  private animFrameId = 0;
  private videoElement: HTMLVideoElement | null = null;
  private busy = false;

  constructor() {
    this.outputCanvas = document.createElement('canvas');
    this.outputCtx = this.outputCanvas.getContext('2d', { willReadFrequently: false })!;
  }

  async init(): Promise<void> {
    await ensureCdnLoaded();

    const SelfieSegmentation = (window as any).SelfieSegmentation;
    if (!SelfieSegmentation) {
      throw new Error('SelfieSegmentation not found on window after CDN load');
    }

    this.segmentation = new SelfieSegmentation({
      locateFile: (file: string) => `${CDN_BASE}${file}`,
    });

    this.segmentation.setOptions({ modelSelection: 1, selfieMode: false });

    this.segmentation.onResults((results: any) => {
      this.handleResults(results);
    });

    await this.segmentation.initialize();
  }

  private handleResults(results: any): void {
    const video = this.videoElement;
    if (!video || !results.segmentationMask) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return;

    if (this.outputCanvas.width !== w || this.outputCanvas.height !== h) {
      this.outputCanvas.width = w;
      this.outputCanvas.height = h;
    }

    const ctx = this.outputCtx;
    ctx.clearRect(0, 0, w, h);

    // Draw the segmentation mask (person = white, bg = black) with a feather blur
    ctx.save();
    ctx.filter = 'blur(3px)';
    ctx.drawImage(results.segmentationMask, 0, 0, w, h);
    ctx.restore();

    // Use the mask as alpha: keep person pixels from the original image
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(results.image, 0, 0, w, h);

    ctx.globalCompositeOperation = 'source-over';
  }

  start(videoElement: HTMLVideoElement): void {
    if (this.running) return;
    this.videoElement = videoElement;
    this.running = true;
    this.busy = false;
    this.tick();
  }

  private tick = (): void => {
    if (!this.running) return;

    const video = this.videoElement;
    if (video && video.readyState >= 2 && video.videoWidth > 0 && !this.busy) {
      this.busy = true;
      this.segmentation
        .send({ image: video })
        .then(() => { this.busy = false; })
        .catch(() => { this.busy = false; });
    }

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  getOutputCanvas(): HTMLCanvasElement {
    return this.outputCanvas;
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
  }

  dispose(): void {
    this.stop();
    try { this.segmentation?.close?.(); } catch { /* noop */ }
    this.segmentation = null;
    this.videoElement = null;
  }
}
