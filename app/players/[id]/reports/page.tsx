import WorkspaceChrome from '@/components/WorkspaceChrome';
import ReportsIndexClient from '@/components/reports/ReportsIndexClient';

export default async function PlayerReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <WorkspaceChrome pageLabel="Reports">
      <div style={{ padding: '20px 16px 40px' }}>
        <ReportsIndexClient playerId={id} />
      </div>
    </WorkspaceChrome>
  );
}
