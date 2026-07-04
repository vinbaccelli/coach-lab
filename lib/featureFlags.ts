/**
 * Feature flags.
 *
 * ENABLE_YOUTUBE_UPLOAD — YouTube upload UI is hidden while Google OAuth
 * verification of the youtube.upload scope is pending (unverified projects get
 * their uploads locked private by YouTube). Flip to true after approval; all
 * upload code paths are intact behind this flag.
 */
export const ENABLE_YOUTUBE_UPLOAD = false;
