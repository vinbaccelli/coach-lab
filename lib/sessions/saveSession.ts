import { buildCreateSessionRequest, collectPendingArtifacts } from '@/lib/sessions/buildSessionPayload';
import type { SessionDraft, PlayerSession } from '@/lib/sessions/types';

export interface SaveSessionOptions {
  /** When set, updates an existing draft session instead of creating a new row. */
  sessionId?: string;
}

async function uploadPendingArtifacts(
  playerId: string,
  sessionId: string,
  draft: SessionDraft,
): Promise<PlayerSession> {
  const pending = collectPendingArtifacts(draft);
  if (pending.length === 0) {
    return fetchSession(playerId, sessionId);
  }

  const form = new FormData();
  form.append('playerId', playerId);
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

  const blobs = await Promise.all(
    pending.map(async (p) => {
      if (p.blob) return p.blob;
      if (p.dataUrl) {
        const res = await fetch(p.dataUrl);
        return res.blob();
      }
      return null;
    }),
  );
  blobs.forEach((blob, i) => {
    if (blob) form.append(`file_${i}`, blob, `artifact-${i}`);
  });

  const uploadRes = await fetch(`/api/sessions/${sessionId}/artifacts`, {
    method: 'POST',
    body: form,
  });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok) throw new Error(uploadData.error ?? 'Artifact upload failed');
  return uploadData.session as PlayerSession;
}

async function fetchSession(playerId: string, sessionId: string): Promise<PlayerSession> {
  const res = await fetch(`/api/players/${playerId}/sessions/${sessionId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to load session');
  return data.session as PlayerSession;
}

export async function saveSessionDraft(
  playerId: string,
  draft: SessionDraft,
  options?: SaveSessionOptions,
): Promise<PlayerSession> {
  const createBody = buildCreateSessionRequest(draft, []);
  const payload = { ...createBody, status: 'saved' as const };

  let session: PlayerSession;

  if (options?.sessionId) {
    const patchRes = await fetch(`/api/players/${playerId}/sessions/${options.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const patchData = await patchRes.json();
    if (!patchRes.ok) throw new Error(patchData.error ?? 'Failed to update session');
    session = patchData.session as PlayerSession;
    session = await uploadPendingArtifacts(playerId, session.id, draft);
  } else {
    const createRes = await fetch(`/api/players/${playerId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const createData = await createRes.json();
    if (!createRes.ok) throw new Error(createData.error ?? 'Failed to create session');
    session = createData.session as PlayerSession;
    session = await uploadPendingArtifacts(playerId, session.id, draft);
  }

  return session;
}

export async function createPlayerDraftSession(
  playerId: string,
  title: string,
): Promise<PlayerSession> {
  const res = await fetch(`/api/players/${playerId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      analysisType: 'other',
      status: 'draft',
      source: 'player_profile',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to create session');
  return data.session as PlayerSession;
}

/** @deprecated use saveSessionDraft */
export { uploadArtifactsViaApi } from '@/lib/sessions/uploadArtifacts';
