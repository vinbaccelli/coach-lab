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

// Next's client build replaces `typeof window` with the constant "object" (even in a worker bundle), so the model modules' own
// `typeof window !== 'undefined'` guards pass here and then read `window.…`, which does not exist in a worker (found: "window is not
// defined" at racketDetect.ts). Point `window` at the worker global BEFORE those modules are imported (they are dynamic imports below).
// `window.localStorage` / `matchMedia` stay undefined; the model code only touches them inside try/catch or optional chaining.
(globalThis as { window?: unknown }).window = globalThis;

// Relay log lines so the page console (and the ?debug=1 panel's consumers) keep seeing "[autoRacket] …" / "[samRacket] …".
for (const level of ['log', 'warn'] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    orig(...args);
    try { ctx.postMessage({ type: 'log', level, text: args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? String(a)).slice(0, 1200) : String(a))).join(' ') }); } catch { /* ignore */ }
  };
}

type DetectMsg = { type: 'detect'; id: number; frame: ImageBitmap; keypoints: unknown; vw: number; vh: number; unitFloorNorm: number | null; label: string };
type SegmentMsg = { type: 'segment'; id: number; frame: ImageBitmap; key: string; box: SamPromptBox };
type InitMsg = { type: 'init'; id: number; phone: boolean; mobileSam?: boolean };
// Mask-editor Object tool: encode once (embedding stays cached in THIS worker), then decode per click.
type EncodeMsg = { type: 'encode'; id: number; frame: ImageBitmap; key: string };
type DecodePointsMsg = { type: 'decodePoints'; id: number; key: string; points: unknown; force: number | null };
type Msg = DetectMsg | SegmentMsg | InitMsg | EncodeMsg | DecodePointsMsg;

let useMobileSam = false;
/** Which backend encoded each frame ('mobile' = MobileSAM, 'sam2' = SAM-2). Decodes must use the module that encoded. */
const backendOf = new Map<string, 'mobile' | 'sam2'>();
/** MobileSAM failed to load or run in this worker: every later frame goes straight to SAM-2. */
let mobileFailed = false;
type SamModule = Pick<typeof import('@/lib/stroMotionDraft/samRacket'), 'encodeFrameForRacket' | 'decodeRacketMask' | 'decodeRacketMaskFromBox' | 'dropRacketEncoding' | 'getLastSamError'>;
const loadSam2 = (): Promise<SamModule> => import('@/lib/stroMotionDraft/samRacket');
const loadMobile = (): Promise<SamModule> => import('@/lib/stroMotionDraft/samMobile');

/**
 * Encode a frame with MobileSAM, falling back to SAM-2 if MobileSAM cannot load or run (missing file, offline, an unsupported device).
 * The caller learns which backend holds the embedding (the editor keeps the light model resident, never the heavy one).
 */
async function encodeWithFallback(key: string, frame: ImageBitmap): Promise<{ enc: { ms: number; bytes: number } | null; err: string; backend: 'mobile' | 'sam2' }> {
  if (useMobileSam && !mobileFailed) {
    const mob = await loadMobile();
    const enc = await mob.encodeFrameForRacket(key, frame);
    if (enc) { backendOf.set(key, 'mobile'); return { enc, err: '', backend: 'mobile' }; }
    mobileFailed = true;
    console.warn('[samMobile] unavailable — falling back to SAM-2:', mob.getLastSamError());
  }
  const sam = await loadSam2();
  const enc = await sam.encodeFrameForRacket(key, frame);
  if (enc) backendOf.set(key, 'sam2');
  return { enc, err: enc ? '' : sam.getLastSamError(), backend: 'sam2' };
}
const samFor = (key: string): Promise<SamModule> => (backendOf.get(key) === 'mobile' ? loadMobile() : loadSam2());

ctx.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      (globalThis as { __stroPhoneBudget?: boolean }).__stroPhoneBudget = m.phone; // read through the window shim by isPhoneBudgetActive()
      useMobileSam = m.mobileSam === true; // OFF unless the page's switch is on (lib/stroMotionDraft/mobileSamSwitch.ts)
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
    if (m.type === 'encode') {
      let r: Awaited<ReturnType<typeof encodeWithFallback>> = { enc: null, err: 'encode failed', backend: 'sam2' };
      try {
        r = await encodeWithFallback(m.key, m.frame);
      } finally {
        try { m.frame.close(); } catch { /* already closed */ }
      }
      ctx.postMessage({ id: m.id, ok: true, enc: r.enc, err: r.err, backend: r.backend });
      return;
    }
    if (m.type === 'decodePoints') {
      const sam = await samFor(m.key);
      const seg = await sam.decodeRacketMask(m.key, m.points as never, m.force ?? undefined);
      ctx.postMessage({ id: m.id, ok: true, seg }, seg ? [seg.mask.data.buffer] : []);
      return;
    }
    if (m.type === 'segment') {
      let reply: Record<string, unknown> = { id: m.id, ok: true, seg: null, reason: 'SAM unavailable on this machine' };
      let transfer: Transferable[] = [];
      let sam: SamModule | null = null;
      try {
        const r = await encodeWithFallback(m.key, m.frame);
        if (r.enc) {
          sam = await samFor(m.key);
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
        try { sam?.dropRacketEncoding(m.key); backendOf.delete(m.key); } catch { /* best-effort */ }
      }
      ctx.postMessage(reply, transfer);
      return;
    }
  } catch (err) {
    ctx.postMessage({ id: (m as { id: number }).id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};
