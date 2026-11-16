'use client';

import { useCallback, useRef, useState } from 'react';
import { Image as ImageIcon, MessageSquare, Video } from 'lucide-react';
import { uploadVideoToYouTube } from '@/lib/export/exportService';
import HistoryFeed, { type HistoryPage } from '@/components/players/history/HistoryFeed';
import type { HistoryItem } from '@/lib/players/history';

const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 16, minWidth: 0 };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 };
const ghost: React.CSSProperties = { ...btn, background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', border: '1px solid var(--cl-border)' };

/** Shrink a picture to at most 1280 px and re-encode as JPEG (keeps storage small and uploads quick on a phone). */
async function shrinkImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.82));
  c.width = c.height = 0;
  if (!blob) throw new Error('Could not read that picture');
  return blob;
}

/**
 * The player's universal timeline for the coach: add comments, pictures and videos here; the list
 * below shows every module (reports, technical notes, measurements, meals, plans…) newest first,
 * with filters, and keeps the coach's manual order.
 */
export default function PlayerTimeline({ playerId, playerName, canEdit, order, onOrderChange }: { playerId: string; playerName: string; canEdit: boolean; order?: string[] | null; onOrderChange?: (order: string[]) => Promise<void> }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const picRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  const fetchPage = useCallback(async (params: URLSearchParams): Promise<HistoryPage> => {
    const res = await fetch(`/api/players/${playerId}/history?${params.toString()}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Could not load the timeline');
    return { items: data.items ?? [], next: data.next ?? null };
  }, [playerId]);
  const load = useCallback(async () => { setReloadKey((k) => k + 1); }, []);

  const postJson = async (body: unknown) => {
    const res = await fetch(`/api/players/${playerId}/timeline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not save');
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };

  const addComment = () => run('Saving…', async () => { await postJson({ kind: 'note', body: text }); setText(''); });
  const addLink = () => run('Saving…', async () => { await postJson({ kind: 'video', youtube_url: link, body: '' }); setLink(''); setShowLink(false); });
  const addPicture = (file: File) => run('Uploading picture…', async () => {
    const blob = await shrinkImage(file);
    const form = new FormData();
    form.append('file', new File([blob], 'picture.jpg', { type: 'image/jpeg' }));
    const res = await fetch(`/api/players/${playerId}/timeline`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not upload the picture');
  });
  const addVideo = (file: File) => run('Uploading to YouTube (unlisted)…', async () => {
    const r = await uploadVideoToYouTube(file, `${playerName} — AngleMotion`);
    if (!r.ok || !r.url) throw new Error(r.needsConnect ? 'Connect YouTube first (in the analysis app export menu), then try again.' : r.error ?? 'YouTube upload failed');
    await postJson({ kind: 'video', youtube_url: r.url, body: '' });
  });
  const remove = async (item: HistoryItem) => {
    const res = await fetch(`/api/players/${playerId}/timeline?itemId=${encodeURIComponent(item.deletableId ?? '')}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not delete');
  };

  return (
    <div style={{ background: 'rgba(250, 249, 247, 0.96)', border: '1px solid var(--cl-border)', borderRadius: 16, padding: 18, color: 'var(--cl-text-primary)', marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Timeline</h2>
      <p style={{ margin: '4px 0 12px', fontSize: 12, color: 'var(--cl-text-secondary)' }}>
        Everything about {playerName}, newest first: comments, pictures, videos, reports, technical notes, measurements, meals and nutrition plans. Filter by section, kind, who added it or dates.
      </p>

      {canEdit ? (
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment…" style={{ ...inp, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" style={btn} disabled={!!busy || !text.trim()} onClick={() => void addComment()}><MessageSquare size={14} /> Add comment</button>
            <button type="button" style={ghost} disabled={!!busy} onClick={() => picRef.current?.click()}><ImageIcon size={14} /> Add picture</button>
            <button type="button" style={ghost} disabled={!!busy} onClick={() => vidRef.current?.click()}><Video size={14} /> Upload video to YouTube (unlisted)</button>
            <button type="button" style={ghost} disabled={!!busy} onClick={() => setShowLink((v) => !v)}>Paste YouTube link</button>
          </div>
          {showLink ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtu.be/…" style={{ ...inp, flex: 1 }} />
              <button type="button" style={btn} disabled={!!busy || !link.trim()} onClick={() => void addLink()}>Add</button>
            </div>
          ) : null}
          <input ref={picRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPicture(f); }} />
          <input ref={vidRef} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addVideo(f); }} />
          {busy ? <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)' }}>{busy}</div> : null}
        </div>
      ) : null}
      {err ? <p style={{ color: 'var(--cl-destructive-text)', fontSize: 12 }}>{err}</p> : null}
      <HistoryFeed
        viewer="coach"
        fetchPage={fetchPage}
        reloadKey={reloadKey}
        order={order ?? null}
        onOrderChange={canEdit ? onOrderChange : undefined}
        onDelete={canEdit ? remove : undefined}
      />
    </div>
  );
}
