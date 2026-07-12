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
// TEMPORARY FOR GOOGLE OAUTH VERIFICATION
// Env override so the SEPARATE verification deployment
// (anglemotionverification.vercel.app, env NEXT_PUBLIC_GOOGLE_VERIFICATION_DEMO=1)
// can show the full Google Docs/Drive/YouTube surface for Google's demo video.
// anglemotion.com production does NOT set this env var, so both flags compile
// to `false` there — behavior is byte-identical to the previous hardcoded values.
// Revert: restore the two exports to `= false;` and delete this block + the
// env var (full instructions in GOOGLE_VERIFICATION_DEMO.md).
const GOOGLE_VERIFICATION_DEMO = process.env.NEXT_PUBLIC_GOOGLE_VERIFICATION_DEMO === '1';

export const ENABLE_GOOGLE_EXPORTS = GOOGLE_VERIFICATION_DEMO;
export const ENABLE_YOUTUBE_UPLOAD = GOOGLE_VERIFICATION_DEMO;

/** Sensitive scopes requested at sign-in when exports are enabled. */
export const GOOGLE_EXPORT_SCOPES =
  'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file';
