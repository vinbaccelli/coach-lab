import SharedProfileClient from '@/components/players/SharedProfileClient';

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedProfileClient token={token} />;
}
