/**
 * Pure core of Motion Layer draft persistence (M4). No IndexedDB, no DOM: everything here is unit-testable.
 *
 * WHAT IS SAVED: only what the coach made and the video cannot recreate — frame times, labels, status, selection boxes,
 * the three masks per frame (run-length compressed) and the section settings. WHAT IS NOT: the video, `sourceFrame` and
 * `backgroundPlate` bitmaps (re-captured from the re-picked video by hydrateDraftBitmaps / ensureStroMotionDraft).
 */
import type { AlphaMask, StroMotionFrameStatus, StroMotionObjectType } from '@/lib/stroMotionDraft/types';
import type { StroMotionSubjectBox } from '@/lib/stroMotion';

export const PERSIST_SCHEMA_VERSION = 2;

/** Run-length coded alpha mask: [value, runLength(u32 LE)] pairs packed in one Uint8Array (5 bytes per run). */
export interface PackedMask { width: number; height: number; runs: Uint8Array }

export function packMask(m: AlphaMask): PackedMask {
  const d = m.data;
  const out: number[] = [];
  let i = 0;
  while (i < d.length) {
    const v = d[i];
    let j = i + 1;
    while (j < d.length && d[j] === v && j - i < 0xffffffff) j++;
    const n = j - i;
    out.push(v, n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
    i = j;
  }
  return { width: m.width, height: m.height, runs: Uint8Array.from(out) };
}

export function unpackMask(p: PackedMask): AlphaMask | null {
  const total = p.width * p.height;
  const data = new Uint8ClampedArray(total);
  let pos = 0;
  for (let k = 0; k + 5 <= p.runs.length; k += 5) {
    const v = p.runs[k];
    const n = (p.runs[k + 1] | (p.runs[k + 2] << 8) | (p.runs[k + 3] << 16) | (p.runs[k + 4] << 24)) >>> 0;
    if (pos + n > total) return null; // corrupt record
    if (v !== 0) data.fill(v, pos, pos + n);
    pos += n;
  }
  return pos === total ? { width: p.width, height: p.height, data } : null;
}

export interface PersistedFrame {
  index: number;
  timeSec: number;
  label: string;
  status: StroMotionFrameStatus;
  selectionBox: StroMotionSubjectBox | null;
  aiSnapshot: PackedMask | null;
  working: PackedMask | null;
  readyMask: PackedMask | null;
}

/**
 * Identity of the source video. Deliberately NOT based on file bytes: iOS re-exports/transcodes a Photos video on every pick,
 * so the same clip arrives with a different size and different bytes each time (found on a real iPhone, PR #163 build 1).
 * What survives a re-export is what the video LOOKS like, so identity = resolution + duration + a visual signature
 * (`sig`: tiny average-hash of FINGERPRINT_FRAMES frames). `name`/`size`/`lastModified` are informational only.
 */
export interface VideoFingerprint {
  name: string;
  size: number;
  lastModified: number;
  durationSec: number;
  width: number;
  height: number;
  /** Concatenated per-frame average hashes (hex); '' when the frames could not be sampled. */
  sig: string;
}

export const FINGERPRINT_FRAMES = 5;
export const FINGERPRINT_GRID = 16;
/** Duration tolerance (s): a re-export can shift the container duration by a frame or two. */
export const DURATION_TOLERANCE_SEC = 0.3;
/** Max differing bits (of FRAMES*GRID*GRID) for "same footage": a re-encode flips a few percent of bits, a different clip far more. */
export const SIG_MAX_DIFF_FRACTION = 0.06;

/** Average hash of one GRID×GRID grayscale frame → GRID*GRID/4 hex chars. */
export function averageHash(gray: ArrayLike<number>): string {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const mean = sum / gray.length;
  let out = '';
  for (let i = 0; i < gray.length; i += 4) {
    let nib = 0;
    for (let b = 0; b < 4; b++) nib = (nib << 1) | (gray[i + b] > mean ? 1 : 0);
    out += nib.toString(16);
  }
  return out;
}

export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

export interface PersistedSettings {
  objectType: StroMotionObjectType;
  startSec: number;
  endSec: number;
  frameCount: number;
  background: 'start' | 'end';
  sampleTimes: number[];
  backgroundTimeSec: number;
  batchUnitFloorNorm: number | null;
}

export interface PersistedDraft {
  v: typeof PERSIST_SCHEMA_VERSION;
  savedAt: number;
  fingerprint: VideoFingerprint;
  settings: PersistedSettings;
  frames: PersistedFrame[];
}

interface DraftLike {
  objectType: StroMotionObjectType;
  backgroundTimeSec: number;
  sampleTimes: number[];
  batchUnitFloorNorm?: number | null;
  frames: Array<{
    index: number; timeSec: number; label: string; status: StroMotionFrameStatus;
    selectionBox: StroMotionSubjectBox | null;
    aiSnapshot: AlphaMask | null; working: AlphaMask | null; readyMask: AlphaMask | null;
  }>;
}

export function serializeDraft(
  draft: DraftLike,
  extra: { fingerprint: VideoFingerprint; startSec: number; endSec: number; frameCount: number; background: 'start' | 'end'; now?: number },
): PersistedDraft {
  const pk = (m: AlphaMask | null) => (m ? packMask(m) : null);
  return {
    v: PERSIST_SCHEMA_VERSION,
    savedAt: extra.now ?? Date.now(),
    fingerprint: extra.fingerprint,
    settings: {
      objectType: draft.objectType, startSec: extra.startSec, endSec: extra.endSec,
      frameCount: extra.frameCount, background: extra.background,
      sampleTimes: [...draft.sampleTimes], backgroundTimeSec: draft.backgroundTimeSec,
      batchUnitFloorNorm: draft.batchUnitFloorNorm ?? null,
    },
    frames: draft.frames.map((f) => ({
      index: f.index, timeSec: f.timeSec, label: f.label, status: f.status, selectionBox: f.selectionBox,
      aiSnapshot: pk(f.aiSnapshot), working: pk(f.working), readyMask: pk(f.readyMask),
    })),
  };
}

/** A record is worth offering for restore only if it has some coach work in it. */
export function hasCoachWork(p: PersistedDraft): boolean {
  return p.frames.some((f) => f.selectionBox || f.aiSnapshot || f.working || f.readyMask);
}

export type FingerprintVerdict = { ok: true } | { ok: false; reason: string };

/** Is `candidate` (the video the coach just re-picked) the video the draft was made on? */
export function matchFingerprint(saved: VideoFingerprint, candidate: VideoFingerprint): FingerprintVerdict {
  if (saved.width !== candidate.width || saved.height !== candidate.height) {
    return { ok: false, reason: `different resolution (${saved.width}×${saved.height} vs ${candidate.width}×${candidate.height})` };
  }
  if (Math.abs(saved.durationSec - candidate.durationSec) > DURATION_TOLERANCE_SEC) {
    return { ok: false, reason: `different length (${saved.durationSec.toFixed(1)} s vs ${candidate.durationSec.toFixed(1)} s)` };
  }
  if (saved.sig && candidate.sig) {
    const d = hammingHex(saved.sig, candidate.sig);
    const max = Math.floor(saved.sig.length * 4 * SIG_MAX_DIFF_FRACTION);
    if (d > max) return { ok: false, reason: `different picture content (${d} of ${saved.sig.length * 4} signature bits differ, limit ${max})` };
    return { ok: true };
  }
  // A signature could not be taken on one side: fall back to the exact file size.
  if (saved.size !== candidate.size) return { ok: false, reason: 'picture could not be compared and file size differs' };
  return { ok: true }; // name/lastModified/size may legitimately change (re-export, cloud copy), so they are not required
}

/** Stable text key for the record (video identity without the cheap-to-change fields). */
export function fingerprintKey(f: VideoFingerprint): string {
  return `${f.width}x${f.height}:${Math.round(f.durationSec * 10)}:${f.sig.slice(0, 32) || f.size}`;
}

/** FNV-1a 32-bit over bytes, hex. Used on head+tail slices of the video file. */
export function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Approximate stored size in bytes (for the storage-limit message). */
export function persistedSizeBytes(p: PersistedDraft): number {
  let n = 512;
  for (const f of p.frames) for (const m of [f.aiSnapshot, f.working, f.readyMask]) if (m) n += m.runs.length + 16;
  return n;
}
