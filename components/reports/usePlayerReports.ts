'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { groupEntriesIntoReports, type EntryLike, type Report } from '@/lib/reports/deriveBlocks';

/**
 * Loads a player's entries and groups them into reports.
 *
 * Always `no-store`, and reloads when the tab becomes visible again: a coach saves
 * from the analysis app and comes back to this page, which must show the new entry
 * without a manual refresh.
 */
export function usePlayerReports(playerId: string) {
  const [playerName, setPlayerName] = useState<string>('');
  const [entries, setEntries] = useState<EntryLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) setLoading(true);
      try {
        const res = await fetch(`/api/players/${playerId}`, { cache: 'no-store' });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          player?: { display_name?: string };
          entries?: EntryLike[];
        };
        if (!res.ok) throw new Error(data.error ?? 'Could not load reports');
        setPlayerName(data.player?.display_name ?? '');
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        setError(null);
      } catch (e) {
        // A quiet refresh failing must not blank a page the coach is reading.
        if (!opts?.quiet) setError(e instanceof Error ? e.message : 'Could not load reports');
      } finally {
        setLoading(false);
      }
    },
    [playerId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load({ quiet: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  const reports: Report[] = useMemo(() => groupEntriesIntoReports(entries), [entries]);

  return { playerName, reports, loading, error, reload: load };
}
