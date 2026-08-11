'use client';

/**
 * TEMP-DEBUG-POSEDET — THROWAWAY DIAGNOSTIC. DELETE WITH THIS TAG.
 *
 * Two questions, one page:
 *
 *  1. IS REPEATED DETECTION A RE-ROLL? Runs `detectFullPoseOnBitmap` three times
 *     on the SAME bitmap and compares every coordinate exactly. If the runs are
 *     identical, clicking "Redo mask" repeatedly can never recover a dropped
 *     joint, and the whole "retry until the arm appears" idea is unbuildable as
 *     stated. This is the claim the ladder is built on, so it is measured rather
 *     than asserted.
 *
 *  2. DOES THE LADDER FIND MORE? Runs the four ladder attempts (plain / mirrored /
 *     heavy / heavy+mirrored) and reports gated joints for each, plus which joints
 *     each attempt recovered that the plain pass missed — by name, so a missing
 *     ARM is identifiable rather than just a count.
 */

import React, { useCallback, useRef, useState } from 'react';
import { createCaptureSource, type CaptureSource } from '@/lib/stroMotionDraft';

const DEV = process.env.NODE_ENV !== 'production';
const GATE = 0.2;

export default function PoseDeterminismCheckPage() {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcLabel, setSrcLabel] = useState('(none)');
  const [timeSec, setTimeSec] = useState(0);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<string[]>([]);

  const say = useCallback((s: string) => {
    logRef.current.push(s);
    setLog([...logRef.current]);
    // eslint-disable-next-line no-console
    console.log('[posedet]', s);
  }, []);

  const run = useCallback(async () => {
    if (!srcUrl || busy) return;
    setBusy(true);
    logRef.current = [];
    setLog([]);
    setReport(null);
    let source: CaptureSource | null = null;

    try {
      source = createCaptureSource(srcUrl);
      await source.ready(20000);
      const el = source.element;
      const vw = el.videoWidth, vh = el.videoHeight;

      await new Promise<void>((resolve) => {
        const done = () => { el.removeEventListener('seeked', done); resolve(); };
        el.addEventListener('seeked', done, { once: true });
        el.currentTime = timeSec;
        setTimeout(done, 3000);
      });
      const bmp = await createImageBitmap(el);
      say(`frame at ${timeSec}s captured (${vw}x${vh})`);

      const { detectFullPoseOnBitmap } = await import('@/lib/mediapipePose');
      const gated = (k: Array<{ score: number }> | null) => (k ?? []).filter((j) => j.score >= GATE).length;

      // ── 1. determinism ────────────────────────────────────────────────────
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const k = await detectFullPoseOnBitmap(bmp, vw, vh);
        runs.push(k);
        say(`repeat run ${i + 1}: joints=${gated(k)}/${k?.length ?? 0} gated`);
      }
      let identical = true;
      let firstDiff: string | null = null;
      for (let i = 1; i < runs.length && identical; i++) {
        const a = runs[0], b = runs[i];
        if (!a || !b || a.length !== b.length) { identical = false; firstDiff = 'length differs'; break; }
        for (let j = 0; j < a.length; j++) {
          if (a[j].x !== b[j].x || a[j].y !== b[j].y || a[j].score !== b[j].score) {
            identical = false;
            firstDiff = `${a[j].name}: run1(${a[j].x.toFixed(3)},${a[j].y.toFixed(3)},${a[j].score.toFixed(4)}) vs run${i + 1}(${b[j].x.toFixed(3)},${b[j].y.toFixed(3)},${b[j].score.toFixed(4)})`;
            break;
          }
        }
      }
      say(identical
        ? 'DETERMINISTIC — all 3 runs bit-identical (repeated clicks cannot re-roll)'
        : `NON-DETERMINISTIC — ${firstDiff}`);

      // ── 2. the ladder ─────────────────────────────────────────────────────
      const { detectBestPoseOnBitmap } = await import('@/lib/stroMotionDraft/poseRetryLadder');
      const best = await detectBestPoseOnBitmap(bmp, vw, vh, { label: 'posedet' });

      // Which joints did the winner recover that the plain pass missed?
      const plain = runs[0];
      const plainMissing = new Set((plain ?? []).filter((k) => k.score < GATE).map((k) => k.name));
      const recovered = (best?.keypoints ?? [])
        .filter((k) => k.score >= GATE && plainMissing.has(k.name))
        .map((k) => k.name);
      const stillMissing = (best?.keypoints ?? [])
        .filter((k) => k.score < GATE)
        .map((k) => k.name);

      const rep = {
        source: srcLabel,
        timeSec,
        repeatRunsIdentical: identical,
        repeatVerdict: identical
          ? 'Repeated detection is deterministic — a "retry" click cannot change the result'
          : 'Detection varies between runs',
        plainGated: gated(plain),
        ladderAttempts: best?.attempts ?? [],
        ladderWinner: best?.winner ?? null,
        ladderGated: best?.gated ?? 0,
        jointsRecoveredByLadder: recovered,
        jointsStillBelowGate: stillMissing,
        improvement: (best?.gated ?? 0) - gated(plain),
      };
      setReport(rep);
      (window as unknown as Record<string, unknown>).__poseDetReport = rep;
      // eslint-disable-next-line no-console
      console.log('[posedet] REPORT', rep);
      say(`DONE — plain=${gated(plain)} ladder=${best?.gated ?? 0} (+${rep.improvement}) recovered=[${recovered.join(', ')}]`);
      bmp.close();
    } catch (e) {
      say(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
      // eslint-disable-next-line no-console
      console.error('[posedet]', e);
    } finally {
      source?.dispose();
      setBusy(false);
    }
  }, [srcUrl, srcLabel, timeSec, busy, say]);

  if (!DEV) return null;
  const btn: React.CSSProperties = { background: '#2b6', color: '#000', border: 0, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', marginRight: 8 };

  return (
    <div style={{ padding: 16, font: '13px monospace', background: '#0b0b0b', color: '#ddd', minHeight: '100vh' }}>
      <h1 style={{ font: '700 16px monospace', color: '#c04cff' }}>Pose determinism + retry ladder — TEMP-DEBUG-POSEDET</h1>
      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setSrcUrl(URL.createObjectURL(f)); setSrcLabel(f.name); } }} />
        <button style={{ ...btn, background: '#456', color: '#eee' }} onClick={() => { setSrcUrl('/demo.mp4'); setSrcLabel('/demo.mp4'); }}>use /demo.mp4</button>
        <span style={{ color: '#888' }}>src: {srcLabel}</span>
        t <input style={{ width: 70, background: '#111', color: '#eee', border: '1px solid #444' }} type="number" step="0.01" value={timeSec} onChange={(e) => setTimeSec(+e.target.value)} />
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
