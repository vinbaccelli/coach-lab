import WorkspaceChrome from '@/components/WorkspaceChrome';
import MatchReportClient from '@/components/MatchReportClient';

export default function MatchReportPage() {
  return (
    <WorkspaceChrome pageLabel="Manual match report">
      <div style={{ padding: '20px 16px 40px' }}>
        <MatchReportClient />
      </div>
    </WorkspaceChrome>
  );
}
