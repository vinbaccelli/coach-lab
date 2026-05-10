import WorkspaceChrome from '@/components/WorkspaceChrome';
import PlayerProfileClient from '@/components/players/PlayerProfileClient';

export default async function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <WorkspaceChrome pageLabel="Player profile">
      <div style={{ padding: '20px 16px 40px' }}>
        <PlayerProfileClient playerId={id} />
      </div>
    </WorkspaceChrome>
  );
}
