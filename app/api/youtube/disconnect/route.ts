import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { disconnectYouTube } from '@/lib/youtube/connection';

export const runtime = 'nodejs';

/**
 * Drop this coach's YouTube grant: revoke it at Google (best effort), then delete
 * the stored row.
 *
 * POST only. A GET that mutates could be triggered by any page that gets the
 * coach to load a URL, and "your YouTube disconnected itself" is a confusing
 * failure to debug.
 */
export async function POST() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await disconnectYouTube(session.userId);
  if (!ok) {
    return NextResponse.json({ error: 'Could not disconnect YouTube.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
