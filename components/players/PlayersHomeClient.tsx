'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { User } from 'lucide-react';

type Player = {
  id: string;
  display_name: string;
  photo_url?: string | null;
  nationality?: string | null;
};

export default function PlayersHomeClient() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/players');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setPlayers(data.players ?? []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cardBase = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    background: 'rgba(250, 249, 247, 0.96)',
    border: '1px solid #E5E5E5',
    textDecoration: 'none',
    color: '#1A1A1A',
    transition: 'transform 0.12s ease, box-shadow 0.12s ease',
  } as const;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 0 40px' }}>
      <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.55, color: '#57534e' }}>
        Premium coaching profiles — technique and match timelines stay synced across devices.
      </p>

      <div
        style={{
          ...cardBase,
          marginBottom: 20,
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>New player</div>
          <div style={{ fontSize: 12, color: '#6e6e73', marginTop: 4 }}>Create a profile before attaching analyses.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Full name"
            style={{
              minWidth: 200,
              borderRadius: 10,
              border: '1px solid #E5E5E5',
              padding: '10px 12px',
              fontSize: 14,
            }}
          />
          <button
            type="button"
            disabled={creating || !newName.trim()}
            onClick={async () => {
              setCreating(true);
              try {
                const res = await fetch('/api/players', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ display_name: newName.trim() }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? 'Failed');
                setNewName('');
                await load();
              } catch (e: unknown) {
                setErr(e instanceof Error ? e.message : 'Failed');
              } finally {
                setCreating(false);
              }
            }}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: 'none',
              background: '#1A1A1A',
              color: '#fff',
              fontWeight: 700,
              cursor: creating ? 'wait' : 'pointer',
            }}
          >
            {creating ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>

      {err ? <p style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 12 }}>{err}</p> : null}

      {loading ? (
        <p style={{ color: '#57534e' }}>Loading…</p>
      ) : players.length === 0 ? (
        <p style={{ color: '#57534e', fontSize: 14 }}>No players yet — add one above or create from an upload flow.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {players.map((p) => (
            <Link key={p.id} href={`/players/${p.id}`} style={cardBase} className="anglemotion-player-card">
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  overflow: 'hidden',
                  background: '#e7e5e4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {p.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <User size={26} color="#57534e" />
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em' }}>{p.display_name}</div>
                {p.nationality ? (
                  <div style={{ fontSize: 12, color: '#6e6e73', marginTop: 4 }}>{p.nationality}</div>
                ) : (
                  <div style={{ fontSize: 12, color: '#a8a29e', marginTop: 4 }}>Open profile</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <style>{`
        .anglemotion-player-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 30px rgba(0,0,0,0.12);
        }
      `}</style>
    </div>
  );
}
