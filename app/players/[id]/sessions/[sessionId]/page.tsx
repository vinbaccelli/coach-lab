import WorkspaceChrome from '@/components/WorkspaceChrome';
import PlayerSessionDetailClient from '@/components/players/PlayerSessionDetailClient';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { rowToPlayerSession } from '@/lib/sessions/types';
import { redirect } from 'next/navigation';

export default async function PlayerSessionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id: playerId, sessionId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { session: authSession },
  } = await supabase.auth.getSession();

  if (!authSession?.user) redirect('/login');

  const { data: player } = await supabase
    .from('players')
    .select('id, display_name')
    .eq('id', playerId)
    .single();

  if (!player) redirect('/players');

  const { data: row } = await supabase
    .from('player_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('player_id', playerId)
    .single();

  if (!row) redirect(`/players/${playerId}`);

  const session = rowToPlayerSession(row);

  return (
    <WorkspaceChrome pageLabel={player.display_name}>
      <PlayerSessionDetailClient
        playerId={playerId}
        playerName={player.display_name}
        session={session}
      />
    </WorkspaceChrome>
  );
}
