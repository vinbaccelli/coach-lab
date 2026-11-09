/// <reference lib="webworker" />
/**
 * Runs the racket models (D-FINE detector, SAM-2 segmenter) OFF the page, so `terminate()` returns ALL of their memory.
 *
 * WHY: on an iPhone the page is killed by memory during the racket pass. Measured (desktop, phone limits): releasing the ONNX
 * session inside the page gives back almost nothing (the wasm heap only grows), so D-FINE's ~250 MB stayed resident under SAM-2's
 * ~600 MB encode and each frame left ~50-80 MB behind. A terminated worker frees its whole heap.
 *
 * One worker per phase: kind 'detect' loads only D-FINE, kind 'sam' loads only SAM-2. The same model modules the page uses run here
 * unchanged (they were made worker-safe in frameCanvas.ts); this file only adds the message plumbing.
 *
 * Only the Auto-detect pass uses this, and only on phones (racketWorkerClient.ts decides). The manual Object tool in the mask editor
 * still uses the in-page SAM module.
 */
import type { SamPromptBox } from '@/lib/stroMotionDraft/samRacket';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Relay log lines so the page console (and the ?debug=1 panel's consumers) keep seeing "[autoRacket] …" / "[samRacket] …".
for (const level of ['log', 'warn'] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    orig(...args);
    try { ctx.postMessage({ type: 'log', level, text: args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ') }); } catch { /* ignore */ }
  };
}

type DetectMsg = { type: 'detect'; id: number; frame: ImageBitmap; keypoints: unknown; vw: number; vh: number; unitFloorNorm: number | null; label: string };
type SegmentMsg = { type: 'segment'; id: number; frame: ImageBitmap; key: string; box: SamPromptBox };
type InitMsg = { type: 'init'; id: number; phone: boolean };
type Msg = DetectMsg | SegmentMsg | InitMsg;

ctx.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      (globalThis as { __stroPhoneBudget?: boolean }).__stroPhoneBudget = m.phone;
      ctx.postMessage({ id: m.id, ok: true });
      return;
    }
    if (m.type === 'detect') {
      const mod = await import('@/lib/stroMotionDraft/racketDetect');
      let hit = null;
      try {
        hit = await mod.detectRacketBox({
          frame: m.frame,
          keypoints: m.keypoints as never,
          vw: m.vw,
          vh: m.vh,
          unitFloorNorm: m.unitFloorNorm,
          label: m.label,
        });
      } finally {
        try { m.frame.close(); } catch { /* already closed */ }
      }
      ctx.postMessage({ id: m.id, ok: true, hit });
      return;
    }
    if (m.type === 'segment') {
      const sam = await import('@/lib/stroMotionDraft/samRacket');
      let reply: Record<string, unknown> = { id: m.id, ok: true, seg: null, reason: 'SAM unavailable on this machine' };
      let transfer: Transferable[] = [];
      try {
        const enc = await sam.encodeFrameForRacket(m.key, m.frame);
        if (enc) {
          const seg = await sam.decodeRacketMaskFromBox(m.key, m.box);
          if (seg) {
            reply = { id: m.id, ok: true, seg: { mask: seg.mask, chosen: seg.chosen, candidates: seg.candidates } };
            transfer = [seg.mask.data.buffer];
          } else {
            reply = { id: m.id, ok: true, seg: null, reason: 'SAM returned nothing plausible for the detected box' };
          }
        }
      } finally {
        try { m.frame.close(); } catch { /* already closed */ }
        try { sam.dropRacketEncoding(m.key); } catch { /* best-effort */ }
      }
      ctx.postMessage(reply, transfer);
      return;
    }
  } catch (err) {
    ctx.postMessage({ id: (m as { id: number }).id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};
