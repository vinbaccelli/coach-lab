'use client';

import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';

/** Shrink a picture to at most 640 px and re-encode as JPEG (small upload, small storage). */
async function shrink(file: File, max = 640): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
  c.width = c.height = 0;
  if (!blob) throw new Error('Could not read that picture');
  return blob;
}

/** The player's photo (or initials) with a camera button to upload a new one. */
export default function PlayerAvatar({ playerId, name, photoUrl, canEdit, onChange, size = 72 }: {
  playerId: string;
  name: string;
  photoUrl: string | null | undefined;
  canEdit: boolean;
  onChange: (url: string) => void;
  size?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', new File([await shrink(file)], 'photo.jpg', { type: 'image/jpeg' }));
      const res = await fetch(`/api/players/${playerId}/photo`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.photo_url) throw new Error(data.error ?? 'Upload failed');
      setBroken(false);
      onChange(data.photo_url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        {photoUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={name} onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--cl-border)' }} />
        ) : (
          <div aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(0,122,255,0.12)', color: 'var(--cl-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: size / 2.8 }}>{initials}</div>
        )}
        {canEdit ? (
          <button type="button" aria-label="Upload a photo" disabled={busy} onClick={() => ref.current?.click()}
            style={{ position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--cl-bg-panel, #fff)', background: 'var(--cl-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
            <Camera size={14} />
          </button>
        ) : null}
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
      </div>
      {busy ? <span style={{ fontSize: 11, color: 'var(--cl-text-muted)' }}>Uploading…</span> : null}
      {err ? <span role="alert" style={{ fontSize: 11, color: '#b3261e', maxWidth: 120, textAlign: 'center' }}>{err}</span> : null}
    </div>
  );
}
