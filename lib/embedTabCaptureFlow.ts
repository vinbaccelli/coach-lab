import {
  getTabCaptureStream,
  stopAllTracks,
  TabCaptureRecorder,
} from '@/lib/tabCaptureRecording';
import {
  captureLog,
  handleCaptureError,
  safeYtCall,
  safeYtVoid,
} from '@/lib/embedCaptureSession';

export type EmbedCaptureOpts = {
  mode: 'full' | 'section';
  startSec: number | null;
  endSec: number | null;
};

/** Sentinel error: thrown internally when caller-supplied cancel callback flips to true. */
class CaptureCancelled extends Error {
  constructor() {
    super('Capture cancelled');
    this.name = 'CaptureCancelled';
  }
}

/**
 * Tracks every disposable resource (interval, RAF, listener, recorder, stream).
 * `runAll()` is idempotent and safe to call from success, error, AND cancel paths,
 * so we can never leak a timer or a stream regardless of how the flow exits.
 */
class CaptureCleaner {
  private items: Array<() => void> = [];
  private done = false;

  add(fn: () => void): void {
    if (this.done) {
      try {
        fn();
      } catch {
        /* noop */
      }
      return;
    }
    this.items.push(fn);
  }

  /** Accepts both DOM (number) and Node (Timeout) interval IDs. */
  addInterval(id: number | ReturnType<typeof setInterval>): void {
    this.add(() => {
      try {
        clearInterval(id as unknown as number);
      } catch {
        /* noop */
      }
    });
  }

  addTimeout(id: number | ReturnType<typeof setTimeout>): void {
    this.add(() => {
      try {
        clearTimeout(id as unknown as number);
      } catch {
        /* noop */
      }
    });
  }

  addRaf(id: number): void {
    this.add(() => {
      try {
        cancelAnimationFrame(id);
      } catch {
        /* noop */
      }
    });
  }

  addListener<K extends keyof MediaStreamTrackEventMap>(
    target: MediaStreamTrack,
    type: K,
    handler: (ev: MediaStreamTrackEventMap[K]) => void,
  ): void {
    this.add(() => {
      try {
        target.removeEventListener(type, handler);
      } catch {
        /* noop */
      }
    });
  }

  runAll(): void {
    if (this.done) return;
    this.done = true;
    const items = this.items.slice();
    this.items = [];
    for (const fn of items) {
      try {
        fn();
      } catch {
        /* noop */
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Sleep that bails immediately when `getCancelled()` returns true. */
async function cancellableSleep(ms: number, getCancelled?: () => boolean): Promise<void> {
  if (ms <= 0) return;
  const t0 = performance.now();
  const STEP = 80;
  while (performance.now() - t0 < ms) {
    if (getCancelled?.()) throw new CaptureCancelled();
    const remaining = ms - (performance.now() - t0);
    await sleep(Math.min(STEP, remaining));
  }
}

function fail(step: string, raw: unknown, friendly: string): { ok: false; message: string } {
  console.error(`[CoachLab capture] FAILED at "${step}":`, raw);
  return { ok: false, message: friendly };
}

async function waitUntilOk(
  pred: () => boolean,
  intervalMs: number,
  timeoutMs = 3_600_000,
  getCancelled?: () => boolean,
  cleaner?: CaptureCleaner,
): Promise<void> {
  const start = performance.now();
  return new Promise<void>((resolve, reject) => {
    const iv = window.setInterval(() => {
      try {
        if (getCancelled?.()) {
          window.clearInterval(iv);
          reject(new CaptureCancelled());
          return;
        }
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
    cleaner?.addInterval(iv);
  });
}

/** YouTube IFrame API: PlayerState.PLAYING === 1, ENDED === 0 */
const YT_PLAYING = 1;
const YT_ENDED = 0;

async function waitForYoutubePlaying(
  getPlayer: () => any | null,
  timeoutMs = 120_000,
  getCancelled?: () => boolean,
): Promise<void> {
  const t0 = performance.now();
  const playerDeadline = t0 + Math.min(90_000, timeoutMs);
  while (performance.now() < playerDeadline) {
    if (getCancelled?.()) throw new CaptureCancelled();
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
    if (getCancelled?.()) throw new CaptureCancelled();
    const p = getPlayer();
    if (!p || typeof p.getPlayerState !== 'function') {
      await sleep(100);
      continue;
    }
    safeYtVoid(() => p.unMute?.());
    safeYtVoid(() => p.playVideo?.());
    const state = safeYtCall<number>(() => p.getPlayerState?.(), -1);
    if (state === YT_PLAYING) return;
    await sleep(80);
  }
  throw new Error('YouTube did not reach PLAYING in time.');
}

async function waitForGenericEmbedAfterLoad(
  getIframe: () => HTMLIFrameElement | null,
  embedAlreadyReady: boolean,
  getCancelled?: () => boolean,
): Promise<void> {
  const el = getIframe();
  if (!el) {
    await cancellableSleep(2000, getCancelled);
    return;
  }
  if (!embedAlreadyReady) {
    let onLoad: (() => void) | null = null;
    await Promise.race([
      new Promise<void>((resolve) => {
        onLoad = () => resolve();
        el.addEventListener('load', onLoad, { once: true });
      }),
      cancellableSleep(10_000, getCancelled),
    ]).finally(() => {
      if (onLoad) {
        try {
          el.removeEventListener('load', onLoad);
        } catch {
          /* noop */
        }
      }
    });
  }
  await cancellableSleep(2000, getCancelled);
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

  // Safari sometimes resolves play() without actually starting playback when the
  // source is a getDisplayMedia track. Give the stream up to 2s to deliver a frame.
  if (video.paused || video.videoWidth === 0) {
    const waitDeadline = performance.now() + 2000;
    while (performance.now() < waitDeadline && (video.paused || video.videoWidth === 0)) {
      await sleep(50);
      if (video.paused) {
        try {
          await video.play();
        } catch {
          /* noop */
        }
      }
    }
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
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;

      // CSS viewport dimensions (always in CSS pixels, DPR-independent).
      const vvW = vv && vv.width > 0 ? vv.width : window.innerWidth;
      const vvH = vv && vv.height > 0 ? vv.height : window.innerHeight;

      // Stream frame dimensions from getSettings() — may be at CSS pixels (Chrome tab
      // capture) OR at native/Retina pixels (Safari window/screen capture).
      const basisW = basisCss && basisCss.w > 0 ? basisCss.w : vvW;
      const basisH = basisCss && basisCss.h > 0 ? basisCss.h : vvH;

      // Detect Retina/HiDPI capture: if the reported stream width is significantly
      // larger than the CSS viewport width, the stream is at native pixel density.
      // getBoundingClientRect() always returns CSS pixels, so we must scale them up
      // to match the stream's native coordinate space before computing the crop region.
      const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      const coordScale = basisCss && basisCss.w > 0 && (basisCss.w / vvW) > 1.25 ? dpr : 1;

      // visualViewport offsets are in CSS pixels; scale to match stream coordinate space.
      const ox = (vv?.offsetLeft ?? 0) * coordScale;
      const oy = (vv?.offsetTop ?? 0) * coordScale;

      if (basisW > 0 && basisH > 0) {
        let sx = ((rect.left * coordScale - ox) / basisW) * vw;
        let sy = ((rect.top * coordScale - oy) / basisH) * vh;
        let sw = (rect.width * coordScale / basisW) * vw;
        let sh = (rect.height * coordScale / basisH) * vh;
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

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopped = true;
    try {
      cancelAnimationFrame(raf);
    } catch {
      /* noop */
    }
    try {
      stopAllTracks(croppedStream);
    } catch {
      /* noop */
    }
    try {
      video.pause();
    } catch {
      /* noop */
    }
    try {
      video.srcObject = null;
    } catch {
      /* noop */
    }
    try {
      video.removeAttribute('src');
    } catch {
      /* noop */
    }
  };

  return { stream: croppedStream, dispose };
}

export type EmbedCaptureResult =
  | { ok: true; blob: Blob }
  | { ok: false; message: string; cancelled?: boolean };

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
  /** Fires at the exact moment MediaRecorder.startCapture() succeeds — use to start the recording timer. */
  onRecordingStarted?: () => void;
  /**
   * Opt-in cancellation: if this callback returns true at any await checkpoint,
   * the flow tears down all resources and returns `{ ok: false, cancelled: true }`.
   * Existing callers that don't pass it behave exactly as before.
   */
  getCancelled?: () => boolean;
}): Promise<EmbedCaptureResult> {
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
    onRecordingStarted,
    getCancelled,
  } = args;

  const effectiveYt = () => (typeof getYtPlayer === 'function' ? getYtPlayer() ?? ytPlayer : ytPlayer);
  const ytState = (): number => safeYtCall<number>(() => effectiveYt()?.getPlayerState?.(), -1);
  const ytTime = (): number => safeYtCall<number>(() => Number(effectiveYt()?.getCurrentTime?.()), 0);
  const ytDuration = (): number => safeYtCall<number>(() => Number(effectiveYt()?.getDuration?.()), 0);

  const cleaner = new CaptureCleaner();
  let recorder: TabCaptureRecorder | null = null;
  let stream: MediaStream | null = null;
  let cropDispose: (() => void) | null = null;

  /** Bail-out helper: shared by every error path so cleanup is guaranteed. */
  const teardown = (alsoStopStream: boolean): void => {
    cleaner.runAll();
    if (cropDispose) {
      try {
        cropDispose();
      } catch {
        /* noop */
      }
      cropDispose = null;
    }
    if (alsoStopStream && stream) {
      try {
        stopAllTracks(stream);
      } catch {
        /* noop */
      }
    }
  };

  const checkCancel = () => {
    if (getCancelled?.()) throw new CaptureCancelled();
  };

  try {
    captureLog('flow-start');
    if (preAcquiredStream) {
      stream = preAcquiredStream;
    } else {
      onStepStatus?.('Preparing…');
      captureLog('pre-gdm-check');

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
        return fail(
          'getDisplayMedia check',
          'navigator.mediaDevices.getDisplayMedia is unavailable',
          'Screen sharing is not available in this browser. Try Chrome or Edge on a desktop computer.',
        );
      }

      // Browser-native picker is self-explanatory; keep the status message terse.
      onStepStatus?.('Preparing…');

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
      teardown(true);
      return fail(
        'video track list check',
        'getVideoTracks() returned null/undefined',
        'Something went wrong reading the video stream. Please refresh the page and try Capture again.',
      );
    }
    if (videoTracks.length === 0) {
      teardown(true);
      return fail(
        'video track check',
        `getVideoTracks() returned ${videoTracks.length} tracks`,
        'No video track received from the shared tab. Make sure you chose "This tab" when asked, then try again.',
      );
    }

    const track = videoTracks[0];

    if (track.readyState === 'ended') {
      teardown(true);
      return fail(
        'track readyState',
        `readyState=${track.readyState} immediately after getDisplayMedia`,
        'The video track ended immediately. Close any other screen shares and try again.',
      );
    }

    /**
     * If the user stops sharing mid-flow (via the browser's "Stop sharing" UI),
     * the track fires "ended". We flag it here and check at every await checkpoint
     * so we can short-circuit cleanly instead of waiting for downstream timeouts.
     */
    let trackEnded = false;
    const onTrackEnded = () => {
      trackEnded = true;
    };
    track.addEventListener('ended', onTrackEnded);
    cleaner.addListener(track, 'ended', onTrackEnded);

    const trackDeadline = performance.now() + 8_000;
    while (track.readyState !== 'live' && performance.now() < trackDeadline) {
      checkCancel();
      if (track.readyState === 'ended') {
        teardown(true);
        return fail(
          'track readyState wait',
          `readyState transitioned to "ended" while waiting`,
          'The shared tab stopped sending video. Try Capture again and keep this tab visible.',
        );
      }
      await sleep(100);
    }

    if (track.readyState !== 'live') {
      teardown(true);
      return fail(
        'track readyState timeout',
        `readyState=${track.readyState} after 8 s`,
        'The shared tab is not sending video. Close the share dialog, tap Capture, and choose this browser tab.',
      );
    }

    captureLog('track-live');

    onStepStatus?.('Starting video…');
    try {
      checkCancel();
      if (isYoutube) {
        await waitForYoutubePlaying(() => effectiveYt(), 120_000, getCancelled);
      } else if (hasGenericEmbed && typeof getGenericIframe === 'function') {
        await waitForGenericEmbedAfterLoad(getGenericIframe, !!genericEmbedReady, getCancelled);
      }
    } catch (e: unknown) {
      teardown(true);
      if (e instanceof CaptureCancelled) throw e;
      const { friendly } = handleCaptureError(e, 'wait-playback');
      return fail('wait-playback', e, friendly);
    }

    onStepStatus?.('Video is playing — starting in 3…');

    if (trackEnded) {
      teardown(true);
      return fail(
        'track ended after playback wait',
        'track.readyState=ended',
        'The shared tab stopped sending video before recording started. Try Capture again.',
      );
    }

    try {
      onPostStreamReady?.();
    } catch (e) {
      console.warn('[CoachLab capture] onPostStreamReady:', e);
    }

    for (let n = 3; n >= 1; n--) {
      checkCancel();
      if (trackEnded) {
        onCountdown?.(null);
        teardown(true);
        return fail(
          'track ended during countdown',
          'track.readyState=ended',
          'The shared tab stopped sending video during the countdown. Try Capture again.',
        );
      }

      // Guard: if the YouTube player paused or started buffering during the countdown
      // (e.g. the coach tapped pause, or the network stalled), attempt a brief recovery
      // before aborting. MediaRecorder must NEVER start before PLAYING state.
      if (isYoutube && ytState() !== YT_PLAYING) {
        safeYtVoid(() => effectiveYt()?.playVideo?.());
        const recoveryDeadline = performance.now() + 2_000;
        while (performance.now() < recoveryDeadline) {
          checkCancel();
          if (ytState() === YT_PLAYING) break;
          await sleep(80);
        }
        if (ytState() !== YT_PLAYING) {
          onCountdown?.(null);
          teardown(true);
          return fail(
            'playback-not-playing-during-countdown',
            `ytState=${ytState()}`,
            'The video paused or buffered during the countdown. Press play on the video and try Capture again.',
          );
        }
      }

      onCountdown?.(n);
      onStepStatus?.(`Video is playing — starting in ${n}…`);
      captureLog(`countdown-${n}`);
      await cancellableSleep(1000, getCancelled);
    }
    onCountdown?.(null);
    captureLog('countdown-done');

    // Measure crop target HERE (after countdown) so output dimensions reflect
    // the exact iframe bounds at the moment recording actually starts.
    const cropTarget = (typeof getCropTargetEl === 'function' ? getCropTargetEl() : null) ?? captureShellEl;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const rect0 = cropTarget?.getBoundingClientRect();
    const outW = Math.max(2, Math.round((rect0?.width ?? 640) * dpr));
    const outH = Math.max(2, Math.round((rect0?.height ?? 360) * dpr));

    if (isYoutube) {
      const p = effectiveYt();
      if (!p || typeof p.getPlayerState !== 'function') {
        teardown(true);
        return fail(
          'youtube-player-missing-before-record',
          'no player',
          'YouTube player disappeared before recording started. Try Capture again.',
        );
      }
      if (ytState() !== YT_PLAYING) {
        safeYtVoid(() => p.playVideo?.());
        const okBy = performance.now() + 12_000;
        while (performance.now() < okBy) {
          checkCancel();
          if (ytState() === YT_PLAYING) break;
          await sleep(50);
        }
        if (ytState() !== YT_PLAYING) {
          teardown(true);
          return fail(
            'youtube-not-playing-before-record',
            `state=${ytState()}`,
            'The video was not playing when recording started. Press play on the video and try Capture again.',
          );
        }
      }
    }

    if (trackEnded) {
      teardown(true);
      return fail(
        'track ended before recorder start',
        'track.readyState=ended',
        'The shared tab stopped sending video. Try Capture again.',
      );
    }

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

    checkCancel();
    onStepStatus?.('Preparing recording…');

    try {
      recorder = new TabCaptureRecorder();
      try {
        recorder.prepare(streamToRecord);
        captureLog('mediaRecorder-prepared');
      } catch (prepErr) {
        recorder = null;
        teardown(true);
        const { friendly } = handleCaptureError(prepErr, 'MediaRecorder.prepare');
        return fail('MediaRecorder.prepare', prepErr, friendly);
      }

      try {
        try {
          recorder.startCapture();
          captureLog('mediaRecorder-started');
          try { onRecordingStarted?.(); } catch { /* noop */ }
          onStepStatus?.('Recording — do not switch tabs');
        } catch (startErr) {
          console.error('[CoachLab capture] first recorder.startCapture() failed:', startErr);
          // Tear down the first recorder before swapping in a new one to avoid
          // leaving two MediaRecorder instances attached to the same stream.
          try {
            await recorder.stop();
          } catch {
            /* noop */
          }
          recorder = null;
          await sleep(300);
          checkCancel();
          recorder = new TabCaptureRecorder();
          recorder.prepare(streamToRecord);
          recorder.startCapture();
          captureLog('mediaRecorder-started-retry');
          try { onRecordingStarted?.(); } catch { /* noop */ }
          onStepStatus?.('Recording — do not switch tabs');
        }
      } catch (startOuter) {
        if (recorder) {
          try {
            await recorder.stop();
          } catch {
            /* noop */
          }
        }
        recorder = null;
        teardown(true);
        const { friendly } = handleCaptureError(startOuter, 'MediaRecorder.startCapture');
        return fail('MediaRecorder.startCapture', startOuter, friendly);
      }
    } catch (recErr) {
      if (recorder) {
        try {
          await recorder.stop();
        } catch {
          /* noop */
        }
      }
      recorder = null;
      teardown(true);
      const { friendly } = handleCaptureError(recErr, 'MediaRecorder');
      return fail('MediaRecorder', recErr, friendly);
    }

    onProgress?.(0.04);
    captureLog('recording-loop-begin');

    const ytEnded = () => ytState() === YT_ENDED;

    /**
     * Wait for the display-capture track to end (user stops sharing, or stream dies).
     * The handler is registered through the cleaner so it can't leak.
     */
    const trackEndedPromise = (): Promise<void> =>
      new Promise<void>((resolve) => {
        if (track.readyState === 'ended') {
          resolve();
          return;
        }
        const onEnd = () => resolve();
        track.addEventListener('ended', onEnd, { once: true });
        cleaner.addListener(track, 'ended', onEnd);
      });

    const ytRec = effectiveYt();
    if (isYoutube && ytRec && safeYtCall<boolean>(() => typeof ytRec.seekTo === 'function', false)) {
      if (opts.mode === 'section' && opts.startSec != null && opts.endSec != null) {
        const startSec = opts.startSec;
        const endSec = opts.endSec;
        safeYtVoid(() => ytRec.seekTo(startSec, true));
        safeYtVoid(() => ytRec.playVideo?.());
        const span = Math.max(0.001, endSec - startSec);
        const timeoutMs = (span + 30) * 1000;
        const progIv = window.setInterval(() => {
          onProgress?.(Math.min(1, Math.max(0, (ytTime() - startSec) / span)));
        }, 80);
        cleaner.addInterval(progIv);
        await waitUntilOk(
          () => ytEnded() || trackEnded || ytTime() >= endSec - 0.5,
          80,
          timeoutMs,
          getCancelled,
          cleaner,
        );
        window.clearInterval(progIv);
        safeYtVoid(() => effectiveYt()?.pauseVideo?.());
        onProgress?.(1);
      } else {
        safeYtVoid(() => ytRec.seekTo(0, true));
        safeYtVoid(() => ytRec.playVideo?.());
        const dur = ytDuration();
        if (dur > 0) {
          const timeoutMs = (dur + 30) * 1000;
          const iv = window.setInterval(() => {
            onProgress?.(Math.min(1, ytTime() / dur));
          }, 250);
          cleaner.addInterval(iv);
          await waitUntilOk(
            () => ytEnded() || trackEnded || ytTime() >= dur - 0.5,
            200,
            timeoutMs,
            getCancelled,
            cleaner,
          );
          window.clearInterval(iv);
          onProgress?.(1);
        } else {
          let pulse = 0;
          const pulseIv = window.setInterval(() => {
            pulse = Math.min(0.94, pulse + 0.012);
            onProgress?.(pulse);
          }, 320);
          cleaner.addInterval(pulseIv);
          await Promise.race([
            trackEndedPromise(),
            waitUntilOk(() => ytEnded() || trackEnded, 500, 600_000, getCancelled, cleaner),
          ]);
          window.clearInterval(pulseIv);
          onProgress?.(1);
        }
        safeYtVoid(() => effectiveYt()?.pauseVideo?.());
      }
    } else if (isYoutube && !effectiveYt()) {
      if (opts.mode === 'section' && opts.startSec != null && opts.endSec != null) {
        const span = Math.max(0.001, opts.endSec - opts.startSec);
        const ms = Math.max(300, (span + 2) * 1000);
        const t0 = performance.now();
        const iv = window.setInterval(() => {
          onProgress?.(Math.min(1, (performance.now() - t0) / ms));
        }, 120);
        cleaner.addInterval(iv);
        await cancellableSleep(ms, getCancelled);
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
          cleaner.addInterval(iv);
          await cancellableSleep(durMs, getCancelled);
          window.clearInterval(iv);
          onProgress?.(1);
        } else {
          let pulse = 0;
          const pulseIv = window.setInterval(() => {
            pulse = Math.min(0.92, pulse + 0.015);
            onProgress?.(pulse);
          }, 400);
          cleaner.addInterval(pulseIv);
          await trackEndedPromise();
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
        cleaner.addInterval(iv);
        await cancellableSleep(ms, getCancelled);
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
          cleaner.addInterval(iv);
          await cancellableSleep(durMs, getCancelled);
          window.clearInterval(iv);
          onProgress?.(1);
        } else {
          let pulse = 0.06;
          const pulseIv = window.setInterval(() => {
            pulse = Math.min(0.92, pulse + 0.013);
            onProgress?.(pulse);
          }, 280);
          cleaner.addInterval(pulseIv);
          await trackEndedPromise();
          window.clearInterval(pulseIv);
          onProgress?.(1);
        }
      }
    }

    onStepStatus?.('Processing your video…');
    captureLog('recorder-stop-begin');
    let blob: Blob;
    try {
      blob = await recorder.stop();
    } catch (stopErr) {
      recorder = null;
      teardown(true);
      return fail(
        'recorder.stop',
        stopErr,
        'Failed to finalize the recording. Refresh the page and try again.',
      );
    }
    recorder = null;
    teardown(true);
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
      recorder = null;
    }
    teardown(true);
    try {
      await document.exitFullscreen?.();
    } catch {
      /* noop */
    }

    if (e instanceof CaptureCancelled) {
      captureLog('flow-cancelled');
      return { ok: false, cancelled: true, message: 'Capture cancelled.' };
    }
    return fail(
      'unexpected top-level',
      e,
      handleCaptureError(e, 'recording-flow').friendly,
    );
  }
}
