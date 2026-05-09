/**
 * Coach-facing messages for tab capture failures (no jargon).
 */

function domName(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const n = (err as { name?: string }).name;
  return typeof n === 'string' ? n : undefined;
}

export function formatTabCaptureError(err: unknown): string {
  const name = domName(err);

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
    return 'Recording could not start because something was busy. Close other recordings or tabs using the camera, then try again.';
  }

  const raw = err instanceof Error ? err.message : String(err);

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

  return 'Something went wrong while recording. Please try again.';
}
