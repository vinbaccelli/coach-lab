'use client';

/**
 * TEMP-DEBUG-WARMTH — THROWAWAY DIAGNOSTIC. DELETE WITH THIS TAG.
 *
 * Answers one question with a number: during a MULTI-FRAME batch running the
 * real phased structure, how many times does the person segmenter actually
 * INITIALISE?
 *
 *   init count == 1        → the model loads once and stays warm (no thrashing)
 *   init count == N frames → it is being evicted and cold-reloaded per frame
 *
 * It counts by watching the segmenter's own `solution initialized` log line, so
 * it measures the SHIPPED module without instrumenting (or touching) it.
 *
 * It drives the REAL production path — `detectRacketBoxesForBatch` (Phase A),
 * then `proposeFrameMask` per frame (Phase B), then `segmentRacketIntoMask`
 * (Phase C) — so what it measures is what `autoProcessFrames` does.
 *
 * Also reports per-frame segmentation time. A cold reload costs seconds; a warm
 * reuse costs a few hundred ms. If frame 1 is slow and frames 2..N are fast, the
 * model is warm — a second independent signal that does not depend on the log.
 */

import React, { useCallback, useRef, useState } from 'react';
import { createCaptureSource, type CaptureSource } from '@/lib/stroMotionDraft';
import { proposeFrameMask } from '@/lib/stroMotionDraft/proposeFrameMask';
import type { AlphaMask } from '@/lib/stroMotionDraft/types';

const DEV = process.env.NODE_ENV !== 'production';

interface Kp { x: number; y: number; score: number; name?: string }

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

function countOn(m: AlphaMask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i] > 127) n++;
  return n;
}

export default function SegmenterWarmthCheckPage() {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcLabel, setSrcLabel] = useState('(none)');
  const [frameCount, setFrameCount] = useState(5);
  const [racketOn, setRacketOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const logRef = useRef<string[]>([]);

  const say = useCallback((s: string) => {
    logRef.current.push(s);
    setLog([...logRef.current]);
    // eslint-disable-next-line no-console
    console.log('[warmth]', s);
  }, []);

  const run = useCallback(async () => {
    if (!srcUrl || busy) return;
    setBusy(true);
    logRef.current = [];
    setLog([]);
    setReport(null);

    // Count the segmenter's OWN init log, without touching its module.
    let segInits = 0;
    let dfineLoads = 0;
    let samLoads = 0;
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      const s = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
      if (s.includes('[selfieSegmenter] solution initialized')) segInits++;
      if (s.includes('[autoRacket] D-FINE-N q4f16 ready')) dfineLoads++;
      if (s.includes('[samRacket] SAM2.1-hiera-tiny q4f16 ready')) samLoads++;
      origLog.apply(console, args as []);
    };

    let source: CaptureSource | null = null;
    try {
      (window as unknown as Record<string, unknown>).__autoRacket = racketOn;

      source = createCaptureSource(srcUrl);
      await source.ready(20000);
      const el = source.element;
      const vw = el.videoWidth, vh = el.videoHeight;
      const N = Math.max(1, Math.min(10, Math.round(frameCount)));
      const dur = Math.min(el.duration, 2.0);
      const times = Array.from({ length: N }, (_, i) => (N === 1 ? 0 : (dur * i) / (N - 1)));
      say(`source ${vw}x${vh}; ${N} frames at ${times.map((t) => t.toFixed(2)).join(', ')}s`);

      const seek = (t: number) => new Promise<void>((resolve) => {
        const done = () => { el.removeEventListener('seeked', done); resolve(); };
        el.addEventListener('seeked', done, { once: true });
        el.currentTime = t;
        setTimeout(done, 3000);
      });

      const { detectFullPoseOnBitmap } = await import('@/lib/mediapipePose');

      // Capture every frame + its pose up front (pose model, not the segmenter).
      const frames: Array<{ i: number; t: number; bmp: ImageBitmap; pose: Kp[]; box: ReturnType<typeof bboxFromPose> }> = [];
      for (let i = 0; i < N; i++) {
        await seek(times[i]);
        const bmp = await createImageBitmap(el);
        const raw = await detectFullPoseOnBitmap(bmp, vw, vh);
        const pose: Kp[] = (raw ?? []).map((k) => ({ x: k.x / vw, y: k.y / vh, score: k.score ?? 0, name: k.name }));
        frames.push({ i, t: times[i], bmp, pose, box: pose.length ? bboxFromPose(pose, vw, vh) : null });
      }
      say(`captured ${frames.length} frames + poses`);

      // ── PHASE A — D-FINE across ALL frames, then disposed ────────────────
      const phaseAStart = performance.now();
      let boxes = new Map<number, import('@/lib/stroMotionDraft/autoRacketPass').RacketBoxForFrame>();
      if (racketOn) {
        const { detectRacketBoxesForBatch } = await import('@/lib/stroMotionDraft/autoRacketPass');
        boxes = await detectRacketBoxesForBatch(
          frames.map((f) => ({ frameIndex: f.i, frame: f.bmp, keypoints: f.pose, label: `warmth-f${f.i}` })),
          { vw, vh, unitFloorNorm: null },
        );
      }
      const phaseAMs = performance.now() - phaseAStart;
      say(`PHASE A: ${racketOn ? `${boxes.size}/${frames.length} boxes` : 'skipped (racket off)'} in ${phaseAMs.toFixed(0)}ms`);

      // ── PHASE B — person segmentation across ALL frames ──────────────────
      const perFrameMs: number[] = [];
      const coverage: number[] = [];
      const built: Array<{ i: number; mask: AlphaMask; bmp: ImageBitmap }> = [];
      for (const f of frames) {
        if (!f.box) { say(`frame ${f.i}: no pose box, skipped`); continue; }
        const t0 = performance.now();
        const own = await createImageBitmap(f.bmp); // proposeFrameMask takes ownership
        const prop = await proposeFrameMask(el, f.t, f.box, f.t + 5, 'racket', null, null, true, f.pose, own, null, null);
        const ms = performance.now() - t0;
        perFrameMs.push(Math.round(ms));
        if (prop) {
          coverage.push(countOn(prop.aiSnapshot));
          built.push({ i: f.i, mask: prop.aiSnapshot, bmp: prop.sourceFrame });
          say(`frame ${f.i}: segmented in ${ms.toFixed(0)}ms, ${countOn(prop.aiSnapshot)}px (segInits so far=${segInits})`);
        } else {
          say(`frame ${f.i}: proposeFrameMask returned null (${ms.toFixed(0)}ms)`);
        }
      }

      // ── PHASE C — SAM on the detected boxes ─────────────────────────────
      let racketApplied = 0;
      if (racketOn && boxes.size) {
        const { segmentRacketIntoMask } = await import('@/lib/stroMotionDraft/autoRacketPass');
        for (const b of built) {
          const hit = boxes.get(b.i);
          if (!hit) continue;
          const r = await segmentRacketIntoMask({ mask: b.mask, frame: b.bmp, samKey: `warmth-f${b.i}`, hit });
          if (r.applied) racketApplied++;
        }
      }

      frames.forEach((f) => { try { f.bmp.close(); } catch { /* closed */ } });
      built.forEach((b) => { try { b.bmp.close(); } catch { /* closed */ } });

      const rep = {
        source: srcLabel,
        autoRacket: racketOn ? 'ON' : 'OFF',
        framesSegmented: perFrameMs.length,
        segmenterInitCount: segInits,
        dfineLoadCount: dfineLoads,
        samLoadCount: samLoads,
        verdict: segInits <= 1
          ? `WARM — segmenter initialised ${segInits}x for ${perFrameMs.length} frames (no per-frame reload)`
          : `THRASHING — segmenter initialised ${segInits}x for ${perFrameMs.length} frames`,
        perFrameSegmentMs: perFrameMs,
        firstFrameMs: perFrameMs[0] ?? null,
        medianLaterFrameMs: perFrameMs.length > 1
          ? [...perFrameMs.slice(1)].sort((a, b) => a - b)[Math.floor((perFrameMs.length - 1) / 2)]
          : null,
        coveragePx: coverage,
        phaseAMs: Math.round(phaseAMs),
        racketBoxesFound: boxes.size,
        racketSegmented: racketApplied,
      };
      setReport(rep);
      (window as unknown as Record<string, unknown>).__warmthReport = rep;
      origLog('[warmth] REPORT', rep);
      say(`DONE — ${rep.verdict}`);
    } catch (e) {
      say(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
      // eslint-disable-next-line no-console
      console.error('[warmth]', e);
    } finally {
      console.log = origLog;
      source?.dispose();
      setBusy(false);
    }
  }, [srcUrl, srcLabel, frameCount, racketOn, busy, say]);

  if (!DEV) return null;
  const inp: React.CSSProperties = { width: 60, background: '#111', color: '#eee', border: '1px solid #444', padding: '2px 4px' };
  const btn: React.CSSProperties = { background: '#2b6', color: '#000', border: 0, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', marginRight: 8 };

  return (
    <div style={{ padding: 16, font: '13px monospace', background: '#0b0b0b', color: '#ddd', minHeight: '100vh' }}>
      <h1 style={{ font: '700 16px monospace', color: '#c04cff' }}>Segmenter warmth check — TEMP-DEBUG-WARMTH</h1>
      <p style={{ maxWidth: 900, color: '#aaa' }}>
        Runs the real phased batch over N frames and counts how many times the person
        segmenter actually initialises. 1 = warm. N = per-frame cold reload.
      </p>
      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setSrcUrl(URL.createObjectURL(f)); setSrcLabel(f.name); } }} />
        <button style={{ ...btn, background: '#456', color: '#eee' }} onClick={() => { setSrcUrl('/demo.mp4'); setSrcLabel('/demo.mp4'); }}>use /demo.mp4</button>
        <span style={{ color: '#888' }}>src: {srcLabel}</span>
      </div>
      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
        frames <input style={inp} type="number" value={frameCount} onChange={(e) => setFrameCount(+e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={racketOn} onChange={(e) => setRacketOn(e.target.checked)} /> auto-racket ON
        </label>
        <button style={btn} disabled={busy || !srcUrl} onClick={() => { void run(); }}>Run</button>
        {busy && <span style={{ color: '#fc0' }}>running…</span>}
      </div>
      {report && (
        <pre style={{ background: '#111', border: '1px solid #333', padding: 10, maxHeight: 420, overflow: 'auto' }}>
          {JSON.stringify(report, null, 2)}
        </pre>
      )}
      <pre style={{ background: '#111', border: '1px solid #333', padding: 10, maxHeight: 300, overflow: 'auto', color: '#9c9' }}>
        {log.join('\n')}
      </pre>
    </div>
  );
}
