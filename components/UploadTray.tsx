'use client';

/**
 * The tray for background uploads (lib/uploads/backgroundUploads.ts). Mounted once in the app shell, so a video
 * going to YouTube stays visible and keeps uploading while the coach moves between pages or starts an analysis.
 * Finished uploads disappear by themselves; failed ones stay until dismissed. While one runs, closing the tab asks first.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { uploadQueue, type UploadJob } from '@/lib/uploads/backgroundUploads';

const EMPTY: UploadJob[] = [];

export default function UploadTray() {
  const jobs = useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot, () => EMPTY);
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'uploading' || j.status === 'saving');

  // Closing or reloading the tab ends the upload (the file is in this page's memory): ask first.
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);

  // Finished uploads leave on their own after a few seconds.
  useEffect(() => {
    const timers = jobs.filter((j) => j.status === 'done').map((j) => window.setTimeout(() => uploadQueue.dismiss(j.id), 6000));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [jobs]);

  if (jobs.length === 0) return null;
  return (
    <div
      data-testid="upload-tray"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', left: 'calc(env(safe-area-inset-left, 0px) + 12px)', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        zIndex: 9000, display: 'flex', flexDirection: 'column', gap: 8, width: 'min(300px, calc(100vw - 24px))',
      }}
    >
      {jobs.map((j) => {
        const busy = j.status === 'queued' || j.status === 'uploading' || j.status === 'saving';
        const pct = Math.round(j.progress * 100);
        return (
          <div key={j.id} data-upload-status={j.status} style={{ background: 'rgba(20,20,22,0.94)', color: '#fff', borderRadius: 12, padding: '10px 12px', fontSize: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.35)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {j.status === 'done' ? <CheckCircle2 size={14} color="#4ADE80" /> : j.status === 'error' ? <AlertTriangle size={14} color="#F87171" /> : null}
              <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.label}</strong>
              {!busy && (
                <button type="button" aria-label="Dismiss" onClick={() => uploadQueue.dismiss(j.id)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: 2 }}>
                  <X size={13} />
                </button>
              )}
            </div>
            <div style={{ marginTop: 4, color: j.status === 'error' ? '#FCA5A5' : 'rgba(255,255,255,0.75)', lineHeight: 1.4 }}>
              {j.status === 'queued' && 'Waiting for the other upload…'}
              {j.status === 'uploading' && `Uploading to YouTube… ${pct}% — you can keep working`}
              {j.status === 'saving' && 'Adding it to the timeline…'}
              {j.status === 'done' && 'Uploaded and added.'}
              {j.status === 'error' && j.error}
            </div>
            {(j.status === 'uploading' || j.status === 'saving') && (
              <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                <div style={{ width: `${j.status === 'saving' ? 100 : pct}%`, height: '100%', background: '#4ADE80', transition: 'width 200ms' }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
