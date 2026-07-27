'use client';

/**
 * PHASE 2 VERIFICATION HARNESS — mask-editor rebuild.
 *
 * Phase 1 proved a KNOWN mask region renders at a KNOWN place and scale. Phase 2
 * proves the reverse direction: a pointer at a KNOWN place writes the mask at the
 * matching frame pixels, and the overlay shows it. Same isolated setup as Phase 1
 * — `/demo.mp4` through `createCaptureSource`, no app state, no session, no video
 * the coach can see.
 *
 * The mask starts EMPTY. Every painted pixel therefore came from the brush and
 * nothing else, which is what makes the pixel check unambiguous.
 *
 * Still not in this phase: selection-box scoping (Phase 3) and AI-detect (Phase 4).
 *
 * Dev only. In a production build this renders nothing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MaskSurface, { type BrushSettings } from '@/components/stroMotion/MaskSurface';
import {
  applyBrushStrokeToMask,
  createCaptureSource,
  fillBoxMask,
  type AlphaMask,
  type CaptureSource,
} from '@/lib/stroMotionDraft';
import {
  containerToFrame,
  frameRectToContainer,
  type Point,
  type Rect,
  type Size,
  type ViewTransform,
} from '@/lib/stroMotionDraft/viewTransform';

const DEMO_SRC = '/demo.mp4';
const CAPTURE_TIME_SEC = 1.0;
const SEED_BOX = { x: 0.375, y: 0.375, width: 0.25, height: 0.25 } as const;

/** Identical to the Phase 1 harness — see the note there on why not `capture()`. */
async function grabFrame(video: HTMLVideoElement, timeSec: number): Promise<ImageBitmap> {
  const target = Math.max(
    0,
    Math.min(timeSec, Number.isFinite(video.duration) ? Math.max(0, video.duration - 1e-6) : timeSec),
  );

  video.pause();
  if (Math.abs(video.currentTime - target) >= 0.001) {
    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done);
        resolve();
      };
      video.addEventListener('seeked', done, { once: true });
      video.currentTime = target;
      window.setTimeout(done, 3000);
    });
  }

  return createImageBitmap(video);
}

function emptyMask(size: Size): AlphaMask {
  return {
    width: size.width,
    height: size.height,
    data: new Uint8ClampedArray(size.width * size.height),
  };
}

/** Painted-pixel count and bounding box, in FRAME px. */
function maskStats(mask: AlphaMask): { painted: number; bbox: Rect | null } {
  let painted = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const { width, height, data } = mask;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] <= 0) continue;
      painted++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    painted,
    bbox:
      painted > 0
        ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
        : null,
  };
}

/**
 * Let React commit the new mask AND let the overlay effect run before sampling.
 * Two rAFs is the reliable "after next paint" signal; the timeout is the fallback
 * for a backgrounded tab, where rAF never fires.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    window.setTimeout(finish, 250);
  });
}

export default function MaskSurfacePhase2Page() {
  const [sourceFrame, setSourceFrame] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [invariant, setInvariant] = useState<string | null>(null);
  const [checkOutput, setCheckOutput] = useState<string | null>(null);

  const [mask, setMask] = useState<AlphaMask | null>(null);
  const [brushMode, setBrushMode] = useState<'add' | 'remove'>('add');
  const [brushRadius, setBrushRadius] = useState(24);
  const [strokes, setStrokes] = useState(0);
  const [paintMs, setPaintMs] = useState<number | null>(null);

  const transformRef = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const containerSizeRef = useRef<Size>({ width: 0, height: 0 });
  const sourceRef = useRef<CaptureSource | null>(null);
  const maskRef = useRef<AlphaMask | null>(null);
  maskRef.current = mask;

  const pan = useMemo(() => ({ x: panX, y: panY }), [panX, panY]);
  const isProd = process.env.NODE_ENV === 'production';

  // ── Capture one frame from the demo clip ─────────────────────────────────
  useEffect(() => {
    if (isProd) return;
    let cancelled = false;

    (async () => {
      try {
        const source = createCaptureSource(DEMO_SRC);
        sourceRef.current = source;
        await source.ready(15000);
        const bitmap = await grabFrame(source.element, CAPTURE_TIME_SEC);
        if (cancelled) {
          bitmap.close();
          return;
        }
        setSourceFrame(bitmap);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      sourceRef.current?.dispose();
      sourceRef.current = null;
    };
  }, [isProd]);

  const frameSize = useMemo<Size | null>(
    () => (sourceFrame ? { width: sourceFrame.width, height: sourceFrame.height } : null),
    [sourceFrame],
  );

  // The editable mask: empty, frame-sized, replaced whenever the frame changes.
  useEffect(() => {
    setMask(frameSize ? emptyMask(frameSize) : null);
    setStrokes(0);
  }, [frameSize]);

  const brush = useMemo<BrushSettings>(
    () => ({ radiusFramePx: brushRadius, mode: brushMode }),
    [brushRadius, brushMode],
  );

  /**
   * THE WHOLE OF PHASE 2, on the app side: the surface hands back a segment
   * already in FRAME px, and the mask owner stamps it. No coordinate arithmetic
   * happens here — if it did, that would be a second authority on scale, which is
   * precisely the defect this rebuild exists to remove.
   */
  const handlePaint = useCallback(
    (from: Point, to: Point) => {
      setMask((current) =>
        current ? applyBrushStrokeToMask(current, from, to, brushRadius, brushMode) : current,
      );
    },
    [brushRadius, brushMode],
  );

  const handleTransformChange = useCallback((vt: ViewTransform, container: Size) => {
    transformRef.current = vt;
    containerSizeRef.current = container;
  }, []);

  const handleOverlayPainted = useCallback((stats: { ms: number }) => {
    setPaintMs(stats.ms);
  }, []);

  const clearMask = useCallback(() => {
    if (frameSize) setMask(emptyMask(frameSize));
  }, [frameSize]);

  const seedMask = useCallback(() => {
    if (frameSize) setMask(fillBoxMask(frameSize.width, frameSize.height, SEED_BOX, 0));
  }, [frameSize]);

  // ── Console probe — the mechanical verification entry point ──────────────
  useEffect(() => {
    if (isProd || !frameSize) return;

    const containerEl = () =>
      document.querySelector<HTMLDivElement>('[data-mask-surface-container]');
    const overlayEl = () =>
      document.querySelector<HTMLCanvasElement>('[data-mask-surface-layer="overlay"]');

    /** Where the frame is on screen right now, in viewport CSS px. */
    const frameViewportRect = (): (Rect & { left: number; top: number }) | null => {
      const el = containerEl();
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const r = frameRectToContainer(transformRef.current, { x: 0, y: 0, ...frameSize });
      return { ...r, left: rect.left + r.x, top: rect.top + r.y };
    };

    const state = () => {
      const el = containerEl();
      const overlay = overlayEl();
      const current = maskRef.current;
      if (!el || !overlay || !current) return { error: 'surface not mounted' };
      const rect = el.getBoundingClientRect();
      const stats = maskStats(current);
      return {
        frame: frameSize,
        mask: { width: current.width, height: current.height, length: current.data.length },
        maskIsFrameSized:
          current.width === frameSize.width &&
          current.height === frameSize.height &&
          current.data.length === frameSize.width * frameSize.height,
        overlayCanvasBackingStore: { width: overlay.width, height: overlay.height },
        container: containerSizeRef.current,
        containerViewportRect: { left: rect.left, top: rect.top },
        zoom,
        pan: { x: panX, y: panY },
        viewTransform: transformRef.current,
        brush: { radiusFramePx: brushRadius, mode: brushMode },
        /** Brush radius as it appears on screen — the tolerance every sample uses. */
        brushRadiusScreenPx: brushRadius * transformRef.current.scale,
        paintedPixels: stats.painted,
        paintedBboxFrame: stats.bbox,
        frameViewportRect: frameViewportRect(),
        lastOverlayPaintMs: paintMs,
      };
    };

    /** Map a VIEWPORT point to FRAME px and read both the mask and the overlay. */
    const at = (viewportX: number, viewportY: number) => {
      const el = containerEl();
      const overlay = overlayEl();
      const current = maskRef.current;
      if (!el || !overlay || !current) return { error: 'surface not mounted' };
      const rect = el.getBoundingClientRect();
      const f = containerToFrame(transformRef.current, viewportX - rect.left, viewportY - rect.top);
      const fx = Math.floor(f.x);
      const fy = Math.floor(f.y);
      const inBounds = fx >= 0 && fy >= 0 && fx < frameSize.width && fy < frameSize.height;
      const ctx = overlay.getContext('2d', { willReadFrequently: true });
      return {
        viewport: { x: viewportX, y: viewportY },
        framePx: { x: fx, y: fy },
        inBounds,
        maskValue: inBounds ? current.data[fy * frameSize.width + fx] : null,
        overlayRgba: inBounds && ctx ? Array.from(ctx.getImageData(fx, fy, 1, 1).data) : null,
      };
    };

    /**
     * Drive the REAL pointer path with synthesized events, so the probe exercises
     * exactly the listener a coach's mouse hits — the conversion, the capture, the
     * interpolation, the repaint. A probe that called `handlePaint` directly would
     * skip the one thing Phase 2 has to prove.
     */
    const stroke = async (ax: number, ay: number, bx: number, by: number, steps = 8) => {
      const el = containerEl();
      if (!el) return { error: 'surface not mounted' };
      const send = (type: string, x: number, y: number, buttons: number) => {
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 4242,
            pointerType: 'mouse',
            isPrimary: true,
            button: type === 'pointerup' ? 0 : type === 'pointerdown' ? 0 : -1,
            buttons,
            clientX: x,
            clientY: y,
          }),
        );
      };
      send('pointerdown', ax, ay, 1);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        send('pointermove', ax + (bx - ax) * t, ay + (by - ay) * t, 1);
      }
      send('pointerup', bx, by, 0);
      await settle();
      return { ok: true, from: { x: ax, y: ay }, to: { x: bx, y: by } };
    };

    const setMaskEmpty = async () => {
      if (frameSize) setMask(emptyMask(frameSize));
      await settle();
    };

    /**
     * FULL ACCEPTANCE. Add then remove, at the CURRENT zoom and pan.
     *
     * A diagonal stroke is drawn across the middle of the displayed frame. Points
     * ON the stroke must be painted; points offset perpendicular by more than the
     * on-screen brush radius must not be. Then the same stroke in remove mode must
     * clear them again. Finally the painted bbox in FRAME px is compared against
     * the bbox predicted by converting the stroke endpoints through
     * `containerToFrame` and inflating by the brush radius — that comparison is
     * what proves the mask was written where the pointer actually was, rather than
     * merely somewhere consistent.
     */
    const check = async () => {
      const el0 = containerEl();
      const fr = frameViewportRect();
      if (!el0 || !fr) return { error: 'surface not mounted' };

      // Test inside the VISIBLE frame — the intersection of the frame's on-screen
      // rect with the container, which is where a coach can actually put the
      // pointer. At zoom the frame overflows the container, and points chosen off
      // the frame rect alone would sit outside the clipped area: still readable
      // from the backing store, but no longer a test of anything a hand could do.
      const cr = el0.getBoundingClientRect();
      const vis = {
        left: Math.max(fr.left, cr.left),
        top: Math.max(fr.top, cr.top),
        right: Math.min(fr.left + fr.width, cr.right),
        bottom: Math.min(fr.top + fr.height, cr.bottom),
      };
      const visW = vis.right - vis.left;
      const visH = vis.bottom - vis.top;

      // A degenerate surface makes every assertion below pass vacuously: the
      // stroke shrinks to sub-pixel and the control points land outside the
      // frame, where `at()` returns null and "not painted" is trivially true.
      // Refuse to report a result rather than report a meaningless pass.
      if (visW < 60 || visH < 60) {
        return {
          pass: false,
          reason:
            `visible frame is ${visW.toFixed(1)}×${visH.toFixed(1)} CSS px — too small to test. ` +
            `The container measured ${containerSizeRef.current.width}×` +
            `${containerSizeRef.current.height}; give the window a real viewport and reload.`,
          frameViewportRect: fr,
          visible: { ...vis, width: visW, height: visH },
          container: containerSizeRef.current,
        };
      }

      await setMaskEmpty();
      const before = state();
      if ('error' in before) return before;
      if (before.paintedPixels !== 0) {
        return { pass: false, reason: 'mask did not start empty', state: before };
      }

      const ax = vis.left + visW * 0.35;
      const ay = vis.top + visH * 0.4;
      const bx = vis.left + visW * 0.65;
      const by = vis.top + visH * 0.6;

      // Perpendicular unit vector, for the "must stay clear" control points.
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const screenRadius = brushRadius * transformRef.current.scale;
      const offset = screenRadius + 10;
      const nx = (-dy / len) * offset;
      const ny = (dx / len) * offset;

      const onStroke = [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => ({
        label: `t=${t}`,
        x: ax + dx * t,
        y: ay + dy * t,
      }));
      const offStroke = [0.25, 0.5, 0.75].flatMap((t) => [
        { label: `t=${t} +n`, x: ax + dx * t + nx, y: ay + dy * t + ny },
        { label: `t=${t} -n`, x: ax + dx * t - nx, y: ay + dy * t - ny },
      ]);

      // `inBounds` is asserted on BOTH polarities. A sample outside the frame
      // reports rgba null, which reads as "not painted" — so without this an
      // out-of-frame control point would satisfy a clear-assertion for the wrong
      // reason, and the whole check would pass while proving nothing.
      const inFrame = (r: ReturnType<typeof at>) => 'inBounds' in r && r.inBounds;
      const painted = (r: ReturnType<typeof at>) =>
        'overlayRgba' in r && !!r.overlayRgba && r.overlayRgba[3] > 0;

      const wasAdd = brushMode === 'add';
      if (!wasAdd) setBrushMode('add');
      await settle();
      await stroke(ax, ay, bx, by);

      const afterAdd = state();
      if ('error' in afterAdd) return afterAdd;
      const addOn = onStroke.map((p) => {
        const r = at(p.x, p.y);
        return { ...p, ok: inFrame(r) && painted(r), inFrame: inFrame(r), sample: r };
      });
      const addOff = offStroke.map((p) => {
        const r = at(p.x, p.y);
        return { ...p, ok: inFrame(r) && !painted(r), inFrame: inFrame(r), sample: r };
      });

      // Predicted FRAME-space bbox of the swept disc.
      const el = containerEl()!;
      const cRect = el.getBoundingClientRect();
      const fA = containerToFrame(transformRef.current, ax - cRect.left, ay - cRect.top);
      const fB = containerToFrame(transformRef.current, bx - cRect.left, by - cRect.top);
      const predictedBbox: Rect = {
        x: Math.min(fA.x, fB.x) - brushRadius,
        y: Math.min(fA.y, fB.y) - brushRadius,
        width: Math.abs(fB.x - fA.x) + brushRadius * 2,
        height: Math.abs(fB.y - fA.y) + brushRadius * 2,
      };
      const actual = afterAdd.paintedBboxFrame;
      // ±2 FRAME px: the disc loop rounds its centre and clamps to whole pixels.
      const tol = 2;
      const bboxOk =
        !!actual &&
        Math.abs(actual.x - predictedBbox.x) <= tol &&
        Math.abs(actual.y - predictedBbox.y) <= tol &&
        Math.abs(actual.width - predictedBbox.width) <= tol * 2 &&
        Math.abs(actual.height - predictedBbox.height) <= tol * 2;

      // ── Remove mode over the same path must clear it again ────────────────
      setBrushMode('remove');
      await settle();
      await stroke(ax, ay, bx, by);
      const afterRemove = state();
      if ('error' in afterRemove) return afterRemove;
      const removeOn = onStroke.map((p) => {
        const r = at(p.x, p.y);
        return { ...p, ok: inFrame(r) && !painted(r), inFrame: inFrame(r), sample: r };
      });

      setBrushMode(wasAdd ? 'add' : 'remove');
      await settle();

      const pass =
        afterAdd.maskIsFrameSized &&
        afterAdd.overlayCanvasBackingStore.width === frameSize.width &&
        afterAdd.paintedPixels > 0 &&
        addOn.every((r) => r.ok) &&
        addOff.every((r) => r.ok) &&
        bboxOk &&
        removeOn.every((r) => r.ok) &&
        afterRemove.paintedPixels === 0;

      return {
        pass,
        zoom,
        pan: { x: panX, y: panY },
        strokeViewport: { ax, ay, bx, by },
        visibleFrameRect: { ...vis, width: visW, height: visH },
        bbox: { predicted: predictedBbox, actual, ok: bboxOk, tolerancePx: tol },
        add: { on: addOn, off: addOff, paintedPixels: afterAdd.paintedPixels },
        remove: { on: removeOn, paintedPixels: afterRemove.paintedPixels },
        state: afterAdd,
      };
    };

    /** Same acceptance at several transforms — the real alignment stress. */
    const checkAll = async () => {
      const configs: Array<{ zoom: number; pan: Point }> = [
        { zoom: 1, pan: { x: 0, y: 0 } },
        { zoom: 1.75, pan: { x: 0, y: 0 } },
        { zoom: 2.5, pan: { x: -80, y: 80 } },
        { zoom: 4, pan: { x: 80, y: -80 } },
      ];
      const results = [];
      for (const c of configs) {
        setZoom(c.zoom);
        setPanX(c.pan.x);
        setPanY(c.pan.y);
        await settle();
        const r = await check();
        results.push({ config: c, pass: 'pass' in r ? r.pass : false, result: r });
      }
      setZoom(1);
      setPanX(0);
      setPanY(0);
      await settle();
      return { pass: results.every((r) => r.pass), results };
    };

    const api = { state, at, stroke, check, checkAll, clear: setMaskEmpty };
    (window as unknown as Record<string, unknown>).__maskSurfacePhase2 = api;
    console.log(
      '[MASKSURFACE-PHASE2] probe ready — __maskSurfacePhase2.state() / .at(vx,vy) / ' +
        '.stroke(ax,ay,bx,by) / await .check() / await .checkAll()',
    );

    return () => {
      delete (window as unknown as Record<string, unknown>).__maskSurfacePhase2;
    };
  }, [isProd, frameSize, zoom, panX, panY, brushRadius, brushMode, paintMs]);

  const runCheck = useCallback(async () => {
    const api = (window as unknown as Record<string, unknown>).__maskSurfacePhase2 as
      | { check: () => Promise<unknown> }
      | undefined;
    if (!api) return;
    setCheckOutput('running…');
    const result = await api.check();
    console.log('[MASKSURFACE-PHASE2] check()', result);
    setCheckOutput(JSON.stringify(result, null, 2));
  }, []);

  const runCheckAll = useCallback(async () => {
    const api = (window as unknown as Record<string, unknown>).__maskSurfacePhase2 as
      | { checkAll: () => Promise<unknown> }
      | undefined;
    if (!api) return;
    setCheckOutput('running all transforms…');
    const result = await api.checkAll();
    console.log('[MASKSURFACE-PHASE2] checkAll()', result);
    setCheckOutput(JSON.stringify(result, null, 2));
  }, []);

  if (isProd) return null;

  const stats = mask ? maskStats(mask) : null;

  return (
    <div style={{ minHeight: '100vh', background: '#111', color: '#fff', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>Mask editor rebuild — Phase 2: brush paints the aligned mask</h1>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'rgba(255,255,255,0.65)', maxWidth: 900 }}>
        The mask starts <strong>empty</strong>. Drag on the frame: the cyan region must appear
        <strong> under the cursor</strong>, at every zoom and pan — same size as the ring, following the
        drag with no gaps. <em>Remove</em> erases it again. The yellow outline is the full FRAME extent.
        No selection box and no AI in this phase.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>brush</span>
        <button type="button" onClick={() => setBrushMode('add')} style={btn(brushMode === 'add')}>Add</button>
        <button type="button" onClick={() => setBrushMode('remove')} style={btn(brushMode === 'remove')}>Remove</button>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginLeft: 8 }}>
          radius {brushRadius} frame px
        </span>
        <input
          type="range"
          min={4}
          max={120}
          step={2}
          value={brushRadius}
          onChange={(e) => setBrushRadius(Number(e.target.value))}
          style={{ width: 140 }}
        />
        <span style={{ width: 10 }} />
        <button type="button" onClick={clearMask} style={btn(false)}>clear</button>
        <button type="button" onClick={seedMask} style={btn(false)}>seed centre 25%</button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>zoom</span>
        {[1, 1.75, 2.5, 4].map((z) => (
          <button key={z} type="button" onClick={() => setZoom(z)} style={btn(zoom === z)}>{z}×</button>
        ))}
        <span style={{ width: 10 }} />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>pan</span>
        <button type="button" onClick={() => setPanX((v) => v - 80)} style={btn(false)}>← 80</button>
        <button type="button" onClick={() => setPanX((v) => v + 80)} style={btn(false)}>→ 80</button>
        <button type="button" onClick={() => setPanY((v) => v - 80)} style={btn(false)}>↑ 80</button>
        <button type="button" onClick={() => setPanY((v) => v + 80)} style={btn(false)}>↓ 80</button>
        <button type="button" onClick={() => { setPanX(0); setPanY(0); setZoom(1); }} style={btn(false)}>reset</button>
        <span style={{ width: 10 }} />
        <button type="button" onClick={runCheck} style={{ ...btn(false), border: '1px solid #34C759', background: 'rgba(52,199,89,0.2)' }}>
          run check()
        </button>
        <button type="button" onClick={runCheckAll} style={{ ...btn(false), border: '1px solid #34C759', background: 'rgba(52,199,89,0.2)' }}>
          run checkAll()
        </button>
      </div>

      {error ? <p style={{ color: '#FF453A', fontSize: 13 }}>Frame capture failed: {error}</p> : null}
      {invariant ? <p style={{ color: '#FF9500', fontSize: 13 }}>Invariant violation: {invariant}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 14, alignItems: 'start' }}>
        {sourceFrame && mask ? (
          <MaskSurface
            sourceFrame={sourceFrame}
            mask={mask}
            zoom={zoom}
            pan={pan}
            brush={brush}
            onPaint={handlePaint}
            onStrokeStart={() => setStrokes((n) => n + 1)}
            onOverlayPainted={handleOverlayPainted}
            onTransformChange={handleTransformChange}
            onInvariantViolation={setInvariant}
            // Deliberately NOT the frame's aspect ratio: a letterboxed container
            // keeps both tx and ty non-zero, so pointer conversion is exercised
            // rather than passing on a degenerate transform.
            style={{ width: '100%', height: '62vh', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)' }}
          />
        ) : (
          <div style={{ height: '62vh', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
            {error ? 'no frame' : 'capturing frame from /demo.mp4…'}
          </div>
        )}

        <div style={{ fontSize: 12, lineHeight: 1.6, fontFamily: 'ui-monospace, monospace', color: 'rgba(255,255,255,0.8)' }}>
          <strong style={{ display: 'block', marginBottom: 6, fontFamily: 'system-ui' }}>Live mask</strong>
          {frameSize && stats ? (
            <>
              <div>frame: {frameSize.width}×{frameSize.height}</div>
              <div>mask: {mask?.width}×{mask?.height}</div>
              <div>strokes: {strokes}</div>
              <div>painted px: {stats.painted.toLocaleString()}</div>
              <div>
                bbox (FRAME):{' '}
                {stats.bbox
                  ? `${stats.bbox.x},${stats.bbox.y} ${stats.bbox.width}×${stats.bbox.height}`
                  : '—'}
              </div>
              <div style={{ marginTop: 8 }}>zoom {zoom} · pan {panX},{panY}</div>
              <div>overlay repaint: {paintMs != null ? `${paintMs.toFixed(1)} ms` : '—'}</div>
              <p style={{ marginTop: 10, fontFamily: 'system-ui', color: 'rgba(255,255,255,0.55)' }}>
                Console: <code>__maskSurfacePhase2.state()</code>, <code>.at(x,y)</code>,{' '}
                <code>.stroke(ax,ay,bx,by)</code> (synthesizes a real pointer drag),{' '}
                <code>await .check()</code>, <code>await .checkAll()</code> (all zoom/pan configs).
              </p>
            </>
          ) : (
            <div>waiting for frame…</div>
          )}
          {checkOutput ? (
            <pre style={{ marginTop: 10, maxHeight: 280, overflow: 'auto', background: '#000', padding: 8, borderRadius: 6, fontSize: 11 }}>
              {checkOutput}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function btn(active: boolean): React.CSSProperties {
  return {
    padding: '5px 10px',
    borderRadius: 7,
    border: active ? '1px solid #007AFF' : '1px solid rgba(255,255,255,0.18)',
    background: active ? 'rgba(0,122,255,0.22)' : 'rgba(255,255,255,0.06)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
