import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { google } from 'googleapis';
import { requireFeature } from '@/lib/entitlements.server';
import { trashDriveFile } from '@/lib/google/drive';
import { deletePlayer, supabaseDeleteStore } from '@/lib/players/deletePlayer';

// googleapis (Drive trash on DELETE) needs the Node runtime; a delete touches Drive and Storage.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const { data: player, error: pe } = await session.supabase
    .from('players')
    .select('*')
    .eq('id', id)
    .single();
  if (pe || !player) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: entries, error: ee } = await session.supabase
    .from('player_entries')
    .select('*')
    .eq('player_id', id)
    .order('created_at', { ascending: false });

  if (ee) return NextResponse.json({ error: ee.message }, { status: 500 });

  return NextResponse.json({ player, entries: entries ?? [] });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeature(session.supabase, { id: session.userId, email: session.email }, 'players');
  if (denied) return denied;
  const { id } = await ctx.params;

  const body = (await req.json()) as Partial<{
    display_name: string;
    photo_url: string | null;
    date_of_birth: string | null;
    nationality: string | null;
    playing_hand: string | null;
    notes: string | null;
  }>;

  const { data, error } = await session.supabase
    .from('players')
    .update({
      ...body,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ player: data });
}

/**
 * Delete a player, their reports, their Drive folder (to the Drive TRASH) and stored images.
 * Body: { confirm_name } — the player's name, checked here too. See lib/players/deletePlayer.ts
 * for the order of operations and the result shape.
 *
 * NOT gated by the Pro plan, on purpose: a coach who stopped paying must still be able to
 * delete their players. (The previous handler required the 'players' feature and did neither
 * the name check nor any Drive / Storage cleanup; nothing in the app called it.)
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { confirm_name?: unknown };

  const googleToken = session.googleAccessToken;
  const result = await deletePlayer(
    { playerId: id, typedName: body.confirm_name },
    {
      store: supabaseDeleteStore(session.supabase, session.userId),
      coachId: session.userId,
      hasGoogleAccess: Boolean(googleToken),
      trashDriveItem: async (fileId) => {
        const oauth2 = new google.auth.OAuth2();
        oauth2.setCredentials({ access_token: googleToken });
        await trashDriveFile(google.drive({ version: 'v3', auth: oauth2 }), fileId);
      },
      removeStorageObjects: async (paths) => {
        const { error } = await session.supabase.storage.from('player-assets').remove(paths);
        if (error) throw new Error(error.message);
      },
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
