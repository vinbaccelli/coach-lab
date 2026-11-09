'use client';
/**
 * IndexedDB layer for Motion Layer drafts (M4). Local to this browser only: no network, no paid storage.
 * Every call resolves — failures come back as `{ ok: false, reason }` so a full or evicted store can never break editing
 * (the in-memory draft stays authoritative; the caller shows a notice).
 */
import { fingerprintKey, hashBytes, type PersistedDraft, type VideoFingerprint, PERSIST_SCHEMA_VERSION } from '@/lib/stroMotionDraft/persist';

const DB_NAME = 'anglemotion-motion-layer';
const STORE = 'drafts';
const SAMPLE_BYTES = 64 * 1024;

export type StoreResult<T = void> = { ok: true; value: T } | { ok: false; reason: 'unavailable' | 'quota' | 'error'; message: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('open failed'));
    req.onblocked = () => reject(new Error('open blocked'));
  });
}

function fail(e: unknown): { ok: false; reason: 'unavailable' | 'quota' | 'error'; message: string } {
  const name = (e as { name?: string })?.name ?? '';
  const message = (e as { message?: string })?.message ?? String(e);
  if (name === 'QuotaExceededError') return { ok: false, reason: 'quota', message };
  if (/unavailable|blocked|SecurityError|InvalidState/i.test(`${name} ${message}`)) return { ok: false, reason: 'unavailable', message };
  return { ok: false, reason: 'error', message };
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<StoreResult<T>> {
  try {
    const db = await openDb();
    try {
      return await new Promise<StoreResult<T>>((resolve) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        let value: T;
        req.onsuccess = () => { value = req.result; };
        tx.oncomplete = () => resolve({ ok: true, value });
        tx.onerror = () => resolve(fail(tx.error));
        tx.onabort = () => resolve(fail(tx.error));
      });
    } finally { db.close(); }
  } catch (e) { return fail(e); }
}

/** One record per video. A put is a single transaction, so an interrupted write leaves the previous record intact. */
export const saveDraftRecord = (rec: PersistedDraft) => run<IDBValidKey>('readwrite', (s) => s.put(rec, fingerprintKey(rec.fingerprint)));
export const deleteDraftRecord = (fp: VideoFingerprint) => run<undefined>('readwrite', (s) => s.delete(fingerprintKey(fp)) as IDBRequest<undefined>);

export async function listDraftRecords(): Promise<StoreResult<PersistedDraft[]>> {
  const r = await run<PersistedDraft[]>('readonly', (s) => s.getAll());
  if (!r.ok) return r;
  // Ignore records from a future/unknown schema instead of crashing on them.
  return { ok: true, value: (r.value ?? []).filter((x) => x && x.v === PERSIST_SCHEMA_VERSION).sort((a, b) => b.savedAt - a.savedAt) };
}

/** Ask the browser not to evict our data (Safari/ITP may otherwise purge it). Returns whether storage is now persistent. */
export async function requestPersistentStorage(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

/** Free/used bytes estimate for the "storage nearly full" notice; null when the browser can't say. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try { const e = await navigator.storage?.estimate?.(); return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null; } catch { return null; }
}

/** Fingerprint a picked video file (cheap: metadata + hash of the first and last 64 KB). */
export async function fingerprintFile(file: File, video: { duration: number; videoWidth: number; videoHeight: number }): Promise<VideoFingerprint> {
  const head = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - SAMPLE_BYTES)).arrayBuffer());
  const both = new Uint8Array(head.length + tail.length);
  both.set(head, 0); both.set(tail, head.length);
  return { name: file.name, size: file.size, lastModified: file.lastModified, durationSec: video.duration, width: video.videoWidth, height: video.videoHeight, sample: hashBytes(both) };
}
