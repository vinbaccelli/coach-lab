import WorkspaceChrome from '@/components/WorkspaceChrome';
import GuidedTour from '@/components/GuidedTour';
import MatchReportClient from '@/components/MatchReportClient';

export default function MatchReportPage() {
  return (
    <WorkspaceChrome pageLabel="Manual match recorder">
      <div style={{ padding: '20px 16px 40px' }}>
        <MatchReportClient />
      </div>
      <GuidedTour page="match-report" />
    </WorkspaceChrome>
  );
}
