import {
  getTabCaptureStream,
  stopAllTracks,
  TabCaptureRecorder,
} from '@/lib/tabCaptureRecording';
import { formatTabCaptureError, rawMessage } from '@/lib/embedCaptureErrors';

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
    if (!videoEl) {
      done();
      return;
    }
    if (typeof videoEl.requestVideoFrameCallback === 'function') {
      videoEl.requestVideoFrameCallback(() => done());
      window.setTimeout(done, 900);
      return;
    }
    if (videoEl.readyState >= 2) {
      done();
      return;
    }
    videoEl.addEventListener('loadeddata', done, { once: true });
    window.setTimeout(done, 900);
  });
}

/** Ensure tab-capture video track is receiving frames before starting MediaRecorder. */
async function waitForLiveVideoTrack(track: MediaStreamTrack | undefined, timeoutMs = 8_000): Promise<boolean> {
  if (!track) return false;
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (track.readyState === 'ended') return false;
    if (track.readyState === 'live') return true;
    await sleep(80);
  }
  return track.readyState === 'live';
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

function safeVideoSrcObject(el: HTMLVideoElement | null, stream: MediaStream | null): boolean {
  if (!el) return false;
  try {
    el.srcObject = stream;
    return true;
  } catch (e) {
    console.warn('[embedTabCaptureFlow] srcObject attach failed', rawMessage(e));
    return false;
  }
}

async function startRecorderWithRetries(stream: MediaStream, videoEl: HTMLVideoElement | null): Promise<TabCaptureRecorder> {
  let attempt = 0;
  const maxAttempts = 6;
  let lastErr: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    const recorder = new TabCaptureRecorder();
    try {
      await sleep(attempt === 1 ? 340 : 240 + attempt * 110);
      recorder.start(stream);
      return recorder;
    } catch (e) {
      lastErr = e;
      if (!isInvalidStateError(e)) throw e;
      try {
        await recorder.stop();
      } catch {
        /* noop */
      }
      /** Detach preview so only MediaRecorder consumes the stream (Chromium tab capture quirk). */
      if (videoEl) {
        try {
          videoEl.srcObject = null;
        } catch {
          /* noop */
        }
        await sleep(180 + attempt * 80);
        if (!safeVideoSrcObject(videoEl, stream)) {
          await sleep(220);
        }
        await videoEl.play().catch(() => {});
        await waitForPreviewFrames(videoEl);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function runEmbedTabCaptureFlow(args: {
  opts: EmbedCaptureOpts;
  videoEl: HTMLVideoElement;
  ytPlayer: any | null;
  isYoutube: boolean;
  captureShellEl: HTMLElement | null;
  onProgress?: (ratio01: number) => void;
  /** Media duration (seconds) read before capture — used for progress on non-YouTube “full” clips */
  videoDurationHintSec?: number | null;
}): Promise<{ ok: true; blob: Blob } | { ok: false; message: string }> {
  const { opts, videoEl, ytPlayer, isYoutube, onProgress, videoDurationHintSec } = args;

  let recorder: TabCaptureRecorder | null = null;
  let stream: MediaStream | null = null;

  try {
    if (!videoEl || typeof videoEl.play !== 'function') {
      return {
        ok: false,
        message:
          'The video player is not ready. Wait until you can see the clip, then tap Capture again.',
      };
    }

    /**
     * Avoid requestFullscreen before capture — it correlates with InvalidStateError when calling
     * MediaRecorder.start() right after getDisplayMedia on several Chromium / embedded-WebView builds.
     */

    if (isYoutube && ytPlayer && typeof ytPlayer.getDuration === 'function') {
      try {
        await waitUntilOk(() => Number(ytPlayer.getDuration?.() ?? 0) > 0.25, 120, 30_000);
      } catch {
        return {
          ok: false,
          message:
            'The embedded player is still loading. Wait until the video is visible and playing, then tap Capture again.',
        };
      }
    }

    stream = await getTabCaptureStream();
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') {
      stopAllTracks(stream);
      stream = null;
      throw new Error('No video from shared tab.');
    }

    const liveOk = await waitForLiveVideoTrack(track, 10_000);
    if (!liveOk) {
      stopAllTracks(stream);
      stream = null;
      return {
        ok: false,
        message:
          'The shared tab is not sending video yet. Close the share dialog and tap Capture again, then choose this browser tab.',
      };
    }

    /**
     * Start MediaRecorder before attaching the tab stream to &lt;video&gt; — avoids InvalidStateError
     * when both compete for first frames (common in Chromium tab capture).
     */
    await sleep(isYoutube ? 160 : 120);
    try {
      recorder = await startRecorderWithRetries(stream, null);
    } catch (e) {
      stopAllTracks(stream);
      stream = null;
      throw e;
    }
    onProgress?.(0.04);

    /**
     * Preview on &lt;video&gt; is optional: recorder already holds the tab MediaStream.
     * Attaching `srcObject` can throw on some Safari / embedded WebViews — do not fail the whole capture.
     */
    const previewOk = safeVideoSrcObject(videoEl, stream);
    if (previewOk) {
      await videoEl.play().catch(() => {});
      await waitForPreviewFrames(videoEl);
      await sleep(isYoutube ? 240 : 180);
    } else {
      if (typeof console !== 'undefined') {
        console.warn('[embedTabCaptureFlow] preview attach failed — continuing recording without local preview');
      }
      onProgress?.(0.08);
      await sleep(isYoutube ? 420 : 300);
    }

    if (isYoutube && ytPlayer && typeof ytPlayer.seekTo === 'function') {
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
          /** Duration often stays 0 until metadata loads — pulse progress instead of freezing at 0%. */
          let pulse = 0;
          const pulseIv = window.setInterval(() => {
            pulse = Math.min(0.94, pulse + 0.012);
            onProgress?.(pulse);
          }, 320);
          await new Promise<void>((resolve) => {
            track?.addEventListener('ended', () => resolve(), { once: true });
          });
          window.clearInterval(pulseIv);
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
        const hint = videoDurationHintSec;
        if (hint != null && hint > 0.5 && Number.isFinite(hint)) {
          const durMs = hint * 1000;
          const t0 = performance.now();
          const iv = window.setInterval(() => {
            onProgress?.(Math.min(1, (performance.now() - t0) / durMs));
          }, 100);
          await sleep(durMs);
          window.clearInterval(iv);
          onProgress?.(1);
        } else {
          let pulse = 0.06;
          const pulseIv = window.setInterval(() => {
            pulse = Math.min(0.92, pulse + 0.013);
            onProgress?.(pulse);
          }, 280);
          await new Promise<void>((resolve) => {
            track?.addEventListener('ended', () => resolve(), { once: true });
          });
          window.clearInterval(pulseIv);
          onProgress?.(1);
        }
      }
    }

    const blob = await recorder.stop();
    recorder = null;
    stopAllTracks(stream);
    stream = null;
    try {
      if (videoEl) videoEl.srcObject = null;
    } catch {
      /* noop */
    }

    try {
      await document.exitFullscreen?.();
    } catch {
      /* noop */
    }

    const minBytes = 256;
    if (!blob || blob.size < minBytes) {
      return {
        ok: false,
        message:
          'The recording file was empty — often a browser tab-share glitch. Refresh the page, tap Capture again, choose “This tab” / “Chrome Tab”, keep the video playing, then stop sharing only when finished.',
      };
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
    stopAllTracks(stream);
    stream = null;
    try {
      if (videoEl) videoEl.srcObject = null;
    } catch {
      /* noop */
    }
    try {
      await document.exitFullscreen?.();
    } catch {
      /* noop */
    }
    if (typeof console !== 'undefined') {
      console.warn('[CoachLab tab capture]', e, rawMessage(e));
    }
    return {
      ok: false,
      message: formatTabCaptureError(e),
    };
  }
}
