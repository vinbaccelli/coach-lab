'use client';
/**
 * The mask editor's Object tool (SAM-2 point prompts) on a phone: run the model in a worker that is terminated when the editor closes.
 * Measured on a real iPhone: Auto-detect with the racket passes survived once the models ran in workers, but the Object tool then loaded SAM-2
 * IN the page (+~550 MB for the encode, never returned) on top of the editor and was killed ("Last step: editor open, first layers drawn").
 *
 * Same message API as the in-page module, so FrameMaskEditor only picks a path. Any worker failure marks the worker unusable for this page and the
 * caller falls back to the in-page SAM, exactly as before. Off phones (racketWorkerEnabled() false) this is never used.
 */
import { RacketWorkerUnavailable, createRacketWorker, getLastWorkerEncodeError, racketWorkerEnabled, type RacketWorkerHandle } from '@/lib/stroMotionDraft/racketWorkerClient';
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** After a worker is terminated the phone needs a moment to take its memory back; a new SAM load started at once failed with "[wasm] RangeError: Out of memory" (real iPhone). */
const SETTLE_MS = 4000; // was 1500: still "Out of memory" on the second use after Generate (real iPhone 14 Pro, 2026-11-22)
const LOAD_RETRIES = 4;
let releasedAt = 0;

/** Encode one frame in the worker. Returns null if SAM is unavailable; throws RacketWorkerUnavailable if the worker itself failed (caller falls back).
 * A failed load leaves a half-grown worker behind, so on failure it is terminated; an out-of-memory failure is retried with a fresh worker after a pause. */
export async function encodeViaWorker(key: string, frame: ImageBitmap | HTMLCanvasElement): Promise<{ ms: number; bytes: number } | null> {
  for (let attempt = 1; ; attempt++) {
    const wait = releasedAt + SETTLE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const r = await ensure().encode({ frame, key });
      if (r) { encoded.add(key); return r; }
      const oom = /memory/i.test(getLastWorkerEncodeError());
      releaseEditorSamWorker(); // never keep the worker that failed to load
      if (!oom || attempt >= LOAD_RETRIES) return null;
      await sleep(SETTLE_MS);
    } catch (e) {
      if (e instanceof RacketWorkerUnavailable) { unusable = true; releaseEditorSamWorker(); }
      throw e;
    }
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

/** Terminate the worker (editor closed, Object tool left, or a racket was added to the mask). Returns whether a worker was running.
 * Measured (desktop, phone limits): the worker holds ~+850 MB while it exists and gives it all back when terminated. */
// (previously: Terminate the worker (editor closed): everything SAM held is returned to the phone. Embeddings are gone, so the next Object use re-encodes. */
export function releaseEditorSamWorker(): boolean {
  const had = worker !== null;
  if (had) releasedAt = Date.now();
  if (worker) { try { worker.terminate(); } catch { /* already gone */ } }
  worker = null;
  encoded.clear();
  return had;
}

/**
 * The frame editor is remounted for every frame (key={frame.index}), and its unmount used to release the worker, so
 * moving to the next frame reloaded the whole model. Leaving the editor now releases it after a short grace period, and the next
 * frame's editor mounting cancels that. Closing the editor for real (nothing mounts) still frees the memory, a moment later.
 */
export const EDITOR_LEAVE_GRACE_MS = 2500;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
export function cancelScheduledEditorRelease(): void {
  if (leaveTimer !== null) { clearTimeout(leaveTimer); leaveTimer = null; }
}
export function releaseEditorSamWorkerOnLeave(): void {
  cancelScheduledEditorRelease();
  if (!keepSamAfterAdd()) { releaseEditorSamWorker(); return; }
  leaveTimer = setTimeout(() => { leaveTimer = null; releaseEditorSamWorker(); }, EDITOR_LEAVE_GRACE_MS);
}

/**
 * Keep the Object tool's model loaded after "Add to mask" (default), so the next frame or the next click does not wait for a reload.
 * The model's memory is the same whichever frame it works on, so reloading per frame bought nothing. It was released there because a real
 * iPhone was killed once at exactly that step; if that happens again (the restart notice names the step "Object select: adding the
 * object"), this turns itself off on that phone and the old release-after-every-add behaviour returns.
 */
export const KEEP_SAM_AFTER_ADD_KEY = 'anglemotion:samKeepAfterAdd';
export const ADD_OBJECT_STAGE = 'Object select: adding the object to the mask';
export function keepSamAfterAdd(): boolean {
  try { return window.localStorage.getItem(KEEP_SAM_AFTER_ADD_KEY) !== '0'; } catch { return true; }
}
export function stopKeepingSamAfterAdd(): void {
  try { window.localStorage.setItem(KEEP_SAM_AFTER_ADD_KEY, '0'); } catch { /* storage blocked */ }
}
