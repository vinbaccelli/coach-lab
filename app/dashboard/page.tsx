import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? 'Coach';

  return (
    <div style={{ minHeight: '100vh', padding: 24, background: '#0b0b0c', color: '#fff' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>Control Panel</h1>
        <p style={{ margin: '8px 0 18px', opacity: 0.75, fontSize: 13 }}>
          Signed in as <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{email}</span>
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Link href="/" style={cardStyle}>
            <div style={{ fontSize: 14, fontWeight: 900 }}>Video Analysis</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              Analyze videos on desktop/tablet/phone with overlays, skeleton and recording.
            </div>
          </Link>

          <Link href="/players" style={cardStyle}>
            <div style={{ fontSize: 14, fontWeight: 900 }}>Players Database</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              Coming next: technical sheets, match analysis, and technical analysis timeline.
            </div>
          </Link>

          <div style={{ ...cardStyle, opacity: 0.7 }}>
            <div style={{ fontSize: 14, fontWeight: 900 }}>Billing</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              Coming next: Stripe monthly/yearly subscriptions and access control.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  display: 'block',
  padding: 16,
  borderRadius: 16,
  background: 'rgba(15, 15, 18, 0.65)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff',
  textDecoration: 'none',
  backdropFilter: 'blur(10px)',
};

