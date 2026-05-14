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

/** YouTube IFrame API: PlayerState.PLAYING === 1 */
const YT_PLAYING = 1;

async function waitForYoutubePlaying(getPlayer: () => any | null, timeoutMs = 120_000): Promise<void> {
  const t0 = performance.now();
  const playerDeadline = t0 + Math.min(90_000, timeoutMs);
  while (performance.now() < playerDeadline) {
    const p = getPlayer();
    if (p && typeof p.getPlayerState === 'function') break;
    await sleep(100);
  }
  const first = getPlayer();
  if (!first || typeof first.getPlayerState !== 'function') {
    throw new Error('YouTube player did not become ready in time.');
  }
  const playingDeadline = t0 + timeoutMs;
  while (performance.now() < playingDeadline) {
    const p = getPlayer();
    if (!p || typeof p.getPlayerState !== 'function') {
      await sleep(100);
      continue;
    }
    try {
      p.mute?.();
    } catch {
      /* noop */
    }
    try {
      p.playVideo?.();
    } catch {
      /* noop */
    }
    if (p.getPlayerState() === YT_PLAYING) return;
    await sleep(80);
  }
  throw new Error('YouTube did not reach PLAYING in time.');
}

async function waitForGenericEmbedAfterLoad(
  getIframe: () => HTMLIFrameElement | null,
  embedAlreadyReady: boolean,
): Promise<void> {
  const el = getIframe();
  if (!el) {
    await sleep(2000);
    return;
  }
  if (!embedAlreadyReady) {
    await Promise.race([
      new Promise<void>((resolve) => {
        el.addEventListener('load', () => resolve(), { once: true });
      }),
      sleep(10_000),
    ]);
  }
  await sleep(2000);
}

type CroppedPipeline = {
  stream: MediaStream;
  dispose: () => void;
};

/**
 * Pipes display-capture frames through a canvas so MediaRecorder only sees the embed region.
 * Maps CSS layout → intrinsic capture pixels (handles HiDPI when the tab frame matches the viewport).
 */
async function startCroppedDisplayPipeline(
  displayStream: MediaStream,
  getCropTarget: () => HTMLElement | null,
  outW: number,
  outH: number,
  basisCss?: { w: number; h: number } | null,
): Promise<CroppedPipeline | null> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.srcObject = displayStream;
  try {
    await video.play();
  } catch {
    try {
      video.srcObject = null;
    } catch {
      /* noop */
    }
    return null;
  }

  const w = Math.max(2, Math.floor(outW));
  const h = Math.max(2, Math.floor(outH));

  type OffscreenCanvasWithCapture = OffscreenCanvas & { captureStream?: (fps?: number) => MediaStream };

  let croppedStream: MediaStream;
  let drawCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  let canvasEl: HTMLCanvasElement | null = null;
  let offscreen: OffscreenCanvas | null = null;

  const ocProto =
    typeof OffscreenCanvas !== 'undefined'
      ? (OffscreenCanvas.prototype as unknown as { captureStream?: unknown })
      : null;
  const preferOffscreen = typeof ocProto?.captureStream === 'function';

  if (preferOffscreen) {
    offscreen = new OffscreenCanvas(w, h);
    const octx = offscreen.getContext('2d', { alpha: false, desynchronized: true });
    if (!octx) {
      try {
        video.srcObject = null;
      } catch {
        /* noop */
      }
      return null;
    }
    drawCtx = octx;
    croppedStream = (offscreen as OffscreenCanvasWithCapture).captureStream!(60);
  } else {
    canvasEl = document.createElement('canvas');
    canvasEl.width = w;
    canvasEl.height = h;
    const cctx = canvasEl.getContext('2d', { alpha: false, desynchronized: true });
    if (!cctx) {
      try {
        video.srcObject = null;
      } catch {
        /* noop */
      }
      return null;
    }
    drawCtx = cctx;
    croppedStream = canvasEl.captureStream(60);
  }
  let raf = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    const target = getCropTarget();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (target && vw > 0 && vh > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const rect = target.getBoundingClientRect();
      const basisW =
        basisCss && basisCss.w > 0 ? basisCss.w : window.innerWidth;
      const basisH =
        basisCss && basisCss.h > 0 ? basisCss.h : window.innerHeight;
      if (basisW > 0 && basisH > 0) {
        let sx = (rect.left / basisW) * vw;
        let sy = (rect.top / basisH) * vh;
        let sw = (rect.width / basisW) * vw;
        let sh = (rect.height / basisH) * vh;
        sx = Math.max(0, Math.min(vw - 1, sx));
        sy = Math.max(0, Math.min(vh - 1, sy));
        sw = Math.max(1, Math.min(vw - sx, sw));
        sh = Math.max(1, Math.min(vh - sy, sh));
        try {
          drawCtx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
        } catch {
          /* noop */
        }
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const dispose = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stopAllTracks(croppedStream);
    try {
      video.srcObject = null;
    } catch {
      /* noop */
    }
  };

  return { stream: croppedStream, dispose };
}

export async function runEmbedTabCaptureFlow(args: {
  opts: EmbedCaptureOpts;
  videoEl: HTMLVideoElement;
  ytPlayer: any | null;
  isYoutube: boolean;
  /** Fallback when getCropTargetEl is null */
  captureShellEl: HTMLElement | null;
  getYtPlayer?: () => any | null;
  getCropTargetEl?: () => HTMLElement | null;
  getGenericIframe?: () => HTMLIFrameElement | null;
  genericEmbedReady?: boolean;
  hasGenericEmbed?: boolean;
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
    captureShellEl,
    getYtPlayer,
    getCropTargetEl,
    getGenericIframe,
    genericEmbedReady,
    hasGenericEmbed,
    onProgress,
    onCountdown,
    onStepStatus,
    videoDurationHintSec,
    preAcquiredStream,
    onPostStreamReady,
  } = args;

  const effectiveYt = () => (typeof getYtPlayer === 'function' ? getYtPlayer() ?? ytPlayer : ytPlayer);

  let recorder: TabCaptureRecorder | null = null;
  let stream: MediaStream | null = null;
  let cropDispose: (() => void) | null = null;

  try {
    captureLog('flow-start');
    if (preAcquiredStream) {
      stream = preAcquiredStream;
    } else {
      onStepStatus?.('Checking browser support…');
      captureLog('pre-gdm-check');

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
        return fail(
          'getDisplayMedia check',
          'navigator.mediaDevices.getDisplayMedia is unavailable',
          'Screen sharing is not available in this browser. Try Chrome or Edge on a desktop computer.',
        );
      }

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

    onStepStatus?.('Waiting for video to start...');
    try {
      if (isYoutube) {
        await waitForYoutubePlaying(() => effectiveYt(), 120_000);
      } else if (hasGenericEmbed && typeof getGenericIframe === 'function') {
        await waitForGenericEmbedAfterLoad(getGenericIframe, !!genericEmbedReady);
      }
    } catch (e: unknown) {
      stopAllTracks(stream);
      const { friendly } = handleCaptureError(e, 'wait-playback');
      return fail('wait-playback', e, friendly);
    }

    const cropTarget = (typeof getCropTargetEl === 'function' ? getCropTargetEl() : null) ?? captureShellEl;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const rect0 = cropTarget?.getBoundingClientRect();
    const outW = Math.max(2, Math.round((rect0?.width ?? 640) * dpr));
    const outH = Math.max(2, Math.round((rect0?.height ?? 360) * dpr));

    for (let n = 3; n >= 1; n--) {
      onCountdown?.(n);
      captureLog(`countdown-${n}`);
      await sleep(1000);
    }
    onCountdown?.(null);
    captureLog('countdown-done');

    const vt = stream.getVideoTracks()[0];
    let basisCss: { w: number; h: number } | null = null;
    try {
      const s = vt?.getSettings?.() as { width?: number; height?: number } | undefined;
      if (s?.width && s?.height && s.width > 0 && s.height > 0) {
        basisCss = { w: s.width, h: s.height };
      }
    } catch {
      basisCss = null;
    }

    let streamToRecord = stream;
    if (cropTarget) {
      const pipe = await startCroppedDisplayPipeline(
        stream,
        () => (typeof getCropTargetEl === 'function' ? getCropTargetEl() : null) ?? captureShellEl,
        outW,
        outH,
        basisCss,
      );
      if (pipe) {
        streamToRecord = pipe.stream;
        cropDispose = pipe.dispose;
      }
    }

    onStepStatus?.('Starting recording…');

    try {
      recorder = new TabCaptureRecorder();
      try {
        recorder.prepare(streamToRecord);
        captureLog('mediaRecorder-prepared');
      } catch (prepErr) {
        cropDispose?.();
        cropDispose = null;
        stopAllTracks(stream);
        const { friendly } = handleCaptureError(prepErr, 'MediaRecorder.prepare');
        return fail('MediaRecorder.prepare', prepErr, friendly);
      }

      try {
        try {
          recorder.startCapture();
          captureLog('mediaRecorder-started');
        } catch (startErr) {
          console.error('[CoachLab capture] first recorder.startCapture() failed:', startErr);
          await sleep(300);
          recorder = new TabCaptureRecorder();
          recorder.prepare(streamToRecord);
          recorder.startCapture();
          captureLog('mediaRecorder-started-retry');
        }
      } catch (startOuter) {
        cropDispose?.();
        cropDispose = null;
        stopAllTracks(stream);
        const { friendly } = handleCaptureError(startOuter, 'MediaRecorder.startCapture');
        return fail('MediaRecorder.startCapture', startOuter, friendly);
      }
    } catch (recErr) {
      cropDispose?.();
      cropDispose = null;
      stopAllTracks(stream);
      const { friendly } = handleCaptureError(recErr, 'MediaRecorder');
      return fail('MediaRecorder', recErr, friendly);
    }

    onProgress?.(0.04);
    captureLog('recording-loop-begin');

    const ytEnded = () => effectiveYt()?.getPlayerState?.() === 0;

    const ytRec = effectiveYt();
    if (isYoutube && ytRec && typeof ytRec.seekTo === 'function') {
      if (opts.mode === 'section' && opts.startSec != null && opts.endSec != null) {
        const startSec = opts.startSec;
        const endSec = opts.endSec;
        ytRec.seekTo(startSec, true);
        ytRec.playVideo?.();
        const span = Math.max(0.001, endSec - startSec);
        const timeoutMs = (span + 30) * 1000;
        const progIv = window.setInterval(() => {
          const y = effectiveYt();
          const t = Number(y?.getCurrentTime?.() ?? 0);
          onProgress?.(Math.min(1, Math.max(0, (t - startSec) / span)));
        }, 80);
        await waitUntilOk(
          () =>
            ytEnded() || Number(effectiveYt()?.getCurrentTime?.() ?? 0) >= endSec - 0.5,
          80,
          timeoutMs,
        );
        window.clearInterval(progIv);
        effectiveYt()?.pauseVideo?.();
        onProgress?.(1);
      } else {
        ytRec.seekTo(0, true);
        ytRec.playVideo?.();
        const dur = Number(ytRec.getDuration?.() ?? 0);
        if (dur > 0) {
          const timeoutMs = (dur + 30) * 1000;
          const iv = window.setInterval(() => {
            const y = effectiveYt();
            const t = Number(y?.getCurrentTime?.() ?? 0);
            onProgress?.(Math.min(1, t / dur));
          }, 250);
          await waitUntilOk(
            () => ytEnded() || Number(effectiveYt()?.getCurrentTime?.() ?? 0) >= dur - 0.5,
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
        effectiveYt()?.pauseVideo?.();
      }
    } else if (isYoutube && !effectiveYt()) {
      if (opts.mode === 'section' && opts.startSec != null && opts.endSec != null) {
        const span = Math.max(0.001, opts.endSec - opts.startSec);
        const ms = Math.max(300, (span + 2) * 1000);
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
          const durMs = (hint + 2) * 1000;
          const t0 = performance.now();
          const iv = window.setInterval(() => {
            onProgress?.(Math.min(1, (performance.now() - t0) / durMs));
          }, 200);
          await sleep(durMs);
          window.clearInterval(iv);
          onProgress?.(1);
        } else {
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
        }
      }
    } else {
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
            track.addEventListener('ended', () => resolve(), { once: true });
          });
          window.clearInterval(pulseIv);
          onProgress?.(1);
        }
      }
    }

    onStepStatus?.('Processing recording…');
    captureLog('recorder-stop-begin');
    let blob: Blob;
    try {
      blob = await recorder.stop();
    } catch (stopErr) {
      cropDispose?.();
      cropDispose = null;
      stopAllTracks(stream);
      return fail(
        'recorder.stop',
        stopErr,
        'Failed to finalize the recording. Refresh the page and try again.',
      );
    }
    recorder = null;
    cropDispose?.();
    cropDispose = null;
    stopAllTracks(stream);
    stream = null;

    try {
      await document.exitFullscreen?.();
    } catch {
      /* noop */
    }

    const MIN_BLOB_BYTES = 256;
    if (!blob || blob.size < MIN_BLOB_BYTES) {
      return fail(
        'blob size validation',
        `blob.size=${blob?.size ?? 0}`,
        'The recording was empty. Refresh the page, tap Capture, choose "This tab", and keep the video playing until finished.',
      );
    }

    captureLog('flow-success');
    return { ok: true, blob };
  } catch (e: unknown) {
    if (recorder) {
      try {
        await recorder.stop();
      } catch {
        /* noop */
      }
    }
    cropDispose?.();
    cropDispose = null;
    stopAllTracks(stream);
    try {
      await document.exitFullscreen?.();
    } catch {
      /* noop */
    }

    return fail(
      'unexpected top-level',
      e,
      handleCaptureError(e, 'recording-flow').friendly,
    );
  }
}
