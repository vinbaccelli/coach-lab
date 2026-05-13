import {
  getTabCaptureStream,
  stopAllTracks,
  TabCaptureRecorder,
} from '@/lib/tabCaptureRecording';
import { captureLog, handleCaptureError } from '@/lib/embedCaptureSession';

export type EmbedCaptureOpts = {
  mode: 'full' | 'section';
  startSec: number | null;
  endSec: number | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fail(step: string, raw: unknown, friendly: string): { ok: false; message: string } {
  console.error(`[CoachLab capture] FAILED at "${step}":`, raw);
  return { ok: false, message: friendly };
}

async function waitUntilOk(
  pred: () => boolean,
  intervalMs: number,
  timeoutMs = 3_600_000,
): Promise<void> {
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
  onCountdown?: (n: number | null) => void;
  onStepStatus?: (msg: string) => void;
  videoDurationHintSec?: number | null;
  preAcquiredStream?: MediaStream;
  /** Fires once the display-capture video track is live (within ~100ms for UI overlay). */
  onPostStreamReady?: () => void;
}): Promise<{ ok: true; blob: Blob } | { ok: false; message: string }> {
  const {
    opts,
    ytPlayer,
    isYoutube,
    onProgress,
    onCountdown,
    onStepStatus,
    videoDurationHintSec,
    preAcquiredStream,
    onPostStreamReady,
  } = args;

  let recorder: TabCaptureRecorder | null = null;
  let stream: MediaStream | null = null;

  try {
    captureLog('flow-start');
    if (preAcquiredStream) {
      // Stream already acquired from user gesture in the caller
      stream = preAcquiredStream;
    } else {
      // ── 1. Check getDisplayMedia availability ──────────────────────────
      onStepStatus?.('Checking browser support…');
      captureLog('pre-gdm-check');

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices?.getDisplayMedia
      ) {
        return fail(
          'getDisplayMedia check',
          'navigator.mediaDevices.getDisplayMedia is unavailable',
          'Screen sharing is not available in this browser. Try Chrome or Edge on a desktop computer.',
        );
      }

      // ── 2. Call getDisplayMedia IMMEDIATELY and store stream ───────────
      onStepStatus?.(
        typeof navigator !== 'undefined' && /Safari/i.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS/i.test(navigator.userAgent)
          ? 'Requesting screen share — on Safari choose Entire Screen or Window (not “tab”)…'
          : 'Requesting screen share — choose “This tab” in Chrome, or Window / Screen in Safari…',
      );

      try {
        stream = await getTabCaptureStream();
        captureLog('getDisplayMedia-ok');
      } catch (e: unknown) {
        const { friendly } = handleCaptureError(e, 'getDisplayMedia');
        return fail('getDisplayMedia', e, friendly);
      }
    }

    onStepStatus?.('Verifying video stream…');
    captureLog('stream-validate');

    if (!stream) {
      return fail(
        'stream null check',
        'stream is null after acquisition',
        'Could not obtain a video stream. Please try Capture again — make sure you pick "This tab" when prompted.',
      );
    }

    const videoTracks = stream.getVideoTracks();
    if (!videoTracks) {
      stopAllTracks(stream);
      return fail(
        'video track list check',
        'getVideoTracks() returned null/undefined',
        'Something went wrong reading the video stream. Please refresh the page and try Capture again.',
      );
    }
    if (videoTracks.length === 0) {
      stopAllTracks(stream);
      return fail(
        'video track check',
        `getVideoTracks() returned ${videoTracks.length} tracks`,
        'No video track received from the shared tab. Make sure you chose "This tab" when asked, then try again.',
      );
    }

    // ── 4. Wait for track to be live ──────────────────────────────────
    const track = videoTracks[0];

    if (track.readyState === 'ended') {
      stopAllTracks(stream);
      return fail(
        'track readyState',
        `readyState=${track.readyState} immediately after getDisplayMedia`,
        'The video track ended immediately. Close any other screen shares and try again.',
      );
    }

    const trackDeadline = performance.now() + 8_000;
    while (track.readyState !== 'live' && performance.now() < trackDeadline) {
      if (track.readyState === 'ended') {
        stopAllTracks(stream);
        return fail(
          'track readyState wait',
          `readyState transitioned to "ended" while waiting`,
          'The shared tab stopped sending video. Try Capture again and keep this tab visible.',
        );
      }
      await sleep(100);
    }

    if (track.readyState !== 'live') {
      stopAllTracks(stream);
      return fail(
        'track readyState timeout',
        `readyState=${track.readyState} after 8 s`,
        'The shared tab is not sending video. Close the share dialog, tap Capture, and choose this browser tab.',
      );
    }

    captureLog('track-live');
    try {
      onPostStreamReady?.();
    } catch (e) {
      console.warn('[CoachLab capture] onPostStreamReady:', e);
    }

    onStepStatus?.('Starting recording…');

    // ── 5. Prepare MediaRecorder, countdown, then start timeslices ───────
    try {
      recorder = new TabCaptureRecorder();
      try {
        recorder.prepare(stream);
        captureLog('mediaRecorder-prepared');
      } catch (prepErr) {
        stopAllTracks(stream);
        const { friendly } = handleCaptureError(prepErr, 'MediaRecorder.prepare');
        return fail('MediaRecorder.prepare', prepErr, friendly);
      }

      for (let n = 3; n >= 1; n--) {
        onCountdown?.(n);
        captureLog(`countdown-${n}`);
        await sleep(1000);
      }
      onCountdown?.(null);
      captureLog('countdown-done');

      try {
        try {
          recorder.startCapture();
          captureLog('mediaRecorder-started');
        } catch (startErr) {
          console.error('[CoachLab capture] first recorder.startCapture() failed:', startErr);
          await sleep(300);
          recorder = new TabCaptureRecorder();
          recorder.prepare(stream);
          recorder.startCapture();
          captureLog('mediaRecorder-started-retry');
        }
      } catch (startOuter) {
        stopAllTracks(stream);
        const { friendly } = handleCaptureError(startOuter, 'MediaRecorder.startCapture');
        return fail('MediaRecorder.startCapture', startOuter, friendly);
      }
    } catch (recErr) {
      stopAllTracks(stream);
      const { friendly } = handleCaptureError(recErr, 'MediaRecorder');
      return fail('MediaRecorder', recErr, friendly);
    }

    onProgress?.(0.04);
    captureLog('recording-loop-begin');

    // ── 6. Run the recording for the requested duration ───────────────
    const ytEnded = () => ytPlayer?.getPlayerState?.() === 0;

    if (isYoutube && ytPlayer && typeof ytPlayer.seekTo === 'function') {
      // YouTube with player API available
      if (opts.mode === 'section' && opts.startSec != null && opts.endSec != null) {
        const startSec = opts.startSec;
        const endSec = opts.endSec;
        ytPlayer.seekTo(startSec, true);
        ytPlayer.playVideo?.();
        const span = Math.max(0.001, endSec - startSec);
        const timeoutMs = (span + 30) * 1000;
        const progIv = window.setInterval(() => {
          const t = Number(ytPlayer.getCurrentTime?.() ?? 0);
          onProgress?.(Math.min(1, Math.max(0, (t - startSec) / span)));
        }, 80);
        await waitUntilOk(
          () => ytEnded() || Number(ytPlayer.getCurrentTime?.() ?? 0) >= endSec - 0.5,
          80,
          timeoutMs,
        );
        window.clearInterval(progIv);
        ytPlayer.pauseVideo?.();
        onProgress?.(1);
      } else {
        ytPlayer.seekTo(0, true);
        ytPlayer.playVideo?.();
        const dur = Number(ytPlayer.getDuration?.() ?? 0);
        if (dur > 0) {
          const timeoutMs = (dur + 30) * 1000;
          const iv = window.setInterval(() => {
            const t = Number(ytPlayer.getCurrentTime?.() ?? 0);
            onProgress?.(Math.min(1, t / dur));
          }, 250);
          await waitUntilOk(
            () => ytEnded() || Number(ytPlayer.getCurrentTime?.() ?? 0) >= dur - 0.5,
            200,
            timeoutMs,
          );
          window.clearInterval(iv);
          onProgress?.(1);
        } else {
          let pulse = 0;
          const pulseIv = window.setInterval(() => {
            pulse = Math.min(0.94, pulse + 0.012);
            onProgress?.(pulse);
          }, 320);
          await Promise.race([
            new Promise<void>((resolve) => {
              track.addEventListener('ended', () => resolve(), { once: true });
            }),
            waitUntilOk(() => ytEnded(), 500, 600_000),
          ]);
          window.clearInterval(pulseIv);
          onProgress?.(1);
        }
        ytPlayer.pauseVideo?.();
      }
    } else if (isYoutube && !ytPlayer) {
      // YouTube without player API — wait for track to end
      let pulse = 0;
      const pulseIv = window.setInterval(() => {
        pulse = Math.min(0.92, pulse + 0.015);
        onProgress?.(pulse);
      }, 400);
      await new Promise<void>((resolve) => {
        track.addEventListener('ended', () => resolve(), { once: true });
      });
      window.clearInterval(pulseIv);
      onProgress?.(1);
    } else {
      // Non-YouTube embed
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
          // Unknown duration — pulse progress until the track ends
          let pulse = 0.06;
          const pulseIv = window.setInterval(() => {
            pulse = Math.min(0.92, pulse + 0.013);
            onProgress?.(pulse);
          }, 280);
          await new Promise<void>((resolve) => {
            track.addEventListener('ended', () => resolve(), { once: true });
          });
          window.clearInterval(pulseIv);
          onProgress?.(1);
        }
      }
    }

    // ── 7. Stop recorder, get blob, stop tracks ──────────────────────
    onStepStatus?.('Processing recording…');
    captureLog('recorder-stop-begin');
    let blob: Blob;
    try {
      blob = await recorder.stop();
    } catch (stopErr) {
      stopAllTracks(stream);
      return fail(
        'recorder.stop',
        stopErr,
        'Failed to finalize the recording. Refresh the page and try again.',
      );
    }
    recorder = null;
    stopAllTracks(stream);
    stream = null;

    try {
      await document.exitFullscreen?.();
    } catch { /* noop */ }

    const MIN_BLOB_BYTES = 256;
    if (!blob || blob.size < MIN_BLOB_BYTES) {
      return fail(
        'blob size validation',
        `blob.size=${blob?.size ?? 0}`,
        'The recording was empty. Refresh the page, tap Capture, choose "This tab", and keep the video playing until finished.',
      );
    }

    // ── 8. Success ────────────────────────────────────────────────────
    captureLog('flow-success');
    return { ok: true, blob };
  } catch (e: unknown) {
    // Top-level safety net
    if (recorder) {
      try { await recorder.stop(); } catch { /* noop */ }
    }
    stopAllTracks(stream);
    try { await document.exitFullscreen?.(); } catch { /* noop */ }

    return fail(
      'unexpected top-level',
      e,
      handleCaptureError(e, 'recording-flow').friendly,
    );
  }
}
