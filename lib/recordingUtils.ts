/**
 * Recording utilities: screen + webcam + mic recording using MediaRecorder API.
 */

export interface RecordingOptions {
  /** The main canvas element to record */
  canvasEl: HTMLCanvasElement;
  /** Webcam stream (optional) */
  webcamStream?: MediaStream | null;
  /** Microphone stream (optional) */
  micStream?: MediaStream | null;
  /** Desired output MIME type */
  mimeType?: string;
  /** Target fps for canvas capture */
  fps?: number;
}

/** Preferred MIME types in priority order */
const MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

export function getSupportedMimeType(): string {
  for (const mt of MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return '';
}

/**
 * Start recording the canvas (with optional webcam overlay + mic audio).
 * Returns a cleanup function to stop recording.
 */
export async function startCanvasRecording(
  opts: RecordingOptions,
  onStop: (blob: Blob) => void,
): Promise<{ mediaRecorder: MediaRecorder; stop: () => void }> {
  const { canvasEl, webcamStream, micStream, fps = 30 } = opts;

  // Canvas video track
  const canvasStream: MediaStream = (canvasEl as any).captureStream(fps);

  const tracks: MediaStreamTrack[] = [...canvasStream.getTracks()];

  // Add mic audio
  if (micStream) {
    micStream.getAudioTracks().forEach((t) => tracks.push(t));
  }

  // Add webcam audio (if no dedicated mic)
  if (!micStream && webcamStream) {
    webcamStream.getAudioTracks().forEach((t) => tracks.push(t));
  }

  const combined = new MediaStream(tracks);
  const mimeType = getSupportedMimeType();

  const mediaRecorder = new MediaRecorder(combined, {
    mimeType: mimeType || undefined,
    videoBitsPerSecond: 4_000_000,
  });

  const chunks: BlobPart[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
    onStop(blob);
  };

  mediaRecorder.start(100);

  return {
    mediaRecorder,
    stop: () => {
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    },
  };
}

/** Request webcam + microphone access */
export async function requestWebcamAndMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

/** Request microphone only */
export async function requestMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

/** Download a Blob as a video file */
export function downloadBlob(blob: Blob, filename = 'recording.webm'): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Create an object URL for previewing a blob */
export function createBlobURL(blob: Blob): string {
  return URL.createObjectURL(blob);
}
