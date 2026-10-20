/**
 * Lifetimes for the analysis page's top status toast (page `processingStatus`).
 * Nothing used to clear most of its ~90 messages, so "AI Track ready…", "Loading
 * precision tracking model…" and the like stayed over the video for good.
 *   info / success  → gone after INFO_MS
 *   error           → close (X) button, and gone after ERROR_MS (also any message
 *                     that matches neither the info nor the progress patterns)
 *   progress        → stays while its task runs; once nothing is running it goes
 *                     after INFO_MS (a task that ended without a closing message)
 */
export type StatusKind = 'info' | 'error' | 'progress';

export const INFO_MS = 4000;
export const ERROR_MS = 10000;
/** A progress message with no known running task is a task nobody tracks: it goes after this. */
export const UNTRACKED_PROGRESS_MS = 8000;
/** The fade before the message is removed. */
export const FADE_MS = 400;

const ERROR_RE = /\b(fail(ed|ure)?|error|could not|couldn['’]t|can['’]t|cannot|unable|not supported|unavailable|stopped|found no|no skeleton|no player|try again|denied|blocked)\b/i;
const PROGRESS_RE = /(…|\.\.\.|\d+\s?%)\s*(\(|$|·|[a-z])?/i;

export function statusKind(text: string): StatusKind {
  if (ERROR_RE.test(text)) return 'error';
  // Finished messages say so; "…" or "42%" alone means still going.
  if (/\b(ready|done|complete(d)?|saved|cleared|cancelled|canceled|locked)\b/i.test(text)) return 'info';
  if (PROGRESS_RE.test(text)) return 'progress';
  // Matches neither a finished nor a progress pattern: unknown, so it is shown
  // as an error (close button, 10 s) rather than vanishing unread.
  return 'error';
}

/** How long (ms) a message stays, or null to leave it (a progress message while its task runs). */
export function statusLifetimeMs(kind: StatusKind, taskRunning: boolean): number | null {
  if (kind === 'error') return ERROR_MS;
  if (kind === 'progress') return taskRunning ? null : UNTRACKED_PROGRESS_MS;
  return INFO_MS;
}
