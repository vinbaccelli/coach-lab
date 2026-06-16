'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';

export type DbPlayer = {
  id: string;
  display_name: string;
  photo_url?: string | null;
};

type Props = {
  playerId: string;
  onPlayerIdChange: (id: string) => void;
  disabled?: boolean;
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #D1D1D6',
  fontSize: 14,
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginTop: 14,
  color: '#1A1A1A',
};

export default function PlayerPickerForm({ playerId, onPlayerIdChange, disabled }: Props) {
  const [players, setPlayers] = useState<DbPlayer[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoadingList(true);
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => {
        const list: DbPlayer[] = d.players ?? [];
        setPlayers(list);
        if (list.length && !playerId) onPlayerIdChange(list[0].id);
        else if (list.length && !list.some((p) => p.id === playerId)) {
          onPlayerIdChange(list[0].id);
        }
      })
      .catch(() => setErr('Could not load players'))
      .finally(() => setLoadingList(false));
  }, [onPlayerIdChange, playerId]);

  const createPlayer = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Create failed');
      const np = data.player as DbPlayer;
      setPlayers((prev) => [...prev, np]);
      onPlayerIdChange(np.id);
      setCreating(false);
      setNewName('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }, [newName, onPlayerIdChange]);

  return (
    <div>
      {!creating ? (
        <label style={labelStyle}>
          Player
          <select
            value={playerId}
            onChange={(e) => onPlayerIdChange(e.target.value)}
            disabled={disabled || loadingList}
            style={inputStyle}
          >
            {players.length === 0 ? (
              <option value="">No players yet</option>
            ) : (
              players.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))
            )}
          </select>
        </label>
      ) : (
        <label style={labelStyle}>
          New player name
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Full name"
            disabled={disabled || busy}
            style={inputStyle}
          />
        </label>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {!creating ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCreating(true)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #D1D1D6',
              background: '#fff',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            + New player
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || !newName.trim()}
              onClick={() => void createPlayer()}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: 'none',
                background: '#007AFF',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {busy ? 'Creating…' : 'Create player'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setCreating(false); setNewName(''); }}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #D1D1D6',
                background: '#fff',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {err ? <p style={{ margin: '10px 0 0', fontSize: 12, color: '#c0392b' }}>{err}</p> : null}
    </div>
  );
}

export function SaveModalShell({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'rgba(250, 249, 247, 0.98)',
          border: '1px solid #E5E5E5',
          borderRadius: 16,
          padding: 20,
          maxWidth: 480,
          width: 'min(480px, calc(100vw - 32px))',
          maxHeight: 'min(90vh, 720px)',
          overflowY: 'auto',
          boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
          color: '#1A1A1A',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h2>
            {subtitle ? (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6e6e73', lineHeight: 1.45 }}>{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: '#6e6e73' }}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ marginTop: 16 }}>{children}</div>
        {footer ? <div style={{ marginTop: 18 }}>{footer}</div> : null}
      </div>
    </div>
  );
}
