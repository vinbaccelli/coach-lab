import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { uploadSessionAsset } from '@/lib/sessions/serverStorage';
import { mimeToExt, sessionArtifactPath } from '@/lib/sessions/storagePaths';
import { rowToPlayerSession } from '@/lib/sessions/types';
import type { SessionArtifact, SessionArtifactKind } from '@/lib/sessions/types';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { sessionId } = await ctx.params;

  const form = await req.formData();
  const playerId = String(form.get('playerId') ?? '');
  if (!playerId) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }

  const { data: playerSession, error: se } = await session.supabase
    .from('player_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('player_id', playerId)
    .single();

  if (se || !playerSession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const newArtifacts: SessionArtifact[] = [];
  const indices = [...form.keys()]
    .filter((k) => k.startsWith('meta_'))
    .map((k) => k.replace('meta_', ''));

  for (const idx of indices) {
    const metaRaw = form.get(`meta_${idx}`);
    const file = form.get(`file_${idx}`);
    if (!metaRaw || !(file instanceof Blob)) continue;

    const meta = JSON.parse(String(metaRaw)) as {
      id: string;
      kind: SessionArtifactKind;
      mime: string;
      label?: string;
      width?: number;
      height?: number;
    };

    const ext = mimeToExt(meta.mime);
    const storagePath = sessionArtifactPath(
      session.userId,
      playerId,
      sessionId,
      meta.id,
      ext,
    );

    const { publicUrl } = await uploadSessionAsset(
      session.supabase,
      storagePath,
      file,
      meta.mime,
    );

    newArtifacts.push({
      id: meta.id,
      kind: meta.kind,
      mime: meta.mime,
      storagePath,
      publicUrl,
      label: meta.label,
      bytes: file.size,
      width: meta.width,
      height: meta.height,
    });
  }

  const existing = (playerSession.artifacts ?? []) as SessionArtifact[];
  const merged = [...existing, ...newArtifacts];

  const { data: updated, error: ue } = await session.supabase
    .from('player_sessions')
    .update({ artifacts: merged })
    .eq('id', sessionId)
    .select('*')
    .single();

  if (ue) return NextResponse.json({ error: ue.message }, { status: 500 });

  return NextResponse.json({
    artifacts: newArtifacts,
    session: rowToPlayerSession(updated),
  });
}
