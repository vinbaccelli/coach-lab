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
 *
 * Every statement below is taken from what the code does. Anything the code
 * cannot answer (legal basis, retention periods, company details, hosting
 * regions) is marked with <Confirm>, which renders a visible
 * "[VIN TO CONFIRM: …]" tag. tests/docsWording.test.ts counts them; resolve
 * each one before this page is published.
 */
export default function PrivacyPage() {
  return (
    <div style={{
      // The app shell sets body{overflow:hidden}; this page must scroll itself.
      height: '100dvh',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      background: 'linear-gradient(160deg, #0a0a10 0%, #0f1420 100%)',
      color: 'var(--cl-text-on-fill)',
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
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--cl-text-on-fill)' }}>
            Angle<span style={{ color: 'var(--cl-accent)' }}>Motion</span>
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
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: '0 0 36px' }}>Last updated: November 1, 2026</p>

        <Section title="Who we are">
          AngleMotion (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a video-analysis platform for tennis coaches, available at{' '}
          <a href="https://www.anglemotion.com" style={a}>www.anglemotion.com</a>. This policy explains what data we
          collect, how we use it, and the choices you have. Questions: <a href="mailto:vinbaccelli@gmail.com" style={a}>vinbaccelli@gmail.com</a>.
        </Section>

        <Section title="Your videos stay on your device">
          Videos you analyze in AngleMotion are processed <strong>locally in your browser</strong>. We do not upload,
          store, or view the video files you analyze on our servers. When you choose to publish, videos go directly from
          your browser to <strong>your own</strong> YouTube account, and screenshots to <strong>your own</strong> Google
          Drive. The one exception is a Motion Layer clip that you save with a player&rsquo;s session: that clip is
          stored by AngleMotion with the session (see &ldquo;Where your data is stored&rdquo;).
        </Section>

        <Section title="Information we collect">
          <ul style={ul}>
            <li><strong>Account information:</strong> when you sign in with Google we receive your name, email address, and profile picture.</li>
            <li><strong>Content you create:</strong> the player data, reports, measurements and screenshots described under &ldquo;Player data you store&rdquo;, saved in our database (hosted by Supabase) so you can access them across devices.</li>
            <li><strong>Payment and billing information:</strong> subscriptions are processed by Stripe. We never see or store your card details. We store your subscription status, and for each paid invoice the billing name, email, address, country and tax identifiers that Stripe sends us, so that invoices can be issued and kept for as long as the law requires for accounting and tax. <Confirm>have the accountant confirm the legal basis and how long invoice records must be kept (no period is stated here)</Confirm></li>
            <li><strong>Public coach profile:</strong> if you create one, the name, tagline, bio, picture, services and links you enter are shown publicly at <code>/coach/&lt;your-name&gt;</code>.</li>
            <li><strong>Academy posts:</strong> questions and replies you post in the Academy are stored with your name and email address.</li>
            <li><strong>Technical basics:</strong> authentication cookies to keep you signed in, and a referral cookie (60 days) if you arrived through an affiliate link. We do not run third-party advertising, and the code contains no analytics or tracking scripts other than the error monitoring and the Trustpilot widget described below.</li>
          </ul>
        </Section>

        <Section title="How we use Google user data">
          AngleMotion requests three Google permissions, used <strong>only when you explicitly trigger an export</strong>:
          <ul style={ul}>
            <li><strong>Google Docs</strong> (create documents): only for the optional &ldquo;Export Google Docs report&rdquo; buttons, which create a Google Doc in your account. Player reports themselves are kept in AngleMotion, not in Google Docs.</li>
            <li><strong>Google Drive</strong> (per-file access): to store the screenshots you save to a player in a folder <em>created by AngleMotion</em> in your Drive, and to move that folder to your Drive trash when you delete the player. We cannot see, read, or modify any other files in your Drive.</li>
            <li><strong>YouTube</strong> (upload videos): to upload analysis videos you export to your own channel, as Unlisted, on your request. This is a separate consent: when you connect YouTube we store a refresh token for your channel, encrypted, so uploads can be made on your request. Disconnecting YouTube in the app revokes it at Google (best effort) and deletes the stored token.</li>
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
          We do not sell your data. We share it only with the services that run the product, listed under &ldquo;Services we use&rdquo; below, plus Trustpilot
          through the review widget described below.
          <p style={{ marginTop: 12 }}>
            Our landing page shows a Trustpilot review widget. When it loads, Trustpilot receives your IP address and
            basic browser information, as described in{' '}
            <a href="https://legal.trustpilot.com/for-reviewers/privacy-policy" style={a}>Trustpilot&rsquo;s privacy policy</a>.
            We don&rsquo;t use this for advertising.
          </p>
        </Section>

        <Section title="Player data you store">
          Coaches can store information about the players they coach. In the player profile and reports, AngleMotion
          stores whatever you enter:
          <ul style={ul}>
            <li>name, date of birth, nationality, playing hand and a link to a photo (we store the link, not the picture file);</li>
            <li>your notes, and the technical sheet: its starting rows are age, height, weight, dominant hand, backhand, strengths, weaknesses and level, and you can add rows of your own. These are free text, so you can write anything in them, including health, injury or diet notes, even though the app does not ask for those;</li>
            <li>reports: technique and match reports with dates, YouTube video links, screenshots and your comments, plus, for match reports, opponent names, match dates and match statistics;</li>
            <li>analysis sessions you save to a player (title, notes, measurements, frame markers and any clip or screenshots saved with them).</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            Screenshots and clips show the player. Information about players is entered by the coach, not by the
            players themselves.
          </p>
        </Section>

        <Section title="Where your data is stored">
          <ul style={ul}>
            <li><strong>Supabase</strong> (database, sign-in and file storage): your account, player profiles, report text and structure, saved sessions, subscription and invoice records, and the encrypted YouTube token. Row-level security limits each coach to their own rows. <Confirm>the Supabase and Vercel hosting regions: the Supabase project region could not be read (the management API refused access to the project) and the repository sets no Vercel region</Confirm></li>
            <li><strong>Your own Google Drive</strong>: screenshots you save to a player, in a folder AngleMotion creates (AngleMotion / Players / the player&rsquo;s name / Screenshots). To let reports display them, each screenshot file is set so that anyone who has its link can view it. This is intentional: the link is the only protection, so save only screenshots you would be comfortable with a person holding the link seeing.</li>
            <li><strong>AngleMotion storage (Supabase Storage)</strong>: a Motion Layer clip you save with a session is stored here, at a web address that anyone who has it can open. Screenshots are not stored here: they go to your own Google Drive only. (Screenshots saved before this change may still be kept here.)</li>
            <li><strong>YouTube</strong>: videos you publish, on your channel, as Unlisted (anyone with the link can watch).</li>
            <li><strong>Stripe</strong>: payment details and the subscription. We never see your card number.</li>
          </ul>
        </Section>

        <Section title="Your responsibility for players&rsquo; data">
          When you store information about a player, you decide what is stored and why. You are responsible for having
          the right to do so under the rules that apply to you, including parental or guardian consent for players who
          are minors, and for keeping notes free of information you should not hold. If a player asks you to remove
          their data, you can delete the player in AngleMotion: this removes the player&rsquo;s profile, reports and
          saved sessions from our database, moves the player&rsquo;s Drive folder to your Drive trash (it is not erased
          until you empty the trash), and removes any images we stored ourselves. Videos on YouTube are not touched.
          You decide what player data to store and share; AngleMotion processes it on your behalf. <Confirm>legal point for a lawyer to check: AngleMotion&rsquo;s role (controller or processor) for player data, and any data-processing terms for coaches</Confirm>
        </Section>

        <Section title="Services we use">
          The services the app calls, taken from the code:
          <ul style={ul}>
            <li><strong>Supabase</strong>: database, sign-in sessions and file storage.</li>
            <li><strong>Vercel</strong>: hosting.</li>
            <li><strong>Stripe</strong>: payments, invoices and the billing portal.</li>
            <li><strong>Google</strong>: sign-in, Drive, Docs and YouTube (as above).</li>
            <li><strong>Sentry</strong>: error monitoring (see below).</li>
            <li><strong>Trustpilot</strong>: the review widget on the landing page.</li>
            <li><strong>Content delivery networks</strong> (cdn.jsdelivr.net and unpkg.com): some video tools load their code from these when you use them, so the CDN sees your IP address and browser details.</li>
            <li><strong>YouTube link resolvers</strong>: when you import a video from a YouTube link, our server looks the video up through YouTube and, if that fails, through public Piped servers. Only the video ID is sent.</li>
          </ul>
        </Section>

        <Section title="Error monitoring (Sentry)">
          When error monitoring is switched on, errors from the browser and the server are sent to Sentry, in its
          <strong> EU region only</strong> (the app refuses to start Sentry with any other region). We do not use session
          replay or performance tracing. Before anything is sent, we remove the signed-in user, cookies, request headers
          and bodies, URL query strings, blob and data URLs, image and video file names, and email addresses. A small
          &ldquo;Report a problem&rdquo; button lets you send a message you type yourself; it has no name, email or
          screenshot field, so please do not include personal details in it. Error reports can still contain technical
          details such as the page, the browser and the error text. <Confirm>whether Sentry is switched on in production: it runs only when an EU Sentry address is set in the hosting settings, which could not be read from the code</Confirm>
        </Section>

        <Section title="Data retention and deletion">
          Your saved content is kept while your account is active. You can delete a player at any time in the app: this
          removes the player&rsquo;s data from our database and moves the player&rsquo;s Drive folder to your Drive trash.
          To delete your account, email <a href="mailto:vinbaccelli@gmail.com" style={a}>vinbaccelli@gmail.com</a>; we
          handle such requests without undue delay. We do not automatically delete inactive accounts. Reports and videos
          already exported to your Google Drive and YouTube belong to you and are unaffected by deletion of your
          AngleMotion account.
        </Section>

        <Section title="Security">
          Data is transmitted over HTTPS and stored with row-level security so each coach can only access their own
          data. The Google access token from your sign-in is used for the Drive and Docs actions you request and is not stored in our database. The one stored Google credential is the encrypted YouTube refresh token described above.
        </Section>

        <Section title="Children">
          AngleMotion is a tool for coaches and is not directed at children under 13. Player profiles created by
          coaches should comply with local regulations and parental consent where applicable (see &ldquo;Your
          responsibility for players&rsquo; data&rdquo;).
        </Section>

        <Section title="Changes to this policy">
          We will post any changes on this page and update the date above. Material changes will be announced in the app.
        </Section>
      </main>
    </div>
  );
}

/**
 * A visible "still to be confirmed" tag. Nothing the code cannot answer (legal
 * basis, retention, company details, hosting regions) is stated as fact: it is
 * wrapped in this, and tests/docsWording.test.ts keeps count.
 */
function Confirm({ children }: { children: React.ReactNode }) {
  return (
    <mark style={{ background: '#ffe066', color: '#1a1a00', padding: '0 4px', borderRadius: 3, fontWeight: 700, fontSize: 12.5 }}>
      [VIN TO CONFIRM: {children}]
    </mark>
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
