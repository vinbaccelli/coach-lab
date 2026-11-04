'use client';

import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureSource';
import { upscaleAlphaMask } from '@/lib/stroMotionDraft/phoneBudget';
import { getExportMask, getPreviewMask } from '@/lib/stroMotionDraft/frameMask';
import type { StroMotionDraftCompositeOptions } from '@/lib/stroMotionDraft/compositeFromDraft';
import type { AlphaMask, StroMotionDraft, StroMotionFrameDraft } from '@/lib/stroMotionDraft/types';

/**
 * PHONE MEMORY BUDGET — the last step before the atomic commit, and the way the
 * first layers reach the screen afterwards (docs/POST_AUTODETECT_FIX.md).
 *
 * Everything here runs on a phone only (callers gate on `isPhoneBudgetActive()`);
 * off a phone nothing in this file is reached.
 *
 * On a phone the pass works on frames and masks capped at PHONE_MAX_EDGE. The draft
 * wants native-size frames and masks (the editor, the composite and the export all
 * assume `sourceFrame`, `aiSnapshot` and `working` share the video's size), so just
 * before the commit each built frame gets its masks scaled up (bilinear, so soft
 * edges stay soft) and its picture re-captured at native size. By then the heavy
 * models have been released, so the extra native bitmaps are the only large thing
 * alive. A frame whose native capture fails keeps its capped pair (picture and masks
 * at the same size), never a mismatched one.
 *
 * It does not touch the commit itself: it only edits the `built` array the commit
 * reads.
 */

// ── events: "Opening editor…" and "first layers drawn" ───────────────────────

export const OPENING_EDITOR_EVENT = 'stro:opening-editor';
export const FIRST_LAYERS_DRAWN_EVENT = 'stro:first-layers-drawn';
export const OPENING_EDITOR_TEXT = 'Opening editor…';
/**
 * If the first layers are never drawn (no composite is shown, the tab is hidden), the
 * status text and the crash marker are released after this long rather than held.
 */
export const OPENING_EDITOR_FAILSAFE_MS = 45_000;

export interface EventTargetLike {
  dispatchEvent(e: Event): boolean;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
}

function defaultTarget(): EventTargetLike | null {
  return typeof window !== 'undefined' ? (window as unknown as EventTargetLike) : null;
}

export function announceOpeningEditor(target: EventTargetLike | null = defaultTarget()): void {
  try { target?.dispatchEvent(new Event(OPENING_EDITOR_EVENT)); } catch { /* best-effort */ }
}

export function announceFirstLayersDrawn(target: EventTargetLike | null = defaultTarget()): void {
  try { target?.dispatchEvent(new Event(FIRST_LAYERS_DRAWN_EVENT)); } catch { /* best-effort */ }
}

/**
 * Keep the crash marker set until the first layers have been drawn, then clear it
 * (once). A kill while the page is still opening the editor therefore still leaves the
 * marker behind and gets the notice on the next load. Released by a failsafe timer if
 * the event never comes. Returns a function that clears now (and cancels both).
 */
export function clearMarkerWhenFirstLayersDrawn(
  clear: () => void,
  target: EventTargetLike | null = defaultTarget(),
  failsafeMs = OPENING_EDITOR_FAILSAFE_MS,
  timers: { set: (cb: () => void, ms: number) => unknown; clear: (h: unknown) => void } = {
    set: (cb, ms) => setTimeout(cb, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): () => void {
  let finished = false;
  let handle: unknown = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    target?.removeEventListener(FIRST_LAYERS_DRAWN_EVENT, finish);
    if (handle !== null) timers.clear(handle);
    clear();
  };
  if (!target) { finish(); return finish; }
  target.addEventListener(FIRST_LAYERS_DRAWN_EVENT, finish);
  handle = timers.set(finish, failsafeMs);
  return finish;
}

// ── sliced mask upscale ─────────────────────────────────────────────────────

/** Longest the upscale runs before it yields to the browser. */
export const SLICE_BUDGET_MS = 25;

export interface SliceOptions {
  budgetMs?: number;
  now?: () => number;
  yieldFn?: () => Promise<void>;
}

const macrotaskYield = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * `upscaleAlphaMask` (phoneBudget.ts), same arithmetic row for row, but it checks the
 * clock after each row and yields once `budgetMs` has passed, so no stretch of it
 * blocks the main thread for longer than the budget plus one row. The result is
 * byte-identical to the one-pass version (tests/phoneFirstComposite.test.ts).
 */
export async function upscaleAlphaMaskSliced(
  mask: AlphaMask,
  dw: number,
  dh: number,
  opts: SliceOptions = {},
): Promise<AlphaMask> {
  if (mask.width === dw && mask.height === dh) return mask;
  const budget = opts.budgetMs ?? SLICE_BUDGET_MS;
  const now = opts.now ?? (() => performance.now());
  const yieldFn = opts.yieldFn ?? macrotaskYield;
  const { width: sw, height: sh, data: src } = mask;
  const out = new Uint8ClampedArray(dw * dh);
  const xr = sw / dw;
  const yr = sh / dh;
  let sliceStart = now();
  for (let y = 0; y < dh; y++) {
    const fy = Math.max(0, (y + 0.5) * yr - 0.5);
    const y0 = Math.min(sh - 1, Math.floor(fy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.max(0, (x + 0.5) * xr - 0.5);
      const x0 = Math.min(sw - 1, Math.floor(fx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const top = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
      const bot = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
      out[y * dw + x] = Math.round(top * (1 - wy) + bot * wy);
    }
    if (now() - sliceStart >= budget && y < dh - 1) {
      await yieldFn();
      sliceStart = now();
    }
  }
  return { width: dw, height: dh, data: out };
}

/** Let the browser paint what was just set (two frames, with a cap for hidden tabs). */
async function paintNow(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return;
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  await Promise.race([
    (async () => { await frame(); await frame(); })(),
    new Promise<void>((r) => setTimeout(r, 150)),
  ]);
}

export async function finalizeBuiltAtNativeSize<
  T extends { frameIndex: number; sourceFrame: ImageBitmap; aiSnapshot: AlphaMask; working: AlphaMask },
>(
  video: HTMLVideoElement,
  built: T[],
  timeOf: (frameIndex: number) => number | undefined,
): Promise<number> {
  const nw = video.videoWidth;
  const nh = video.videoHeight;
  if (!(nw > 0) || !(nh > 0)) return 0;
  // The coach sees why the page is busy, and it is painted before the first long step.
  announceOpeningEditor();
  await paintNow();
  let done = 0;
  for (const b of built) {
    if (b.sourceFrame.width === nw && b.sourceFrame.height === nh) continue;
    const t = timeOf(b.frameIndex);
    if (t === undefined) continue;
    let native: ImageBitmap;
    try {
      native = await captureVideoFrameAtTime(video, t);
    } catch (e) {
      console.warn('[phoneBudget] native re-capture failed on frame', b.frameIndex, '— keeping the capped frame', e);
      continue;
    }
    const ai = await upscaleAlphaMaskSliced(b.aiSnapshot, nw, nh);
    // `working` starts as a copy of `aiSnapshot` and may differ after the racket union;
    // each is scaled from its own pixels.
    const working = b.working === b.aiSnapshot ? ai : await upscaleAlphaMaskSliced(b.working, nw, nh);
    try { b.sourceFrame.close(); } catch { /* already closed */ }
    b.sourceFrame = native;
    b.aiSnapshot = ai as AlphaMask;
    b.working = working as AlphaMask;
    done++;
    await macrotaskYield();
  }
  return done;
}

// ── first composite, one layer per frame ────────────────────────────────────

type Render = (ctx: CanvasRenderingContext2D, draft: StroMotionDraft, options: StroMotionDraftCompositeOptions) => void;

interface OffscreenLike {
  canvas: { width: number; height: number };
  ctx: CanvasRenderingContext2D;
}

export interface PhoneFirstCompositeDeps {
  render: Render;
  /** A canvas + 2D context at the given pixel size, or null if none can be made. */
  createOffscreen?: (w: number, h: number) => OffscreenLike | null;
  /** The mask a layer would use in the one-pass composite. */
  pickMask?: (frame: StroMotionFrameDraft, previewMode: boolean) => AlphaMask | null;
  announceOpening?: () => void;
  announceDrawn?: () => void;
}

interface Job {
  draft: StroMotionDraft;
  key: string;
  endPlate: unknown;
  resolveMask: unknown;
  off: OffscreenLike;
  order: StroMotionFrameDraft[];
  /** 0 = background plate, 1..n = layers in paint order. */
  step: number;
  complete: boolean;
}

function defaultOffscreen(w: number, h: number): OffscreenLike | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

/**
 * THE FIRST COMPOSITE OF A NEW DRAFT, ON A PHONE ONLY.
 *
 * `renderStroMotionDraftComposite` draws every layer in one call, and each layer is
 * a full-frame readback (`getImageData`) — 2.6 s at 1080p and about 9 s at 4K, 4×
 * throttle, as one main-thread block (docs/POST_AUTODETECT_FREEZE.md). This builds the
 * same picture off screen one layer per animation frame and shows it as it grows:
 *
 *   step 0   background plate only (the real function with every mask withheld)
 *   step k   layer k, over what is already there (the real function with
 *            `overlayMode` and a `resolveMask` that lets exactly that layer through)
 *
 * Every layer is drawn by the unchanged `renderMaskedFrame`, with the draft's own
 * opacity/fade arguments, in the same ascending order, onto a canvas with the same
 * size and transform as the visible one, so the finished picture is the one-pass
 * picture. It is then copied 1:1 to the visible canvas.
 *
 * Scope: only for a draft that has not been composited yet, and never in overlay
 * mode (layers over the live video). If the options change before it finishes, it
 * gives up and the caller's original one-pass call runs. After it finishes the
 * result is reused while nothing changed; any change goes back to the original call.
 * `draw` returns false whenever the caller must do the original call itself.
 */
export class PhoneFirstComposite {
  private readonly render: Render;
  private readonly createOffscreen: (w: number, h: number) => OffscreenLike | null;
  private readonly pickMask: (frame: StroMotionFrameDraft, previewMode: boolean) => AlphaMask | null;
  private readonly announceOpening: () => void;
  private readonly announceDrawn: () => void;
  private readonly seen = new WeakSet<object>();
  private job: Job | null = null;

  constructor(deps: PhoneFirstCompositeDeps) {
    this.render = deps.render;
    this.createOffscreen = deps.createOffscreen ?? defaultOffscreen;
    this.pickMask = deps.pickMask ?? ((f, preview) => (preview ? getPreviewMask(f) : getExportMask(f)));
    this.announceOpening = deps.announceOpening ?? (() => announceOpeningEditor());
    this.announceDrawn = deps.announceDrawn ?? (() => announceFirstLayersDrawn());
  }

  draw(
    ctx: CanvasRenderingContext2D,
    draft: StroMotionDraft,
    options: StroMotionDraftCompositeOptions,
    requestRender: () => void,
  ): boolean {
    if (options.overlayMode) return false;
    const key = this.keyOf(ctx, options);
    const job = this.job;
    if (job && job.draft === draft) {
      const same = job.key === key && job.endPlate === (options.endPlate ?? null) && job.resolveMask === (options.resolveMask ?? null);
      if (same) {
        if (!job.complete) {
          this.advance(job, draft, options);
          if (job.complete) { this.announceDrawn(); } else { requestRender(); }
        }
        this.blit(ctx, job);
        return true;
      }
      // Options changed. Unfinished: stop and let the original one-pass call draw it.
      if (!job.complete) {
        this.dropJob();
        this.announceDrawn();
      }
      return false;
    }
    if (this.seen.has(draft)) return false;

    // A draft we have not composited before: build it progressively.
    this.dropJob();
    this.seen.add(draft);
    const off = this.createOffscreen(ctx.canvas.width, ctx.canvas.height);
    if (!off) return false;
    try { off.ctx.setTransform(ctx.getTransform()); } catch { this.disposeOffscreen(off); return false; }
    const next: Job = {
      draft,
      key,
      endPlate: options.endPlate ?? null,
      resolveMask: options.resolveMask ?? null,
      off,
      order: this.paintOrder(draft, options),
      step: 0,
      complete: false,
    };
    this.job = next;
    this.announceOpening();
    this.advance(next, draft, options);
    this.blit(ctx, next);
    if (next.complete) this.announceDrawn(); else requestRender();
    return true;
  }

  /** Release the off-screen canvas (component unmount). */
  dispose(): void {
    this.dropJob();
  }

  private keyOf(ctx: CanvasRenderingContext2D, o: StroMotionDraftCompositeOptions): string {
    const t = ctx.getTransform();
    return [
      ctx.canvas.width, ctx.canvas.height,
      t.a, t.b, t.c, t.d, t.e, t.f,
      o.dest.x, o.dest.y, o.dest.w, o.dest.h,
      o.visibleCount ?? '', o.visibleStart ?? '', o.previewMode ? 1 : 0,
      o.background ?? '', o.videoOrder ?? '', o.fadeMode ?? '', o.opacity ?? '',
    ].join('|');
  }

  /** The frames the one-pass composite paints, in its paint order (ascending index). */
  private paintOrder(draft: StroMotionDraft, o: StroMotionDraftCompositeOptions): StroMotionFrameDraft[] {
    const all = draft.frames;
    const count = Math.min(o.visibleCount ?? all.length, all.length);
    const ordered = o.videoOrder === 'reverse' ? [...all].reverse() : all;
    const startIdx = Math.max(0, Math.min(o.visibleStart ?? 0, count));
    return [...ordered.slice(startIdx, count)].sort((a, b) => a.index - b.index);
  }

  private advance(job: Job, draft: StroMotionDraft, options: StroMotionDraftCompositeOptions): void {
    const ctx = job.off.ctx;
    if (job.step === 0) {
      // Background plate only: every mask withheld, so no layer is drawn.
      this.render(ctx, draft, { ...options, overlayMode: false, resolveMask: () => null });
      job.step = 1;
    } else {
      const frame = job.order[job.step - 1];
      const preview = !!options.previewMode;
      const pick = options.resolveMask ?? ((f: StroMotionFrameDraft) => this.pickMask(f, preview));
      this.render(ctx, draft, { ...options, overlayMode: true, resolveMask: (f) => (f === frame ? pick(f) : null) });
      job.step++;
    }
    if (job.step > job.order.length) job.complete = true;
  }

  private blit(ctx: CanvasRenderingContext2D, job: Job): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(job.off.canvas as unknown as CanvasImageSource, 0, 0);
    ctx.restore();
  }

  private dropJob(): void {
    if (this.job) this.disposeOffscreen(this.job.off);
    this.job = null;
  }

  private disposeOffscreen(off: OffscreenLike): void {
    try { off.canvas.width = 0; off.canvas.height = 0; } catch { /* already gone */ }
  }
}
