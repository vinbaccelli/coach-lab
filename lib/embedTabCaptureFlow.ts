import {
  getTabCaptureStream,
  stopAllTracks,
  TabCaptureRecorder,
} from '@/lib/tabCaptureRecording';
import { formatTabCaptureError } from '@/lib/embedCaptureErrors';

export type EmbedCaptureOpts = {
  mode: 'full' | 'section';
  startSec: number | null;
  endSec: number | null;
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function isInvalidStateError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as DOMException).name === 'InvalidStateError';
}

/** Wait until at least one decoded frame is ready (helps Chromium accept MediaRecorder on display streams). */
function waitForPreviewFrames(videoEl: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    if (typeof videoEl.requestVideoFrameCallback === 'function') {
      videoEl.requestVideoFrameCallback(() => done());
      window.setTimeout(done, 400);
      return;
    }
    if (videoEl.readyState >= 2) {
      done();
      return;
    }
    videoEl.addEventListener('loadeddata', done, { once: true });
    window.setTimeout(done, 400);
  });
}

function stopStreams(stream: MediaStream | null, recordStream: MediaStream | null) {
  stopAllTracks(stream);
  if (recordStream && recordStream !== stream) stopAllTracks(recordStream);
}

async function waitUntilOk(pred: () => boolean, intervalMs: number, timeoutMs = 3_600_000) {
  const start = performance.now();
  return new Promise<void>((resolve, reject) => {
    const iv = window.setInterval(() => {
      try {
        if (performance.now() - start > timeoutMs) {
          window.clearInterval(iv);
          reject(new Error('Capture timed out.'));
          return;
        }
        if (pred()) {
          window.clearInterval(iv);
          resolve();
        }
      } catch (e) {
        window.clearInterval(iv);
        reject(e);
      }
    }, intervalMs);
  });
}

export async function runEmbedTabCaptureFlow(args: {
  opts: EmbedCaptureOpts;
  videoEl: HTMLVideoElement;
  ytPlayer: any | null;
  isYoutube: boolean;
  captureShellEl: HTMLElement | null;
  onProgress?: (ratio01: number) => void;
}): Promise<{ ok: true; blob: Blob } | { ok: false; message: string }> {
  const { opts, videoEl, ytPlayer, isYoutube, onProgress } = args;

  let recorder: TabCaptureRecorder | null = null;
  let stream: MediaStream | null = null;
  /** When clone() succeeds, recorder uses this so &lt;video&gt; and MediaRecorder are not sharing one pipeline (fixes recurring InvalidStateError in Chromium). */
  let recordStream: MediaStream | null = null;

  try {
    /**
     * Avoid requestFullscreen before capture — it correlates with InvalidStateError when calling
     * MediaRecorder.start() right after getDisplayMedia on several Chromium / embedded-WebView builds.
     */

    stream = await getTabCaptureStream();
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') {
      stopAllTracks(stream);
      stream = null;
      throw new Error('No video from shared tab.');
    }

    try {
      recordStream = stream.clone();
    } catch {
      recordStream = stream;
    }

    videoEl.srcObject = stream;
    await videoEl.play().catch(() => {});
    await waitForPreviewFrames(videoEl);
    await sleep(60);

    recorder = new TabCaptureRecorder();
    try {
      recorder.start(recordStream);
    } catch (e) {
      if (!isInvalidStateError(e)) throw e;
      await sleep(250);
      recorder = new TabCaptureRecorder();
      try {
        recorder.start(recordStream);
      } catch (e2) {
        if (!isInvalidStateError(e2)) throw e2;
        /** Last resort: detach preview so only the recorder holds the pipeline (never stop() clone tracks — that can end the whole tab capture in Chromium). */
        videoEl.srcObject = null;
        await sleep(80);
        recorder = new TabCaptureRecorder();
        recorder.start(recordStream);
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});
      }
    }

    if (isYoutube && ytPlayer) {
      if (opts.mode === 'section' && opts.startSec != null && opts.endSec != null) {
        const startSec = opts.startSec;
        const endSec = opts.endSec;
        ytPlayer.seekTo?.(startSec, true);
        ytPlayer.playVideo?.();
        const span = Math.max(0.001, endSec - startSec);
        const progIv = window.setInterval(() => {
          const t = Number(ytPlayer.getCurrentTime?.() ?? 0);
          onProgress?.(Math.min(1, Math.max(0, (t - startSec) / span)));
        }, 80);
        await waitUntilOk(() => Number(ytPlayer.getCurrentTime?.() ?? 0) >= endSec - 0.12, 80);
        window.clearInterval(progIv);
        ytPlayer.pauseVideo?.();
        onProgress?.(1);
      } else {
        ytPlayer.seekTo?.(0, true);
        ytPlayer.playVideo?.();
        const dur = Number(ytPlayer.getDuration?.() ?? 0);
        if (dur > 0) {
          const iv = window.setInterval(() => {
            const t = Number(ytPlayer.getCurrentTime?.() ?? 0);
            onProgress?.(Math.min(1, t / dur));
          }, 250);
          await waitUntilOk(() => Number(ytPlayer.getCurrentTime?.() ?? 0) >= dur - 0.25, 200);
          window.clearInterval(iv);
          onProgress?.(1);
        } else {
          await new Promise<void>((resolve) => {
            track?.addEventListener('ended', () => resolve(), { once: true });
          });
          onProgress?.(1);
        }
        ytPlayer.pauseVideo?.();
      }
    } else if (isYoutube && !ytPlayer) {
      /** YouTube iframe API not ready yet — same as open-ended tab capture */
      let pulse = 0;
      const pulseIv = window.setInterval(() => {
        pulse = Math.min(0.92, pulse + 0.015);
        onProgress?.(pulse);
      }, 400);
      await new Promise<void>((resolve) => {
        track?.addEventListener('ended', () => resolve(), { once: true });
      });
      window.clearInterval(pulseIv);
      onProgress?.(1);
    } else if (!isYoutube) {
      if (opts.mode === 'section' && opts.startSec != null && opts.endSec != null) {
        const ms = Math.max(300, (opts.endSec - opts.startSec) * 1000);
        const t0 = performance.now();
        const iv = window.setInterval(() => {
          onProgress?.(Math.min(1, (performance.now() - t0) / ms));
        }, 120);
        await sleep(ms);
        window.clearInterval(iv);
        onProgress?.(1);
      } else {
        /** Wait until user stops sharing this tab */
        await new Promise<void>((resolve) => {
          track?.addEventListener('ended', () => resolve(), { once: true });
        });
        onProgress?.(1);
      }
    }

    const blob = await recorder.stop();
    recorder = null;
    stopStreams(stream, recordStream);
    stream = null;
    recordStream = null;
    videoEl.srcObject = null;

    try {
      await document.exitFullscreen?.();
    } catch {
      /* noop */
    }

    return { ok: true, blob };
  } catch (e) {
    if (recorder) {
      try {
        await recorder.stop();
      } catch {
        /* noop */
      }
    }
    stopStreams(stream, recordStream);
    stream = null;
    recordStream = null;
    if (videoEl) videoEl.srcObject = null;
    try {
      await document.exitFullscreen?.();
    } catch {
      /* noop */
    }
    if (typeof console !== 'undefined') {
      console.warn('[CoachLab tab capture]', e);
    }
    return {
      ok: false,
      message: formatTabCaptureError(e),
    };
  }
}
