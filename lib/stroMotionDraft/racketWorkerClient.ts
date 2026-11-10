'use client';
/**
 * Page side of racketWorker.ts: spawn a worker for one phase, call it, terminate it.
 * A failure to create or initialise the worker throws RacketWorkerUnavailable so the caller can fall back to the in-page path.
 */
import { isPhoneBudgetActive } from '@/lib/stroMotionDraft/phoneBudget';
import type { RacketDetection } from '@/lib/stroMotionDraft/racketDetect';
import type { SamCandidate, SamDecodeResult, SamPoint, SamPromptBox } from '@/lib/stroMotionDraft/samRacket';
import type { AlphaMask } from '@/lib/stroMotionDraft/types';

/**
 * Worker on or off. DEFAULT: on for phones (where the page is killed by memory), off elsewhere (desktop behaviour unchanged).
 * Override: localStorage 'racketWorker' = '1' (force on) / '0' (force off), or window.__racketWorker = true | false.
 */
export function racketWorkerEnabled(): boolean {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.__racketWorker === 'boolean') return w.__racketWorker;
  let stored: string | null = null;
  try { stored = window.localStorage.getItem('racketWorker'); } catch { /* storage blocked */ }
  if (stored === '1') return true;
  if (stored === '0') return false;
  return isPhoneBudgetActive();
}

export class RacketWorkerUnavailable extends Error {}

export interface WorkerSegmentResult {
  mask: AlphaMask;
  chosen: number;
  candidates: SamCandidate[];
}

export interface RacketWorkerHandle {
  detect(args: { frame: ImageBitmap | HTMLCanvasElement; keypoints: unknown; vw: number; vh: number; unitFloorNorm: number | null; label: string }): Promise<RacketDetection | null>;
  /** Resolves with `seg: null` and a reason when SAM could not produce a mask (never throws for "no mask"). */
  segment(args: { frame: ImageBitmap | HTMLCanvasElement; key: string; box: SamPromptBox }): Promise<{ seg: WorkerSegmentResult | null; reason: string }>;
  /** Mask-editor Object tool: encode a frame once; the embedding stays in this worker for decodePoints(). */
  encode(args: { frame: ImageBitmap | HTMLCanvasElement; key: string }): Promise<{ ms: number; bytes: number } | null>;
  decodePoints(args: { key: string; points: SamPoint[]; force?: number | null }): Promise<SamDecodeResult | null>;
  terminate(): void;
}

/** Why the last worker encode returned nothing (the worker's SAM load error). */
let lastEncodeError = '';
export function getLastWorkerEncodeError(): string { return lastEncodeError; }

const CALL_TIMEOUT_MS = 300_000; // SAM-2 on a phone: model load plus a multi-second wasm encode

export function createRacketWorker(): RacketWorkerHandle {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./racketWorker.ts', import.meta.url));
  } catch (e) {
    throw new RacketWorkerUnavailable(`could not start the racket worker: ${e instanceof Error ? e.message : String(e)}`);
  }

  let nextId = 1;
  let dead = false;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  const failAll = (err: Error) => {
    dead = true;
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
  };

  worker.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { type?: string; level?: 'log' | 'warn'; text?: string; id?: number; ok?: boolean; error?: string };
    if (m.type === 'log') { (m.level === 'warn' ? console.warn : console.log)(m.text); return; }
    if (typeof m.id !== 'number') return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m); else p.reject(new Error(m.error ?? 'racket worker error'));
  };
  worker.onerror = (ev) => failAll(new RacketWorkerUnavailable(`racket worker crashed: ${ev.message || 'unknown error'}`));

  const call = (msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<any> => {
    if (dead) return Promise.reject(new RacketWorkerUnavailable('racket worker is not running'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`racket worker call timed out after ${CALL_TIMEOUT_MS / 1000}s`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ ...msg, id }, transfer); } catch (e) { pending.delete(id); clearTimeout(timer); reject(e as Error); }
    });
  };

  const ready = call({ type: 'init', phone: isPhoneBudgetActive() }).catch((e) => {
    throw e instanceof RacketWorkerUnavailable ? e : new RacketWorkerUnavailable(`racket worker did not start: ${(e as Error).message}`);
  });

  ready.catch(() => { /* surfaced by the first detect()/segment(); this only silences an unused-rejection warning */ });

  /** The worker gets its OWN copy of the frame (transferred and closed there); the caller's bitmap stays usable. */
  const copyFrame = (frame: ImageBitmap | HTMLCanvasElement) => createImageBitmap(frame);

  return {
    async detect(a) {
      await ready;
      const bm = await copyFrame(a.frame);
      const r = await call({ type: 'detect', frame: bm, keypoints: a.keypoints ?? null, vw: a.vw, vh: a.vh, unitFloorNorm: a.unitFloorNorm, label: a.label }, [bm]);
      return (r.hit ?? null) as RacketDetection | null;
    },
    async segment(a) {
      await ready;
      const bm = await copyFrame(a.frame);
      const r = await call({ type: 'segment', frame: bm, key: a.key, box: a.box }, [bm]);
      return { seg: (r.seg ?? null) as WorkerSegmentResult | null, reason: (r.reason as string | undefined) ?? '' };
    },
    async encode(a) {
      await ready;
      const bm = await copyFrame(a.frame);
      const r = await call({ type: 'encode', frame: bm, key: a.key }, [bm]);
      lastEncodeError = (r.err as string | undefined) ?? '';
      return (r.enc ?? null) as { ms: number; bytes: number } | null;
    },
    async decodePoints(a) {
      await ready;
      const r = await call({ type: 'decodePoints', key: a.key, points: a.points, force: a.force ?? null });
      return (r.seg ?? null) as SamDecodeResult | null;
    },
    terminate() {
      if (!dead) failAll(new RacketWorkerUnavailable('racket worker terminated'));
      try { worker.terminate(); } catch { /* already gone */ }
    },
  };
}
