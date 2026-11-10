'use client';
/**
 * Motion Layer draft autosave + restore offer (M4). Owns NO draft state: it observes the draft the app already holds,
 * writes a compact record to IndexedDB after a quiet period, and reports a matching saved record for the loaded video.
 * Nothing here can throw into the editor; every storage failure becomes `notice`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StroMotionDraft } from '@/lib/stroMotionDraft/types';
import {
  hasCoachWork, matchFingerprint, serializeDraft, persistedSizeBytes,
  type PersistedDraft, type VideoFingerprint,
} from '@/lib/stroMotionDraft/persist';
import {
  saveDraftRecord, listDraftRecords, deleteDraftRecord, requestPersistentStorage, storageEstimate,
} from '@/lib/stroMotionDraft/persistStore';

export const AUTOSAVE_QUIET_MS = 1500;

export interface PersistSettings { startSec: number; endSec: number; frameCount: number; background: 'start' | 'end' }

export interface MotionLayerPersistence {
  /** Saved work for the currently loaded video, waiting for the coach's yes/no. */
  offer: PersistedDraft | null;
  /** Saved work for OTHER videos (shown when nothing matches, so the coach knows to re-pick the original). */
  others: PersistedDraft[];
  /** Why the most recent saved draft did NOT match the loaded video (null when there is no loaded video or no saved work). */
  mismatchReason: string | null;
  /** Plain-language problem with saving, or null. */
  notice: string | null;
  lastSavedAt: number | null;
  /** Coach chose Restore: returns the record and clears the offer. */
  accept: () => PersistedDraft | null;
  /** Coach chose Discard: deletes the record. */
  discard: () => void;
}

export function useMotionLayerPersistence(opts: {
  enabled: boolean;
  draft: StroMotionDraft | null;
  settings: PersistSettings;
  fingerprint: VideoFingerprint | null;
}): MotionLayerPersistence {
  const { enabled, draft, settings, fingerprint } = opts;
  const [offer, setOffer] = useState<PersistedDraft | null>(null);
  const [others, setOthers] = useState<PersistedDraft[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [mismatchReason, setMismatchReason] = useState<string | null>(null);
  /** Fingerprint of the restored record: later saves reuse it so one video keeps ONE record even if its signature drifts slightly. */
  const adoptedFpRef = useRef<VideoFingerprint | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const restoredRef = useRef(false); // an offer was already answered for this fingerprint
  const fpKeyRef = useRef<string | null>(null);

  // Look for saved work whenever the Motion Layer opens or the loaded video changes.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const r = await listDraftRecords();
      if (cancelled || !r.ok) return;
      const withWork = r.value.filter(hasCoachWork);
      const match = fingerprint ? withWork.find((p) => matchFingerprint(p.fingerprint, fingerprint).ok) ?? null : null;
      const key = fingerprint ? `${fingerprint.width}x${fingerprint.height}:${fingerprint.durationSec}:${fingerprint.sig}` : null;
      if (key !== fpKeyRef.current) { fpKeyRef.current = key; restoredRef.current = false; adoptedFpRef.current = null; }
      setOffer(match && !restoredRef.current ? match : null);
      setOthers(withWork.filter((p) => p !== match));
      const v = fingerprint && withWork[0] && !match ? matchFingerprint(withWork[0].fingerprint, fingerprint) : null;
      setMismatchReason(v && !v.ok ? v.reason : null);
    })();
    return () => { cancelled = true; };
  }, [enabled, fingerprint]);

  // Debounced autosave. Skipped while an offer is pending so the saved work isn't overwritten by an empty fresh draft.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!enabled || !draft || !fingerprint || offer) return;
    timer.current = setTimeout(async () => {
      timer.current = null;
      const rec = serializeDraft(draft, { fingerprint: adoptedFpRef.current ?? fingerprint, ...settings });
      if (!hasCoachWork(rec)) return; // never replace saved work with an empty draft
      const r = await saveDraftRecord(rec);
      if (r.ok) { setLastSavedAt(rec.savedAt); setNotice(null); void requestPersistentStorage(); return; }
      if (r.reason === 'quota') {
        const est = await storageEstimate();
        const mb = Math.round(persistedSizeBytes(rec) / 1e5) / 10;
        setNotice(`Could not save your Motion Layer work: this browser's storage is full${est ? ` (${Math.round(est.usage / 1e6)} of ${Math.round(est.quota / 1e6)} MB used)` : ''}. Your work stays open here but won't survive a refresh. This draft needs about ${mb} MB.`);
      } else if (r.reason === 'unavailable') {
        setNotice("This browser isn't allowing local saving (private mode?), so your Motion Layer work won't survive a refresh.");
      } else setNotice(`Could not save your Motion Layer work (${r.message.slice(0, 80)}).`);
    }, AUTOSAVE_QUIET_MS);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [enabled, draft, fingerprint, offer, settings]);

  const accept = useCallback(() => { const o = offer; restoredRef.current = true; adoptedFpRef.current = o ? o.fingerprint : null; setOffer(null); return o; }, [offer]);
  const discard = useCallback(() => {
    const o = offer; restoredRef.current = true; setOffer(null);
    if (o) void deleteDraftRecord(o.fingerprint);
  }, [offer]);

  return { offer, others, mismatchReason, notice, lastSavedAt, accept, discard };
}
