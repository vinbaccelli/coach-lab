/**
 * The browser origin a YouTube resumable upload session is created for.
 *
 * The page PUTs the video bytes straight to Google's session URL
 * (lib/export/youtubeResumableUpload.ts), a cross-origin request. Google's
 * upload server only answers it with Access-Control-Allow-Origin for the
 * origin named in the `Origin` header of the request that CREATED the
 * session. The session is created server-side (app/api/youtube/upload-session),
 * where fetch sends no Origin at all, so every browser upload was blocked by
 * CORS ("No 'Access-Control-Allow-Origin' header…", surfacing as
 * "Failed to fetch").
 *
 * So the session must be created with the browser's real origin. It is read
 * from the incoming request's Origin header (browsers always send it on a POST)
 * and must be on this allowlist: never reflected blindly, never "*".
 */
const PRODUCTION_ORIGINS: ReadonlySet<string> = new Set([
  'https://anglemotion.com',
  'https://www.anglemotion.com',
]);

/** http://localhost:<port> or http://127.0.0.1:<port>, development only. */
const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/**
 * The allowed origin for this request, or null when the request has no Origin
 * header or one that is not allowed. `isDev` defaults to NODE_ENV.
 */
export function selectUploadOrigin(
  requestOrigin: string | null | undefined,
  isDev: boolean = process.env.NODE_ENV !== 'production',
): string | null {
  const origin = requestOrigin?.trim();
  if (!origin) return null;
  if (PRODUCTION_ORIGINS.has(origin)) return origin;
  if (isDev && LOCAL_DEV_ORIGIN.test(origin)) return origin;
  return null;
}

/** Shown when the upload cannot start (no session, or the first bytes are refused). */
export const YOUTUBE_UPLOAD_COULD_NOT_START =
  'YouTube upload could not start. Try again, or download the file instead.';
