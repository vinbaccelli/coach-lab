'use client';

import Link from 'next/link';
import type { PlayerSession, SessionArtifact } from '@/lib/sessions/types';

const typeLabels: Record<string, string> = {
  stromotion: 'StroMotion',
  ai_metrics: 'AI Metrics',
  combined: 'Combined analysis',
  recording: 'Recording',
  other: 'Analysis',
};

function primaryArtifact(session: PlayerSession): SessionArtifact | undefined {
  return (
    session.artifacts.find((a) => a.kind === 'stromotion_png')
    ?? session.artifacts.find((a) => a.kind === 'metrics_frame')
    ?? session.artifacts[0]
  );
}

export default function SessionTimelineCard({
  session,
  playerId,
}: {
  session: PlayerSession;
  playerId: string;
}) {
  const thumb = primaryArtifact(session);
  const label = typeLabels[session.analysisType] ?? session.analysisType;
  const isDraft = session.status === 'draft';
  const href = isDraft
    ? `/analysis?playerId=${playerId}&sessionId=${session.id}`
    : `/players/${playerId}/sessions/${session.id}`;

  return (
    <Link
      href={href}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <article
        style={{
          display: 'flex',
          gap: 12,
          padding: 14,
          borderRadius: 12,
          background: '#fff',
          border: isDraft ? '1px solid #fcd34d' : '1px solid #E7E5E4',
          cursor: 'pointer',
        }}
      >
        {thumb?.publicUrl ? (
          <img
            src={thumb.publicUrl}
            alt=""
            style={{
              width: 72,
              height: 72,
              objectFit: 'cover',
              borderRadius: 8,
              flexShrink: 0,
              background: '#f5f5f4',
            }}
          />
        ) : (
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 8,
              background: isDraft ? '#fffbeb' : '#f5f5f4',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: '#78716c',
              textAlign: 'center',
              padding: 4,
            }}
          >
            {isDraft ? 'Continue' : label}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '4px 8px',
                borderRadius: 8,
                background: isDraft ? '#fef3c7' : '#e0f2fe',
                color: isDraft ? '#b45309' : '#0369a1',
              }}
            >
              {isDraft ? 'Draft' : label}
            </span>
            <span style={{ fontSize: 11, color: '#78716c' }}>
              {new Date(session.updatedAt ?? session.createdAt).toLocaleString()}
            </span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8 }}>{session.title}</div>
          {session.coachNotes?.trim() ? (
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 12,
                color: '#78716c',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {session.coachNotes}
            </p>
          ) : isDraft ? (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#b45309' }}>
              Continue in Video Analysis → Save Report when ready
            </p>
          ) : null}
          {!isDraft ? (
            <div style={{ fontSize: 11, color: '#a8a29e', marginTop: 6 }}>
              {session.artifacts.length} artifact{session.artifacts.length === 1 ? '' : 's'}
            </div>
          ) : null}
        </div>
      </article>
    </Link>
  );
}
