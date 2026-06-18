'use client';

import React from 'react';
import Link from 'next/link';
import {
  Instagram,
  Youtube,
  Globe,
  Mail,
  ExternalLink,
  Star,
  MessageCircle,
} from 'lucide-react';

// ── Static profile data per slug ──────────────────────────────────────────
// In production this would come from a Supabase `coach_profiles` table.
// For now, the vinbaccelli profile is hard-coded here as the launch example.

interface ServiceItem {
  id: string;
  title: string;
  description: string;
  price: string;
  ctaLabel: string;
  ctaUrl: string;
}

interface LinkItem {
  id: string;
  label: string;
  url: string;
  icon?: 'instagram' | 'youtube' | 'globe' | 'mail' | 'external';
}

interface CoachProfileData {
  slug: string;
  name: string;
  tagline: string;
  bio: string;
  avatarUrl?: string;
  accentColor: string;
  services: ServiceItem[];
  links: LinkItem[];
  socials: { instagram?: string; youtube?: string; website?: string; email?: string };
}

const PROFILES: Record<string, CoachProfileData> = {
  vinbaccelli: {
    slug: 'vinbaccelli',
    name: 'Vin Baccelli',
    tagline: 'Tennis Coach · CoachLab Founder · High Performance Analyst',
    bio: 'Professional tennis coach and data analyst. I combine on-court training with advanced video analysis and SwingVision metrics to help players of all levels improve faster. Based in Miami — coaching online worldwide.',
    accentColor: '#007AFF',
    services: [
      {
        id: 'video-analysis',
        title: 'Video Analysis Session',
        description: 'Full match or practice video breakdown using CoachLab. Receive a detailed PDF report with annotated screenshots, metrics, and a personalised training plan.',
        price: '$79',
        ctaLabel: 'Book Video Analysis',
        ctaUrl: 'https://buy.stripe.com/video-analysis',
      },
      {
        id: 'online-coaching',
        title: '1-on-1 Online Coaching',
        description: 'Weekly video call + video analysis package. Watch your game evolve week by week with progressive metrics and clear goals.',
        price: '$249 / month',
        ctaLabel: 'Start Coaching',
        ctaUrl: 'https://buy.stripe.com/online-coaching',
      },
      {
        id: 'match-report',
        title: 'AI Match Report',
        description: 'Send me your SwingVision data and I will generate a full AI-powered match decoder report: errors, winners, serve stats, tactical summary and video review list.',
        price: '$39',
        ctaLabel: 'Order Match Report',
        ctaUrl: 'https://buy.stripe.com/match-report',
      },
    ],
    links: [
      { id: 'coachlab', label: 'Try CoachLab Free', url: 'https://coachlab.app/analysis', icon: 'globe' },
      { id: 'youtube', label: 'YouTube — Technique Videos', url: 'https://youtube.com/@vinbaccelli', icon: 'youtube' },
      { id: 'instagram', label: 'Instagram', url: 'https://instagram.com/vinbaccelli', icon: 'instagram' },
      { id: 'website', label: 'vinbaccelli.com', url: 'https://vinbaccelli.com', icon: 'external' },
    ],
    socials: {
      instagram: 'https://instagram.com/vinbaccelli',
      youtube: 'https://youtube.com/@vinbaccelli',
      website: 'https://vinbaccelli.com',
      email: 'vin@coachlab.app',
    },
  },
};

const FALLBACK: CoachProfileData = {
  slug: '',
  name: 'Coach',
  tagline: 'Tennis Professional',
  bio: 'This coach has not set up their profile yet.',
  accentColor: '#007AFF',
  services: [],
  links: [],
  socials: {},
};

// ── Icon helper ────────────────────────────────────────────────────────────
function LinkIcon({ type }: { type?: string }) {
  const size = 18;
  if (type === 'instagram') return <Instagram size={size} />;
  if (type === 'youtube') return <Youtube size={size} />;
  if (type === 'globe') return <Globe size={size} />;
  if (type === 'mail') return <Mail size={size} />;
  return <ExternalLink size={size} />;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function CoachPublicProfile({ slug }: { slug: string }) {
  const profile = PROFILES[slug] ?? { ...FALLBACK, slug };
  const { accentColor } = profile;

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(160deg, #0a0a10 0%, #0f1420 100%)',
      color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* CoachLab nav bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <Link href="/" style={{ fontSize: 14, fontWeight: 800, color: '#fff', textDecoration: 'none', letterSpacing: -0.3 }}>
          Coach<span style={{ color: accentColor }}>Lab</span>
        </Link>
        <Link href="/analysis" style={{
          fontSize: 12, fontWeight: 600, color: '#fff', textDecoration: 'none',
          padding: '6px 14px', borderRadius: 20,
          background: accentColor, opacity: 0.9,
        }}>
          Try Free →
        </Link>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 20px 80px' }}>
        {/* ── Avatar + bio ── */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            width: 96, height: 96, borderRadius: '50%', margin: '0 auto 16px',
            background: `linear-gradient(135deg, ${accentColor} 0%, #5856D6 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 36, fontWeight: 900, color: '#fff',
            boxShadow: `0 0 0 4px rgba(255,255,255,0.08), 0 8px 32px ${accentColor}40`,
          }}>
            {profile.avatarUrl
              ? <img src={profile.avatarUrl} alt={profile.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
              : profile.name.charAt(0)}
          </div>
          <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 900, letterSpacing: -0.5 }}>{profile.name}</h1>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>{profile.tagline}</p>
          <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
            {profile.bio}
          </p>

          {/* Social icons */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
            {profile.socials.instagram && (
              <a href={profile.socials.instagram} target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.5)', display: 'flex' }}>
                <Instagram size={20} />
              </a>
            )}
            {profile.socials.youtube && (
              <a href={profile.socials.youtube} target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.5)', display: 'flex' }}>
                <Youtube size={20} />
              </a>
            )}
            {profile.socials.website && (
              <a href={profile.socials.website} target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.5)', display: 'flex' }}>
                <Globe size={20} />
              </a>
            )}
            {profile.socials.email && (
              <a href={`mailto:${profile.socials.email}`} style={{ color: 'rgba(255,255,255,0.5)', display: 'flex' }}>
                <Mail size={20} />
              </a>
            )}
          </div>
        </div>

        {/* ── Services ── */}
        {profile.services.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1.2, margin: '0 0 12px' }}>
              Services
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {profile.services.map(svc => (
                <div key={svc.id} style={{
                  background: 'rgba(255,255,255,0.05)', borderRadius: 14,
                  border: '1px solid rgba(255,255,255,0.1)',
                  padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{svc.title}</span>
                    <span style={{ fontWeight: 800, fontSize: 16, color: accentColor, flexShrink: 0 }}>{svc.price}</span>
                  </div>
                  <p style={{ margin: '0 0 14px', fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.55 }}>{svc.description}</p>
                  <a
                    href={svc.ctaUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'block', textAlign: 'center', padding: '10px 0',
                      borderRadius: 10, background: accentColor,
                      color: '#fff', fontWeight: 700, fontSize: 14,
                      textDecoration: 'none',
                    }}
                  >
                    {svc.ctaLabel}
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Links ── */}
        {profile.links.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1.2, margin: '0 0 12px' }}>
              Links
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {profile.links.map(link => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 18px', borderRadius: 12,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 14,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.09)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                >
                  <span style={{ color: accentColor, display: 'flex', flexShrink: 0 }}>
                    <LinkIcon type={link.icon} />
                  </span>
                  {link.label}
                  <ExternalLink size={13} style={{ marginLeft: 'auto', opacity: 0.35 }} />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* ── Leave a review CTA ── */}
        <div style={{
          textAlign: 'center', padding: '20px 0',
          borderTop: '1px solid rgba(255,255,255,0.07)',
        }}>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 10px' }}>
            Worked with {profile.name.split(' ')[0]}? Leave a review
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <a href="https://g.page/r/coachlab/review" target="_blank" rel="noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
              background: 'transparent', color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none', fontSize: 13, fontWeight: 600,
            }}>
              <Star size={14} /> Google
            </a>
            <a href="mailto:vin@coachlab.app?subject=Feedback" style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
              background: 'transparent', color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none', fontSize: 13, fontWeight: 600,
            }}>
              <MessageCircle size={14} /> Email
            </a>
          </div>
        </div>

        {/* CoachLab footer attribution */}
        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', textDecoration: 'none' }}>
            Powered by CoachLab
          </Link>
        </div>
      </div>
    </div>
  );
}
