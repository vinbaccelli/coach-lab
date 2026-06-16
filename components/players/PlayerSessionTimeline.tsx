'use client';

import type { PlayerSession } from '@/lib/sessions/types';
import SessionTimelineCard from '@/components/sessions/SessionTimelineCard';

export default function PlayerSessionTimeline({
  playerId,
  sessions,
}: {
  playerId: string;
  sessions: PlayerSession[];
}) {
  if (sessions.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: '#78716c' }}>
        No sessions yet. Start a new analysis session above.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sessions.map((s) => (
        <SessionTimelineCard key={s.id} session={s} playerId={playerId} />
      ))}
    </div>
  );
}
