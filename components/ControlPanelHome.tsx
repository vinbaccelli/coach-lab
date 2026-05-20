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

const shell: CSSProperties = {
  width: '100%',
  maxWidth: 1120,
  margin: '0 auto',
  minHeight: '100%',
  height: 'auto',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  padding: '24px 16px calc(100px + env(safe-area-inset-bottom, 0px))',
  background: 'linear-gradient(180deg, #FFFFFF 0%, #FAF8F5 45%, #F5F0E8 100%)',
  color: '#1A1A1A',
};

const cardBase: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 20,
  borderRadius: 16,
  background: '#FFFFFF',
  border: '1px solid #E8E6E1',
  color: '#1A1A1A',
  textDecoration: 'none',
  transition: 'border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease',
  minHeight: 132,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

export default function ControlPanelHome() {
  return (
    <div style={shell}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 900, letterSpacing: '-0.03em', color: '#111827' }}>
          Control Panel
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.55, color: '#4B5563', maxWidth: 720 }}>
          Your coaching workspace: open the video lab, manage players and documents, log matches by hand, or run the AI decoder.
          Everything routes into each player&apos;s profile when you connect storage and APIs later.
        </p>
      </div>

      <h2 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', color: '#9CA3AF', textTransform: 'uppercase' }}>
        Primary tools
      </h2>
      <div
        className="coachlab-control-grid-primary"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        <Link href="/analysis" style={cardBase} className="coachlab-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#2563EB' }}>
              <Video size={22} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Video Analysis</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#6B7280' }}>
            Draw, measure angles, skeleton overlay, split-screen compare, zoom, slow motion, frame stepping, record with webcam or mic.
            Load files or URLs — no upload required.
          </p>
        </Link>

        <Link href="/players" style={cardBase} className="coachlab-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#16A34A' }}>
              <Users size={22} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Player database</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#6B7280' }}>
            Technical sheet, match analysis timeline, and technical analysis with embedded YouTube / SwingVision clips.
            Player profiles are the hub for every document.
          </p>
        </Link>
      </div>

      <h2 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', color: '#9CA3AF', textTransform: 'uppercase' }}>
        Match intelligence
      </h2>
      <div
        className="coachlab-control-grid-match"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        <Link href="/match-report" style={cardBase} className="coachlab-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#D97706' }}>
              <ClipboardList size={22} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Manual match report</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#6B7280' }}>
            Point-by-point logging when you don&apos;t have automated tracking — server, score, shot type, outcome, notes.
            Designed to feed the AI decoder and the player&apos;s match analysis.
          </p>
        </Link>

        <Link href="/decoder" style={cardBase} className="coachlab-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#7C3AED' }}>
              <Sparkles size={22} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>AI match data decoder</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#6B7280' }}>
            Turn SwingVision exports, Gemini-assisted screenshots, or a finished manual report into stats, ratios, and patterns.
            Output will merge into match analysis when wired to your database.
          </p>
        </Link>
      </div>

      <h2 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', color: '#9CA3AF', textTransform: 'uppercase' }}>
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
        <Link href="/profile" style={{ ...cardBase, minHeight: 112 }} className="coachlab-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserCircle size={20} strokeWidth={2.25} />
            <span style={{ fontSize: 15, fontWeight: 800 }}>Coach profile</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: '#6B7280' }}>
            Services, pricing, payment links — your public-facing coaching identity inside CoachLab.
          </p>
        </Link>

        <Link href="/catalog" style={{ ...cardBase, minHeight: 112 }} className="coachlab-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Globe size={20} strokeWidth={2.25} />
            <span style={{ fontSize: 15, fontWeight: 800 }}>Public catalog</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: '#6B7280' }}>
            Optional showcase: reviews (Trustpilot / Google), socials, website — clients leave reviews with one click.
          </p>
        </Link>

        <Link href="/billing" style={{ ...cardBase, minHeight: 112 }} className="coachlab-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CreditCard size={20} strokeWidth={2.25} />
            <span style={{ fontSize: 15, fontWeight: 800 }}>Subscription</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: '#6B7280' }}>
            €15/month or €120/year via Stripe — connect your account when you&apos;re ready.
          </p>
        </Link>
      </div>

      <p style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.5, margin: 0, maxWidth: 640 }}>
        Infrastructure preview: videos live as unlisted YouTube links inside player documents; Google Sign-In powers uploads and future Gemini features.
      </p>

      <style>{`
        .coachlab-card-hover-light:hover {
          border-color: rgba(53, 103, 154, 0.45);
          box-shadow: 0 8px 28px rgba(53, 103, 154, 0.12);
          transform: translateY(-1px);
        }
        @media (max-width: 640px) {
          .coachlab-control-grid-primary,
          .coachlab-control-grid-match {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
