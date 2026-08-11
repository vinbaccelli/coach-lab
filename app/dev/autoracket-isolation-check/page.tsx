'use client';

/**
 * TEMP-DEBUG-ISOLATION — THROWAWAY DIAGNOSTIC. DELETE WITH THIS TAG.
 *
 * Answers, with real inference on real footage, the question the union-math
 * proof cannot: "does auto-racket change the PERSON mask through some path
 * other than the union?"
 *
 * TEST A — UNION MATH, with real SAM output (not synthetic).
 *   Build a real person mask via `proposeFrameMask`. Clone it. Apply
 *   `applyAutoRacket` (forced on) to the clone. Diff clone-before vs
 *   clone-after: count pixels LOWERED (must be 0) vs RAISED (expected).
 *
 * TEST B — CROSS-FRAME RESOURCE CONTENTION.
 *   `proposeFrameMask` never imports anything racket-related (verified: zero
 *   diff vs the good-cutout commit), so the only way auto-racket could still
 *   change ITS output is indirectly — by loading D-FINE + SAM-2 (large ONNX
 *   sessions, a 420MB embedding budget) into the SAME TAB earlier in a batch,
 *   and that memory/compute pressure somehow degrading the person segmenter's
 *   OWN model on a LATER frame, despite identical call arguments.
 *
 *   B1: propose the mask for frame "1" — nothing racket-related loaded yet.
 *   Then: run a full auto-racket pass on frame "0" (detect → encode → SAM
 *   decode), so D-FINE and SAM-2 are now resident, exactly as they would be
 *   mid-batch if frame 0 had a racket.
 *   B2: propose the mask for frame "1" AGAIN — same time, same pose object
 *   (reused, not re-detected, so pose nondeterminism cannot confound this).
 *   Diff B1 vs B2. Identical ⇒ no cross-frame coupling on this hardware.
 *   Different ⇒ real coupling, and the diff shows exactly which pixels moved.
 */

import React, { useCallback, useRef, useState } from 'react';
import { createCaptureSource, type CaptureSource } from '@/lib/stroMotionDraft';
import { proposeFrameMask } from '@/lib/stroMotionDraft/proposeFrameMask';
import { cloneAlphaMask } from '@/lib/stroMotionDraft/maskUtils';
import type { AlphaMask } from '@/lib/stroMotionDraft/types';

const DEV = process.env.NODE_ENV !== 'production';

interface Kp { x: number; y: number; score: number; name?: string }

function diffMasks(a: AlphaMask, b: AlphaMask, label: string) {
  if (a.width !== b.width || a.height !== b.height) {
    return { label, comparable: false, note: `size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  let lowered = 0, raised = 0, same = 0, sumAbsDelta = 0;
  let minY = a.height, maxY = -1, minX = a.width, maxX = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = y * a.width + x;
      const d = b.data[i] - a.data[i];
      if (d < 0) {
        lowered++;
        sumAbsDelta += -d;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
      } else if (d > 0) {
        raised++;
        sumAbsDelta += d;
      } else {
        same++;
      }
    }
  }
  return {
    label,
    comparable: true,
    totalPx: a.width * a.height,
    lowered,
    raised,
    unchanged: same,
    sumAbsDelta,
    loweredBBox: lowered > 0 ? { x0: minX, y0: minY, x1: maxX, y1: maxY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  };
}

async function getPose(video: HTMLVideoElement, vw: number, vh: number, bmp: ImageBitmap): Promise<Kp[] | null> {
  const { detectFullPoseOnBitmap } = await import('@/lib/mediapipePose');
  const kps = await detectFullPoseOnBitmap(bmp, vw, vh);
  if (!kps?.length) return null;
  return kps.map((k) => ({ x: k.x / vw, y: k.y / vh, score: k.score ?? 0, name: k.name }));
}

/**
 * The production SEQUENTIAL path, for one frame: detect (D-FINE, then disposed)
 * → segment (SAM). Uses the real two-phase exports, so this diagnostic exercises
 * exactly what the batch does rather than a parallel re-implementation.
 */
async function autoRacketSequential(args: {
  mask: AlphaMask;
  frame: ImageBitmap;
  keypoints: Kp[];
  samKey: string;
  vw: number;
  vh: number;
}): Promise<{ mask: AlphaMask; applied: boolean; reason: string }> {
  const { detectRacketBoxesForBatch, segmentRacketIntoMask } =
    await import('@/lib/stroMotionDraft/autoRacketPass');
  const boxes = await detectRacketBoxesForBatch(
    [{ frameIndex: 0, frame: args.frame, keypoints: args.keypoints, label: args.samKey }],
    { vw: args.vw, vh: args.vh, unitFloorNorm: null },
  );
  const hit = boxes.get(0);
  if (!hit) return { mask: args.mask, applied: false, reason: 'no wrist-gated implement on this frame' };
  return segmentRacketIntoMask({ mask: args.mask, frame: args.frame, samKey: args.samKey, hit });
}

function bboxFromPose(kps: Kp[], vw: number, vh: number) {
  const valid = kps.filter((k) => k.score >= 0.2);
  if (valid.length < 4) return null;
  const xs = valid.map((k) => k.x * vw);
  const ys = valid.map((k) => k.y * vh);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const padX = (maxX - minX) * 0.15, padY = (maxY - minY) * 0.15;
  const x0 = Math.max(0, minX - padX), y0 = Math.max(0, minY - padY);
  const x1 = Math.min(vw, maxX + padX), y1 = Math.min(vh, maxY + padY);
  return { x: x0 / vw, y: y0 / vh, width: (x1 - x0) / vw, height: (y1 - y0) / vh };
}

export default function AutoRacketIsolationCheckPage() {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcLabel, setSrcLabel] = useState('(none)');
  const [tFrame0, setTFrame0] = useState(0);
  const [tFrame1, setTFrame1] = useState(0.14);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const thumbsRef = useRef<HTMLDivElement | null>(null);

  const say = useCallback((s: string) => {
    setLog((p) => [...p, s]);
    // eslint-disable-next-line no-console
    console.log('[isolation]', s);
  }, []);

  const pickFile = useCallback((f: File | null) => {
    if (!f) return;
    setSrcUrl(URL.createObjectURL(f));
    setSrcLabel(f.name);
  }, []);

  const thumb = useCallback((label: string, mask: AlphaMask) => {
    const c = document.createElement('canvas');
    const TW = 220;
    c.width = TW;
    c.height = Math.round((TW / mask.width) * mask.height);
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      img.data[i * 4] = 0; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 100;
      img.data[i * 4 + 3] = mask.data[i];
    }
    const off = document.createElement('canvas');
    off.width = mask.width; off.height = mask.height;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.fillStyle = '#222'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(off, 0, 0, c.width, c.height);
    const cell = document.createElement('div');
    cell.style.cssText = 'display:inline-block;margin:4px;vertical-align:top;font:11px monospace;color:#ccc';
    const cap = document.createElement('div');
    cap.textContent = label;
    cell.appendChild(c); cell.appendChild(cap);
    thumbsRef.current?.appendChild(cell);
  }, []);

  const run = useCallback(async () => {
    if (!srcUrl || busy) return;
    setBusy(true);
    setLog([]);
    setReport(null);
    if (thumbsRef.current) thumbsRef.current.innerHTML = '';
    let source: CaptureSource | null = null;

    try {
      // Force the gate cleanly for this diagnostic — no ambiguity with a mode default.
      (window as unknown as Record<string, unknown>).__autoRacket = false;

      source = createCaptureSource(srcUrl);
      await source.ready(20000);
      const el = source.element;
      const vw = el.videoWidth, vh = el.videoHeight;
      say(`source ready: ${vw}x${vh}, duration ${el.duration.toFixed(2)}s`);

      const seek = (t: number) => new Promise<void>((resolve) => {
        const done = () => { el.removeEventListener('seeked', done); resolve(); };
        el.addEventListener('seeked', done, { once: true });
        el.currentTime = t;
        setTimeout(done, 3000);
      });

      // ── capture frame 1 + its pose ONCE, reused for every proposeFrameMask
      // call below, so pose-detection nondeterminism cannot confound the test.
      await seek(tFrame1);
      const bmp1 = await createImageBitmap(el);
      const pose1 = await getPose(el, vw, vh, bmp1);
      if (!pose1) throw new Error('no pose detected on frame 1 — pick a different time');
      const box1 = bboxFromPose(pose1, vw, vh);
      if (!box1) throw new Error('pose too weak to build a box on frame 1');
      say(`frame1 pose: ${pose1.filter((k) => k.score >= 0.2).length}/${pose1.length} joints ≥0.2`);

      // ═══ TEST A — union math, with a REAL segmented mask ═══════════════════
      say('── TEST A: real union, before/after diff ──');
      const bmpA = await createImageBitmap(el); // fresh bitmap; proposeFrameMask takes ownership
      const propA = await proposeFrameMask(el, tFrame1, box1, tFrame1 + 5, 'racket', null, null, true, pose1, bmpA, null, null);
      if (!propA) throw new Error('proposeFrameMask returned null for test A');
      const beforeA = cloneAlphaMask(propA.aiSnapshot);
      thumb('A: before union', beforeA);

      (window as unknown as Record<string, unknown>).__autoRacket = true;
      const bmpForRacket = await createImageBitmap(el); // detect/encode need their own bitmap
      const resA = await autoRacketSequential({
        mask: cloneAlphaMask(beforeA),
        frame: bmpForRacket,
        keypoints: pose1,
        samKey: 'isoTest-A',
        vw, vh,
      });
      bmpForRacket.close();
      say(`TEST A auto-racket: applied=${resA.applied} — ${resA.reason}`);
      thumb('A: after union', resA.mask);
      const diffA = diffMasks(beforeA, resA.mask, 'A (union math)');
      say(`TEST A diff: lowered=${(diffA as { lowered?: number }).lowered ?? '-'} raised=${(diffA as { raised?: number }).raised ?? '-'}`);

      // ═══ TEST B — cross-frame resource contention ══════════════════════════
      say('── TEST B: frame-1 mask before vs after loading D-FINE+SAM2 on frame 0 ──');
      const bmpB1 = await createImageBitmap(el);
      const propB1 = await proposeFrameMask(el, tFrame1, box1, tFrame1 + 5, 'racket', null, null, true, pose1, bmpB1, null, null);
      if (!propB1) throw new Error('proposeFrameMask returned null for B1');
      const maskB1 = cloneAlphaMask(propB1.aiSnapshot);
      thumb('B1: frame1, nothing loaded', maskB1);
      say(`B1 built. Loading D-FINE + SAM-2 via a full auto-racket pass on frame 0…`);

      await seek(tFrame0);
      const bmp0 = await createImageBitmap(el);
      const pose0 = await getPose(el, vw, vh, bmp0);
      const box0 = pose0 ? bboxFromPose(pose0, vw, vh) : null;
      if (pose0 && box0) {
        const propBase0 = await proposeFrameMask(el, tFrame0, box0, tFrame0 + 5, 'racket', null, null, true, pose0, bmp0, null, null);
        if (propBase0) {
          const bmpR0 = await createImageBitmap(el);
          const res0 = await autoRacketSequential({
            mask: propBase0.aiSnapshot,
            frame: bmpR0,
            keypoints: pose0,
            samKey: 'isoTest-frame0',
            vw, vh,
          });
          bmpR0.close();
          say(`frame 0 auto-racket: applied=${res0.applied} — ${res0.reason}`);
        } else {
          say('frame 0 proposeFrameMask returned null — loading D-FINE/SAM anyway via a direct call');
        }
      } else {
        say('no usable pose on frame 0 — loading D-FINE/SAM directly (no wrist gate to satisfy)');
      }
      // Whether or not frame 0 had a wrist-gated hit, ENSURE both models are
      // loaded and at least one frame is encoded, so B2 runs under the same
      // "heavy models resident" condition auto-racket mid-batch would create.
      try {
        const { detectRacketBox } = await import('@/lib/stroMotionDraft/racketDetect');
        const bmpWarm = await createImageBitmap(el);
        await detectRacketBox({ frame: bmpWarm, keypoints: pose1, vw, vh, unitFloorNorm: null, label: 'warm' });
        bmpWarm.close();
      } catch { /* best-effort warm-up */ }

      await seek(tFrame1);
      const bmpB2 = await createImageBitmap(el);
      const propB2 = await proposeFrameMask(el, tFrame1, box1, tFrame1 + 5, 'racket', null, null, true, pose1, bmpB2, null, null);
      if (!propB2) throw new Error('proposeFrameMask returned null for B2');
      thumb('B2: frame1, D-FINE+SAM2 loaded', propB2.aiSnapshot);
      const diffB = diffMasks(maskB1, propB2.aiSnapshot, 'B (cross-frame contention)');
      say(`TEST B diff: lowered=${(diffB as { lowered?: number }).lowered ?? '-'} raised=${(diffB as { raised?: number }).raised ?? '-'} unchanged=${(diffB as { unchanged?: number }).unchanged ?? '-'}`);

      const rep = {
        source: srcLabel,
        frame1Time: tFrame1,
        frame0Time: tFrame0,
        testA_unionMath: diffA,
        testA_verdict: (diffA as { lowered?: number }).lowered === 0
          ? 'PASS — union never lowered a person pixel on real SAM output'
          : 'FAIL — union lowered pixels, see loweredBBox',
        testB_crossFrameContention: diffB,
        testB_verdict: (diffB as { lowered?: number; unchanged?: number; totalPx?: number }).lowered === 0
          && (diffB as { unchanged?: number; totalPx?: number }).unchanged === (diffB as { totalPx?: number }).totalPx
          ? 'PASS — frame 1 mask IDENTICAL whether or not D-FINE/SAM2 were already loaded from frame 0'
          : 'DIFFERS — proposeFrameMask produced a different mask depending on prior racket activity in the same tab (real coupling, not the union)',
      };
      setReport(rep);
      (window as unknown as Record<string, unknown>).__isolationReport = rep;
      // eslint-disable-next-line no-console
      console.log('[isolation] REPORT', rep);
      say(`DONE. A: ${rep.testA_verdict}`);
      say(`DONE. B: ${rep.testB_verdict}`);
    } catch (e) {
      say(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
      // eslint-disable-next-line no-console
      console.error('[isolation]', e);
    } finally {
      source?.dispose();
      setBusy(false);
    }
  }, [srcUrl, srcLabel, tFrame0, tFrame1, busy, say, thumb]);

  if (!DEV) return null;

  const inp: React.CSSProperties = { width: 80, background: '#111', color: '#eee', border: '1px solid #444', padding: '2px 4px' };
  const btn: React.CSSProperties = { background: '#2b6', color: '#000', border: 0, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', marginRight: 8 };

  return (
    <div style={{ padding: 16, font: '13px monospace', background: '#0b0b0b', color: '#ddd', minHeight: '100vh' }}>
      <h1 style={{ font: '700 16px monospace', color: '#c04cff' }}>Auto-racket isolation check — TEMP-DEBUG-ISOLATION</h1>
      <p style={{ maxWidth: 900, color: '#aaa' }}>
        Test A: does the union math ever lower a person pixel (real SAM output)?
        Test B: does proposeFrameMask&apos;s own output for one frame change depending on
        whether D-FINE/SAM-2 were already loaded from an earlier frame in the same tab?
      </p>
      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept="video/*" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        <button style={{ ...btn, background: '#456', color: '#eee' }} onClick={() => { setSrcUrl('/demo.mp4'); setSrcLabel('/demo.mp4'); }}>
          use /demo.mp4
        </button>
        <span style={{ color: '#888' }}>src: {srcLabel}</span>
      </div>
      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
        frame0 t <input style={inp} type="number" step="0.01" value={tFrame0} onChange={(e) => setTFrame0(+e.target.value)} />
        frame1 t <input style={inp} type="number" step="0.01" value={tFrame1} onChange={(e) => setTFrame1(+e.target.value)} />
        <button style={btn} disabled={busy || !srcUrl} onClick={() => { void run(); }}>Run both tests</button>
        {busy && <span style={{ color: '#fc0' }}>running…</span>}
      </div>
      {report && (
        <pre style={{ background: '#111', border: '1px solid #333', padding: 10, maxHeight: 420, overflow: 'auto' }}>
          {JSON.stringify(report, null, 2)}
        </pre>
      )}
      <div ref={thumbsRef} style={{ margin: '12px 0' }} />
      <pre style={{ background: '#111', border: '1px solid #333', padding: 10, maxHeight: 300, overflow: 'auto', color: '#9c9' }}>
        {log.join('\n')}
      </pre>
    </div>
  );
}
