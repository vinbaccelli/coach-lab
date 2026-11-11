'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, MessageSquare, Video, X } from 'lucide-react';
import { buildTimeline, youtubeEmbedUrl, type RawEntry, type RawItem, type RawMetric } from '@/lib/players/timeline';
import { uploadVideoToYouTube } from '@/lib/export/exportService';

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

/** One chronological list for the player: comments, pictures, videos, reports and progress values. */
export default function PlayerTimeline({ playerId, playerName, entries, canEdit }: { playerId: string; playerName: string; entries: RawEntry[]; canEdit: boolean }) {
  const [items, setItems] = useState<RawItem[]>([]);
  const [metrics, setMetrics] = useState<RawMetric[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [showLink, setShowLink] = useState(false);
  const picRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/players/${playerId}/timeline`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load the timeline');
      setItems(data.items ?? []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the timeline');
    }
    // Progress values are optional here: a missing table must not break the timeline.
    try {
      const res = await fetch(`/api/players/${playerId}/metrics`, { cache: 'no-store' });
      if (res.ok) setMetrics((await res.json()).metrics ?? []);
    } catch { /* ignore */ }
  }, [playerId]);
  useEffect(() => { void load(); }, [load]);

  const timeline = useMemo(() => buildTimeline({ items, entries, metrics }), [items, entries, metrics]);

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
  const remove = (id: string) => {
    if (!window.confirm('Delete this item?')) return;
    void run('Deleting…', async () => {
      const res = await fetch(`/api/players/${playerId}/timeline?itemId=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete');
    });
  };

  return (
    <div style={{ background: 'rgba(250, 249, 247, 0.96)', border: '1px solid var(--cl-border)', borderRadius: 16, padding: 18, color: 'var(--cl-text-primary)', marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Timeline</h2>
      <p style={{ margin: '4px 0 12px', fontSize: 12, color: 'var(--cl-text-secondary)' }}>
        Comments, pictures, videos, reports and progress values for {playerName}, newest first.
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

      {timeline.length === 0 && !err ? <p style={{ fontSize: 12, color: 'var(--cl-text-muted)' }}>Nothing here yet.</p> : null}
      <div style={{ display: 'grid', gap: 10 }}>
        {timeline.map((t) => (
          <div key={t.key} style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{t.title}</span>
              <span style={{ fontSize: 11, color: 'var(--cl-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {t.at.slice(0, 10)}
                {canEdit && t.deletableId ? (
                  <button type="button" aria-label="Delete" onClick={() => remove(t.deletableId!)} disabled={!!busy} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--cl-text-muted)', display: 'inline-flex' }}><X size={14} /></button>
                ) : null}
              </span>
            </div>
            {t.body ? <p style={{ margin: '4px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>{t.body}</p> : null}
            {t.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.imageUrl} alt="" loading="lazy" style={{ marginTop: 6, maxWidth: '100%', maxHeight: 360, borderRadius: 10, display: 'block' }} />
            ) : null}
            {t.youtubeId ? (
              <div style={{ marginTop: 6, position: 'relative', paddingTop: '56.25%', maxWidth: 560 }}>
                <iframe
                  src={youtubeEmbedUrl(t.youtubeId)}
                  title="Video"
                  loading="lazy"
                  allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 10 }}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
