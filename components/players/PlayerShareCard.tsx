'use client';

import { useCallback, useEffect, useState } from 'react';

type Share = { mode: 'view' | 'edit'; allowed_email: string | null; revoked: boolean; url: string | null };

const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 16, minWidth: 0 };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 12, cursor: 'pointer' };
const ghost: React.CSSProperties = { ...btn, background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', border: '1px solid var(--cl-border)' };

/** The coach's share card: one link per player, view-only or can-add, optional email check. */
export default function PlayerShareCard({ playerId, canEdit }: { playerId: string; canEdit: boolean }) {
  const [share, setShare] = useState<Share | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const apply = (s: Share | null) => {
    setShare(s);
    if (s && !s.revoked) { setMode(s.mode); setEmail(s.allowed_email ?? ''); }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/players/${playerId}/share`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load');
      apply(data.share);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoaded(true);
    }
  }, [playerId]);
  useEffect(() => { void load(); }, [load]);

  const save = async (replace: boolean) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/players/${playerId}/share`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, allowed_email: email, replace }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not save');
      apply(data.share);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!window.confirm('Turn the link off? Anyone using it loses access immediately.')) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/players/${playerId}/share`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not turn it off');
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!share?.url) return;
    try { await navigator.clipboard.writeText(share.url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { window.prompt('Copy this link', share.url); }
  };

  const active = !!share && !share.revoked && !!share.url;

  return (
    <div style={{ background: 'rgba(250, 249, 247, 0.96)', border: '1px solid var(--cl-border)', borderRadius: 16, padding: 18, color: 'var(--cl-text-primary)', marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Share with the player</h2>
      <p style={{ margin: '4px 0 12px', fontSize: 12, color: 'var(--cl-text-secondary)' }}>
        One link for this profile. The player opens it with no sign-in and sees the profile fields, progress graphs and timeline (not your private notes or reports). Every filled-in profile field is visible, so remove any field you do not want them to see (for example a contact).
      </p>
      {err ? <p style={{ color: 'var(--cl-destructive-text)', fontSize: 12 }}>{err}</p> : null}
      {!loaded ? <p style={{ fontSize: 12 }}>Loading…</p> : (
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ fontSize: 12 }}>
            What can the player do?
            <select value={mode} onChange={(e) => setMode(e.target.value as 'view' | 'edit')} disabled={!canEdit} style={{ ...inp, display: 'block', marginTop: 4 }}>
              <option value="view">View only</option>
              <option value="edit">View and add (comments, pictures, videos, progress values)</option>
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            Ask for an email (optional)
            <input value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canEdit} placeholder="player@example.com" style={{ ...inp, display: 'block', marginTop: 4, width: '100%', maxWidth: 360 }} />
            <span style={{ color: 'var(--cl-text-muted)' }}>The visitor must type this email to open the link. It is a simple check, not a password: do not rely on it for private data.</span>
          </label>
          {active ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input readOnly value={share!.url!} onFocus={(e) => e.currentTarget.select()} style={{ ...inp, flex: '1 1 260px' }} />
              <button type="button" style={btn} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
          ) : null}
          {canEdit ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" style={btn} disabled={busy} onClick={() => void save(false)}>{active ? 'Save settings' : 'Create link'}</button>
              {active ? <button type="button" style={ghost} disabled={busy} onClick={() => { if (window.confirm('Make a new link? The old one stops working.')) void save(true); }}>Replace link</button> : null}
              {active ? <button type="button" style={ghost} disabled={busy} onClick={() => void revoke()}>Turn off</button> : null}
            </div>
          ) : null}
          {share?.revoked ? <p style={{ fontSize: 12, color: 'var(--cl-text-muted)' }}>The link is off. Create it again to share a new one.</p> : null}
        </div>
      )}
    </div>
  );
}
