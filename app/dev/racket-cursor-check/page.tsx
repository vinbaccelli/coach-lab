'use client';

/**
 * TEMP-DEBUG-SAMPROBE — THROWAWAY. Delete with the tag.
 *
 * Mounts the REAL FrameMaskEditor to answer one question the auth-gated
 * /analysis route will not let us answer directly: in Racket mode, does the
 * drawn reticle land on EXACTLY the pixel the click will use — at zoom 1, and
 * zoomed and panned?
 *
 * The reticle and the click share one expression on one element, so they agree
 * by construction. The real failure mode is GEOMETRIC: the reticle lives on a
 * SEPARATE overlay canvas, and if that canvas's on-screen box drifts from the
 * edit canvas's box under zoom/pan, the coach sees the crosshair somewhere the
 * click will not land. That is what this measures — the two rects, and the
 * drawn reticle centre recovered from the overlay's own pixels.
 *
 * The frame here is a synthetic grid ON PURPOSE. This tests COORDINATE
 * GEOMETRY, not segmentation quality — nothing about mask quality is claimed or
 * measurable here, and that still belongs on Vin's real footage.
 */

import { useCallback, useEffect, useState } from 'react';
import FrameMaskEditor from '@/components/stroMotion/FrameMaskEditor';
import type { AlphaMask } from '@/lib/stroMotionDraft';

const W = 1080;
const H = 1920;

export default function RacketCursorCheckPage() {
  const [frame, setFrame] = useState<ImageBitmap | null>(null);
  const [mask, setMask] = useState<AlphaMask | null>(null);
  const [out, setOut] = useState<string[]>([]);

  const say = useCallback((m: string) => {
    console.log('[cursor-check]', m);
    setOut((o) => [...o, m]);
  }, []);

  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#123';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#2a4';
    ctx.lineWidth = 2;
    for (let x = 0; x <= W; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    void createImageBitmap(c).then(setFrame);
    setMask({ width: W, height: H, data: new Uint8ClampedArray(W * H) });
  }, []);

  /**
   * Measure alignment. Returns the delta between where the reticle was DRAWN
   * and where a click at the same client point WOULD resolve.
   */
  const measure = useCallback(
    (label: string) => {
      const edit = document.querySelector('canvas[data-canvas-role="mask-edit"]') as HTMLCanvasElement | null;
      const all = [...document.querySelectorAll('canvas')] as HTMLCanvasElement[];
      const overlay = all.find((c) => c !== edit && c.width === W && c.height === H && c.style.pointerEvents === 'none');
      if (!edit || !overlay) {
        say(`${label}: FAIL — edit=${!!edit} overlay=${!!overlay}`);
        return;
      }
      const er = edit.getBoundingClientRect();
      const or = overlay.getBoundingClientRect();
      const rectDelta = {
        l: +(or.left - er.left).toFixed(2),
        t: +(or.top - er.top).toFixed(2),
        w: +(or.width - er.width).toFixed(2),
        h: +(or.height - er.height).toFixed(2),
      };

      // Aim inside the CONTAINER, not the canvas. Once zoomed, the canvas rect
      // extends well outside the container (left went to -225 at 1.6×), so a
      // fraction of the canvas rect can land off-screen at a negative clientX —
      // a point no coach could ever hover, which measures nothing.
      const cont = edit.parentElement!;
      const cr = cont.getBoundingClientRect();
      const clientX = cr.left + cr.width * 0.55;
      const clientY = cr.top + cr.height * 0.45;
      edit.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true, pointerId: 1 }));

      // What the CLICK would compute for that same client point.
      const expectX = (clientX - er.left) * (edit.width / er.width);
      const expectY = (clientY - er.top) * (edit.height / er.height);

      // Recover the reticle centre from the overlay's own pixels: the centre dot
      // is the only filled blob, so the centroid of drawn pixels is it.
      setTimeout(() => {
        const octx = overlay.getContext('2d')!;
        const d = octx.getImageData(0, 0, W, H).data;
        let sx = 0, sy = 0, n = 0;
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] > 40) { const p = (i - 3) / 4; sx += p % W; sy += (p / W) | 0; n++; }
        }
        if (!n) { say(`${label}: FAIL — nothing drawn on the reticle overlay`); return; }
        const gotX = sx / n, gotY = sy / n;
        const dx = +(gotX - expectX).toFixed(2);
        const dy = +(gotY - expectY).toFixed(2);
        const ok = Math.abs(dx) <= 1.5 && Math.abs(dy) <= 1.5 &&
          Math.abs(rectDelta.l) <= 0.5 && Math.abs(rectDelta.t) <= 0.5 &&
          Math.abs(rectDelta.w) <= 0.5 && Math.abs(rectDelta.h) <= 0.5;
        say(
          `${label}: ${ok ? 'PASS' : 'FAIL'} — rectDelta l=${rectDelta.l} t=${rectDelta.t} w=${rectDelta.w} h=${rectDelta.h} | ` +
            `click would be (${expectX.toFixed(1)},${expectY.toFixed(1)}) reticle drawn at (${gotX.toFixed(1)},${gotY.toFixed(1)}) → off by (${dx},${dy}) px`,
        );
      }, 120);
    },
    [say],
  );

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__cursorCheck = measure;
  }, [measure]);

  if (!frame || !mask) return <div style={{ color: '#fff', padding: 20 }}>building test frame…</div>;

  return (
    <div style={{ background: '#000', minHeight: '100vh' }}>
      <pre
        style={{
          position: 'fixed', zIndex: 99999, top: 0, left: 0, right: 0,
          background: 'rgba(0,0,0,0.88)', color: '#8f8', fontSize: 11, padding: 6, margin: 0,
          maxHeight: 130, overflow: 'auto', fontFamily: 'ui-monospace, monospace',
        }}
      >
        TEMP-DEBUG-SAMPROBE cursor alignment — call __cursorCheck(&apos;label&apos;) from the console{'\n'}
        {out.join('\n')}
      </pre>
      <FrameMaskEditor
        sourceFrame={frame}
        mask={mask}
        frameLabel="cursor check"
        frameIndex={0}
        frameTotal={1}
        racketKey="cursor-check-frame"
        onMaskChange={setMask}
        onReset={() => {}}
        onRegenerate={() => true}
        onClose={() => {}}
      />
    </div>
  );
}
