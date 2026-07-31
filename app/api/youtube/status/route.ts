import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { getYouTubeConnectionInfo } from '@/lib/youtube/connection';

export const runtime = 'nodejs';

/**
 * Whether this coach has connected YouTube — the question the UI actually asks.
 *
 * Exists so the browser never needs to see `youtube_connections`. That table has
 * RLS on with zero policies precisely so no client can read it; this returns the
 * one boolean the UI needs, plus a display name, and no token material of any
 * kind. Deliberately does NOT hit Google: it answers "is there a stored grant",
 * not "is that grant still valid" — a revoked grant surfaces at upload time as
 * `needsConnect`, which is the moment it can actually be fixed.
 */
export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const info = await getYouTubeConnectionInfo(session.userId);
  return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
}
