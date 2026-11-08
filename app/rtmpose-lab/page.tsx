'use client';
/**
 * RTMPose spike — LAB. Runs several pose engines over the SAME frames of one clip and compares them.
 * Not part of the product: not linked from the app, own route, does not touch the analysis page or AI Track.
 * Desktop and phone results are different things — the page prints the device so a pasted result says where it came from.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ENGINE_IDS, REFERENCE_ENGINE, createEngine, type EngineId } from '@/lib/rtmpose/labEngines';
import { summarize, compareToReference, type EngineSummary, type RefComparison, type LabFrame } from '@/lib/rtmpose/labMetrics';
import type { Kp } from '@/lib/rtmpose/core';

interface EngineResult {
  id: EngineId; label: string; initMs: number; info: Record<string, unknown>; warmupMs: number;
  frames: LabFrame[]; summary: EngineSummary; vsRef: RefComparison | null; error?: string;
}

const EDGES: Array<[string, string]> = [
  ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'], ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'], ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'], ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
];

async function seek(v: HTMLVideoElement, t: number) {
  await new Promise<void>((res) => {
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); res(); };
    v.addEventListener('seeked', fin); v.currentTime = t; setTimeout(fin, 1500);
  });
  await new Promise<void>((res) => {
    const vv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (typeof vv.requestVideoFrameCallback === 'function') { vv.requestVideoFrameCallback(() => res()); setTimeout(res, 200); } else setTimeout(res, 60);
  });
}

function deviceInfo() {
  const n = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  return {
    userAgent: n.userAgent, cores: n.hardwareConcurrency, memoryGB: n.deviceMemory ?? null, webgpu: !!n.gpu,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated, dpr: window.devicePixelRatio,
  };
}

async function battery(): Promise<{ level: number; charging: boolean } | null> {
  try { const b = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.(); return b ? { level: b.level, charging: b.charging } : null; } catch { return null; }
}

interface LiveResult {
  id: EngineId; label: string; seconds: number; frames: number; detPerSec: number | null; detectedPct: number;
  /** capture→result (ms, real time at 1×): the engine's own latency */
  ageMs: [number | null, number | null, number | null];
  /** capture→next screen refresh after the result: what a drawn skeleton would trail the picture by */
  ageAtDrawMs: [number | null, number | null, number | null];
  mainDropped: string; mainFrameGapMs: [number | null, number | null]; jankOver50: number; jumps: number; swaps: number; error?: string;
}

const pc = (v: number[], p: number) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10; };

const fmt = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(d));

export default function RtmposeLab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [fps, setFps] = useState(15);
  const [seconds, setSeconds] = useState(6);
  const [startAt, setStartAt] = useState(0);
  const [threads, setThreads] = useState(0);
  const [detEvery, setDetEvery] = useState(0);
  const [picked, setPicked] = useState<Record<string, boolean>>({ 'movenet-thunder': true, 'mp-live-full': true, 'mp-crop-full': true, 'mp-crop-seeded': true, 'mp-crop-heavy': true, 'rtmpose-t': true, 'rtmpose-s': true, 'rtmpose-m': false });
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<EngineResult[]>([]);
  const [report, setReport] = useState<string>('');
  const [liveSeconds, setLiveSeconds] = useState(6);
  const [liveResults, setLiveResults] = useState<LiveResult[]>([]);
  const [viewEngine, setViewEngine] = useState<string>('');
  const [viewIdx, setViewIdx] = useState(0);
  const cancelRef = useRef(false);

  const say = useCallback((s: string) => setLog((l) => [...l.slice(-40), s]), []);

  const run = useCallback(async (ids?: EngineId[], o?: { fps?: number; seconds?: number; startAt?: number }) => {
    const v = videoRef.current; if (!v || !url) return null;
    const sel = ids ?? ENGINE_IDS.filter((e) => picked[e]);
    const F = o?.fps ?? fps, S = o?.seconds ?? seconds, T0 = o?.startAt ?? startAt;
    const count = Math.max(2, Math.min(Math.floor(S * F), Math.floor(((v.duration || S) - T0) * F)));
    cancelRef.current = false; setBusy(true); setResults([]);
    const out: EngineResult[] = [];
    const bat0 = await battery(); const t00 = performance.now();
    for (const id of sel) {
      if (cancelRef.current) break;
      say(`${id}: loading…`);
      const eng = createEngine(id, { threads: threads || undefined, detEvery });
      const frames: LabFrame[] = [];
      let initMs = 0, info: Record<string, unknown> = {}, warmupMs = 0, error: string | undefined;
      try {
        const t0 = performance.now(); info = await eng.init(); initMs = performance.now() - t0;
        say(`${id}: ready in ${(initMs / 1000).toFixed(1)} s — running ${count} frames`);
        for (let k = 0; k < count && !cancelRef.current; k++) {
          const t = T0 + k / F;
          await seek(v, t);
          const a = performance.now(); let kps: Kp[] | null = null;
          try { kps = await eng.detect(v); } catch (e) { error = (e as Error)?.message; }
          const ms = performance.now() - a;
          if (k < 2) warmupMs += ms; // first calls pay shader/graph compile: reported separately, excluded from timing stats
          frames.push({ t, kps, ms: k < 2 ? 0 : ms });
          if (k % 10 === 0) { setLog((l) => [...l.slice(-40).filter((x) => !x.startsWith(`${id}: frame`)), `${id}: frame ${k}/${count}`]); await new Promise((r) => setTimeout(r, 0)); }
        }
      } catch (e) { error = (e as Error)?.message ?? String(e); say(`${id}: FAILED ${error}`); }
      try { eng.dispose(); } catch { /* noop */ }
      const summary = summarize(frames);
      out.push({ id, label: eng.label, initMs, info, warmupMs, frames, summary, vsRef: null, error });
      say(`${id}: p50 ${fmt(summary.msP50)} ms, detected ${summary.detectedPct}%`);
    }
    const ref = out.find((r) => r.id === REFERENCE_ENGINE);
    for (const r of out) r.vsRef = ref && r !== ref ? compareToReference(r.frames, ref.frames) : null;
    const bat1 = await battery();
    setResults(out); setBusy(false);
    const rep = {
      kind: 'rtmpose-lab', when: new Date().toISOString(), device: deviceInfo(), clip: { w: v.videoWidth, h: v.videoHeight, duration: v.duration, startAt: T0, fps: F, frames: count },
      note: 'vsRef compares against the MediaPipe heavy engine: PSEUDO-truth, not ground truth. Timings exclude the first 2 frames (warm-up).',
      wallSeconds: Math.round((performance.now() - t00) / 100) / 10, battery: { start: bat0, end: bat1 },
      engines: out.map((r) => ({ id: r.id, label: r.label, initMs: Math.round(r.initMs), warmupMs: Math.round(r.warmupMs), info: r.info, error: r.error, summary: r.summary, vsRef: r.vsRef })),
    };
    setReport(JSON.stringify(rep, null, 1));
    if (out[0]) { setViewEngine(out[0].id); setViewIdx(0); }
    (window as unknown as { __rtmLabResults?: unknown }).__rtmLabResults = { report: rep, frames: Object.fromEntries(out.map((r) => [r.id, r.frames])) };
    return rep;
  }, [url, picked, fps, seconds, startAt, threads, detEvery, say]);

  React.useEffect(() => { (window as unknown as { __rtmLab?: unknown }).__rtmLab = { run }; }, [run]);


  /** REAL-TIME test: the clip plays at 1× while the engine detects the latest frame, one in flight (like the live skeleton). */
  const runLive = useCallback(async (ids?: EngineId[], o?: { seconds?: number; startAt?: number }) => {
    const v = videoRef.current; if (!v || !url) return null;
    const sel = (ids ?? ENGINE_IDS.filter((e) => picked[e] && e !== REFERENCE_ENGINE));
    const S = o?.seconds ?? liveSeconds, T0 = o?.startAt ?? startAt;
    cancelRef.current = false; setBusy(true); setLiveResults([]);
    const out: LiveResult[] = [];
    const bat0 = await battery();
    // refresh timestamps, to know when a result would reach the screen
    const rafs: number[] = []; let rafOn = true;
    const tick = (ts: number) => { rafs.push(ts); if (rafs.length > 4000) rafs.splice(0, 1000); if (rafOn) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    for (const id of sel) {
      if (cancelRef.current) break;
      say(`LIVE ${id}: loading…`);
      const eng = createEngine(id, { threads: threads || undefined, detEvery });
      let error: string | undefined; const frames: LabFrame[] = []; const ages: number[] = [], atDraw: number[] = []; const pairs: Array<[number, number]> = [];
      try {
        await eng.init();
        v.muted = true; v.playbackRate = 1; await seek(v, T0);
        // warm-up on the paused frame so shader / graph compile is not counted
        for (let k = 0; k < 2; k++) await eng.detect(v);
        await seek(v, T0);
        const q0 = v.getVideoPlaybackQuality?.(); const r0 = rafs.length;
        const start = performance.now(); await v.play();
        while (performance.now() - start < S * 1000 && !v.paused && !v.ended && !cancelRef.current) {
          const t = v.currentTime, a = performance.now();
          let kps: Kp[] | null = null;
          try { kps = await eng.detect(v); } catch (e) { error = (e as Error)?.message; break; }
          const b = performance.now();
          frames.push({ t, kps, ms: b - a }); ages.push(b - a); pairs.push([a, b]);
          await new Promise((r) => setTimeout(r, 0)); // let the browser breathe like the app's rVFC loop would
        }
        const wall = (performance.now() - start) / 1000;
        v.pause();
        const q1 = v.getVideoPlaybackQuality?.();
        await new Promise((r) => setTimeout(r, 80)); // let the last refreshes land, then find each result's next refresh
        for (const [a, b] of pairs) { const next = rafs.find((x) => x >= b); if (next !== undefined) atDraw.push(next - a); }
        const gaps: number[] = []; for (let i = r0 + 1; i < rafs.length; i++) gaps.push(rafs[i] - rafs[i - 1]);
        const use = frames.slice(0), sm = summarize(use);
        out.push({
          id, label: eng.label, seconds: Math.round(wall * 10) / 10, frames: frames.length, detPerSec: frames.length ? Math.round((frames.length / wall) * 10) / 10 : null,
          detectedPct: sm.detectedPct, ageMs: [pc(ages, 0.5), pc(ages, 0.95), pc(ages, 1)], ageAtDrawMs: [pc(atDraw, 0.5), pc(atDraw, 0.95), pc(atDraw, 1)],
          mainDropped: q0 && q1 ? `${q1.droppedVideoFrames - q0.droppedVideoFrames}/${q1.totalVideoFrames - q0.totalVideoFrames}` : 'n/a',
          mainFrameGapMs: [pc(gaps, 0.5), pc(gaps, 1)], jankOver50: gaps.filter((g) => g > 50).length, jumps: sm.track.jumps, swaps: sm.track.swaps, error,
        });
      } catch (e) { error = (e as Error)?.message ?? String(e); say(`LIVE ${id}: FAILED ${error}`); out.push({ id, label: eng.label, seconds: 0, frames: 0, detPerSec: null, detectedPct: 0, ageMs: [null, null, null], ageAtDrawMs: [null, null, null], mainDropped: 'n/a', mainFrameGapMs: [null, null], jankOver50: 0, jumps: 0, swaps: 0, error }); }
      try { v.pause(); eng.dispose(); } catch { /* noop */ }
      const last = out[out.length - 1]; say(`LIVE ${id}: ${last?.detPerSec ?? '–'} det/s, age p50 ${last?.ageMs[0] ?? '–'} ms, at draw ${last?.ageAtDrawMs[0] ?? '–'} ms`);
    }
    rafOn = false;
    const bat1 = await battery();
    setLiveResults(out); setBusy(false);
    const rep = { kind: 'rtmpose-lab-live', when: new Date().toISOString(), device: deviceInfo(), clip: { w: v.videoWidth, h: v.videoHeight, startAt: T0, seconds: S },
      note: 'Real-time playback at 1x, one detection in flight. age = capture to result; age at draw = capture to the next screen refresh after the result. Battery API is Chromium-only (null on iPhone).',
      battery: { start: bat0, end: bat1 }, engines: out };
    setReport((prev) => { try { const p = prev ? JSON.parse(prev) : {}; return JSON.stringify({ ...p, live: rep }, null, 1); } catch { return JSON.stringify({ live: rep }, null, 1); } });
    (window as unknown as { __rtmLabLive?: unknown }).__rtmLabLive = rep;
    return rep;
  }, [url, picked, liveSeconds, startAt, threads, detEvery, say]);

  React.useEffect(() => { (window as unknown as { __rtmLabLiveRun?: unknown }).__rtmLabLiveRun = runLive; }, [runLive]);

  // overlay viewer
  const draw = useCallback(async (engineId: string, idx: number) => {
    const v = videoRef.current, c = overlayRef.current; const r = results.find((x) => x.id === engineId);
    if (!v || !c || !r || !r.frames[idx]) return;
    await seek(v, r.frames[idx].t);
    const rect = v.getBoundingClientRect(); c.width = rect.width; c.height = rect.height;
    const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, c.width, c.height);
    const k = r.frames[idx].kps; if (!k) return;
    const s = rect.width / v.videoWidth, m = new Map(k.map((p) => [p.name, p]));
    ctx.lineWidth = 2; ctx.strokeStyle = '#0f0';
    for (const [a, b] of EDGES) { const p = m.get(a), q = m.get(b); if (p && q && p.score > 0.3 && q.score > 0.3) { ctx.beginPath(); ctx.moveTo(p.x * s, p.y * s); ctx.lineTo(q.x * s, q.y * s); ctx.stroke(); } }
    ctx.fillStyle = '#f33'; for (const p of k) if (p.score > 0.3) { ctx.beginPath(); ctx.arc(p.x * s, p.y * s, 3, 0, 7); ctx.fill(); }
  }, [results]);

  const copy = async () => { try { await navigator.clipboard.writeText(report); say('result copied'); } catch { say('copy failed — use Download'); } };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([report], { type: 'application/json' })); a.download = `rtmpose-lab-${Date.now()}.json`; a.click(); };

  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehavior: 'contain', background: '#fff', color: '#111' }}>
    {/* the app's global styles lock the page scroll; this lab scrolls inside its own fixed layer */}
    <div style={{ padding: 12, paddingBottom: 120, fontFamily: 'system-ui, sans-serif', fontSize: 14, maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ margin: '4px 0' }}>Pose engine lab (spike)</h2>
      <p style={{ margin: '4px 0 10px', color: '#555' }}>Runs the chosen engines on the same frames of one clip. Keep this tab in the foreground until it finishes. Not part of the product.</p>
      <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setUrl(URL.createObjectURL(f)); setResults([]); setReport(''); } }} />
      <div style={{ position: 'relative', marginTop: 8 }}>
        <video ref={videoRef} src={url ?? undefined} muted playsInline preload="auto" controls={false} onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = 0.001; } catch { /* noop */ } }} style={{ width: '100%', maxHeight: 320, background: '#000' }} />
        <canvas ref={overlayRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} />
      </div>
      <fieldset style={{ margin: '10px 0', padding: 8 }}>
        <legend>Engines</legend>
        {ENGINE_IDS.map((e) => (
          <label key={e} style={{ display: 'block' }}><input type="checkbox" checked={!!picked[e]} onChange={(ev) => setPicked((p) => ({ ...p, [e]: ev.target.checked }))} /> {e}{e === REFERENCE_ENGINE ? ' (reference, keep ON)' : ''}</label>
        ))}
      </fieldset>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label>sample fps <input type="number" value={fps} min={5} max={30} onChange={(e) => setFps(Number(e.target.value))} style={{ width: 56 }} /></label>
        <label>seconds <input type="number" value={seconds} min={1} max={30} onChange={(e) => setSeconds(Number(e.target.value))} style={{ width: 56 }} /></label>
        <label>start at (s) <input type="number" value={startAt} min={0} step={0.5} onChange={(e) => setStartAt(Number(e.target.value))} style={{ width: 64 }} /></label>
        <label>RTMPose threads (0 = auto) <input type="number" value={threads} min={0} max={8} onChange={(e) => setThreads(Number(e.target.value))} style={{ width: 48 }} /></label>
        <label>re-detect person every N frames (0 = only when lost) <input type="number" value={detEvery} min={0} onChange={(e) => setDetEvery(Number(e.target.value))} style={{ width: 56 }} /></label>
      </div>
      <div style={{ margin: '10px 0', display: 'flex', gap: 8 }}>
        <button disabled={!url || busy} onClick={() => void run()} style={{ padding: '10px 16px', fontSize: 16 }}>{busy ? 'Running…' : 'Run comparison'}</button>
        <label style={{ alignSelf: 'center' }}>live seconds <input type="number" value={liveSeconds} min={3} max={20} onChange={(e) => setLiveSeconds(Number(e.target.value))} style={{ width: 48 }} /></label>
        <button disabled={!url || busy} onClick={() => void runLive()} style={{ padding: '10px 16px', fontSize: 16 }}>Run LIVE test (1×)</button>
        {busy && <button onClick={() => { cancelRef.current = true; }} style={{ padding: '10px 16px', fontSize: 16 }}>Stop</button>}
        {report && <><button onClick={copy} style={{ padding: '10px 16px', fontSize: 16 }}>Copy result</button><button onClick={download} style={{ padding: '10px 16px', fontSize: 16 }}>Download</button></>}
      </div>
      <pre style={{ background: '#111', color: '#9f9', padding: 8, fontSize: 12, maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{log.join('\n') || 'log'}</pre>
      {liveResults.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 10 }}>
          <b>LIVE (real time, 1×)</b>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
            <thead><tr>{['engine', 'det/s', 'age p50', 'p95', 'max', 'at draw p50', 'p95', 'main dropped', 'frame gap p50/max', 'gaps>50ms', 'found %', 'jumps', 'swaps'].map((h) => <th key={h} style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'left' }}>{h}</th>)}</tr></thead>
            <tbody>{liveResults.map((r) => (
              <tr key={r.id}>{[r.id + (r.error ? ' ⚠' : ''), fmt(r.detPerSec), fmt(r.ageMs[0], 0), fmt(r.ageMs[1], 0), fmt(r.ageMs[2], 0), fmt(r.ageAtDrawMs[0], 0), fmt(r.ageAtDrawMs[1], 0), r.mainDropped, `${fmt(r.mainFrameGapMs[0], 0)}/${fmt(r.mainFrameGapMs[1], 0)}`, String(r.jankOver50), String(r.detectedPct), String(r.jumps), String(r.swaps)].map((c, i) => <td key={i} style={{ border: '1px solid #ccc', padding: '2px 6px' }}>{c}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {results.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
            <thead><tr>{['engine', 'init s', 'ms p50', 'ms p95', 'fps*', 'found %', 'jumps', 'swaps', 'arm↔leg', 'dropped', 'wrist bh/s', 'err vs ref', 'PCK@.1', 'wrist ratio'].map((h) => <th key={h} style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} style={{ background: r.id === REFERENCE_ENGINE ? '#eef' : undefined }}>
                  {[r.id + (r.error ? ' ⚠' : ''), fmt(r.initMs / 1000), fmt(r.summary.msP50), fmt(r.summary.msP95), fmt(r.summary.fpsSustained, 0), String(r.summary.detectedPct), String(r.summary.track.jumps), String(r.summary.track.swaps), String(r.summary.crossLimb.armToLeg + r.summary.crossLimb.legToArm), String(r.summary.validation.droppedFrames), fmt(r.summary.peakWristBhPerS, 1), fmt(r.vsRef?.meanErrBh, 3), fmt(r.vsRef?.pck10, 2), fmt(r.vsRef?.wristSpeedRatio, 2)].map((c, i) => <td key={i} style={{ border: '1px solid #ccc', padding: '2px 6px' }}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: '#555', fontSize: 12 }}>*fps = 1000 / mean ms, sequential, nothing else running. err/PCK/ratio are vs the reference engine (pseudo-truth). jumps/swaps/arm↔leg/dropped need no reference (lower is better).</p>
          <div style={{ margin: '8px 0' }}>
            <select value={viewEngine} onChange={(e) => { setViewEngine(e.target.value); void draw(e.target.value, viewIdx); }}>{results.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}</select>{' '}
            <input type="range" min={0} max={Math.max(0, (results[0]?.frames.length ?? 1) - 1)} value={viewIdx} onChange={(e) => { const i = Number(e.target.value); setViewIdx(i); void draw(viewEngine, i); }} style={{ width: '60%' }} /> frame {viewIdx}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
