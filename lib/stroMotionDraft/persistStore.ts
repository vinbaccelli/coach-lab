'use client';
/**
 * IndexedDB layer for Motion Layer drafts (M4). Local to this browser only: no network, no paid storage.
 * Every call resolves — failures come back as `{ ok: false, reason }` so a full or evicted store can never break editing
 * (the in-memory draft stays authoritative; the caller shows a notice).
 */
import { fingerprintKey, averageHash, FINGERPRINT_FRAMES, FINGERPRINT_GRID, type PersistedDraft, type VideoFingerprint, PERSIST_SCHEMA_VERSION } from '@/lib/stroMotionDraft/persist';

const DB_NAME = 'anglemotion-motion-layer';
const STORE = 'drafts';

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

/**
 * Visual signature of a video: FINGERPRINT_FRAMES evenly spaced frames, each shrunk to GRID×GRID gray and average-hashed.
 * Uses its OWN hidden <video> on the same blob URL, so the coach's playhead and playback are never touched. Returns ''
 * when any step fails or times out (the caller then falls back to file size).
 */
async function sampleSignature(url: string, durationSec: number): Promise<string> {
  if (typeof document === 'undefined' || !(durationSec > 0)) return '';
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
  const waitFor = (ev: string, ms = 6000) => new Promise<boolean>((resolve) => {
    const t = setTimeout(() => { v.removeEventListener(ev, ok); resolve(false); }, ms);
    const ok = () => { clearTimeout(t); resolve(true); };
    v.addEventListener(ev, ok, { once: true });
  });
  try {
    v.src = url;
    if (v.readyState < 1 && !(await waitFor('loadedmetadata'))) return '';
    const canvas = document.createElement('canvas');
    canvas.width = FINGERPRINT_GRID; canvas.height = FINGERPRINT_GRID;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '';
    let sig = '';
    for (let k = 0; k < FINGERPRINT_FRAMES; k++) {
      const t = durationSec * (0.1 + (0.8 * k) / (FINGERPRINT_FRAMES - 1));
      const seeked = waitFor('seeked');
      v.currentTime = t;
      if (!(await seeked)) return '';
      ctx.drawImage(v, 0, 0, FINGERPRINT_GRID, FINGERPRINT_GRID);
      const px = ctx.getImageData(0, 0, FINGERPRINT_GRID, FINGERPRINT_GRID).data;
      const gray = new Uint8Array(FINGERPRINT_GRID * FINGERPRINT_GRID);
      for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
      sig += averageHash(gray);
    }
    return sig;
  } catch { return ''; } finally {
    try { v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
  }
}

/** Fingerprint a picked video (resolution + duration + visual signature; file bytes are NOT used, see persist.ts). */
export async function fingerprintFile(file: File, video: { duration: number; videoWidth: number; videoHeight: number }, url: string): Promise<VideoFingerprint> {
  const sig = await sampleSignature(url, video.duration);
  return { name: file.name, size: file.size, lastModified: file.lastModified, durationSec: video.duration, width: video.videoWidth, height: video.videoHeight, sig };
}
