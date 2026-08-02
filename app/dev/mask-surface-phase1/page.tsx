'use client';

/**
 * PHASE 1 VERIFICATION HARNESS — mask-editor rebuild.
 *
 * Isolated on purpose. It touches no app state, no session, no StroMotion draft
 * and no video the coach can see: the frame comes from `/demo.mp4` through
 * `createCaptureSource`, the same dedicated-element capture path the pipeline
 * already uses, which owns a hidden <video> of its own.
 *
 * What it proves: a KNOWN mask region renders at a KNOWN place and scale on the
 * displayed frame, at multiple zooms and pans. That is the whole of Phase 1 —
 * there is no brushing, no selection and no AI here.
 *
 * Dev only. In a production build this renders nothing (and middleware.ts's
 * `/dev/` bypass is likewise compiled out).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MaskSurface from '@/components/stroMotion/MaskSurface';
import { createCaptureSource, fillBoxMask, type AlphaMask, type CaptureSource } from '@/lib/stroMotionDraft';
import {
  containerToFrame,
  frameRectToContainer,
  roundTripError,
  type Rect,
  type Size,
  type ViewTransform,
} from '@/lib/stroMotionDraft/viewTransform';

const DEMO_SRC = '/demo.mp4';
const CAPTURE_TIME_SEC = 1.0;

/**
 * Seek + grab, event-driven, with no requestAnimationFrame anywhere.
 *
 * Deliberately NOT `CaptureSource.capture()`. That routes into
 * `captureFrameFromElement`, which awaits a bare rAF (captureFrame.ts:147) with
 * no timeout fallback — unlike the seek await directly above it, which has one.
 * rAF does not fire in a backgrounded or hidden tab, so that await never settles
 * and the capture hangs forever with no error. That is a real latent defect in
 * committed code, reported separately; it is NOT fixed here, because touching the
 * capture primitive is out of Phase 1 scope.
 *
 * Independence is the right call regardless: this harness verifies the DISPLAY
 * SURFACE, and it should not go red because the capture pipeline is unwell. All
 * we need is a real video frame at frame-native dimensions.
 */
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

/**
 * THE TEST MASK: the centre 25% of the frame — a rect whose width and height are
 * each 25% of the frame, centred. Built with the shipped `fillBoxMask`, so the
 * harness exercises the real mask constructor rather than a bespoke one.
 *
 * With padding 0, fillBoxMask fills the half-open FRAME-space rect
 *   x ∈ [round(0.375·W), round(0.625·W))   y ∈ [round(0.375·H), round(0.625·H))
 * which is exactly what `testRectFrame()` below reports and what the probe checks.
 */
const TEST_BOX = { x: 0.375, y: 0.375, width: 0.25, height: 0.25 } as const;

function testRectFrame(frame: Size): Rect {
  const x = Math.round(TEST_BOX.x * frame.width);
  const y = Math.round(TEST_BOX.y * frame.height);
  return {
    x,
    y,
    width: Math.round((TEST_BOX.x + TEST_BOX.width) * frame.width) - x,
    height: Math.round((TEST_BOX.y + TEST_BOX.height) * frame.height) - y,
  };
}

interface ProbeState {
  frame: Size;
  mask: Size & { length: number };
  maskIsFrameSized: boolean;
  frameCanvasBackingStore: Size;
  overlayCanvasBackingStore: Size;
  container: Size;
  containerViewportRect: { left: number; top: number };
  zoom: number;
  pan: { x: number; y: number };
  viewTransform: ViewTransform;
  testRectFrame: Rect;
  predictedContainerRect: Rect;
  /** Where the cyan square must appear on screen, in viewport CSS px. */
  predictedViewportRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  roundTripErrorPx: number;
}

export default function MaskSurfacePhase1Page() {
  const [sourceFrame, setSourceFrame] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [invariant, setInvariant] = useState<string | null>(null);
  const [checkOutput, setCheckOutput] = useState<string | null>(null);

  const transformRef = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const containerSizeRef = useRef<Size>({ width: 0, height: 0 });
  const sourceRef = useRef<CaptureSource | null>(null);

  const pan = useMemo(() => ({ x: panX, y: panY }), [panX, panY]);

  const isProd = process.env.NODE_ENV === 'production';

  // ── Capture one frame from the demo clip ─────────────────────────────────
  useEffect(() => {
    if (isProd) return;
    let cancelled = false;

    (async () => {
      try {
        // The dedicated hidden element IS reused — it is the proven, isolated way
        // to decode without touching any video the app is showing. Only the
        // seek/grab step is local (see grabFrame above).
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

  const mask = useMemo<AlphaMask | null>(
    () => (frameSize ? fillBoxMask(frameSize.width, frameSize.height, TEST_BOX, 0) : null),
    [frameSize],
  );

  const handleTransformChange = useCallback((vt: ViewTransform, container: Size) => {
    transformRef.current = vt;
    containerSizeRef.current = container;
  }, []);

  // ── Console probe — the mechanical verification entry point ──────────────
  useEffect(() => {
    if (isProd || !frameSize || !mask) return;

    const containerEl = () =>
      document.querySelector<HTMLDivElement>('[data-mask-surface-container]');
    const overlayEl = () =>
      document.querySelector<HTMLCanvasElement>('[data-mask-surface-layer="overlay"]');
    const frameEl = () =>
      document.querySelector<HTMLCanvasElement>('[data-mask-surface-layer="frame"]');

    const state = (): ProbeState | { error: string } => {
      const el = containerEl();
      const overlay = overlayEl();
      const frameCanvas = frameEl();
      if (!el || !overlay || !frameCanvas) return { error: 'surface not mounted' };

      const rect = el.getBoundingClientRect();
      const vt = transformRef.current;
      const tr = testRectFrame(frameSize);
      const predicted = frameRectToContainer(vt, tr);

      return {
        frame: frameSize,
        mask: { width: mask.width, height: mask.height, length: mask.data.length },
        maskIsFrameSized:
          mask.width === frameSize.width &&
          mask.height === frameSize.height &&
          mask.data.length === frameSize.width * frameSize.height,
        frameCanvasBackingStore: { width: frameCanvas.width, height: frameCanvas.height },
        overlayCanvasBackingStore: { width: overlay.width, height: overlay.height },
        container: containerSizeRef.current,
        containerViewportRect: { left: rect.left, top: rect.top },
        zoom,
        pan: { x: panX, y: panY },
        viewTransform: vt,
        testRectFrame: tr,
        predictedContainerRect: predicted,
        predictedViewportRect: {
          left: rect.left + predicted.x,
          top: rect.top + predicted.y,
          right: rect.left + predicted.x + predicted.width,
          bottom: rect.top + predicted.y + predicted.height,
          width: predicted.width,
          height: predicted.height,
        },
        roundTripErrorPx: roundTripError(vt, rect.width / 2, rect.height / 2),
      };
    };

    /** Map a VIEWPORT point to FRAME px and read both the mask and the overlay. */
    const at = (viewportX: number, viewportY: number) => {
      const el = containerEl();
      const overlay = overlayEl();
      if (!el || !overlay) return { error: 'surface not mounted' };
      const rect = el.getBoundingClientRect();
      const vt = transformRef.current;
      const f = containerToFrame(vt, viewportX - rect.left, viewportY - rect.top);
      const fx = Math.floor(f.x);
      const fy = Math.floor(f.y);
      const inBounds = fx >= 0 && fy >= 0 && fx < frameSize.width && fy < frameSize.height;
      const tr = testRectFrame(frameSize);
      const ctx = overlay.getContext('2d', { willReadFrequently: true });
      const rgba =
        inBounds && ctx ? Array.from(ctx.getImageData(fx, fy, 1, 1).data) : null;
      return {
        viewport: { x: viewportX, y: viewportY },
        framePx: { x: fx, y: fy },
        inBounds,
        insideTestRect:
          fx >= tr.x && fx < tr.x + tr.width && fy >= tr.y && fy < tr.y + tr.height,
        maskValue: inBounds ? mask.data[fy * frameSize.width + fx] : null,
        overlayRgba: rgba,
      };
    };

    /**
     * Full acceptance run: the centre and the four inner corners of the predicted
     * on-screen rect must be painted; four points 6px OUTSIDE each edge must be
     * clear. Passing means mask space and display space agree at this transform.
     */
    const check = () => {
      const s = state();
      if ('error' in s) return s;
      const p = s.predictedViewportRect;
      const inset = 2;
      const out = 6;
      const inside = [
        ['centre', (p.left + p.right) / 2, (p.top + p.bottom) / 2],
        ['top-left', p.left + inset, p.top + inset],
        ['top-right', p.right - inset, p.top + inset],
        ['bottom-left', p.left + inset, p.bottom - inset],
        ['bottom-right', p.right - inset, p.bottom - inset],
      ] as const;
      const outside = [
        ['left-of', p.left - out, (p.top + p.bottom) / 2],
        ['right-of', p.right + out, (p.top + p.bottom) / 2],
        ['above', (p.left + p.right) / 2, p.top - out],
        ['below', (p.left + p.right) / 2, p.bottom - 0 + out],
      ] as const;

      const painted = (r: ReturnType<typeof at>) =>
        'overlayRgba' in r && !!r.overlayRgba && r.overlayRgba[3] > 0;

      const insideResults = inside.map(([label, x, y]) => {
        const r = at(x, y);
        return { label, x, y, ok: painted(r), sample: r };
      });
      const outsideResults = outside.map(([label, x, y]) => {
        const r = at(x, y);
        return { label, x, y, ok: !painted(r), sample: r };
      });

      const pass =
        s.maskIsFrameSized &&
        s.frameCanvasBackingStore.width === s.frame.width &&
        s.overlayCanvasBackingStore.width === s.frame.width &&
        s.roundTripErrorPx < 1e-6 &&
        insideResults.every((r) => r.ok) &&
        outsideResults.every((r) => r.ok);

      return { pass, state: s, inside: insideResults, outside: outsideResults };
    };

    const api = { state, at, check };
    (window as unknown as Record<string, unknown>).__maskSurfacePhase1 = api;
    console.log(
      '[MASKSURFACE-PHASE1] probe ready — __maskSurfacePhase1.state() / .at(vx,vy) / .check()',
    );

    return () => {
      delete (window as unknown as Record<string, unknown>).__maskSurfacePhase1;
    };
  }, [isProd, frameSize, mask, zoom, panX, panY]);

  const runCheck = useCallback(() => {
    const api = (window as unknown as Record<string, unknown>).__maskSurfacePhase1 as
      | { check: () => unknown }
      | undefined;
    if (!api) return;
    const result = api.check();
    console.log('[MASKSURFACE-PHASE1] check()', result);
    setCheckOutput(JSON.stringify(result, null, 2));
  }, []);

  if (isProd) return null;

  const tr = frameSize ? testRectFrame(frameSize) : null;

  return (
    <div style={{ minHeight: '100vh', background: '#111', color: '#fff', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>Mask editor rebuild — Phase 1: display surface alignment</h1>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'rgba(255,255,255,0.65)', maxWidth: 900 }}>
        Static test. The cyan region is a mask filled over the <strong>centre 25%</strong> of the frame
        (each side 25% of the frame, centred). It must sit centred on the video frame at every zoom and
        pan, scaling with the frame — never full-frame, never offset, never wrong-scaled. The yellow
        outline is the full FRAME extent. No brushing, no selection, no AI in this phase.
      </p>

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
      </div>

      {error ? (
        <p style={{ color: '#FF453A', fontSize: 13 }}>Frame capture failed: {error}</p>
      ) : null}
      {invariant ? (
        <p style={{ color: '#FF9500', fontSize: 13 }}>Invariant violation: {invariant}</p>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 14, alignItems: 'start' }}>
        {sourceFrame && mask ? (
          <MaskSurface
            sourceFrame={sourceFrame}
            mask={mask}
            zoom={zoom}
            pan={pan}
            onTransformChange={handleTransformChange}
            onInvariantViolation={setInvariant}
            // Deliberately NOT the frame's aspect ratio: a letterboxed container
            // keeps both tx and ty non-zero, so the prediction is a real test
            // rather than one that passes on a degenerate transform.
            style={{ width: '100%', height: '62vh', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)' }}
          />
        ) : (
          <div style={{ height: '62vh', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
            {error ? 'no frame' : 'capturing frame from /demo.mp4…'}
          </div>
        )}

        <div style={{ fontSize: 12, lineHeight: 1.6, fontFamily: 'ui-monospace, monospace', color: 'rgba(255,255,255,0.8)' }}>
          <strong style={{ display: 'block', marginBottom: 6, fontFamily: 'system-ui' }}>Expected geometry</strong>
          {frameSize && tr ? (
            <>
              <div>frame: {frameSize.width}×{frameSize.height}</div>
              <div>mask: {mask?.width}×{mask?.height}</div>
              <div>test rect (FRAME px):</div>
              <div>&nbsp;&nbsp;x {tr.x}…{tr.x + tr.width}</div>
              <div>&nbsp;&nbsp;y {tr.y}…{tr.y + tr.height}</div>
              <div>&nbsp;&nbsp;{tr.width}×{tr.height}</div>
              <div style={{ marginTop: 8 }}>zoom {zoom} · pan {panX},{panY}</div>
              <p style={{ marginTop: 10, fontFamily: 'system-ui', color: 'rgba(255,255,255,0.55)' }}>
                Console: <code>__maskSurfacePhase1.state()</code> reports the live transform and the
                predicted viewport rect; <code>.at(x,y)</code> samples a viewport point;
                <code>.check()</code> runs the full assertion.
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
