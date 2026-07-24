'use client';

import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import SessionArtifactPreview from '@/components/sessions/SessionArtifactPreview';
import type { PlayerSession } from '@/lib/sessions/types';

const typeLabels: Record<string, string> = {
  stromotion: 'StroMotion',
  ai_metrics: 'AI Metrics',
  combined: 'Combined analysis',
  recording: 'Recording',
  other: 'Analysis',
};

export default function PlayerSessionDetailClient({
  playerId,
  playerName,
  session,
}: {
  playerId: string;
  playerName: string;
  session: PlayerSession;
}) {
  const label = typeLabels[session.analysisType] ?? session.analysisType;
  const videoUrl = session.videoRef.url;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Link
        href={`/players/${playerId}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          color: '#007AFF',
          textDecoration: 'none',
          marginBottom: 16,
        }}
      >
        <ArrowLeft size={16} /> Back to {playerName}
      </Link>

      <div
        style={{
          background: 'rgba(250, 249, 247, 0.96)',
          border: '1px solid #E5E5E5',
          borderRadius: 16,
          padding: 20,
          color: '#1A1A1A',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '4px 8px',
              borderRadius: 8,
              background: '#e0f2fe',
              color: '#0369a1',
            }}
          >
            {label}
          </span>
          <span style={{ fontSize: 12, color: '#78716c' }}>
            {new Date(session.createdAt).toLocaleString()}
          </span>
        </div>

        <h1 style={{ margin: '12px 0 8px', fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>
          {session.title}
        </h1>

        {session.coachNotes?.trim() ? (
          <section style={{ marginTop: 16 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#44403c' }}>Coach notes</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{session.coachNotes}</p>
          </section>
        ) : null}

        {videoUrl ? (
          <section style={{ marginTop: 16 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#44403c' }}>Source video</h2>
            <a href={videoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: '#2563eb' }}>
              {session.videoRef.label ?? videoUrl}
            </a>
          </section>
        ) : null}

        {session.measurements?.measurements?.length ? (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#44403c' }}>Measurements summary</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              {session.measurements.measurements.map((m) => (
                <div key={m.phaseId} style={{ padding: 10, borderRadius: 8, background: '#fafaf9', border: '1px solid #e7e5e4' }}>
                  <strong>{m.phaseLabel}</strong> @ {m.timeSec.toFixed(2)}s
                  {m.racketAngleDeg != null ? ` · Racket ${m.racketAngleDeg}°` : ''}
                  {m.shoulderHipSeparationDeg != null ? ` · S-H ${m.shoulderHipSeparationDeg}°` : ''}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section style={{ marginTop: 24 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#44403c' }}>Artifacts</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {session.artifacts.map((artifact) => (
              <div key={artifact.id}>
                <SessionArtifactPreview artifact={artifact} />
                {artifact.publicUrl ? (
                  <a
                    href={artifact.publicUrl}
                    download
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 8,
                      fontSize: 13,
                      color: '#2563eb',
                      textDecoration: 'none',
                    }}
                  >
                    <Download size={14} /> Download
                  </a>
                ) : null}
              </div>
            ))}
            {session.artifacts.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: '#78716c' }}>No artifacts stored for this session.</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
