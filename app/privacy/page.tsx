import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — AngleMotion',
  description: 'How AngleMotion collects, uses, and protects your data.',
};

/**
 * Public privacy policy — required for Google OAuth verification of the
 * sensitive scopes (documents, drive.file, youtube.upload). The Google API
 * section intentionally includes the Limited Use disclosure Google reviewers
 * look for. Served at https://www.anglemotion.com/privacy
 */
export default function PrivacyPage() {
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
        <Link href="/pricing" style={{
          fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', textDecoration: 'none',
          padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.2)',
        }}>
          Pricing
        </Link>
      </div>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 20px 80px', lineHeight: 1.65 }}>
        <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: -0.5, margin: '0 0 6px' }}>Privacy Policy</h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: '0 0 36px' }}>Last updated: July 3, 2026</p>

        <Section title="Who we are">
          AngleMotion (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a video-analysis platform for tennis coaches, available at{' '}
          <a href="https://www.anglemotion.com" style={a}>www.anglemotion.com</a>. This policy explains what data we
          collect, how we use it, and the choices you have. Questions: <a href="mailto:vinbaccelli@gmail.com" style={a}>vinbaccelli@gmail.com</a>.
        </Section>

        <Section title="Your videos stay on your device">
          Videos you analyze in AngleMotion are processed <strong>locally in your browser</strong>. We do not upload,
          store, or view your video files on our servers. When you choose to export, videos go directly from your
          browser to <strong>your own</strong> YouTube account, and reports to <strong>your own</strong> Google Drive.
        </Section>

        <Section title="Information we collect">
          <ul style={ul}>
            <li><strong>Account information:</strong> when you sign in with Google we receive your name, email address, and profile picture.</li>
            <li><strong>Content you create:</strong> player profiles, notes, measurements, and analysis screenshots you choose to save are stored in our database (hosted by Supabase) so you can access them across devices.</li>
            <li><strong>Payment information:</strong> subscriptions are processed by Stripe. We never see or store your card details — we only store your subscription status.</li>
            <li><strong>Technical basics:</strong> authentication cookies to keep you signed in. We do not run third-party advertising or tracking.</li>
          </ul>
        </Section>

        <Section title="How we use Google user data">
          AngleMotion requests three Google permissions, used <strong>only when you explicitly trigger an export</strong>:
          <ul style={ul}>
            <li><strong>Google Docs</strong> (create documents): to generate the coaching reports you request.</li>
            <li><strong>Google Drive</strong> (per-file access): to organize the reports and folders <em>created by AngleMotion</em> in your Drive. We cannot see, read, or modify any other files in your Drive.</li>
            <li><strong>YouTube</strong> (upload videos): to upload analysis videos you export to your own channel, as Unlisted, on your request.</li>
          </ul>
          We never read your Google data for any other purpose, never use it for advertising, and no humans read it.
          You can revoke AngleMotion&rsquo;s access at any time at{' '}
          <a href="https://myaccount.google.com/permissions" style={a}>myaccount.google.com/permissions</a> — the app
          keeps working; only the export features stop.
          <p style={{ marginTop: 12 }}>
            AngleMotion&rsquo;s use and transfer of information received from Google APIs adheres to the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" style={a}>
              Google API Services User Data Policy
            </a>, including the Limited Use requirements.
          </p>
        </Section>

        <Section title="Who we share data with">
          We do not sell your data. We share it only with the processors that run the service: Supabase (database and
          authentication), Stripe (payments), Google (only the exports you trigger), and Vercel (hosting).
        </Section>

        <Section title="Data retention and deletion">
          Your saved content is kept while your account is active. To delete your account and all associated data,
          email <a href="mailto:vinbaccelli@gmail.com" style={a}>vinbaccelli@gmail.com</a> and we will remove it within
          30 days. Reports and videos already exported to your Google Drive and YouTube belong to you and are
          unaffected by deletion of your AngleMotion account.
        </Section>

        <Section title="Security">
          Data is transmitted over HTTPS and stored with row-level security so each coach can only access their own
          data. Google access tokens are used transiently for the exports you request and are not stored on our servers.
        </Section>

        <Section title="Children">
          AngleMotion is a tool for coaches and is not directed at children under 13. Player profiles created by
          coaches should comply with local regulations and parental consent where applicable.
        </Section>

        <Section title="Changes to this policy">
          We will post any changes on this page and update the date above. Material changes will be announced in the app.
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
const ul: React.CSSProperties = { margin: '10px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 };
