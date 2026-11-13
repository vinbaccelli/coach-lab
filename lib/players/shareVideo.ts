/** Pure rules for a video uploaded through a player share link (onto the COACH's YouTube channel). */

/** One link may start this many uploads per rolling 24 h, and one coach this many across all their links. */
export const SHARE_UPLOADS_PER_LINK_PER_DAY = 5;
export const SHARE_UPLOADS_PER_COACH_PER_DAY = 20;
/** Largest video a player may send (bytes). */
export const SHARE_MAX_VIDEO_BYTES = 600 * 1024 * 1024;

export type ShareVideoRequest = { sizeBytes: number; mimeType: string };

/** Validate the browser's request body: a positive size within the cap and a video mime type. */
export function validateShareVideoRequest(raw: unknown): { ok: true; req: ShareVideoRequest } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const sizeBytes = Number(b.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { ok: false, error: 'Choose a video.' };
  if (sizeBytes > SHARE_MAX_VIDEO_BYTES) return { ok: false, error: 'That video is too large (the limit is 600 MB). Shrink it or paste a YouTube link.' };
  const mimeType = typeof b.mimeType === 'string' ? b.mimeType.trim().toLowerCase() : '';
  if (!/^video\/[a-z0-9.+-]{1,40}$/.test(mimeType)) return { ok: false, error: 'That file is not a video.' };
  return { ok: true, req: { sizeBytes: Math.floor(sizeBytes), mimeType } };
}

/** The title is built on the server so a link holder cannot put arbitrary text on the coach's channel. */
export function shareVideoTitle(playerName: string): string {
  const n = playerName.replace(/[\r\n<>]/g, ' ').trim().slice(0, 80) || 'Player';
  return `${n} — AngleMotion`;
}

export function withinUploadLimits(perLinkLast24h: number, perCoachLast24h: number): { ok: true } | { ok: false; error: string } {
  if (perLinkLast24h >= SHARE_UPLOADS_PER_LINK_PER_DAY) return { ok: false, error: 'Too many video uploads today from this link. Try again tomorrow, or paste a YouTube link.' };
  if (perCoachLast24h >= SHARE_UPLOADS_PER_COACH_PER_DAY) return { ok: false, error: 'Your coach has reached the daily video upload limit. Try again tomorrow, or paste a YouTube link.' };
  return { ok: true };
}
