'use client';
/**
 * The mask editor's Object tool (SAM-2 point prompts) on a phone: run the model in a worker that is terminated when the editor closes.
 * Measured on a real iPhone: Auto-detect with the racket passes survived once the models ran in workers, but the Object tool then loaded SAM-2
 * IN the page (+~550 MB for the encode, never returned) on top of the editor and was killed ("Last step: editor open, first layers drawn").
 *
 * Same message API as the in-page module, so FrameMaskEditor only picks a path. Any worker failure marks the worker unusable for this page and the
 * caller falls back to the in-page SAM, exactly as before. Off phones (racketWorkerEnabled() false) this is never used.
 */
import { RacketWorkerUnavailable, createRacketWorker, racketWorkerEnabled, type RacketWorkerHandle } from '@/lib/stroMotionDraft/racketWorkerClient';
import type { SamDecodeResult, SamPoint } from '@/lib/stroMotionDraft/samRacket';

let worker: RacketWorkerHandle | null = null;
let unusable = false;
const encoded = new Set<string>();

/** Should the editor use the worker right now? */
export function editorSamViaWorker(): boolean {
  return racketWorkerEnabled() && !unusable;
}

function ensure(): RacketWorkerHandle {
  if (!worker) worker = createRacketWorker();
  return worker;
}

export function isFrameEncodedViaWorker(key: string): boolean {
  return encoded.has(key);
}

/** Encode one frame in the worker. Returns null if SAM is unavailable; throws RacketWorkerUnavailable if the worker itself failed (caller falls back). */
export async function encodeViaWorker(key: string, frame: ImageBitmap | HTMLCanvasElement): Promise<{ ms: number; bytes: number } | null> {
  try {
    const r = await ensure().encode({ frame, key });
    if (r) encoded.add(key);
    return r;
  } catch (e) {
    if (e instanceof RacketWorkerUnavailable) { unusable = true; releaseEditorSamWorker(); }
    throw e;
  }
}

export async function decodeViaWorker(key: string, points: SamPoint[], force?: number | null): Promise<SamDecodeResult | null> {
  try {
    return await ensure().decodePoints({ key, points, force });
  } catch (e) {
    if (e instanceof RacketWorkerUnavailable) { unusable = true; releaseEditorSamWorker(); }
    throw e;
  }
}

/** Terminate the worker (editor closed): everything SAM held is returned to the phone. Embeddings are gone, so the next Object use re-encodes. */
export function releaseEditorSamWorker(): void {
  if (worker) { try { worker.terminate(); } catch { /* already gone */ } }
  worker = null;
  encoded.clear();
}
