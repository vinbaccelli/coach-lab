/**
 * Feature flags.
 *
 * ENABLE_GOOGLE_EXPORTS — master switch for the Google Docs/Drive export
 * surface AND the sensitive OAuth scopes requested at sign-in. While Google's
 * verification review is pending, requesting the sensitive scopes shows every
 * user a "Google hasn't verified this app" warning — so until approval we
 * sign in with basic profile scopes only (no warning) and hide all export UI.
 * Flip to true after approval; every code path is intact behind the flags.
 *
 * ENABLE_YOUTUBE_UPLOAD — YouTube upload UI (unverified projects get uploads
 * locked private by YouTube). Requires ENABLE_GOOGLE_EXPORTS.
 */
export const ENABLE_GOOGLE_EXPORTS = false;
export const ENABLE_YOUTUBE_UPLOAD = false;

/** Sensitive scopes requested at sign-in when exports are enabled. */
export const GOOGLE_EXPORT_SCOPES =
  'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file';
