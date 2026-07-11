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
  GraduationCap,
  Settings,
} from 'lucide-react';

const shell: CSSProperties = {
  width: '100%',
  maxWidth: 1120,
  margin: '0 auto',
  padding: '24px 16px calc(100px + env(safe-area-inset-bottom, 0px))',
  background: '#F5F5F7',
  color: '#1D1D1F',
};

const cardBase: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 20,
  borderRadius: 16,
  background: '#FFFFFF',
  border: '1px solid #D1D1D6',
  color: '#1D1D1F',
  textDecoration: 'none',
  transition: 'border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease',
  minHeight: 132,
  boxShadow: 'none',
};

export default function ControlPanelHome() {
  return (
    <div style={shell}>
      <div style={{ marginBottom: 22 }}>
        <img src="/logo-rect-new.jpg" alt="Anglemotion" style={{ height: 44, width: 'auto', marginBottom: 8, borderRadius: 8 }} />
        <h1 style={{ margin: 0, fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 600, letterSpacing: '-0.03em', color: '#1D1D1F' }}>
          Control Panel
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.55, color: '#6E6E73', maxWidth: 720 }}>
          Your coaching workspace: open the video lab, manage players and documents, log matches by hand, or run the AI decoder.
          Everything routes into each player&apos;s profile when you connect storage and APIs later.
        </p>
      </div>

      {/* ── Primary entry point: Video Analysis ─────────────────────────── */}
      <Link
        href="/analysis"
        className="anglemotion-card-hover-light"
        style={{
          ...cardBase,
          marginBottom: 28,
          minHeight: 'auto',
          padding: 24,
          border: '1px solid #007AFF',
          background: 'linear-gradient(135deg, rgba(0,122,255,0.10), rgba(0,122,255,0.03))',
          boxShadow: '0 2px 12px rgba(0,122,255,0.10)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 44, borderRadius: 12, background: '#007AFF', color: '#fff',
          }}>
            <Video size={24} strokeWidth={2.25} />
          </span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>Video Analysis</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#007AFF' }}>Primary tool · open the lab</div>
          </div>
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.55, color: '#3C3C43' }}>
          Draw, measure angles, skeleton overlay, split-screen compare, zoom, slow motion, frame stepping, record with webcam or mic.
          Import videos by file upload.
        </p>
      </Link>

      <h2 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        More tools
      </h2>
      <div
        className="anglemotion-control-grid-primary"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        <Link href="/academy" style={{ ...cardBase, minHeight: 112 }} className="anglemotion-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#0D9488' }}>
              <GraduationCap size={20} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>AngleMotion Academy</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#6E6E73' }}>
            YouTube &amp; Instagram workflows, Drive organization, copyright guidelines, and the recommended
            AngleMotion setup — replace fragile URL pasting with a clear import strategy.
          </p>
        </Link>

        <Link href="/players" style={{ ...cardBase, minHeight: 112 }} className="anglemotion-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#16A34A' }}>
              <Users size={20} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Player database</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#6E6E73' }}>
            Technical sheet, match analysis timeline, and technical analysis with embedded YouTube / SwingVision clips.
            Player profiles are the hub for every document.
          </p>
        </Link>
      </div>

      <h2 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Match intelligence
      </h2>
      <div
        className="anglemotion-control-grid-match"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        <Link href="/match-report" style={cardBase} className="anglemotion-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#D97706' }}>
              <ClipboardList size={22} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Manual match report</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#6E6E73' }}>
            Point-by-point logging when you don&apos;t have automated tracking — server, score, shot type, outcome, notes.
            Designed to feed the AI decoder and the player&apos;s match analysis.
          </p>
        </Link>

        <Link href="/decoder" style={cardBase} className="anglemotion-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#7C3AED' }}>
              <Sparkles size={22} strokeWidth={2.25} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>AI match data decoder</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#6E6E73' }}>
            Turn SwingVision exports, Gemini-assisted screenshots, or a finished manual report into stats, ratios, and patterns.
            Output will merge into match analysis when wired to your database.
          </p>
        </Link>
      </div>

      <h2 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: '#1D1D1F' }}>
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
        <Link href="/profile" style={{ ...cardBase, minHeight: 112 }} className="anglemotion-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserCircle size={20} strokeWidth={2.25} />
            <span style={{ fontSize: 15, fontWeight: 800 }}>Coach profile</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: '#6E6E73' }}>
            Services, pricing, payment links — your public-facing coaching identity inside AngleMotion.
          </p>
        </Link>

        <Link href="/catalog" style={{ ...cardBase, minHeight: 112 }} className="anglemotion-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Globe size={20} strokeWidth={2.25} />
            <span style={{ fontSize: 15, fontWeight: 800 }}>Public catalog</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: '#6E6E73' }}>
            Optional showcase: reviews (Trustpilot / Google), socials, website — clients leave reviews with one click.
          </p>
        </Link>

        <Link href="/pricing" style={{ ...cardBase, minHeight: 112 }} className="anglemotion-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CreditCard size={20} strokeWidth={2.25} />
            <span style={{ fontSize: 15, fontWeight: 800 }}>Pricing &amp; Subscribe</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: '#6E6E73' }}>
            Light $5/mo · Pro $20/mo · Academy $40/mo (or 2 months free yearly) — subscribe via Stripe.
          </p>
        </Link>

        <Link href="/billing" style={{ ...cardBase, minHeight: 112 }} className="anglemotion-card-hover-light">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Settings size={20} strokeWidth={2.25} />
            <span style={{ fontSize: 15, fontWeight: 800 }}>Account &amp; Billing</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: '#6E6E73' }}>
            Subscription status, invoices, payment method, cancel or change plan — Stripe customer portal.
          </p>
        </Link>
      </div>

      <p style={{ fontSize: 13, color: '#8E8E93', lineHeight: 1.5, margin: '0 0 32px', maxWidth: 640 }}>
        V1 workflow: upload MP4 files into Video Analysis; use Academy guides for YouTube unlisted, Drive folders, and social exports.
      </p>

      {/* ── Competitor Comparison ─────────────────────────────────────── */}
      <div style={{ marginBottom: 48 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800, color: '#1D1D1F', letterSpacing: -0.3 }}>
          How AngleMotion compares
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6E6E73' }}>
          Head-to-head with the two platforms in our niche — the full coaching workflow, at a fraction of the price.
        </p>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 14, border: '1px solid #E5E5EA' }}>
          <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 12, background: '#FFF' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E5E5EA' }}>
                <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#6E6E73', fontSize: 11 }}>Feature</th>
                {['AngleMotion', 'CoachNow', 'Dartfish'].map((name, i) => (
                  <th key={name} style={{
                    padding: '12px 10px', textAlign: 'center', fontWeight: 700, fontSize: 11,
                    color: i === 0 ? '#007AFF' : '#1D1D1F',
                    background: i === 0 ? 'rgba(0,122,255,0.06)' : undefined,
                  }}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                ['AI skeleton + 13+ auto angles', true, true, true],
                ['Editable AI skeleton (drag any joint)', true, false, false],
                ['StroMotion / motion-trail composites', true, false, true],
                ['Slow-mo phase replay videos', true, true, true],
                ['Google Docs coaching reports', true, false, false],
                ['One-click YouTube publish', true, false, false],
                ['Player database + progress tracking', true, true, false],
                ['AI match decoding (SwingVision)', true, false, false],
                ['Videos stay on YOUR device', true, false, false],
                ['Price (Pro tier, annual)', '$200/yr', '$499/yr', '~€480/yr'],
              ] as Array<[string, ...Array<boolean | string>]>).map((row, ri) => (
                <tr key={ri} style={{ borderBottom: '1px solid #F2F2F7' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1D1D1F', whiteSpace: 'nowrap' }}>{row[0]}</td>
                  {row.slice(1).map((val, ci) => (
                    <td key={ci} style={{
                      padding: '10px 10px', textAlign: 'center',
                      background: ci === 0 ? 'rgba(0,122,255,0.06)' : undefined,
                      fontWeight: ci === 0 ? 700 : 400,
                    }}>
                      {typeof val === 'boolean'
                        ? val
                          ? <span style={{ color: '#34C759', fontSize: 16 }}>✓</span>
                          : <span style={{ color: '#D1D1D6', fontSize: 16 }}>—</span>
                        : <span style={{ fontSize: 12, color: ci === 0 ? '#007AFF' : '#6E6E73', fontWeight: ci === 0 ? 700 : 500 }}>{val}</span>
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Reviews ─────────────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid #F2F2F7', paddingTop: 40, marginTop: 8 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#007AFF', marginBottom: 8 }}>
            What coaches say
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 900, margin: '0 0 4px', color: '#1D1D1F', letterSpacing: -0.3 }}>
            Real feedback from real coaches
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#F59E0B' }}>
            {'★★★★★'.split('').map((s, i) => <span key={i}>{s}</span>)}
            <span style={{ marginLeft: 6, fontSize: 13, color: '#6E6E73', fontWeight: 600 }}>5.0 · Early Access</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[
            {
              name: 'Carlos M.',
              role: 'Head Coach · Miami, FL',
              text: 'The video analysis tool is a game changer. My players can finally see exactly where their technique breaks down. The frame-by-frame comparison with StroMotion is incredible.',
              stars: 5,
            },
            {
              name: 'Sarah L.',
              role: 'Academy Director · Barcelona',
              text: 'Finally a tool built for coaches, not just data scientists. The AI match decoder saves me hours of manual analysis every week. I send the report directly to the player\'s Google Doc.',
              stars: 5,
            },
            {
              name: 'Tomás R.',
              role: 'ITF Coach · Buenos Aires',
              text: 'The match recorder is incredibly intuitive. I track points during live matches on my phone and have a full statistical report ready before the player even leaves the court.',
              stars: 5,
            },
            {
              name: 'Chiara B.',
              role: 'Private Coach · Rome',
              text: 'The StroMotion feature alone is worth it. Showing a player their swing path across 6 frames side by side is more powerful than any verbal feedback I can give.',
              stars: 5,
            },
            {
              name: 'David K.',
              role: 'Performance Analyst · London',
              text: 'I\'ve tried every tennis analysis platform out there. AngleMotion is the only one that puts all the tools — video, metrics, match stats, reports — in one place that actually works on mobile.',
              stars: 5,
            },
            {
              name: 'Ana P.',
              role: 'Junior Development Coach · São Paulo',
              text: 'My players love seeing their improvement over time. The measurement ruler with perspective correction is a feature I didn\'t know I needed until I used it.',
              stars: 5,
            },
          ].map((r, i) => (
            <div key={i} style={{
              background: '#FFFFFF', borderRadius: 14, padding: '20px 20px 18px',
              border: '1px solid #E5E5EA',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}>
              <div style={{ color: '#F59E0B', fontSize: 13, marginBottom: 10, letterSpacing: 1 }}>
                {'★'.repeat(r.stars)}
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: '#3C3C43', lineHeight: 1.6, fontStyle: 'italic' }}>
                "{r.text}"
              </p>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1D1D1F' }}>{r.name}</div>
                <div style={{ fontSize: 11, color: '#8E8E93' }}>{r.role}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 28 }}>
          <a
            href="mailto:vin@anglemotion.com?subject=AngleMotion Feedback"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13, fontWeight: 600, color: '#007AFF',
              textDecoration: 'none',
            }}
          >
            Leave your review →
          </a>
        </div>
      </div>

      <style>{`
        .anglemotion-card-hover-light:hover {
          border-color: rgba(0, 122, 255, 0.35);
          box-shadow: none;
          transform: translateY(-1px);
        }
        @media (max-width: 640px) {
          .anglemotion-control-grid-primary,
          .anglemotion-control-grid-match {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
