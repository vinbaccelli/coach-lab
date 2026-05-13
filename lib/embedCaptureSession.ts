/**
 * Embed / URL screen-capture session helpers: isolation, structured errors, logging.
 * Keeps YouTube IFrame API usage out of React timelines during capture.
 */

export function captureLog(step: string, detail?: string): void {
  if (typeof console === 'undefined' || !console.log) return;
  console.log('[Capture] Step', step, Date.now(), detail ?? '');
}

export type CaptureErrorResult = {
  friendly: string;
  /** True when message mentions YouTube iframe internals */
  isYtConflict: boolean;
};

/** Map errors to coach-safe copy; never surface raw minified strings. */
export function handleCaptureError(error: unknown, step: string): CaptureErrorResult {
  console.error('Capture failed at step:', step, error);

  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : String(error);

  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      friendly:
        'Screen sharing was cancelled — please tap Capture and allow screen sharing when prompted.',
      isYtConflict: false,
    };
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return {
      friendly:
        'Could not access your screen — please close any other screen recording apps and try again.',
      isYtConflict: false,
    };
  }
  if (
    /null is not an object|undefined is not an object|cannot read properties of null|reading 'src'|evaluating 'this\.g\.src|this\.g\.src/i.test(
      raw,
    )
  ) {
    return {
      friendly:
        'A YouTube player conflict occurred — please refresh the page and try once more.',
      isYtConflict: true,
    };
  }

  return {
    friendly: `Something went wrong at step ${step} — please refresh and try again.`,
    isYtConflict: false,
  };
}

export type YoutubeIsolationSync = {
  /** Pause + block iframe; call before nulling refs */
  storedTimeSec: number;
  /** Restore iframe pointer-events only */
  restore: () => void;
};

/**
 * Synchronous YouTube freeze: pause, pointer-events none on iframe, read time.
 * Caller must null refs, wait 500ms, then call getDisplayMedia.
 */
export function isolateYouTubePlayerSync(player: any | null): YoutubeIsolationSync {
  let iframe: HTMLIFrameElement | null = null;
  let prevPointerEvents = '';

  if (player) {
    try {
      player.pauseVideo?.();
    } catch (e) {
      console.warn('[Capture] pauseVideo during isolation:', e);
    }
    try {
      iframe = player.getIframe?.() ?? null;
      if (iframe?.style) {
        prevPointerEvents = iframe.style.pointerEvents || '';
        iframe.style.pointerEvents = 'none';
      }
    } catch (e) {
      console.warn('[Capture] iframe pointer-events during isolation:', e);
    }
  }

  let storedTimeSec = 0;
  try {
    storedTimeSec = Number(player?.getCurrentTime?.() ?? 0);
    if (!Number.isFinite(storedTimeSec)) storedTimeSec = 0;
  } catch {
    storedTimeSec = 0;
  }

  return {
    storedTimeSec,
    restore: () => {
      try {
        if (iframe?.style) iframe.style.pointerEvents = prevPointerEvents;
      } catch {
        /* noop */
      }
    },
  };
}

export function flushCaptureIsolationMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fully tear down the YT.Player instance before tab capture so nothing in the
 * capture pipeline touches the iframe API (avoids WebKit "player conflict" errors).
 * Returns last playback time (seconds) when readable.
 */
export function destroyYouTubeEmbedHard(player: any | null): number {
  let t = 0;
  if (!player) return t;
  try {
    t = Number(player.getCurrentTime?.() ?? 0);
    if (!Number.isFinite(t)) t = 0;
  } catch {
    t = 0;
  }
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = player.getIframe?.() ?? null;
  } catch {
    iframe = null;
  }
  try {
    player.destroy?.();
  } catch (e) {
    console.warn('[Capture] player.destroy:', e);
  }
  try {
    iframe?.remove?.();
  } catch (e) {
    console.warn('[Capture] iframe.remove:', e);
  }
  return t;
}
