import { NextResponse } from 'next/server';
import { resolveShare, type Db, type Share } from '@/lib/players/shareAccess';
import { getYouTubeAccessToken } from '@/lib/youtube/connection';
import { selectUploadOrigin, YOUTUBE_UPLOAD_COULD_NOT_START } from '@/lib/youtube/uploadOrigin';
import { createYoutubeUploadSession } from '@/lib/youtube/uploadSession';
import { coachMayHostUploads } from '@/lib/players/coachHost';
import { shareVideoTitle, validateShareVideoRequest, withinUploadLimits } from '@/lib/players/shareVideo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/**
 * A player (no login) uploads a video to the COACH's YouTube channel, as unlisted. Only for a "can add" link.
 * Same pattern as /api/youtube/upload-session: this route creates the resumable session with the coach's
 * server-held grant and returns the session URL; the video bytes go from the player's browser straight to Google.
 * Brakes: origin allow-list, coach must still have the Pro tools, 5 uploads / link / day, 20 / coach / day,
 * 600 MB cap, server-built title. The player then adds the finished video to the timeline through the normal
 * share POST (which has its own hourly brake).
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE });
  if (!share.perms.add.videos) return NextResponse.json({ error: 'This link does not allow adding videos.' }, { status: 403, headers: NO_STORE });

  const origin = selectUploadOrigin(req.headers.get('origin'));
  if (!origin) return NextResponse.json({ error: YOUTUBE_UPLOAD_COULD_NOT_START }, { status: 400, headers: NO_STORE });

  const v = validateShareVideoRequest(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: NO_STORE });

  if (!(await coachMayHostUploads(db, share.coach_id))) {
    return NextResponse.json({ error: 'Video upload is not available on this link right now. You can paste a YouTube link instead.' }, { status: 403, headers: NO_STORE });
  }

  // Count what this link and this coach already started in the last 24 h (fails closed if the table is missing).
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [perLink, perCoach] = await Promise.all([
    db.from('share_video_sessions').select('id', { count: 'exact', head: true }).eq('share_id', share.id).gte('created_at', since),
    db.from('share_video_sessions').select('id', { count: 'exact', head: true }).eq('coach_id', share.coach_id).gte('created_at', since),
  ]);
  if (perLink.error || perCoach.error) {
    console.error('[share/youtube-session] limits read failed:', perLink.error?.message ?? perCoach.error?.message);
    return NextResponse.json({ error: 'Video upload is not available right now.' }, { status: 503, headers: NO_STORE });
  }
  const lim = withinUploadLimits(perLink.count ?? 0, perCoach.count ?? 0);
  if (!lim.ok) return NextResponse.json({ error: lim.error }, { status: 429, headers: NO_STORE });

  const accessToken = await getYouTubeAccessToken(share.coach_id);
  if (!accessToken) return NextResponse.json({ error: 'Video upload is not available on this link right now. You can paste a YouTube link instead.' }, { status: 403, headers: NO_STORE });

  const { data: p } = await db.from('players').select('display_name').eq('id', share.player_id).maybeSingle<{ display_name: string }>();
  // Record BEFORE asking Google: starting a session spends quota whether or not the video is finished.
  const rec = await db.from('share_video_sessions').insert({ share_id: share.id, coach_id: share.coach_id });
  if (rec.error) return NextResponse.json({ error: 'Video upload is not available right now.' }, { status: 503, headers: NO_STORE });

  const s = await createYoutubeUploadSession({
    accessToken,
    origin,
    title: shareVideoTitle(p?.display_name ?? ''),
    description: 'Uploaded from AngleMotion',
    sizeBytes: v.req.sizeBytes,
    mimeType: v.req.mimeType,
  });
  if (!s.ok) return NextResponse.json({ error: 'Video upload is not available right now. You can paste a YouTube link instead.' }, { status: s.status, headers: NO_STORE });
  return NextResponse.json({ uploadUrl: s.uploadUrl }, { headers: NO_STORE });
}
