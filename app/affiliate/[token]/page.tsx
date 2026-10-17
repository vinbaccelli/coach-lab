import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { influencerView } from '@/lib/affiliates.server';
import { formatEur, referralLink } from '@/lib/affiliates';

/**
 * An affiliate's own page, /affiliate/<view_token>: public, read-only, no login,
 * never indexed. The token is the secret (43 random characters). It shows the
 * affiliate's link and totals, and per commission only the date, amount and
 * status — never who the referred coaches are (lib/affiliates.server.ts
 * influencerView reads no names, emails or ids for display). Unknown token: 404.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Affiliate — AngleMotion',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const STATUS: Record<string, string> = { pending: 'Pending', paid: 'Paid', void: 'Void' };

export default async function AffiliatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createSupabaseServiceClient();
  const view = db ? await influencerView(db, token).catch(() => null) : null;
  if (!view) notFound();
  const { summary: s } = view;
  const stats: Array<[string, string]> = [
    ['Clicks', String(s.clicks)],
    ['Signups', String(s.signups)],
    ['Buyers', String(s.buyers)],
    ['Pending', formatEur(s.pendingCents)],
    ['Paid', formatEur(s.paidCents)],
  ];

  return (
    <div style={{
      height: '100dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      background: 'linear-gradient(160deg, #0a0a10 0%, #0f1420 100%)', color: 'var(--cl-text-on-fill)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '28px 16px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={card}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, opacity: 0.7 }}>AngleMotion affiliate</p>
          <h1 style={{ margin: '4px 0 8px', fontSize: 22, fontWeight: 800 }}>{view.name}</h1>
          {!view.active && <p style={{ margin: '0 0 8px', fontSize: 13, color: 'rgb(255,179,64)' }}>This link is paused: new clicks are not counted.</p>}
          <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>Your link</p>
          <code style={{ fontSize: 14, wordBreak: 'break-all' }}>{referralLink(view.code)}</code>
        </div>

        <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
          {stats.map(([k, v]) => (
            <div key={k}>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>{k}</p>
              <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{v}</p>
            </div>
          ))}
        </div>

        <section style={card}>
          <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800 }}>Commissions</h2>
          {view.commissions.length === 0 ? <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>None yet.</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {view.commissions.map((c, i) => (
                  <tr key={i}>
                    <td style={td}>{fmt(c.date)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatEur(c.amountCents)}</td>
                    <td style={td}>{STATUS[c.status] ?? c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}

const card: React.CSSProperties = { padding: 20, borderRadius: 14, background: 'rgba(15, 15, 18, 0.65)', border: '1px solid rgba(255,255,255,0.12)' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 12, fontWeight: 700, opacity: 0.8, borderBottom: '1px solid rgba(255,255,255,0.12)' };
const td: React.CSSProperties = { padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)' };
