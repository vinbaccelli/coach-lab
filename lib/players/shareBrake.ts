import { withinLinkLimit } from '@/lib/players/share';
import type { Db, Share } from '@/lib/players/shareAccess';

/**
 * Abuse brake for share links: at most LINK_ADDS_PER_HOUR additions per hour through one player's
 * link, counted across every table a link can add to. A table that does not exist yet counts 0.
 */
const TABLES = ['player_timeline_items', 'player_metrics', 'player_tracker_entries'] as const;

export async function linkUnderHourlyLimit(db: Db, share: Pick<Share, 'player_id'>, extraTables: readonly string[] = []): Promise<boolean> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const counts = await Promise.all([...TABLES, ...extraTables].map((t) =>
    db.from(t).select('id', { count: 'exact', head: true }).eq('player_id', share.player_id).eq('author', 'link').gte('created_at', since)));
  return withinLinkLimit(counts.reduce((acc, c) => acc + (c.count ?? 0), 0));
}
