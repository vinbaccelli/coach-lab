import CoachPublicProfile from '@/components/coach/CoachPublicProfile';

export default function CoachPage({ params }: { params: { slug: string } }) {
  return <CoachPublicProfile slug={params.slug} />;
}
