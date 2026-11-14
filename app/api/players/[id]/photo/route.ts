import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';

export const runtime = 'nodejs';

const BUCKET = 'player-assets';
const MAX_BYTES = 2 * 1024 * 1024; // the page shrinks to 640 px JPEG first; this is the server-side cap

/**
 * Upload the player's profile photo to the coach's folder in `player-assets`
 * ({coach_id}/{player_id}/profile/…, covered by the existing storage policies) and point
 * players.photo_url at it. The previous uploaded photo, if it was one of ours, is removed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const { data: player, error: pe } = await s.supabase.from('players').select('id,photo_url').eq('id', id).maybeSingle();
  if (pe) return dbError(pe);
  if (!player) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return NextResponse.json({ error: 'Choose a JPEG, PNG or WebP picture' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Picture is too large' }, { status: 413 });
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${s.userId}/${id}/profile/${crypto.randomUUID()}.${ext}`;
  const up = await s.supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  const photo_url = s.supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const { error: ue } = await s.supabase.from('players').update({ photo_url, updated_at: new Date().toISOString() }).eq('id', id);
  if (ue) {
    await s.supabase.storage.from(BUCKET).remove([path]);
    return dbError(ue);
  }
  // Remove the photo this replaces, only when it is one of ours in this coach's folder.
  const marker = `/${BUCKET}/`;
  const old = typeof player.photo_url === 'string' && player.photo_url.includes(marker) ? player.photo_url.split(marker)[1] : null;
  if (old && old.startsWith(`${s.userId}/${id}/profile/`)) await s.supabase.storage.from(BUCKET).remove([decodeURIComponent(old)]);
  return NextResponse.json({ photo_url });
}
