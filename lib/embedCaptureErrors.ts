/**
 * Coach-facing messages for tab capture failures (no jargon).
 */

export function formatTabCaptureError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = String((err as { name?: string }).name);
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Sharing was cancelled or blocked. Tap Capture again and choose your browser tab when asked.';
    }
    if (name === 'NotFoundError') {
      return 'No screen or tab could be shared from this device. Check your browser settings and try again.';
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return 'Could not access the shared tab. Close other apps using the camera or screen if needed, then try again.';
    }
  }

  const raw = err instanceof Error ? err.message : String(err);

  if (/screen capture is not supported/i.test(raw)) {
    return 'This browser does not support recording from a tab. Try Chrome or Edge on desktop.';
  }

  if (/timed out/i.test(raw)) {
    return 'Recording took too long and stopped. Try a shorter clip or try again.';
  }

  return 'Something went wrong while recording. Please try again.';
}
