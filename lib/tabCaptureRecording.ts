/**
 * Screen/tab capture via getDisplayMedia + MediaRecorder for session-local recordings.
 */

function isSafariLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|Edg/i.test(ua);
}

/**
 * Safari prefers MP4/H.264 when supported; Chrome prefers WebM/VP9.
 */
export function pickRecorderMimeType(): string {
  const MR = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null;
  if (!MR?.isTypeSupported) return 'video/webm';

  if (isSafariLike()) {
    const safariFirst = [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for (const c of safariFirst) {
      if (MR.isTypeSupported(c)) return c;
    }
    return 'video/webm';
  }

  const chromeFirst = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
  ];
  for (const c of chromeFirst) {
    if (MR.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

/**
 * Call getDisplayMedia exactly ONCE.  A retry (even in a catch block) consumes
 * the user-gesture token on Safari / WebKit, so the second call always fails
 * with "getDisplayMedia must be called from a user gesture handler".
 *
 * This function MUST be the first await in any handler triggered by a click.
 */
export async function getTabCaptureStream(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen capture is not supported in this browser.');
  }

  const isChromium = /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);

  const constraints: DisplayMediaStreamOptions = isChromium
    ? {
        video: { frameRate: { ideal: 30, max: 60 } } as MediaTrackConstraints,
        audio: false,
        // @ts-expect-error preferCurrentTab is a Chromium-only extension
        preferCurrentTab: true,
      }
    : { video: true, audio: false };

  try {
    return await navigator.mediaDevices.getDisplayMedia(constraints);
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

  /**
   * Create MediaRecorder for the stream without starting — call startCapture() after countdown.
   */
  prepare(stream: MediaStream, _cb?: RecordingCallbacks) {
    try {
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
    } catch (e) {
      this.recorder = null;
      this.chunks = [];
      throw new Error(
        `Could not prepare the recorder: ${e instanceof Error ? e.message : String(e)}. ` +
          'Close other apps using the camera or screen, then try again.',
      );
    }
  }

  startCapture(timesliceMs = 250) {
    if (!this.recorder) {
      throw new Error('Recorder not prepared. Call prepare(stream) first.');
    }
    try {
      this.recorder.start(timesliceMs);
    } catch (e) {
      try {
        this.recorder?.stop();
      } catch {
        /* noop */
      }
      this.recorder = null;
      throw e instanceof Error
        ? e
        : new Error(
            `Could not start the recorder: ${String(e)}. Close other apps using the screen, then try again.`,
          );
    }
  }

  /** @deprecated Prefer prepare() + startCapture() so countdown can run between them */
  start(stream: MediaStream, cb?: RecordingCallbacks) {
    this.prepare(stream, cb);
    this.startCapture(250);
  }

  async stop(): Promise<Blob> {
    const rec = this.recorder;
    if (!rec) {
      const fallback = new Blob(this.chunks, { type: pickRecorderMimeType() });
      this.chunks = [];
      return fallback;
    }
    if (rec.state === 'inactive') {
      const fallback = new Blob(this.chunks, { type: rec.mimeType || pickRecorderMimeType() });
      this.recorder = null;
      this.chunks = [];
      return fallback;
    }
    return new Promise((resolve, reject) => {
      rec.onerror = (ev) => {
        this.recorder = null;
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
      window.setTimeout(() => {
        try {
          if (rec.state !== 'inactive') rec.stop();
        } catch (err) {
          this.recorder = null;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }, 40);
    });
  }
}
