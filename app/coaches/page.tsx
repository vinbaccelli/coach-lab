import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface CoachRow {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  avatar_url: string | null;
  accent_color: string | null;
}

export default async function CoachesPage() {
  let coaches: CoachRow[] = [];

  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from('coach_profiles').select('id, slug, name, tagline, avatar_url, accent_color').order('name');
    coaches = (data as CoachRow[] | null) ?? [];
  } catch { /* DB not configured */ }

  return (
    <div style={{
      height: '100dvh',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      background: 'linear-gradient(160deg, #0a0a10 0%, #0f1420 100%)',
      color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src="/logo-square-new.jpg" alt="AngleMotion" style={{ width: 28, height: 28, borderRadius: 6 }} />
          <span style={{ fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: -0.3 }}>
            Angle<span style={{ color: '#007AFF' }}>Motion</span>
          </span>
        </Link>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/analysis" style={{
            fontSize: 12, fontWeight: 600, color: '#fff', textDecoration: 'none',
            padding: '6px 14px', borderRadius: 20, background: '#007AFF',
          }}>
            Try Free →
          </Link>
          <Link href="/login" style={{
            fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', textDecoration: 'none',
            padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.2)',
          }}>
            Sign In
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 20px 80px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 32, fontWeight: 900, letterSpacing: -0.5 }}>
            Find a Coach
          </h1>
          <p style={{ margin: 0, fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
            Browse certified coaches using AngleMotion for video analysis and training.
          </p>
        </div>

        {coaches.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎾</div>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', margin: '0 0 20px' }}>
              No coach profiles yet. Be the first to create yours!
            </p>
            <Link href="/login" style={{
              display: 'inline-block', padding: '12px 24px', borderRadius: 12,
              background: '#007AFF', color: '#fff', fontWeight: 700, fontSize: 14,
              textDecoration: 'none',
            }}>
              Create Your Profile
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {coaches.map(coach => (
              <Link
                key={coach.id}
                href={`/coach/${coach.slug}`}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                  padding: '24px 16px', borderRadius: 16,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  textDecoration: 'none', color: '#fff',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${coach.accent_color ?? '#007AFF'} 0%, #5856D6 100%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 24, fontWeight: 900, color: '#fff',
                  boxShadow: `0 4px 16px ${(coach.accent_color ?? '#007AFF')}40`,
                }}>
                  {coach.avatar_url
                    ? <img src={coach.avatar_url} alt={coach.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                    : coach.name.charAt(0)}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{coach.name}</div>
                  {coach.tagline && (
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4, lineHeight: 1.4 }}>
                      {coach.tagline}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', textDecoration: 'none' }}>
            Powered by anglemotion.com
          </Link>
        </div>
      </div>
    </div>
  );
}
