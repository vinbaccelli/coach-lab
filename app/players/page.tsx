import WorkspaceChrome from '@/components/WorkspaceChrome';
import PlayersHomeClient from '@/components/players/PlayersHomeClient';

export default function PlayersPage() {
  return (
    <WorkspaceChrome pageLabel="Players">
      <div style={{ padding: '20px 16px 40px' }}>
        <PlayersHomeClient />
      </div>
    </WorkspaceChrome>
  );
}
