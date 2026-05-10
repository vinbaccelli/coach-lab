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

  /** Prefer current tab when supported (Chromium). Omit fixed width/height ideals — they often cause OverconstrainedError or flaky pipelines on laptops and deployed HTTPS. */
  const preferTab = {
    video: {
      frameRate: { ideal: 30, max: 60 },
    },
    audio: false,
    preferCurrentTab: true,
  } as Parameters<MediaDevices['getDisplayMedia']>[0];

  const minimal = {
    video: true,
    audio: false,
  } as Parameters<MediaDevices['getDisplayMedia']>[0];

  try {
    return await navigator.mediaDevices.getDisplayMedia(preferTab);
  } catch {
    try {
      return await navigator.mediaDevices.getDisplayMedia(minimal);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
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
    try {
      this.recorder.start(250);
    } catch (e) {
      try {
        this.recorder?.stop();
      } catch {
        /* noop */
      }
      this.recorder = null;
      throw e;
    }
  }

  async stop(): Promise<Blob> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') {
      return new Blob(this.chunks, { type: pickRecorderMimeType() });
    }
    return new Promise((resolve, reject) => {
      rec.onerror = (ev) => {
        const inner = (ev as { error?: DOMException }).error;
        reject(
          inner instanceof Error
            ? inner
            : new Error('Recording stopped unexpectedly. Try again or use a shorter clip.'),
        );
      };
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
      /** Allow one paint so the final chunk is queued before stop (reduces empty blobs). */
      window.setTimeout(() => {
        try {
          if (rec.state !== 'inactive') rec.stop();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }, 40);
    });
  }
}
