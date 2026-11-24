import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getRouteSession } from '@/lib/auth/routeSession';
import { requireFeature } from '@/lib/entitlements.server';
import { REPORTS_IN_APP } from '@/lib/featureFlags';
import { trashDriveFile } from '@/lib/google/drive';
import { deleteEntry, editEntryNote, supabaseEntryStore } from '@/lib/reports/entryOps';

// googleapis (the Drive trash on DELETE) needs the Node runtime.
export const runtime = 'nodejs';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string; entryId: string }> };

/**
 * PATCH /api/players/[id]/entries/[entryId]  body: { note }
 * Changes ONLY the note (`body_text`) of a technique entry. Owner check: the coach's own session
 * client (RLS) plus the player id in the URL. Same plan guard as the other player writes.
 * With REPORTS_IN_APP off the in-app report pages do not exist, so neither does this route.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  if (!REPORTS_IN_APP) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeature(session.supabase, { id: session.userId, email: session.email }, 'players');
  if (denied) return denied;
  const { id: playerId, entryId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { note?: unknown };
  const result = await editEntryNote(supabaseEntryStore(session.supabase as never, session.userId), { playerId, entryId, note: body.note });
  return NextResponse.json(result.body, { status: result.status });
}

/**
 * DELETE /api/players/[id]/entries/[entryId]
 * Row first, then the Drive file(s) to the Drive TRASH (never permanent; the same helper as delete-player).
 * A Drive failure never undoes the delete; it is logged without data and reported in the answer.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  if (!REPORTS_IN_APP) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeature(session.supabase, { id: session.userId, email: session.email }, 'players');
  if (denied) return denied;
  const { id: playerId, entryId } = await ctx.params;
  const googleToken = session.googleAccessToken;
  const result = await deleteEntry(
    {
      store: supabaseEntryStore(session.supabase as never, session.userId),
      hasGoogleAccess: Boolean(googleToken),
      trashDriveItem: async (fileId) => {
        const oauth2 = new google.auth.OAuth2();
        oauth2.setCredentials({ access_token: googleToken });
        await trashDriveFile(google.drive({ version: 'v3', auth: oauth2 }), fileId);
      },
      log: (message, detail) => console.error(message, detail),
    },
    { playerId, entryId },
  );
  return NextResponse.json(result.body, { status: result.status });
}
