import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service — AngleMotion',
  description: 'Terms of service for the AngleMotion coaching platform.',
};

/** Public terms of service — linked from the Google OAuth consent screen. */
export default function TermsPage() {
  return (
    <div style={{
      // The app shell sets body{overflow:hidden}; this page must scroll itself.
      height: '100dvh',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      background: 'linear-gradient(160deg, #0a0a10 0%, #0f1420 100%)',
      color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src="/logo-square-new.jpg" alt="AngleMotion" style={{ width: 28, height: 28, borderRadius: 6 }} />
          <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>
            Angle<span style={{ color: '#FF3B30' }}>Motion</span>
          </span>
        </Link>
        <Link href="/privacy" style={{
          fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', textDecoration: 'none',
          padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.2)',
        }}>
          Privacy Policy
        </Link>
      </div>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 20px 80px', lineHeight: 1.65 }}>
        <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: -0.5, margin: '0 0 6px' }}>Terms of Service</h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: '0 0 36px' }}>Last updated: July 3, 2026</p>

        <Section title="1. The service">
          AngleMotion (&ldquo;the Service&rdquo;), available at{' '}
          <a href="https://www.anglemotion.com" style={a}>www.anglemotion.com</a>, is a video-analysis platform for
          tennis coaches: pose analysis, drawing tools, StroMotion composites, and report exports to your own Google
          Drive and YouTube. By creating an account or using the Service you agree to these terms.
        </Section>

        <Section title="2. Your account">
          You sign in with your Google account and are responsible for activity under it. You must be at least 18 years
          old to hold an account. You may stop using the Service and request deletion of your data at any time
          (see the <Link href="/privacy" style={a}>Privacy Policy</Link>).
        </Section>

        <Section title="3. Subscriptions and billing">
          Paid plans are billed through Stripe on a monthly or yearly basis and renew automatically until cancelled.
          You can cancel anytime from the billing page — access continues until the end of the paid period. Prices may
          change with notice; changes apply from the next billing cycle.
        </Section>

        <Section title="4. Your content">
          You keep full ownership of your videos, analyses, reports, and player data. Videos are processed locally in
          your browser and are not stored on our servers. Content you export to Google Drive or YouTube lives in your
          own accounts under Google&rsquo;s terms. You are responsible for having the right to analyze the footage you
          use, including consent from the people in it.
        </Section>

        <Section title="5. Acceptable use">
          Do not misuse the Service: no unlawful content, no attempts to break, overload, or reverse-engineer the
          platform, no reselling of the Service, and no uploading of content that infringes the rights of others.
        </Section>

        <Section title="6. AI features">
          Pose detection and AI measurements are estimates provided as a starting point for coaching analysis. They can
          be inaccurate and are always editable by the coach. They are not medical, physiotherapeutic, or safety
          advice.
        </Section>

        <Section title="7. Availability and changes">
          We work to keep the Service available and improving, but it is provided &ldquo;as is&rdquo; without
          warranties. Features may change. We may suspend accounts that violate these terms.
        </Section>

        <Section title="8. Liability">
          To the maximum extent permitted by law, our liability is limited to the amount you paid for the Service in
          the 12 months before the claim.
        </Section>

        <Section title="9. Contact">
          Questions about these terms: <a href="mailto:vinbaccelli@gmail.com" style={a}>vinbaccelli@gmail.com</a>.
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 10px', letterSpacing: -0.2 }}>{title}</h2>
      <div style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.82)' }}>{children}</div>
    </section>
  );
}

const a: React.CSSProperties = { color: '#4DA3FF', textDecoration: 'underline' };
