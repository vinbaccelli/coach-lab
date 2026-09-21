/**
 * The AngleMotion watermark, drawn bottom-left on every surface the coach sees
 * or exports.
 *
 * ONE implementation, deliberately. The watermark has to appear on the live
 * analysis canvas AND inside every recorded/exported video, and those are drawn
 * by different loops in different files. Anything duplicated here would drift:
 * two corners, two sizes, two opacities.
 *
 * WHY BOTTOM-LEFT. Recording Hub composites the webcam PiP into the
 * bottom-RIGHT corner (contexts/RecordingContext.tsx), so a bottom-right
 * watermark would sit on the coach's face in every recording. Bottom-left is
 * free on every surface, so one position works everywhere with no special
 * casing per call site.
 */

/**
 * Icon + "AngleMotion" wordmark. NOT logo-square-new.jpg (icon only), and NOT
 * public/logo-watermark.svg — despite the name, that file is stale CoachLab.ai
 * branding, and app/layout.tsx records that the old SVG marks are retired.
 */
const LOGO_SRC = '/logo-rect-new.jpg';

/**
 * The logo's REAL content inside that file, measured pixel by pixel.
 *
 * The asset is 980x551 but carries 139px of dead space along the bottom and
 * 28px at the right, so its content is 2.40:1 rather than the 1.78:1 the file
 * dimensions imply. Drawing the whole file would float the logo inside an
 * oversized, mostly-empty box. Cropping to these bounds is what makes the
 * drawn mark match its visual weight.
 */
const SRC = { x: 0, y: 16, w: 952, h: 396 } as const;
const SRC_ASPECT = SRC.w / SRC.h; // 2.404

/** Target width as a fraction of frame width. */
const WIDTH_FRACTION = 0.09;
/**
 * Clamped so the mark stays legible on a phone-width canvas and does not grow
 * silly on a 4K export — 9% of 375px would be a 34px-wide wordmark nobody can
 * read, and 9% of 3840px would be a 345px banner.
 */
const MIN_WIDTH_PX = 80;
const MAX_WIDTH_PX = 240;

/** Inset from the left and bottom edges, as a fraction of each dimension. */
const MARGIN_FRACTION = 0.02;
const MIN_MARGIN_PX = 8;

/**
 * The source JPEG has NO alpha channel, so its near-black (#1D1D1F-ish)
 * background paints as a solid rectangle. Reduced alpha is what keeps that
 * reading as a subtle darkening rather than a box stuck on the video.
 *
 * Once a transparent PNG replaces the JPEG this is the ONLY value to change —
 * raise it toward 1 and swap LOGO_SRC. Nothing else here assumes opacity.
 */
export const WATERMARK_ALPHA = 0.55;

let logo: HTMLImageElement | null = null;
let ready = false;
let failed = false;

/**
 * Load once per document, lazily.
 *
 * Lazy rather than at module scope because this module is imported into files
 * that Next also evaluates on the server, where `Image` does not exist. The
 * first call always comes from a browser draw loop, so the guard costs nothing.
 */
function ensureLogo(): void {
  if (logo || failed || typeof window === 'undefined') return;
  const img = new Image();
  img.onload = () => { ready = true; };
  img.onerror = () => { failed = true; logo = null; };
  img.src = LOGO_SRC;
  logo = img;
}

/**
 * Where the mark should sit, when the caller knows more than the raw surface.
 *
 * WHY THIS EXISTS. The analysis canvas is NOT the video: it is the whole video
 * pane, and a 16:9 clip letterboxed into it leaves black bars above and below.
 * Anchoring to the canvas put the mark in the BOTTOM BAR — outside the picture,
 * reading as app chrome rather than as a mark on the footage — and underneath
 * the playback dock, which is absolutely positioned over that same bottom strip.
 * Measured on a 1260x950 pane with a 960x540 clip: the video occupies
 * y 121-829, the dock starts at y 800, and the canvas-anchored mark landed at
 * y 884-931. Entirely in the letterbox, entirely behind the controls.
 */
export interface WatermarkArea {
  /** The drawn VIDEO rect in the same space as W/H — Canvas's dx/dy/dw/dh. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * A Y the mark's bottom edge must not cross — the top of the playback dock.
   * Omitted or <= 0 means nothing is in the way.
   *
   * A CLAMP rather than a second anchor, deliberately: the dock overlaps only
   * the last ~29px of the video on a desktop pane, so this nudges the mark just
   * clear of the controls instead of floating it high up the frame. On a
   * surface with no dock — every recording and export — the clamp never binds
   * and the mark sits at the video's own bottom-left.
   */
  maxBottomY?: number;
}

/**
 * Draw the watermark bottom-left.
 *
 * With no `area`, that is bottom-left of the W x H surface — which is what a
 * recording canvas wants, since it composites a screen grab with no letterbox
 * and no controls of its own.
 *
 * With an `area`, it is bottom-left of THAT rect (the drawn video), clamped
 * clear of `maxBottomY`. Size follows the area's width, so the mark scales with
 * the picture rather than with the pane around it.
 *
 * Call this LAST, in screen space — after any zoom/pan transform has been
 * undone — so the mark stays pinned and sits above everything else.
 *
 * Silently does nothing until the image has loaded, so the first few frames of
 * a session simply have no watermark rather than throwing inside a render loop.
 * Cost per call is a single drawImage of an already-decoded bitmap.
 */
export function drawVideoWatermark(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  area?: WatermarkArea | null,
): void {
  ensureLogo();
  if (!ready || !logo || !(W > 0) || !(H > 0)) return;

  // The box the mark is positioned inside. Falls back to the whole surface, so
  // callers that pass nothing keep the original behaviour exactly.
  const box = area && area.w > 0 && area.h > 0
    ? area
    : { x: 0, y: 0, w: W, h: H, maxBottomY: undefined as number | undefined };

  const w = Math.round(Math.max(MIN_WIDTH_PX, Math.min(MAX_WIDTH_PX, box.w * WIDTH_FRACTION)));
  const h = Math.round(w / SRC_ASPECT);
  const marginX = Math.round(Math.max(MIN_MARGIN_PX, box.w * MARGIN_FRACTION));
  const marginY = Math.round(Math.max(MIN_MARGIN_PX, box.h * MARGIN_FRACTION));

  const x = Math.round(box.x + marginX);
  // Bottom edge: the box's own bottom, pulled up if the dock would cover it.
  let bottom = box.y + box.h - marginY;
  if (box.maxBottomY != null && box.maxBottomY > 0) {
    bottom = Math.min(bottom, box.maxBottomY - marginY);
  }
  // Never let a clamp push the mark off the top of its own box.
  const y = Math.round(Math.max(box.y, bottom - h));

  ctx.save();
  // Reset any inherited alpha/compositing from the caller's loop: the watermark
  // must look identical whatever was drawn immediately before it.
  ctx.globalAlpha = WATERMARK_ALPHA;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(logo, SRC.x, SRC.y, SRC.w, SRC.h, x, y, w, h);
  ctx.restore();
}
