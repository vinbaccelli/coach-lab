/**
 * Screen/tab capture via getDisplayMedia + MediaRecorder for session-local recordings.
 */

export function pickRecorderMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

export async function getTabCaptureStream(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen capture is not supported in this browser.');
  }

  const video: MediaTrackConstraints = {
    frameRate: { ideal: 60, max: 60 },
    width: { ideal: 3840 },
    height: { ideal: 2160 },
  };

  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video,
      audio: false,
      preferCurrentTab: true,
    } as Parameters<MediaDevices['getDisplayMedia']>[0]);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export function stopAllTracks(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* noop */
    }
  });
}

export type RecordingCallbacks = {
  onProgress?: (ratio01: number) => void;
};

export class TabCaptureRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  start(stream: MediaStream, _cb?: RecordingCallbacks) {
    const mimeType = pickRecorderMimeType();
    const opts: MediaRecorderOptions = { mimeType };
    try {
      this.recorder = new MediaRecorder(stream, opts);
    } catch {
      this.recorder = new MediaRecorder(stream);
    }
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(250);
  }

  async stop(): Promise<Blob> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') {
      return new Blob(this.chunks, { type: pickRecorderMimeType() });
    }
    return new Promise((resolve, reject) => {
      rec.onerror = () => reject(new Error('MediaRecorder error'));
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || pickRecorderMimeType() });
        this.recorder = null;
        this.chunks = [];
        resolve(blob);
      };
      try {
        rec.requestData?.();
      } catch {
        /* noop */
      }
      rec.stop();
    });
  }
}
