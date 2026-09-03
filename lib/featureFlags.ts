/**
 * Feature flags.
 *
 * ENABLE_GOOGLE_EXPORTS — master switch for the Google Docs/Drive export
 * surface AND the sensitive OAuth scopes requested at sign-in. ON.
 *
 * ENABLE_YOUTUBE_UPLOAD — "the YouTube upload feature EXISTS". A build-time kill
 * switch only. It does NOT mean a given coach can upload: YouTube has its own
 * grant now, so the real per-coach gate is the runtime `connected` flag from
 * hooks/useYouTubeConnection (backed by /api/youtube/status). Flipping this off
 * hides every YouTube surface; leaving it on shows "Connect YouTube" to coaches
 * who have not authorized it yet.
 *
 * Google's OAuth verification was approved on 2026-07-28 for `documents`,
 * `drive.file` and `youtube.upload`. Requesting all three together at sign-in,
 * though, gets Google's consent screen to reject the request outright: 400
 * invalid_request, "This request contains scopes that cannot be requested
 * together: [youtube.upload, drive.file]". YouTube scopes are not combinable
 * with other sensitive scopes in one OAuth grant — a Google policy constraint,
 * not a bug in this app.
 *
 * `drive.file` cannot be the one dropped: the Docs export creates the
 * `AngleMotion/Reports` and `AngleMotion/Players/<name>` folder structure,
 * uploads snapshot images into it, and sets sharing permissions — all Drive
 * writes that `documents` alone does not cover (see lib/google/drive.ts,
 * app/api/google/report/route.ts, app/api/google/upload-image/route.ts).
 *
 * So GOOGLE_EXPORT_SCOPES below requests `documents drive.file` only, and
 * YouTube runs an entirely separate consent: app/api/youtube/connect →
 * /connect/callback stores its own refresh token, encrypted, in
 * public.youtube_connections, and /api/youtube/upload mints an access token
 * from that (lib/youtube/connection.ts). Nothing about YouTube touches sign-in
 * any more — THIS FLAG NO LONGER AFFECTS THE SIGN-IN SCOPES AT ALL, which is
 * what makes it safe to toggle.
 *
 * ONE CONSEQUENCE WORTH KNOWING BEFORE TOGGLING ENABLE_GOOGLE_EXPORTS (which
 * does still gate sign-in scopes — hooks/useAuth.ts, app/login/LoginClient.tsx,
 * components/WorkspaceChrome.tsx, keep all three in sync): a session created
 * while it was off holds no Docs/Drive grant, so those buttons appear but the
 * APIs reject them until the user signs out and back in.
 */
export const ENABLE_GOOGLE_EXPORTS = true;
export const ENABLE_YOUTUBE_UPLOAD = true;

/**
 * Sensitive scopes requested at sign-in when exports are enabled. Deliberately
 * NOT including youtube.upload — see the block above for why it cannot share
 * a request with drive.file.
 */
export const GOOGLE_EXPORT_SCOPES =
  'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file';

/**
 * ENABLE_MOTION_LAYER_PRECISION — precision touch mode inside the Motion Layer
 * frame editor (components/stroMotion/FrameMaskEditor.tsx) ONLY.
 *
 * Precision touch is the hold-one-finger / crosshair-above-the-finger /
 * second-finger-commit gesture that lets a coach place a point the finger would
 * otherwise cover. It has been proven on the main analysis canvas
 * (components/Canvas.tsx) and is permanently on there — that surface has NO
 * flag and is unaffected by this one.
 *
 * This flag exists because the Motion Layer integration is newer and runs in a
 * different pointer pipeline (its own zoom/pan, its own brush/selection logic).
 * Turning it OFF makes hooks/usePrecisionTouch inert inside the frame editor:
 * no listeners, no timers, no crosshair, and every handler returns false, so the
 * editor's existing brush and selection behaviour is exactly what it was before
 * precision was added. Nothing about the main canvas changes either way.
 *
 * To disable: set to false. That is the whole revert.
 */
export const ENABLE_MOTION_LAYER_PRECISION = true;

/**
 * ENABLE_RULER_PRECISION — precision touch mode inside the measurement ruler
 * (components/ruler/RulerOverlay.tsx) ONLY.
 *
 * The ruler renders its own SVG overlay above the analysis canvas and handles
 * its own pointer events, so it needs its own integration of
 * hooks/usePrecisionTouch — exactly as the Motion Layer frame editor did.
 *
 * Turning this OFF makes the hook inert inside the ruler: no listeners, no
 * timers, no crosshair, every handler returns false, and calibration and
 * measurement behave exactly as they did before precision was added.
 *
 * Independent of ENABLE_MOTION_LAYER_PRECISION and of the main analysis canvas
 * (components/Canvas.tsx), whose precision mode is proven, permanently on, and
 * has no flag. Flipping this changes nothing outside the ruler.
 *
 * To disable: set to false. That is the whole revert.
 */
export const ENABLE_RULER_PRECISION = true;
