import SharedReportClient from '@/components/players/SharedReportClient';

export default async function ShareReportPage({ params }: { params: Promise<{ token: string; entryId: string }> }) {
  const { token, entryId } = await params;
  return <SharedReportClient token={token} entryId={entryId} />;
}
