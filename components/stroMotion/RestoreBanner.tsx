'use client';
import React from 'react';
import type { PersistedDraft } from '@/lib/stroMotionDraft/persist';

function when(ts: number): string {
  try { return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; }
}
function readyCount(p: PersistedDraft): number { return p.frames.filter((f) => f.status === 'ready').length; }

/** Restore offer + save-problem notice for the Motion Layer draft (M4). Presentational only. */
export default function RestoreBanner(props: {
  offer: PersistedDraft | null;
  others: PersistedDraft[];
  mismatchReason?: string | null;
  notice: string | null;
  hasVideo: boolean;
  busy: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const { offer, others, mismatchReason, notice, hasVideo, busy, onRestore, onDiscard } = props;
  const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.35)', background: 'transparent', color: 'inherit', fontSize: 13, minHeight: 36 };
  const box: React.CSSProperties = { margin: '8px', padding: '10px 12px', borderRadius: 10, background: 'rgba(37,99,235,0.18)', border: '1px solid rgba(96,165,250,0.5)', fontSize: 13, lineHeight: 1.35 };
  return (
    <>
      {offer && (
        <div style={box} role="alert" data-testid="motion-restore-offer">
          <strong>Continue your earlier Motion Layer work?</strong>
          <div style={{ opacity: 0.85, margin: '4px 0 8px' }}>
            Saved {when(offer.savedAt)} on this device: {offer.frames.length} frames, {readyCount(offer)} ready.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={{ ...btn, background: '#2563eb', borderColor: '#2563eb', color: '#fff' }} disabled={busy} onClick={onRestore}>{busy ? 'Restoring…' : 'Restore'}</button>
            <button type="button" style={btn} disabled={busy} onClick={onDiscard}>Start fresh (deletes saved copy)</button>
          </div>
        </div>
      )}
      {!offer && others.length > 0 && (
        <div style={box} data-testid="motion-restore-others">
          <strong>Unfinished Motion Layer work is saved on this device.</strong>
          <div style={{ opacity: 0.85, marginTop: 4 }}>
            {hasVideo ? 'It belongs to a different video. ' : ''}Load the same video file (e.g. “{others[0].fingerprint.name}”) to continue it. Your video is never copied or uploaded.
            {mismatchReason ? <div style={{ opacity: 0.7, marginTop: 4, fontSize: 12 }}>Why it did not match: {mismatchReason}.</div> : null}
          </div>
        </div>
      )}
      {notice && (
        <div style={{ ...box, background: 'rgba(234,88,12,0.2)', borderColor: 'rgba(251,146,60,0.6)' }} role="status" data-testid="motion-save-notice">{notice}</div>
      )}
    </>
  );
}
