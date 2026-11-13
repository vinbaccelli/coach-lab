'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MetricChart } from '@/components/players/PlayerMetrics';
import { groupMetrics, type MetricRow } from '@/lib/players/metrics';
import { youtubeEmbedUrl } from '@/lib/players/timeline';
import { uploadToResumableSession } from '@/lib/export/youtubeResumableUpload';
import { applyManualOrder } from '@/lib/players/reorder';

type Item = { id: string; kind: 'note' | 'picture' | 'video'; body: string; media_url: string | null; youtube_id: string | null; created_at: string; author: 'coach' | 'link' };
type Data = { name: string; sheet: Array<{ label: string; value: string }>; items: Item[]; metrics: MetricRow[]; canAdd: boolean; timelineOrder?: string[] | null };

const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 16, minWidth: 0 };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 12, cursor: 'pointer' };
const ghost: React.CSSProperties = { ...btn, background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', border: '1px solid var(--cl-border)' };
const panel: React.CSSProperties = { background: 'rgba(250, 249, 247, 0.96)', border: '1px solid var(--cl-border)', borderRadius: 16, padding: 18, marginBottom: 16 };
const today = () => new Date().toISOString().slice(0, 10);

async function shrink(file: File): Promise<Blob> {
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

/** What the player sees at /share/<token>: no sign-in. */
export default function SharedProfileClient({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'email' | 'gone'>('loading');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [mName, setMName] = useState('');
  const [mUnit, setMUnit] = useState('');
  const [mVal, setMVal] = useState('');
  const [mDate, setMDate] = useState(today());
  const picRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  const headers = useCallback((): Record<string, string> => (email.trim() ? { 'x-share-email': email.trim() } : {}), [email]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/share/${token}`, { cache: 'no-store', headers: headers() });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && body.needsEmail) { setState('email'); setErr(email ? 'That email does not match.' : null); return; }
      if (!res.ok) { setState('gone'); return; }
      setData(body); setState('ok'); setErr(null);
    } catch { setState('gone'); }
  }, [token, headers, email]);
  useEffect(() => { void load(); /* first load only */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = async (init: RequestInit) => {
    const res = await fetch(`/api/share/${token}`, { method: 'POST', ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...headers() } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Could not save');
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };
  const json = (b: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

  const series = useMemo(() => groupMetrics(data?.metrics ?? []), [data]);

  if (state === 'loading') return <p style={{ padding: 24 }}>Loading…</p>;
  if (state === 'gone') return <p style={{ padding: 24 }}>This link is not available. Ask your coach for a new one.</p>;
  if (state === 'email' || !data) {
    return (
      <div style={{ maxWidth: 420, margin: '60px auto', padding: 16 }}>
        <div style={panel}>
          <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Enter your email</h1>
          <p style={{ fontSize: 13, color: 'var(--cl-text-secondary)' }}>Your coach asked for the email this link was shared with.</p>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ ...inp, width: '100%' }} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} />
          {err ? <p style={{ color: 'var(--cl-destructive-text)', fontSize: 12 }}>{err}</p> : null}
          <button type="button" style={{ ...btn, marginTop: 10 }} onClick={() => void load()}>Open</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 48px', color: 'var(--cl-text-primary)' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 14px' }}>{data.name}</h1>
      {err ? <p style={{ color: 'var(--cl-destructive-text)', fontSize: 13 }}>{err}</p> : null}

      {data.sheet.length > 0 ? (
        <div style={panel}>
          <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>Profile</h2>
          <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {data.sheet.map((r, i) => (
              <div key={`${r.label}-${i}`} style={{ fontSize: 13 }}>
                <div style={{ color: 'var(--cl-text-muted)', fontSize: 11 }}>{r.label}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{r.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(series.length > 0 || data.canAdd) ? (
        <div style={panel}>
          <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>Progress</h2>
          {series.map((s) => (
            <div key={s.key} style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 10, marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14 }}>{s.name}</strong>
                <span style={{ fontSize: 13 }}>{s.latest.value}{s.unit ? ` ${s.unit}` : ''}{s.change !== null ? ` (${s.change > 0 ? '+' : ''}${Math.round(s.change * 100) / 100} since first)` : ''}</span>
              </div>
              <MetricChart points={s.points} />
              {data.canAdd ? (
                <button type="button" style={{ ...ghost, marginTop: 6 }} onClick={() => { setMName(s.name); setMUnit(s.unit); }}>Add a value to {s.name}</button>
              ) : null}
            </div>
          ))}
          {data.canAdd ? (
            <div style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 10, marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="What (e.g. 5 km run)" style={{ ...inp, flex: '1 1 140px' }} />
              <input value={mUnit} onChange={(e) => setMUnit(e.target.value)} placeholder="Unit" style={{ ...inp, width: 80 }} />
              <input inputMode="decimal" value={mVal} onChange={(e) => setMVal(e.target.value)} placeholder="Value" style={{ ...inp, width: 90 }} />
              <input type="date" value={mDate} max={today()} onChange={(e) => setMDate(e.target.value)} style={{ ...inp, width: 150 }} />
              <button type="button" style={btn} disabled={!!busy || !mName.trim() || !mVal.trim()} onClick={() => void run('Saving…', async () => {
                await post(json({ kind: 'metric', name: mName, unit: mUnit, value: mVal, recorded_on: mDate })); setMVal('');
              })}>Add value</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={panel}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>Timeline</h2>
        {data.canAdd ? (
          <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment…" style={{ ...inp, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" style={btn} disabled={!!busy || !text.trim()} onClick={() => void run('Saving…', async () => { await post(json({ kind: 'note', body: text })); setText(''); })}>Add comment</button>
              <button type="button" style={ghost} disabled={!!busy} onClick={() => picRef.current?.click()}>Add picture</button>
              <button type="button" style={ghost} disabled={!!busy} onClick={() => vidRef.current?.click()}>Upload video</button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube link" style={{ ...inp, flex: 1 }} />
              <button type="button" style={ghost} disabled={!!busy || !link.trim()} onClick={() => void run('Saving…', async () => { await post(json({ kind: 'video', youtube_url: link, body: '' })); setLink(''); })}>Add video</button>
            </div>
            <input ref={picRef} type="file" accept="image/*" hidden onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (f) void run('Uploading picture…', async () => {
                const blob = await shrink(f); const form = new FormData(); form.append('file', new File([blob], 'picture.jpg', { type: 'image/jpeg' })); await post({ body: form });
              });
            }} />
            <input ref={vidRef} type="file" accept="video/*" hidden onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (f) void run('Uploading video…', async () => {
                const res = await fetch(`/api/share/${token}/youtube-session`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ sizeBytes: f.size, mimeType: f.type || 'video/mp4' }) });
                const body = await res.json().catch(() => ({}));
                if (!res.ok || !body.uploadUrl) throw new Error(body.error ?? 'Could not start the video upload');
                const up = await uploadToResumableSession(body.uploadUrl, f, (p) => setBusy(`Uploading video… ${Math.round(p * 100)}%`));
                if (!up.ok || !up.url) throw new Error(up.error ?? 'The video upload failed');
                await post(json({ kind: 'video', youtube_url: up.url, body: '' }));
              });
            }} />
            {busy ? <div style={{ fontSize: 12 }}>{busy}</div> : null}
          </div>
        ) : null}
        {data.items.length === 0 ? <p style={{ fontSize: 12, color: 'var(--cl-text-muted)' }}>Nothing here yet.</p> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {applyManualOrder(data.items.map((x) => ({ ...x, key: `i-${x.id}` })), data.timelineOrder).map((t) => (
            <div key={t.id} style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <strong>{t.author === 'link' ? 'Player' : 'Coach'}</strong>
                <span style={{ color: 'var(--cl-text-muted)' }}>{t.created_at.slice(0, 10)}</span>
              </div>
              {t.body ? <p style={{ margin: '4px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>{t.body}</p> : null}
              {t.kind === 'picture' && t.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.media_url} alt="" loading="lazy" style={{ marginTop: 6, maxWidth: '100%', maxHeight: 360, borderRadius: 10, display: 'block' }} />
              ) : null}
              {t.kind === 'video' && t.youtube_id ? (
                <div style={{ marginTop: 6, position: 'relative', paddingTop: '56.25%', maxWidth: 560 }}>
                  <iframe src={youtubeEmbedUrl(t.youtube_id)} title="Video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 10 }} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--cl-text-muted)', textAlign: 'center' }}>Made with AngleMotion</p>
    </div>
  );
}
