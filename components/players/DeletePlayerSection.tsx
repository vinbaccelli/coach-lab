'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { driveFolderPath, namesMatch } from '@/lib/players/deletePlayer';

type Outcome = {
  ok: true;
  complete: boolean;
  message: string;
  drive: { status: string; folderPath: string };
  storage: { status: string };
};

/**
 * "Danger zone" at the bottom of the player profile. Deleting needs the player's name typed in
 * (trimmed, case-insensitive; the server checks it again), says exactly what goes away, and ends
 * with the server's own result: if Drive could not be reached, the folder to delete by hand is
 * named and the page stays until the coach has read it. Not plan-gated.
 */
export default function DeletePlayerSection({ playerId, playerName }: { playerId: string; playerName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef(false);
  const matches = namesMatch(typed, playerName);

  // A fully clean delete goes back to the list by itself after the message has been on screen.
  useEffect(() => {
    if (!outcome?.complete) return;
    const t = setTimeout(() => router.push('/players'), 3500);
    return () => clearTimeout(t);
  }, [outcome, router]);

  const remove = async () => {
    if (inFlight.current || !matches) return; // no double taps
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/players/${playerId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_name: typed }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<Outcome> & { message?: string; error?: string };
      if (!res.ok || !data.ok) {
        // Nothing was deleted (the server stops before touching anything else); say what it said.
        setError(data.message ?? data.error ?? `The player could not be deleted (HTTP ${res.status}).`);
        return;
      }
      setOutcome(data as Outcome);
    } catch (e) {
      setError(`Could not reach the server — ${e instanceof Error ? e.message : 'network error'}. Check the Players list before trying again.`);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const box = { marginTop: 32, padding: 18, borderRadius: 16, border: '1px solid rgba(185,28,28,0.35)', background: 'rgba(255,59,48,0.04)' } as const;

  if (outcome) {
    return (
      <section style={box} aria-live="polite">
        <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800, color: 'var(--cl-destructive-text)' }}>
          {outcome.complete ? 'Player deleted' : 'Player deleted — one thing to finish by hand'}
        </h2>
        <p role="status" style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.5 }}>{outcome.message}</p>
        <Link href="/players" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 16px', borderRadius: 12, background: 'var(--cl-action-primary)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
          Back to Players
        </Link>
      </section>
    );
  }

  return (
    <section style={box} aria-labelledby="danger-zone-title">
      <h2 id="danger-zone-title" style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, color: 'var(--cl-destructive-text)' }}>Danger zone</h2>
      {!open ? (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5, color: 'var(--cl-text-secondary)' }}>
            Delete this player, all of their reports, and their folder in your Google Drive.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid var(--cl-destructive-text)', background: 'var(--cl-bg-panel)', color: 'var(--cl-destructive-text)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            Delete player…
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.5 }}>
            This deletes <strong>{playerName}</strong>, <strong>all of their reports</strong>, and <strong>their folder in your Google Drive</strong> ({driveFolderPath(playerName)}).
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5, color: 'var(--cl-text-secondary)' }}>
            The player and the reports cannot be brought back. The Drive folder goes to your Drive trash, where it stays recoverable for 30 days.
          </p>
          <label htmlFor="delete-player-name" style={{ display: 'block', margin: '0 0 6px', fontSize: 13, fontWeight: 600 }}>
            Type <strong>{playerName}</strong> to confirm
          </label>
          <input
            id="delete-player-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            style={{ width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--cl-border)', fontSize: 16 }}
          />
          {error ? (
            <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.45, color: 'var(--cl-destructive-text)', fontWeight: 600 }}>{error}</p>
          ) : null}
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={!matches || busy}
              style={{
                minHeight: 44, padding: '0 16px', borderRadius: 12, border: 'none', fontWeight: 700, fontSize: 14,
                background: matches && !busy ? '#C62828' : 'var(--cl-fill-inactive)',
                color: matches && !busy ? '#fff' : 'var(--cl-text-muted)',
                cursor: !matches ? 'not-allowed' : busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? 'Deleting…' : 'Delete player permanently'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setTyped(''); setError(null); }}
              disabled={busy}
              style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
