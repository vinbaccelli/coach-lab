'use client';

/**
 * TEMPORARY spike page (not linked anywhere): can THIS phone shrink a high-resolution clip to 1080p
 * inside the page, fast enough, with its own video encoder (WebCodecs)? Nothing is uploaded or stored.
 * Pick a clip, tap Run, and send the result text back. Remove the page after the spike.
 */
import { useRef, useState } from 'react';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
function fit(w: number, h: number, longEdge: number) {
  const s = Math.min(1, longEdge / Math.max(w, h));
  return { w: even(w * s), h: even(h * s) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seekTo(v: HTMLVideoElement, t: number): Promise<number> {
  const t0 = performance.now();
  await new Promise<void>((res) => {
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
  return Math.round(performance.now() - t0);
}

export default function TranscodeCheckPage() {
  const [text, setText] = useState('Pick a video (a 4K phone clip is the interesting one), then tap Run.');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef('');

  const run = async (file: File) => {
    setBusy(true);
    const out: Record<string, unknown> = {};
    const show = () => { resultRef.current = JSON.stringify(out, null, 2); setText(resultRef.current); };
    const g = globalThis as Any;
    let url = '';
    try {
      out.userAgent = navigator.userAgent;
      out.cores = navigator.hardwareConcurrency;
      out.deviceMemoryGB = (navigator as Any).deviceMemory ?? 'n/a';
      out.api = {
        VideoDecoder: !!g.VideoDecoder,
        VideoEncoder: !!g.VideoEncoder,
        VideoFrame: !!g.VideoFrame,
        requestVideoFrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
      };
      show();

      url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('the video would not load')); });
      out.source = { width: v.videoWidth, height: v.videoHeight, seconds: Math.round(v.duration * 10) / 10, sizeMB: Math.round(file.size / 1e5) / 10 };
      const t = fit(v.videoWidth, v.videoHeight, 1920);
      out.target1080 = t;
      show();

      // 1. Which encoders does this phone offer at the target size?
      const support: Record<string, string> = {};
      if (g.VideoEncoder) {
        for (const codec of ['avc1.640028', 'avc1.4d0028', 'vp09.00.40.08', 'hev1.1.6.L120.B0']) {
          try {
            const r = await g.VideoEncoder.isConfigSupported({ codec, width: t.w, height: t.h, bitrate: 6_000_000, framerate: 30 });
            support[codec] = r.supported ? 'yes' : 'no';
          } catch { support[codec] = 'error'; }
        }
      }
      out.encoderSupport = support;
      show();

      // 2. How long do far-apart seeks take on this clip (what the analysis does)?
      const seeks: number[] = [];
      for (const f of [0.15, 0.55, 0.85, 0.3, 0.7]) seeks.push(await seekTo(v, v.duration * f));
      out.seekMs = seeks;
      show();

      // 3. Re-encode 3 seconds at 1080p: the section-only "shrink".
      const codec = ['avc1.640028', 'avc1.4d0028', 'vp09.00.40.08'].find((c) => support[c] === 'yes');
      if (!codec || !g.VideoFrame) {
        out.transcode = 'skipped: no usable encoder or VideoFrame on this device';
        show();
        return;
      }
      const t0 = Math.max(0, Math.min(1, v.duration / 2));
      await seekTo(v, t0);
      const canvas = document.createElement('canvas');
      canvas.width = t.w; canvas.height = t.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2D canvas');
      let bytes = 0, chunks = 0, frames = 0, maxQueue = 0, encErr = '';
      const enc = new g.VideoEncoder({
        output: (c: Any) => { bytes += c.byteLength; chunks++; },
        error: (e: Any) => { encErr = String(e); },
      });
      enc.configure({ codec, width: t.w, height: t.h, bitrate: 6_000_000, framerate: 30 });
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const tick = (_now: number, meta: Any) => {
          if (meta.mediaTime >= t0 + 3 || v.ended || encErr) { resolve(); return; }
          ctx.drawImage(v, 0, 0, t.w, t.h);
          const vf = new g.VideoFrame(canvas, { timestamp: Math.round((meta.mediaTime - t0) * 1e6) });
          enc.encode(vf, { keyFrame: frames % 60 === 0 });
          vf.close();
          frames++;
          maxQueue = Math.max(maxQueue, enc.encodeQueueSize);
          (v as Any).requestVideoFrameCallback(tick);
        };
        if (!('requestVideoFrameCallback' in v)) { encErr = 'requestVideoFrameCallback missing'; resolve(); return; }
        (v as Any).requestVideoFrameCallback(tick);
        void v.play();
      });
      v.pause();
      await enc.flush();
      enc.close();
      const wallMs = Math.round(performance.now() - start);
      out.transcode = {
        codecUsed: codec,
        framesIn: frames,
        chunksOut: chunks,
        outputKB: Math.round(bytes / 1024),
        wallMs,
        speedVsRealTime: Math.round((3000 / Math.max(1, wallMs)) * 100) / 100,
        maxEncodeQueue: maxQueue,
        error: encErr || null,
      };
      show();
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
      show();
    } finally {
      if (url) URL.revokeObjectURL(url);
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 640, margin: '0 auto', fontSize: 16 }}>
      <h1 style={{ fontSize: 20 }}>Shrink-to-1080p check (temporary)</h1>
      <p style={{ fontSize: 14, color: '#555' }}>Nothing is uploaded: the clip stays on this phone. Pick a clip, tap Run (about 20 seconds), then tap Copy and paste the text to Claude.</p>
      <input ref={fileRef} type="file" accept="video/*" disabled={busy} style={{ fontSize: 16, marginBottom: 12, display: 'block' }} />
      <button
        type="button"
        disabled={busy}
        onClick={() => { const f = fileRef.current?.files?.[0]; if (f) void run(f); else setText('Pick a video first.'); }}
        style={{ fontSize: 16, padding: '10px 18px', borderRadius: 10, border: 'none', background: '#007AFF', color: '#fff', fontWeight: 700, marginRight: 8 }}
      >
        {busy ? 'Running…' : 'Run'}
      </button>
      <button
        type="button"
        onClick={() => { void navigator.clipboard.writeText(resultRef.current || text).catch(() => {}); }}
        style={{ fontSize: 16, padding: '10px 18px', borderRadius: 10, border: '1px solid #ccc', background: '#fff' }}
      >
        Copy
      </button>
      <pre style={{ marginTop: 14, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f4f4f4', padding: 10, borderRadius: 8 }}>{text}</pre>
    </div>
  );
}
