'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import PlayerSessionTimeline from '@/components/players/PlayerSessionTimeline';
import { createPlayerDraftSession } from '@/lib/sessions/saveSession';
import type { PlayerSession } from '@/lib/sessions/types';

type Player = {
  id: string;
  display_name: string;
  photo_url?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  playing_hand?: string | null;
  notes?: string | null;
};

type Entry = {
  id: string;
  category: 'technique' | 'match';
  folder_label: string;
  body_text: string;
  youtube_url?: string | null;
  created_at: string;
  screenshots?: unknown;
};

export default function PlayerProfileClient({ playerId }: { playerId: string }) {
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sessions, setSessions] = useState<PlayerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/players/${playerId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Not found');
      setPlayer(data.player);
      setEntries(data.entries ?? []);
      const sessRes = await fetch(`/api/players/${playerId}/sessions`);
      const sessData = await sessRes.json();
      if (sessRes.ok) setSessions(sessData.sessions ?? []);
      else setSessions([]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    load();
  }, [load]);

  const timelineEntries = useMemo(
    () => [...entries].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [entries],
  );

  const panel = {
    background: 'rgba(250, 249, 247, 0.96)',
    border: '1px solid #E5E5E5',
    borderRadius: 16,
    padding: 18,
    color: '#1A1A1A',
  } as const;

  const saveProfile = async () => {
    if (!player) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: player.display_name,
          photo_url: player.photo_url || null,
          date_of_birth: player.date_of_birth || null,
          nationality: player.nationality || null,
          playing_hand: player.playing_hand || 'unknown',
          notes: player.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setPlayer(data.player);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const startNewSession = async () => {
    if (!player) return;
    setCreatingSession(true);
    setErr(null);
    try {
      const title = `${player.display_name} — ${new Date().toLocaleDateString()}`;
      const session = await createPlayerDraftSession(playerId, title);
      router.push(`/analysis?playerId=${playerId}&sessionId=${session.id}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not start session');
    } finally {
      setCreatingSession(false);
    }
  };

  if (loading) {
    return <p style={{ color: 'rgba(255,255,255,0.65)' }}>Loading profile…</p>;
  }
  if (err || !player) {
    return <p style={{ color: '#fca5a5' }}>{err ?? 'Player not found'}</p>;
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', paddingBottom: 48 }}>
      <Link
        href="/players"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'rgba(255,255,255,0.75)',
          fontSize: 13,
          marginBottom: 16,
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={16} /> Players
      </Link>

      <div style={{ ...panel, marginBottom: 18 }}>
        <h1 style={{ margin: '0 0 14px', fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em' }}>{player.display_name}</h1>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          <label style={lb}>
            Photo URL
            <input
              value={player.photo_url ?? ''}
              onChange={(e) => setPlayer({ ...player, photo_url: e.target.value })}
              style={inp}
              placeholder="https://…"
            />
          </label>
          <label style={lb}>
            Date of birth
            <input
              type="date"
              value={player.date_of_birth?.slice(0, 10) ?? ''}
              onChange={(e) => setPlayer({ ...player, date_of_birth: e.target.value || null })}
              style={inp}
            />
          </label>
          <label style={lb}>
            Nationality
            <input
              value={player.nationality ?? ''}
              onChange={(e) => setPlayer({ ...player, nationality: e.target.value })}
              style={inp}
            />
          </label>
          <label style={lb}>
            Playing hand
            <select
              value={player.playing_hand ?? 'unknown'}
              onChange={(e) => setPlayer({ ...player, playing_hand: e.target.value })}
              style={inp}
            >
              <option value="unknown">Unknown</option>
              <option value="right">Right</option>
              <option value="left">Left</option>
            </select>
          </label>
        </div>
        <label style={{ ...lb, marginTop: 14 }}>
          Coach notes
          <textarea
            value={player.notes ?? ''}
            onChange={(e) => setPlayer({ ...player, notes: e.target.value })}
            rows={3}
            style={{ ...inp, resize: 'vertical' }}
          />
        </label>
        <button
          type="button"
          onClick={saveProfile}
          disabled={saving}
          style={{
            marginTop: 14,
            padding: '10px 20px',
            borderRadius: 10,
            border: 'none',
            background: '#1A1A1A',
            color: '#fff',
            fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>

      <section
        style={{
          background: 'rgba(250, 249, 247, 0.96)',
          border: '1px solid #E5E5E5',
          borderRadius: 16,
          padding: 18,
          color: '#1A1A1A',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>
          Analysis Sessions
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#78716c' }}>
          Start from the player, use tools in Video Analysis, then Save Report — newest first.
        </p>
        <button
          type="button"
          onClick={() => { void startNewSession(); }}
          disabled={creatingSession}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
            padding: '10px 16px',
            borderRadius: 10,
            border: 'none',
            background: '#007AFF',
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            cursor: creatingSession ? 'wait' : 'pointer',
          }}
        >
          <Plus size={16} />
          {creatingSession ? 'Starting…' : 'New Analysis Session'}
        </button>
        <PlayerSessionTimeline playerId={playerId} sessions={sessions} />
      </section>

      <section
        style={{
          background: 'rgba(250, 249, 247, 0.96)',
          border: '1px solid #E5E5E5',
          borderRadius: 16,
          padding: 18,
          color: '#1A1A1A',
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Reports</h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: '#78716c' }}>
          Match and technique reports — newest first.
        </p>
        {timelineEntries.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: '#78716c' }}>No entries yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {timelineEntries.map((e) => (
              <article
                key={e.id}
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: '#fff',
                  border: '1px solid #E7E5E4',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      padding: '4px 8px',
                      borderRadius: 8,
                      background: e.category === 'match' ? '#ecfccb' : '#e0f2fe',
                      color: e.category === 'match' ? '#365314' : '#0369a1',
                    }}
                  >
                    {e.category === 'match' ? 'Match analysis' : 'Technique analysis'}
                  </span>
                  <span style={{ fontSize: 11, color: '#78716c' }}>{new Date(e.created_at).toLocaleString()}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8 }}>{e.folder_label}</div>
                {e.youtube_url ? (
                  <a
                    href={e.youtube_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 13, color: '#2563eb', marginTop: 8, display: 'inline-block' }}
                  >
                    YouTube link
                  </a>
                ) : null}
                {e.body_text?.trim() ? (
                  <pre
                    style={{
                      margin: '10px 0 0',
                      fontSize: 12,
                      lineHeight: 1.45,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                      color: '#44403c',
                    }}
                  >
                    {e.body_text.length > 600 ? `${e.body_text.slice(0, 600)}…` : e.body_text}
                  </pre>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const lb: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
};

const inp: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid #E5E5E5',
  padding: '10px 12px',
  fontSize: 14,
  width: '100%',
  boxSizing: 'border-box',
};
