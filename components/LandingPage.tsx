'use client';

/**
 * Public marketing landing page (CoachNow-style) shown to logged-out visitors.
 * Copy + verified competitor table from research (anglemotion-landing-research).
 * The comparison table uses ONLY verified data; unknowns are '?'.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Check, X, Minus, ChevronDown } from 'lucide-react';

const ACCENT = '#FF3B30';
const INK = '#1D1D1F';
const MUTED = '#6E6E73';

const features = [
  {
    h: 'The AI does the work. You keep the final say.',
    b: 'AngleMotion auto-detects 13+ real joint angles and every skeleton keypoint on your player’s stroke — then hands you the pen. Drag any point, correct any angle, trust the read. AI-fast for the 90%, coach-accurate for the 10% that matters. No black box you can’t touch.',
    micro: 'Trust the AI for speed. Trust yourself for the truth.',
  },
  {
    h: 'Measure the stroke, not just watch it.',
    b: 'Shoulder, hip, knee, elbow — AngleMotion reads 13+ joint angles automatically and shows the numbers right on the frame. Compare a serve to a model, prove why a stroke breaks down, and back every note with a real measurement instead of a guess.',
  },
  {
    h: 'See what the eye can’t — with StroMotion.',
    b: 'Turn any swing into a multi-position motion-trail composite — as a still and as video. The whole stroke, frozen across space, so a student instantly sees the path their body took. The demo that sells your coaching and the shareable that markets it.',
    micro: 'Plus — it looks incredible.',
  },
  {
    h: 'Break the stroke into phases — in slow motion.',
    b: 'Snapshot every phase of the stroke and replay it frame-by-frame in slow motion, side-by-side, with angle overlays. Then screen-record it with your webcam and mic to deliver a same-day coaching video your player can rewatch until it clicks.',
  },
  {
    h: 'One platform for every player you coach.',
    b: 'A player database, two Google Docs per student (technical + match analysis), a technical sheet, and progress tracking across the whole season. Rivals hand you a clip and stop — AngleMotion is the client file, the deliverable, and the storefront in one place.',
    micro: 'Every student’s technical story in one file — from first lesson to nationals.',
  },
  {
    h: 'Record, report, and publish without leaving the app.',
    b: 'Capture your screen, webcam, and mic in one hub, drop it into a Google Docs coaching report, and push it to YouTube in a click. The Match Decoder even reads SwingVision screenshots and folds match stats into the player’s file. Kill the five-tool, duct-taped workflow.',
  },
];

// Verified comparison (research-checked). y=yes, n=no, q='?'.
const COMPARE_COLS = ['AngleMotion', 'Dartfish', 'CoachNow', 'OnForm', 'Kinovea', 'SwingVision'];
const COMPARE_ROWS: Array<{ label: string; cells: Array<'y' | 'n' | 'q' | string> }> = [
  { label: 'Price (annual)', cells: ['$200/yr', '€7–180/mo', '$59–899/yr', '~$20–60/mo', 'Free', '$179.99/yr'] },
  { label: 'AI pose / skeleton overlay', cells: ['y', 'y', 'y', 'q', 'n', 'n'] },
  { label: 'Angle measurement (auto)', cells: ['y', 'y', 'y', 'y', 'y', 'n'] },
  { label: 'Editable AI skeleton (override by hand)', cells: ['y', 'n', 'q', 'q', 'n', 'n'] },
  { label: 'Slow-mo / frame-by-frame', cells: ['y', 'y', 'y', 'y', 'y', 'y'] },
  { label: 'Drawing / telestration', cells: ['y', 'y', 'y', 'y', 'y', 'q'] },
  { label: 'Side-by-side compare', cells: ['y', 'y', 'y', 'y', 'y', 'n'] },
  { label: 'StroMotion / motion-trail composite', cells: ['y', 'y', 'n', 'q', 'q', 'n'] },
  { label: 'Coaching report (Google Docs)', cells: ['y', 'q', 'q', 'q', 'n', 'y'] },
  { label: 'Player database / client file', cells: ['y', 'q', 'y', 'y', 'n', 'n'] },
  { label: 'Videos stay local (no cloud lock-in)', cells: ['y', 'n', 'n', 'n', 'y', 'n'] },
  { label: 'One-click YouTube publish', cells: ['y', 'q', 'q', 'q', 'n', 'q'] },
  { label: 'SwingVision stat import (Match Decoder)', cells: ['y', 'n', 'n', 'n', 'n', 'q'] },
];

const faqs = [
  { q: 'What is AngleMotion?', a: 'A browser-based tennis video-analysis platform: AI skeleton + angle detection you can edit by hand, StroMotion composites, slow-motion phase replays, a recording hub, and per-player Google Docs coaching reports — all in one place.' },
  { q: 'Does the AI replace my judgment?', a: 'No. Every skeleton point and angle the AI detects is editable — drag it, correct it, trust it. AI does the fast 90%; you own the 10% that matters.' },
  { q: 'Do my videos get uploaded to a cloud?', a: 'No. Your footage is processed locally in your browser and stays on your device. Only the reports and clips you explicitly export go to your own Google Drive / YouTube.' },
  { q: 'What do I need to run it?', a: 'Just a browser — nothing to install. A laptop or desktop with graphics acceleration on gives the smoothest AI skeleton.' },
  { q: 'How does the yearly plan and free eBook work?', a: 'Go yearly ($200/yr — 2 months free vs monthly) and we include our tennis biomechanics eBook, the coach’s guide to reading every stroke.' },
  { q: 'Can I use my SwingVision data?', a: 'Yes — the Match Decoder reads SwingVision screenshots and folds match stats into the player’s file.' },
];

function Cell({ v }: { v: string }) {
  if (v === 'y') return <Check size={18} style={{ color: '#30A46C' }} aria-label="yes" />;
  if (v === 'n') return <X size={16} style={{ color: '#C4C4C6' }} aria-label="no" />;
  if (v === 'q') return <Minus size={16} style={{ color: '#C4C4C6' }} aria-label="unknown" />;
  return <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{v}</span>;
}

export default function LandingPage() {
  const [annual, setAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div style={{ height: '100dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#fff', color: INK, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* NAV */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #EEE' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/logo-square-new.jpg" alt="AngleMotion" style={{ width: 28, height: 28, borderRadius: 6 }} />
          <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: -0.3 }}>Angle<span style={{ color: ACCENT }}>Motion</span></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="#features" style={navLink}>Features</a>
          <a href="#pricing" style={navLink}>Pricing</a>
          <a href="#compare" style={navLink}>Compare</a>
          <Link href="/login" style={{ ...navLink, fontWeight: 600 }}>Sign In</Link>
          <Link href="/login" style={ctaBtn}>Start Free</Link>
        </div>
      </nav>

      {/* HERO */}
      <header style={{ maxWidth: 960, margin: '0 auto', padding: '72px 20px 40px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(32px, 6vw, 56px)', fontWeight: 900, letterSpacing: -1.5, lineHeight: 1.05, margin: '0 0 18px' }}>
          AI that sees every angle.<br /><span style={{ color: ACCENT }}>Coaching that stays yours.</span>
        </h1>
        <p style={{ fontSize: 'clamp(15px, 2.4vw, 19px)', color: MUTED, lineHeight: 1.55, maxWidth: 680, margin: '0 auto 28px' }}>
          Auto-detect 13+ joint angles and every skeleton point — then edit anything by hand. Build slow-mo phase replays, StroMotion trails, and a branded coaching report your students actually keep. Runs in your browser; your footage stays yours.
        </p>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/login" style={{ ...ctaBtn, fontSize: 16, padding: '14px 30px' }}>Start Free</Link>
          <a href="#how" style={{ ...navLink, fontWeight: 600, color: ACCENT }}>See how it works {'→'}</a>
        </div>
        <p style={{ fontSize: 13, color: MUTED, marginTop: 18 }}>
          Go yearly and get our free tennis biomechanics eBook — the coach’s guide to reading every stroke.
        </p>
      </header>

      {/* TRUST STRIP */}
      <section style={{ background: '#FAFAFA', borderTop: '1px solid #EEE', borderBottom: '1px solid #EEE', padding: '20px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
          {['Runs in your browser — nothing to install', 'Your videos stay local — no cloud lock-in', 'Works with Google Docs, YouTube & SwingVision'].map((t) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: INK }}>
              <Check size={16} style={{ color: '#30A46C', flexShrink: 0 }} /> {t}
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" style={{ maxWidth: 900, margin: '0 auto', padding: '64px 20px 20px' }}>
        {features.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 24, alignItems: 'center', flexDirection: i % 2 ? 'row-reverse' : 'row', flexWrap: 'wrap', marginBottom: 44 }}>
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <h3 style={{ fontSize: 'clamp(22px, 3.4vw, 30px)', fontWeight: 800, letterSpacing: -0.5, margin: '0 0 12px', lineHeight: 1.15 }}>{f.h}</h3>
              <p style={{ fontSize: 15.5, color: MUTED, lineHeight: 1.6, margin: 0 }}>{f.b}</p>
              {f.micro && <p style={{ fontSize: 14, fontWeight: 700, color: ACCENT, margin: '10px 0 0' }}>{f.micro}</p>}
            </div>
            <div style={{ flex: '1 1 280px', minWidth: 240, height: 200, borderRadius: 16, background: 'linear-gradient(135deg, #0a0a10, #1a2740)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13, fontWeight: 600 }}>
              Product screenshot
            </div>
          </div>
        ))}
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{ background: '#FAFAFA', borderTop: '1px solid #EEE', borderBottom: '1px solid #EEE', padding: '56px 20px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: 900, letterSpacing: -0.5, margin: '0 0 32px' }}>From video to student-ready report in three steps.</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
            {[
              ['1', 'Record', 'Drop in any tennis video, or capture live in your browser.'],
              ['2', 'Analyze', 'AI maps the skeleton and angles; you edit and add StroMotion + slow-mo.'],
              ['3', 'Share', 'Export a branded Google Docs report or push to YouTube in one click.'],
            ].map(([n, t, d]) => (
              <div key={n} style={{ background: '#fff', border: '1px solid #EEE', borderRadius: 14, padding: 20 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: ACCENT, color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>{n}</div>
                <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>{t}</div>
                <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMPARISON */}
      <section id="compare" style={{ maxWidth: 1000, margin: '0 auto', padding: '64px 20px' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(22px, 3.6vw, 32px)', fontWeight: 900, letterSpacing: -0.5, margin: '0 0 8px', lineHeight: 1.15 }}>
          Editable AI biomechanics, a coaching-business workflow, and local video — in one tool.
        </h2>
        <p style={{ textAlign: 'center', fontSize: 15, color: MUTED, margin: '0 0 28px' }}>Every rival makes you pick two of the three. Here’s the honest breakdown.</p>
        <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid #E5E5EA', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13, background: '#fff' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E5E5EA' }}>
                <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: MUTED, fontWeight: 600 }}>Feature</th>
                {COMPARE_COLS.map((c, i) => (
                  <th key={c} style={{ padding: '12px 8px', textAlign: 'center', fontSize: 12, fontWeight: 800, color: i === 0 ? ACCENT : INK, background: i === 0 ? 'rgba(255,59,48,0.06)' : undefined }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((r, ri) => (
                <tr key={r.label} style={{ borderBottom: '1px solid #F0F0F0' }}>
                  <td style={{ padding: '10px 14px', color: INK, fontWeight: 500 }}>{r.label}</td>
                  {r.cells.map((v, ci) => (
                    <td key={ci} style={{ padding: '10px 8px', textAlign: 'center', background: ci === 0 ? 'rgba(255,59,48,0.04)' : undefined }}>
                      <Cell v={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11, color: MUTED, marginTop: 10 }}>Verified data; “–” means uncertain/undocumented, not a claim of absence. Prices approximate; check each vendor for current pricing.</p>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ background: '#FAFAFA', borderTop: '1px solid #EEE', padding: '64px 20px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: 900, letterSpacing: -0.5, margin: '0 0 8px' }}>Less than one lesson a month.</h2>
          <p style={{ fontSize: 15, color: MUTED, margin: '0 0 24px' }}>A full coaching platform for barely more than a player-only stats app. Try it free, then keep the tools that grow your business all season.</p>
          <div style={{ display: 'inline-flex', background: '#EDEDED', borderRadius: 999, padding: 4, marginBottom: 28 }}>
            <button type="button" onClick={() => setAnnual(true)} style={toggleBtn(annual)}>Annual <span style={{ fontSize: 10, fontWeight: 800, color: annual ? '#fff' : ACCENT }}>· 2 mo free</span></button>
            <button type="button" onClick={() => setAnnual(false)} style={toggleBtn(!annual)}>Monthly</button>
          </div>
          <div style={{ display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap' }}>
            {/* Featured plan */}
            <div style={{ flex: '1 1 320px', maxWidth: 380, background: '#fff', border: `2px solid ${ACCENT}`, borderRadius: 18, padding: 26, textAlign: 'left', boxShadow: '0 12px 40px rgba(255,59,48,0.12)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT }}>{annual ? 'ANNUAL' : 'MONTHLY'}</span>
                {annual && <span style={{ fontSize: 10, fontWeight: 800, background: ACCENT, color: '#fff', padding: '2px 8px', borderRadius: 999 }}>MOST POPULAR</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 40, fontWeight: 900, letterSpacing: -1 }}>{annual ? '$200' : '$20'}</span>
                <span style={{ fontSize: 15, color: MUTED }}>{annual ? '/yr' : '/mo'}</span>
                {annual && <span style={{ fontSize: 15, color: '#B0B0B5', textDecoration: 'line-through' }}>$240</span>}
              </div>
              <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 14px' }}>{annual ? '$16.67/mo · 2 months free' : 'Switch to yearly anytime for 2 months free + the eBook.'}</p>
              {annual && <div style={{ fontSize: 12, fontWeight: 700, color: ACCENT, background: 'rgba(255,59,48,0.08)', padding: '6px 10px', borderRadius: 8, marginBottom: 14 }}>Includes the free tennis biomechanics eBook</div>}
              <Link href="/pricing" style={{ ...ctaBtn, display: 'block', textAlign: 'center', padding: '12px', fontSize: 15 }}>Start Free</Link>
              <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {['Editable AI skeleton + 13+ angle detection', 'StroMotion composites (image + video)', 'Slow-mo phase replays + side-by-side', 'Player database + 2 Google Docs per player', 'Technical sheet + progress tracking', 'Recording hub (screen / webcam / mic)', 'One-click YouTube publish', 'SwingVision Match Decoder', 'Your videos stay local'].map((li) => (
                  <li key={li} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: INK }}><Check size={16} style={{ color: '#30A46C', flexShrink: 0, marginTop: 1 }} /> {li}</li>
                ))}
              </ul>
            </div>
          </div>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 18 }}>Start with a free trial — no commitment. One retained student pays for the whole year.</p>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ maxWidth: 760, margin: '0 auto', padding: '56px 20px' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(22px, 3.6vw, 30px)', fontWeight: 900, letterSpacing: -0.5, margin: '0 0 24px' }}>Questions, answered.</h2>
        {faqs.map((f, i) => (
          <div key={i} style={{ borderBottom: '1px solid #EEE' }}>
            <button type="button" onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 16, fontWeight: 700, color: INK }}>
              {f.q}
              <ChevronDown size={18} style={{ flexShrink: 0, transform: openFaq === i ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: MUTED }} />
            </button>
            {openFaq === i && <p style={{ margin: '0 0 16px', fontSize: 14.5, color: MUTED, lineHeight: 1.6 }}>{f.a}</p>}
          </div>
        ))}
      </section>

      {/* FINAL CTA */}
      <section style={{ background: 'linear-gradient(160deg, #0a0a10 0%, #14203a 100%)', color: '#fff', padding: '64px 20px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 'clamp(26px, 4.4vw, 40px)', fontWeight: 900, letterSpacing: -1, margin: '0 0 12px' }}>Ready to raise your game?</h2>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', maxWidth: 560, margin: '0 auto 26px', lineHeight: 1.55 }}>
          Analyze faster, teach clearer, and grow your coaching business — for less than one lesson a month. Go yearly and get the free tennis biomechanics eBook.
        </p>
        <Link href="/login" style={{ ...ctaBtn, fontSize: 16, padding: '14px 32px' }}>Start Free</Link>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 16 }}>Annual is 2 months free — and the eBook’s on us.</p>
      </section>

      {/* FOOTER */}
      <footer style={{ background: '#0a0a10', color: 'rgba(255,255,255,0.6)', padding: '32px 20px', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 14 }}>
          <img src="/logo-square-new.jpg" alt="AngleMotion" style={{ width: 24, height: 24, borderRadius: 5 }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Angle<span style={{ color: ACCENT }}>Motion</span></span>
        </div>
        <div style={{ display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap', fontSize: 13, marginBottom: 12 }}>
          <a href="#features" style={footLink}>Features</a>
          <a href="#pricing" style={footLink}>Pricing</a>
          <Link href="/privacy" style={footLink}>Privacy</Link>
          <Link href="/terms" style={footLink}>Terms</Link>
          <Link href="/login" style={footLink}>Sign In</Link>
        </div>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: 0 }}>{'©'} 2026 AngleMotion. Built by tennis coaches.</p>
      </footer>
    </div>
  );
}

const navLink: React.CSSProperties = { fontSize: 14, color: INK, textDecoration: 'none', fontWeight: 500 };
const footLink: React.CSSProperties = { color: 'rgba(255,255,255,0.6)', textDecoration: 'none' };
const ctaBtn: React.CSSProperties = { display: 'inline-block', background: ACCENT, color: '#fff', fontWeight: 700, fontSize: 14, padding: '9px 20px', borderRadius: 999, textDecoration: 'none', border: 'none', cursor: 'pointer' };
function toggleBtn(active: boolean): React.CSSProperties {
  return { padding: '8px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: active ? ACCENT : 'transparent', color: active ? '#fff' : INK };
}
