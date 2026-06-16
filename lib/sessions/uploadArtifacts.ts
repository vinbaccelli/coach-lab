import type { PendingArtifact, SessionArtifact } from '@/lib/sessions/types';
import { mimeToExt, sessionArtifactPath } from '@/lib/sessions/storagePaths';

async function pendingToBlob(pending: PendingArtifact): Promise<Blob | null> {
  if (pending.blob) return pending.blob;
  if (pending.dataUrl) {
    const res = await fetch(pending.dataUrl);
    return res.blob();
  }
  return null;
}

export interface UploadArtifactsOptions {
  coachId: string;
  playerId: string;
  sessionId: string;
  pending: PendingArtifact[];
  upload: (path: string, blob: Blob, mime: string) => Promise<{ publicUrl?: string }>;
}

export async function uploadPendingArtifacts(
  options: UploadArtifactsOptions,
): Promise<SessionArtifact[]> {
  const { coachId, playerId, sessionId, pending, upload } = options;
  const artifacts: SessionArtifact[] = [];

  for (const item of pending) {
    const blob = await pendingToBlob(item);
    if (!blob) continue;
    const ext = mimeToExt(item.mime);
    const storagePath = sessionArtifactPath(coachId, playerId, sessionId, item.id, ext);
    const { publicUrl } = await upload(storagePath, blob, item.mime);
    artifacts.push({
      id: item.id,
      kind: item.kind,
      mime: item.mime,
      storagePath,
      publicUrl,
      label: item.label,
      bytes: blob.size,
      width: item.width,
      height: item.height,
    });
  }

  return artifacts;
}

export async function uploadArtifactsViaApi(
  sessionId: string,
  pending: PendingArtifact[],
): Promise<SessionArtifact[]> {
  const form = new FormData();
  form.append('sessionId', sessionId);
  pending.forEach((p, i) => {
    form.append(`meta_${i}`, JSON.stringify({
      id: p.id,
      kind: p.kind,
      mime: p.mime,
      label: p.label,
      width: p.width,
      height: p.height,
    }));
  });

  const blobs = await Promise.all(pending.map((p) => pendingToBlob(p)));
  blobs.forEach((blob, i) => {
    if (blob) form.append(`file_${i}`, blob, `artifact-${i}`);
  });

  const res = await fetch(`/api/sessions/${sessionId}/artifacts`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Artifact upload failed');
  return data.artifacts as SessionArtifact[];
}
