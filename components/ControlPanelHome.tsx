import type { CSSProperties } from 'react';
import Link from 'next/link';
import {
  Video,
  Users,
  ClipboardList,
  Sparkles,
  UserCircle,
  Globe,
  CreditCard,
} from 'lucide-react';

const cardBase: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 20,
  borderRadius: 16,
  background: 'rgba(15, 15, 18, 0.65)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff',
  textDecoration: 'none',
  transition: 'border-color 0.15s ease, background 0.15s ease',
  minHeight: 132,
};

export default function ControlPanelHome() {
  return (
    <div style={{ padding: '20px 16px 32px', maxWidth: 1120, margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 900, letterSpacing: '-0.03em' }}>
          Control Panel
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.55, opacity: 0.82, maxWidth: 720 }}>
          Your coaching workspace: open the video lab, manage players and documents, log matches by hand, or run the AI decoder.
          Everything routes into each player&apos;s profile when you connect storage and APIs later.
        </p>
      </div>

      <h2 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', opacity: 0.55, textTransform: 'uppercase' }}>
        Primary tools
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        <Link href="/analysis" style={cardBase} className="coachlab-card-hover">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#7dd3fc' }}>
              <Video size={22} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Video Analysis</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.78 }}>
            Draw, measure angles, skeleton overlay, split-screen compare, zoom, slow motion, frame stepping, record with webcam or mic.
            Load files or URLs — no upload required.
          </p>
        </Link>

        <Link href="/players" style={cardBase} className="coachlab-card-hover">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#86efac' }}>
              <Users size={22} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Player database</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.78 }}>
            Technical sheet, match analysis timeline, and technical analysis with embedded YouTube / SwingVision clips.
            Player profiles are the hub for every document.
          </p>
        </Link>
      </div>

      <h2 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', opacity: 0.55, textTransform: 'uppercase' }}>
        Match intelligence
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        <Link href="/match-report" style={cardBase} className="coachlab-card-hover">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#fcd34d' }}>
              <ClipboardList size={22} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Manual match report</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.78 }}>
            Point-by-point logging when you don&apos;t have automated tracking — server, score, shot type, outcome, notes.
            Designed to feed the AI decoder and the player&apos;s match analysis.
          </p>
        </Link>

        <Link href="/decoder" style={cardBase} className="coachlab-card-hover">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#d8b4fe' }}>
              <Sparkles size={22} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>AI match data decoder</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.78 }}>
            Turn SwingVision exports, Gemini-assisted screenshots, or a finished manual report into stats, ratios, and patterns.
            Output will merge into match analysis when wired to your database.
          </p>
        </Link>
      </div>

      <h2 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', opacity: 0.55, textTransform: 'uppercase' }}>
        Profile &amp; business
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <Link href="/profile" style={{ ...cardBase, minHeight: 112 }} className="coachlab-card-hover">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserCircle size={20} strokeWidth={2.25} />
            <span style={{ fontSize: 15, fontWeight: 800 }}>Coach profile</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, opacity: 0.72 }}>
            Services, pricing, payment links — your public-facing coaching identity inside CoachLab.
          </p>
        </Link>

        <Link href="/catalog" style={{ ...cardBase, minHeight: 112 }} className="coachlab-card-hover">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Globe size={20} strokeWidth={2.25} />
            <span style={{ fontSize: 15, fontWeight: 800 }}>Public catalog</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, opacity: 0.72 }}>
            Optional showcase: reviews (Trustpilot / Google), socials, website — clients leave reviews with one click.
          </p>
        </Link>

        <Link href="/billing" style={{ ...cardBase, minHeight: 112 }} className="coachlab-card-hover">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CreditCard size={20} strokeWidth={2.25} />
            <span style={{ fontSize: 15, fontWeight: 800 }}>Subscription</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, opacity: 0.72 }}>
            €15/month or €120/year via Stripe — connect your account when you&apos;re ready.
          </p>
        </Link>
      </div>

      <p style={{ fontSize: 11, opacity: 0.45, lineHeight: 1.5, margin: 0, maxWidth: 640 }}>
        Infrastructure preview: videos live as unlisted YouTube links inside player documents; Google Sign-In powers uploads and future Gemini features.
      </p>

      <style>{`
        .coachlab-card-hover:hover {
          border-color: rgba(53, 103, 154, 0.55);
          background: rgba(53, 103, 154, 0.12);
        }
      `}</style>
    </div>
  );
}
