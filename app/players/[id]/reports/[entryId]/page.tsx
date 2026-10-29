import WorkspaceChrome from '@/components/WorkspaceChrome';
import ReportViewClient from '@/components/reports/ReportViewClient';

export default async function PlayerReportPage({ params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  return (
    <WorkspaceChrome pageLabel="Report">
      <div style={{ padding: '20px 16px 56px' }}>
        <ReportViewClient playerId={id} entryId={entryId} />
      </div>
    </WorkspaceChrome>
  );
}
