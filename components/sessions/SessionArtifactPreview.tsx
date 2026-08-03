'use client';

import type { SessionArtifact } from '@/lib/sessions/types';
import { displayArtifactLabel } from '@/lib/sessions/displayLabels';

export default function SessionArtifactPreview({ artifact }: { artifact: SessionArtifact }) {
  const isVideo = artifact.mime.startsWith('video/');
  const isImage = artifact.mime.startsWith('image/');
  const url = artifact.publicUrl;
  // Sanitized at display time — the stored `label`/`kind` are never rewritten,
  // see lib/sessions/displayLabels.ts.
  const label = displayArtifactLabel(artifact);

  if (!url) {
    return (
      <div style={{ padding: 12, borderRadius: 10, background: '#f5f5f4', fontSize: 12, color: '#78716c' }}>
        {label} (no preview URL)
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #E7E5E4' }}>
      {isImage ? (
        <img src={url} alt={label} style={{ width: '100%', display: 'block' }} />
      ) : isVideo ? (
        <video src={url} controls playsInline style={{ width: '100%', display: 'block', background: '#000' }} />
      ) : (
        <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block', padding: 12, fontSize: 13 }}>
          Download {label}
        </a>
      )}
      {artifact.label ? (
        <div style={{ padding: '8px 10px', fontSize: 12, fontWeight: 600, background: '#fafaf9' }}>
          {label}
        </div>
      ) : null}
    </div>
  );
}
