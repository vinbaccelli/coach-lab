'use client';

/**
 * DEV-ONLY REFERENCE HARNESS — MediaPipe Pose, drawn the way MediaPipe itself
 * draws it, next to the way THIS APP draws it.
 *
 * Purpose: the app's foot lines diverged from a known-good "clean MediaPipe"
 * implementation, and patching individual stages kept missing. This renders the
 * NATIVE baseline with no app code in the path at all:
 *
 *   PoseLandmarker.detect() → raw 33 normalized landmarks
 *   → DrawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS)
 *
 * No COCO-17 down-conversion, no re-append, no bake, no interpolation, no
 * estimate. Exactly the reference pipeline from MediaPipe's own web example.
 *
 * The right panel runs the APP's path (lib/mediapipePose.landmarksToKeypoints →
 * COCO-17 + appended feet) over the SAME frame, and the readout underneath is a
 * numeric diff of the foot coordinates between the two.
 *
 * Route lives under /dev/, which middleware.ts leaves ungated in development and
 * auth-gates in production. Nothing here is imported by the app.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { detectFullPoseOnFrame } from '@/lib/mediapipePose';

const WASM_DIR = '/mediapipe-wasm';
const MODEL = '/models/pose_landmarker_full.task';

/** BlazePose 33-landmark names, in index order. */
const LM = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye',
  'right_eye_outer', 'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
  'left_pinky', 'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index',
];

type Row = { label: string; native: string; app: string; delta: string };

export default function MediaPipeReferencePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const nativeCanvas = useRef<HTMLCanvasElement | null>(null);
  const appCanvas = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState('idle');
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [time, setTime] = useState(1.0);

  const landmarkerRef = useRef<unknown>(null);
  const tvRef = useRef<typeof import('@mediapipe/tasks-vision') | null>(null);

  const ensure = useCallback(async () => {
    if (landmarkerRef.current) return;
    setStatus('loading PoseLandmarker…');
    const tv = await import('@mediapipe/tasks-vision');
    tvRef.current = tv;
    const fileset = await tv.FilesetResolver.forVisionTasks(WASM_DIR);
    landmarkerRef.current = await tv.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
      runningMode: 'IMAGE',
      numPoses: 1,
    });
    setStatus('ready');
  }, []);

  const run = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    await ensure();
    const tv = tvRef.current!;
    const lm = landmarkerRef.current as import('@mediapipe/tasks-vision').PoseLandmarker;

    await new Promise<void>((res) => {
      if (Math.abs(v.currentTime - time) < 0.001) { res(); return; }
      const on = () => { v.removeEventListener('seeked', on); res(); };
      v.addEventListener('seeked', on);
      v.currentTime = time;
    });

    const vw = v.videoWidth, vh = v.videoHeight;
    setStatus(`detecting @${v.currentTime.toFixed(3)}s (${vw}x${vh})…`);

    // ── REFERENCE: raw landmarks + native connections ────────────────────
    const res = lm.detect(v);
    const pts = res?.landmarks?.[0];
    if (!pts) { setStatus('no pose'); return; }

    for (const c of [nativeCanvas.current, appCanvas.current]) {
      if (!c) continue;
      c.width = vw; c.height = vh;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(v, 0, 0, vw, vh);
    }

    const nctx = nativeCanvas.current!.getContext('2d')!;
    const du = new tv.DrawingUtils(nctx);
    // THE reference call — MediaPipe's own connections, its own drawing utils.
    du.drawConnectors(pts, tv.PoseLandmarker.POSE_CONNECTIONS, { color: '#00FF88', lineWidth: 3 });
    du.drawLandmarks(pts, { color: '#FF3B30', radius: 2 });

    // ── APP PATH: same frame through lib/mediapipePose ───────────────────
    const appKps = await detectFullPoseOnFrame(v);
    const actx = appCanvas.current!.getContext('2d')!;
    if (appKps) {
      // Draw the app's COCO-17 bones + its foot line, same style, so the two
      // panels differ only in what the PIPELINE produced.
      const BONES: Array<[number, number]> = [
        [5, 7], [7, 9], [6, 8], [8, 10], [11, 13], [13, 15], [12, 14], [14, 16], [5, 6], [11, 12],
      ];
      actx.strokeStyle = '#00FF88'; actx.lineWidth = 3;
      for (const [a, b] of BONES) {
        const ka = appKps[a], kb = appKps[b];
        if (!ka || !kb || ka.score < 0.2 || kb.score < 0.2) continue;
        actx.beginPath(); actx.moveTo(ka.x, ka.y); actx.lineTo(kb.x, kb.y); actx.stroke();
      }
      // Mirrors Canvas.drawSkeletonOverlay's foot block exactly: native closed
      // triangle, ending ON the landmarks, no overshoot, no estimate.
      const named = (n: string) => appKps.find((k) => k.name === n && k.score >= 0.1) ?? null;
      actx.strokeStyle = '#FFD700'; actx.lineWidth = 3;
      for (const [ankleI, heelN, toeN] of [[15, 'left_heel', 'left_foot_index'], [16, 'right_heel', 'right_foot_index']] as Array<[number, string, string]>) {
        const ankle = appKps[ankleI]; const heel = named(heelN); const toe = named(toeN);
        if (!ankle || ankle.score < 0.2 || (!toe && !heel)) continue;
        actx.beginPath();
        if (heel && toe) {
          actx.moveTo(ankle.x, ankle.y);
          actx.lineTo(heel.x, heel.y);
          actx.lineTo(toe.x, toe.y);
          actx.closePath();
        } else if (toe) { actx.moveTo(ankle.x, ankle.y); actx.lineTo(toe.x, toe.y); }
        else { actx.moveTo(ankle.x, ankle.y); actx.lineTo(heel!.x, heel!.y); }
        actx.stroke();
      }
      actx.fillStyle = '#FF3B30';
      for (const k of appKps) { if (k.score >= 0.2) { actx.beginPath(); actx.arc(k.x, k.y, 3, 0, 7); actx.fill(); } }
    }

    // ── NUMERIC DIFF on the foot landmarks ───────────────────────────────
    const out: Row[] = [];
    const mkRow = (mpIdx: number, appName: string) => {
      const p = pts[mpIdx];
      const nx = (p?.x ?? 0) * vw, ny = (p?.y ?? 0) * vh;
      const a = appKps?.find((k) => k.name === appName) ?? null;
      out.push({
        label: `${mpIdx} ${LM[mpIdx]}`,
        native: `${nx.toFixed(1)}, ${ny.toFixed(1)}  vis=${(p as { visibility?: number })?.visibility?.toFixed(2) ?? '—'}`,
        app: a ? `${a.x.toFixed(1)}, ${a.y.toFixed(1)}  s=${a.score.toFixed(2)}` : 'ABSENT',
        delta: a ? `${Math.hypot(a.x - nx, a.y - ny).toFixed(3)} px` : '—',
      });
    };
    mkRow(27, 'left_ankle'); mkRow(28, 'right_ankle');
    mkRow(29, 'left_heel'); mkRow(30, 'right_heel');
    mkRow(31, 'left_foot_index'); mkRow(32, 'right_foot_index');
    setRows(out);

    // Structural notes — what the reference has that the app path does not.
    const n: string[] = [];
    const conn = tv.PoseLandmarker.POSE_CONNECTIONS.map((c) => `${c.start}-${c.end}`);
    const footConn = conn.filter((s) => { const [a, b] = s.split('-').map(Number); return a >= 27 || b >= 27; });
    n.push(`native POSE_CONNECTIONS: ${conn.length} total; foot region: ${footConn.join(', ')}`);
    n.push(`native landmarks delivered: ${pts.length} (app keeps ${appKps?.length ?? 0})`);
    const dropped = LM.filter((_, i) => ![0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].includes(i));
    n.push(`landmarks the app discards entirely: ${dropped.join(', ')}`);
    const vis = (i: number) => (pts[i] as { visibility?: number })?.visibility ?? 0;
    n.push(`foot visibility — L heel ${vis(29).toFixed(2)}, R heel ${vis(30).toFixed(2)}, L toe ${vis(31).toFixed(2)}, R toe ${vis(32).toFixed(2)} (app append gate is 0.3)`);
    setNotes(n);
    setStatus(`done @${v.currentTime.toFixed(3)}s`);
  }, [ensure, time]);

  useEffect(() => { void ensure(); }, [ensure]);

  return (
    <div style={{ padding: 16, font: '13px ui-monospace, monospace', color: '#eee', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ font: 'bold 16px ui-monospace', marginBottom: 8 }}>
        MediaPipe Pose — native reference vs app pipeline
      </h1>
      <p style={{ opacity: 0.75, marginBottom: 12, maxWidth: 900 }}>
        LEFT = MediaPipe’s own rendering: raw 33 landmarks + <code>PoseLandmarker.POSE_CONNECTIONS</code> via{' '}
        <code>DrawingUtils</code>. No COCO conversion, no bake, no estimate.{' '}
        RIGHT = this app’s path: <code>landmarksToKeypoints</code> → COCO-17 + appended feet → the app’s foot line.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label>t = </label>
        <input type="number" step="0.05" value={time} onChange={(e) => setTime(Number(e.target.value))}
          style={{ width: 90, background: '#222', color: '#eee', border: '1px solid #555', padding: '4px 6px' }} />
        <button onClick={() => void run()}
          style={{ background: '#0a84ff', color: '#fff', border: 0, borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}>
          Detect &amp; compare
        </button>
        <span style={{ opacity: 0.8 }} id="status">{status}</span>
      </div>

      <video ref={videoRef} src="/demo.mp4" muted playsInline preload="auto" style={{ display: 'none' }} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <figure style={{ margin: 0 }}>
          <figcaption style={{ color: '#00FF88', marginBottom: 4 }}>NATIVE (MediaPipe reference)</figcaption>
          <canvas ref={nativeCanvas} style={{ width: 300, border: '1px solid #444' }} />
        </figure>
        <figure style={{ margin: 0 }}>
          <figcaption style={{ color: '#FFD700', marginBottom: 4 }}>APP PIPELINE</figcaption>
          <canvas ref={appCanvas} style={{ width: 300, border: '1px solid #444' }} />
        </figure>
      </div>

      <h2 style={{ font: 'bold 14px ui-monospace', margin: '16px 0 6px' }}>Foot-landmark coordinate diff</h2>
      <table id="diff" cellPadding={5} style={{ borderCollapse: 'collapse', background: '#181818' }}>
        <thead><tr style={{ color: '#888' }}>
          <th align="left">landmark</th><th align="left">native (x,y px)</th><th align="left">app (x,y px)</th><th align="left">Δ</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} style={{ borderTop: '1px solid #333' }}>
              <td>{r.label}</td><td>{r.native}</td>
              <td style={{ color: r.app === 'ABSENT' ? '#FF3B30' : '#eee' }}>{r.app}</td>
              <td style={{ color: r.delta === '0.000 px' ? '#00FF88' : '#FFD700' }}>{r.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ font: 'bold 14px ui-monospace', margin: '16px 0 6px' }}>Structural divergence</h2>
      <ul id="notes" style={{ lineHeight: 1.7, maxWidth: 1000 }}>
        {notes.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}
