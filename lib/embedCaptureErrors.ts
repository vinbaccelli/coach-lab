/**
 * Coach-facing messages for tab capture failures (no jargon).
 */

function domName(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const n = (err as { name?: string }).name;
  return typeof n === 'string' ? n : undefined;
}

/** Browser quirks often throw DOMExceptions or Events with non-standard shapes — extract anything usable. */
export function rawMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
    const code = (err as DOMException).code;
    if (typeof code === 'number' && code !== 0) return `DOMException code ${code}`;
  }
  try {
    const s = String(err);
    if (s && s !== '[object Object]') return s;
  } catch {
    /* noop */
  }
  return '';
}

export function formatTabCaptureError(err: unknown): string {
  const name = domName(err);
  const raw = rawMessage(err);

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Sharing was cancelled or blocked. Tap Capture again and choose your browser tab when asked.';
  }
  if (name === 'NotFoundError') {
    return 'No screen or tab could be shared from this device. Check your browser settings and try again.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Could not access the shared tab. Close other apps using the camera or screen if needed, then try again.';
  }
  if (name === 'OverconstrainedError') {
    return 'Your browser could not start recording at the requested quality. Try again, or update your browser.';
  }
  if (name === 'NotSupportedError') {
    return 'This browser cannot record from a tab the way we need. Try Chrome or Edge on a desktop computer.';
  }
  if (name === 'SecurityError') {
    return 'Recording needs a secure connection (HTTPS). Open CoachLab from https:// or try another network.';
  }
  if (name === 'InvalidStateError') {
    return 'Recording could not start yet — wait a second, then tap Capture again. If it keeps happening, stop any other screen recording or tab-share, refresh this page, and try once more.';
  }

  if (/screen capture is not supported|getdisplaymedia is not supported/i.test(raw)) {
    return 'This browser does not support recording from a tab. Try Chrome or Edge on desktop.';
  }

  if (/timed out/i.test(raw)) {
    return 'Recording took too long and stopped. Try a shorter clip or try again.';
  }

  if (/No video from shared tab|Could not read video from the shared tab/i.test(raw)) {
    return 'We did not get a picture from the tab you shared. Pick “This tab” when asked, then try again.';
  }

  if (/Recording stopped unexpectedly|MediaRecorder/i.test(raw)) {
    return 'Recording stopped early — often because the clip was very long or the tab was closed. Try a shorter segment.';
  }

  if (/secure context|HTTPS/i.test(raw)) {
    return 'Recording needs a secure page (https). Check the address bar and try again.';
  }

  if (/could not establish|pipeline|sink|decode/i.test(raw)) {
    return 'Your browser could not connect the recording pipeline to this tab. Pick “This tab” / “Chrome Tab” when asked (not the whole screen), then try again.';
  }

  if (/recording produced no video|empty file was empty|no usable video/i.test(raw)) {
    return 'The recording did not contain usable video. Try Capture again and keep this tab shared until recording finishes.';
  }

  if (
    /null is not an object|undefined is not an object|cannot read properties of null|reading 'src'|evaluating 'this\.|\.src\b/i.test(
      raw,
    )
  ) {
    return 'The recording preview was not ready yet. Wait until the video plays clearly in this tab, then tap Capture again. If this repeats, refresh the page.';
  }

  const trimmed = raw.trim();
  if (trimmed.length > 0 && trimmed.length < 220 && !/^error$/i.test(trimmed)) {
    /** Never surface minified stack fragments or opaque browser internals to coaches */
    if (/^\s*null\s*$|^\s*undefined\s*$|^\[object/i.test(trimmed)) {
      return 'Something went wrong while recording. Please tap Retry or refresh the page and try again.';
    }
    return 'Something went wrong while recording. Please try again.';
  }

  return 'Something went wrong while recording. Please try again.';
}
